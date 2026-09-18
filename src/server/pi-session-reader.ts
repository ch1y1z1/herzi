import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import type {
  ChatDiffLine,
  ChatDividerKind,
  ChatJsonObject,
  ChatMessage,
  ChatPart,
  ChatQuestionAnswer,
  ChatSnapshot,
  ChatTodosSnapshot,
  ChatToolDisplay,
  ChatToolResultPayload,
} from "../shared/protocol.js";
import { buildTodoSnapshot, isTodoDetails, type TodoDetails } from "../shared/todo-tasks.js";
import { extractManagedAttachments } from "./managed-attachments.js";

interface PiEntry {
  id: string;
  parentId?: string | null;
  timestamp?: string;
  type: string;
  message?: PiMessage;
  /** `compaction` / `branch_summary` entries only. */
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  details?: unknown;
}

interface PiMessage {
  role: "user" | "assistant" | "toolResult" | string;
  content?: PiContent[] | string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  stopReason?: string;
  /** `todo` tool results carry their full state here. */
  details?: unknown;
}

type PiContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "toolCall";
      id: string;
      name: string;
      arguments?: ChatJsonObject;
    }
  | Record<string, unknown>;

const imageHashes = new WeakMap<object, string>();

interface CacheEntry {
  mtimeMs: number;
  size: number;
  entries: PiEntry[];
}

type ManagedAttachmentResolver = (
  uploadId: string,
  paneId: string,
  sessionPath: string,
) => Promise<
  | { image: string; name: string; mimeType: string; sha256: string }
  | null
>;

export class PiSessionReader {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly resolveManagedAttachment?: ManagedAttachmentResolver) {}

  async read(
    paneId: string,
    sessionPath: string,
    running: boolean,
    branchLeafId?: string | null,
  ): Promise<ChatSnapshot> {
    const fileStat = await stat(sessionPath);
    let cached = this.cache.get(sessionPath);

    if (!cached || cached.mtimeMs !== fileStat.mtimeMs || cached.size !== fileStat.size) {
      const source = await readFile(sessionPath, "utf8");
      const entries = parseJsonLines(source);
      cached = {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        entries,
      };
      this.cache.set(sessionPath, cached);
    }

    const messages = convertActiveBranch(cached.entries, branchLeafId);
    return {
      paneId,
      running,
      updatedAt: cached.mtimeMs,
      messages: this.resolveManagedAttachment
        ? await hydrateManagedAttachments(
            messages.messages,
            paneId,
            sessionPath,
            this.resolveManagedAttachment,
          )
        : messages.messages,
      ...(messages.todos ? { todos: messages.todos } : {}),
    };
  }
}

function parseJsonLines(source: string): PiEntry[] {
  const entries: PiEntry[] = [];
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as PiEntry;
      if (entry && typeof entry.id === "string" && typeof entry.type === "string") {
        entries.push(entry);
      }
    } catch {
      // A final partial line is normal while Pi is appending to the session.
    }
  }
  return entries;
}

interface BranchConversion {
  messages: ChatMessage[];
  /** Last `todo` snapshot on the branch; absent when the tool was never used. */
  todos?: ChatTodosSnapshot;
}

/**
 * Converts the active branch into chat messages.
 *
 * Every `message` entry becomes a chat message. `compaction` and
 * `branch_summary` entries become a divider message instead of being dropped,
 * and no history is hidden: the divider only marks where the model's context
 * starts (decision P2).
 */
function convertActiveBranch(
  entries: PiEntry[],
  branchLeafId?: string | null,
): BranchConversion {
  if (!entries.length) return { messages: [] };

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: PiEntry[] = [];
  const visited = new Set<string>();
  let cursor: PiEntry | undefined =
    branchLeafId === undefined
      ? entries.at(-1)
      : branchLeafId === null
        ? undefined
        : byId.get(branchLeafId);

  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  branch.reverse();

  const branchIndexById = new Map(
    branch.map((entry, index) => [entry.id, index] as const),
  );

  const toolResults = new Map<string, ToolResultEntry>();
  let todoSource: { details: TodoDetails; updatedAt: number } | undefined;
  for (const entry of branch) {
    const message = entry.message;
    if (entry.type !== "message" || !message) continue;
    // The `todo` extension returns its complete state on every successful call,
    // so the last matching result on the branch is the state. Only the tool
    // name and the documented `details` shape are required.
    if (message.toolName === "todo" && isTodoDetails(message.details)) {
      todoSource = {
        details: message.details,
        updatedAt: entryWrittenAt(entry) ?? 0,
      };
    }
    if (message.role !== "toolResult") continue;
    if (!message.toolCallId) continue;
    const display = projectToolDisplay(
      message.toolName,
      message.details,
      toolResultText(message.content),
    );
    toolResults.set(message.toolCallId, {
      result: toolResultValue(message.content),
      isError: Boolean(message.isError),
      toolName: message.toolName,
      ...(display ? { display } : {}),
    });
  }

  // Only the surviving snapshot is projected and size-checked, so a long
  // session with hundreds of `todo` calls does not pay for the discarded ones.
  const todos = todoSource
    ? buildTodoSnapshot(todoSource.details, todoSource.updatedAt)
    : undefined;

  const reasoningDurations = reasoningDurationsByEntry(branch);

  // Messages and dividers are placed by their position in the branch. A
  // divider sorts before the entry it announces, so a message uses rank 1 and a
  // divider rank 0; the sort is stable, so several dividers at the same
  // boundary keep their branch order.
  type Slot =
    | { boundary: number; rank: 1; message: ChatMessage }
    | {
        boundary: number;
        rank: 0;
        entry: PiEntry;
        dividerKind: ChatDividerKind;
      };

  const slots: Slot[] = [];
  branch.forEach((entry, entryIndex) => {
    const message = entry.message;
    if (entry.type !== "message" || !message) return;
    if (message.role !== "user" && message.role !== "assistant") return;

    const content = attachReasoningDuration(
      convertContent(message.content, toolResults),
      reasoningDurations.get(entry.id),
    );
    if (!content.length) return;

    const entryTimestamp = Date.parse(entry.timestamp ?? "");

    slots.push({
      boundary: entryIndex,
      rank: 1,
      message: {
        id: entry.id,
        role: message.role,
        createdAt:
          typeof message.timestamp === "number"
            ? message.timestamp
            : entryTimestamp || 0,
        ...(message.role === "assistant" && Number.isFinite(entryTimestamp)
          ? { completedAt: entryTimestamp }
          : {}),
        content,
        ...(message.role === "assistant"
          ? { status: statusFromStopReason(message.stopReason) }
          : {}),
      },
    });
  });

  branch.forEach((entry, entryIndex) => {
    const dividerKind = dividerKindFor(entry);
    if (!dividerKind) return;

    // Decision P1: the compaction divider marks the semantic boundary, i.e. the
    // first entry that stays in the model's context. `firstKeptEntryId` may be
    // missing or live on another branch; then the divider falls back to the
    // position of the compaction entry itself instead of failing.
    const keptIndex =
      dividerKind === "compaction" && typeof entry.firstKeptEntryId === "string"
        ? branchIndexById.get(entry.firstKeptEntryId)
        : undefined;

    slots.push({
      boundary: keptIndex ?? entryIndex,
      rank: 0,
      entry,
      dividerKind,
    });
  });

  slots.sort(
    (left, right) => left.boundary - right.boundary || left.rank - right.rank,
  );

  const messages: ChatMessage[] = [];
  slots.forEach((slot, index) => {
    if (slot.rank === 1) {
      messages.push(slot.message);
      return;
    }

    /** Timestamp of the nearest real message, used to keep the divider where it
     * was inserted: `mergeRealtime`/`mergePendingUserMessages` re-sort messages
     * by `createdAt`, so a marker carrying the (later) compaction time would be
     * pushed below the messages it belongs before. */
    const neighbourAt = (direction: -1 | 1): number | undefined => {
      for (
        let cursor = index + direction;
        cursor >= 0 && cursor < slots.length;
        cursor += direction
      ) {
        const candidate = slots[cursor];
        if (candidate.rank === 1) {
          const at = validTimestamp(candidate.message.createdAt);
          if (at !== undefined) return at;
        }
      }
      return undefined;
    };

    messages.push(
      dividerMessage(
        slot.entry,
        slot.dividerKind,
        neighbourAt(1) ?? neighbourAt(-1) ?? entryWrittenAt(slot.entry) ?? 0,
      ),
    );
  });

  return { messages, todos };
}

function dividerKindFor(entry: PiEntry): ChatDividerKind | undefined {
  if (entry.type === "compaction") return "compaction";
  if (entry.type === "branch_summary") return "branch-summary";
  return undefined;
}

/**
 * A divider renders as its own assistant message so that it lands between the
 * messages it splits and can also break a `Worked for` group in two (the group
 * boundary is a divider part, see `ChatView`). `createdAt` is the timestamp of
 * the message next to it (ordering anchor, see above); `at` on the part is the
 * real timestamp of the compaction / branch summary entry.
 */
function dividerMessage(
  entry: PiEntry,
  kind: ChatDividerKind,
  createdAt: number,
): ChatMessage {
  const at = entryWrittenAt(entry) ?? 0;
  const tokensBefore =
    typeof entry.tokensBefore === "number" &&
    Number.isFinite(entry.tokensBefore) &&
    entry.tokensBefore > 0
      ? entry.tokensBefore
      : undefined;
  const details = isRecord(entry.details) ? entry.details : null;
  const modifiedFiles = stringArray(details?.modifiedFiles);
  const readFiles = stringArray(details?.readFiles);

  return {
    id: `divider:${entry.id}`,
    role: "assistant",
    createdAt,
    content: [
      {
        type: "divider",
        kind,
        summary: typeof entry.summary === "string" ? entry.summary : "",
        ...(tokensBefore === undefined ? {} : { tokensBefore }),
        ...(modifiedFiles ? { modifiedFiles } : {}),
        ...(readFiles ? { readFiles } : {}),
        at,
      },
    ],
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length ? strings : undefined;
}

/**
 * Thinking duration approximation (decision D3).
 *
 * The span runs from the moment this entry started (its message timestamp) to
 * the earlier of two real timestamps:
 * - the time the entry itself was written (its entry timestamp); this bounds the
 *   value, so a long pause before the next user message can never be counted as
 *   thinking; and
 * - the start of the next entry in the active branch, which during a turn is the
 *   continuation (another assistant entry or a tool result).
 *
 * Entries without usable timestamps are omitted; the reasoning part then carries
 * no duration and the UI shows none.
 */
function reasoningDurationsByEntry(branch: PiEntry[]): Map<string, number> {
  const durations = new Map<string, number>();

  branch.forEach((entry, index) => {
    if (entry.message?.role !== "assistant") return;
    const startedAt = entryStartedAt(entry);
    if (startedAt === undefined) return;

    const ends = [
      entryWrittenAt(entry),
      entryStartedAt(branch[index + 1]),
    ].filter(
      (candidate): candidate is number =>
        candidate !== undefined && candidate > startedAt,
    );
    if (!ends.length) return;

    durations.set(entry.id, Math.min(...ends) - startedAt);
  });

  return durations;
}

/**
 * When this entry started: Pi writes the message timestamp when generation
 * begins, the entry timestamp when the entry is persisted.
 */
function entryStartedAt(entry: PiEntry | undefined): number | undefined {
  if (!entry) return undefined;
  const messageTimestamp = entry.message?.timestamp;
  if (typeof messageTimestamp === "number") {
    const parsed = validTimestamp(messageTimestamp);
    if (parsed !== undefined) return parsed;
  }
  return entryWrittenAt(entry);
}

/** When the entry was persisted. */
function entryWrittenAt(entry: PiEntry | undefined): number | undefined {
  if (!entry) return undefined;
  return validTimestamp(Date.parse(entry.timestamp ?? ""));
}

function validTimestamp(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Only a message with exactly one reasoning part can be attributed a duration;
 * with several blocks in one entry the timestamps cannot be split between them,
 * so none of them gets a number.
 */
function attachReasoningDuration(
  parts: ChatPart[],
  durationMs: number | undefined,
): ChatPart[] {
  if (durationMs === undefined) return parts;
  if (parts.filter((part) => part.type === "reasoning").length !== 1) return parts;
  return parts.map((part) =>
    part.type === "reasoning" ? { ...part, durationMs } : part,
  );
}

/** One `toolResult` message as the transcript needs it. */
interface ToolResultEntry {
  result: unknown;
  isError: boolean;
  toolName?: string;
  display?: ChatToolDisplay;
}

function convertContent(
  value: PiMessage["content"],
  toolResults: Map<string, ToolResultEntry>,
): ChatPart[] {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  if (!Array.isArray(value)) return [];

  return value.flatMap((part): ChatPart[] => {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      return part.text ? [{ type: "text", text: part.text }] : [];
    }
    if (
      part.type === "thinking" &&
      "thinking" in part &&
      typeof part.thinking === "string"
    ) {
      return part.thinking ? [{ type: "reasoning", text: part.thinking }] : [];
    }
    if (
      part.type === "image" &&
      "data" in part &&
      "mimeType" in part &&
      typeof part.data === "string" &&
      typeof part.mimeType === "string"
    ) {
      return [
        {
          type: "image",
          image: `data:${part.mimeType};base64,${part.data}`,
          mimeType: part.mimeType,
          sha256: imageSha256(part, part.data),
        },
      ];
    }
    if (
      part.type === "toolCall" &&
      "id" in part &&
      "name" in part &&
      typeof part.id === "string" &&
      typeof part.name === "string"
    ) {
      const result = toolResults.get(part.id);
      return [
        {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          args:
            "arguments" in part && isRecord(part.arguments)
              ? part.arguments
              : {},
          ...(result ? { result: result.result, isError: result.isError } : {}),
          ...(result?.display ? { display: result.display } : {}),
        },
      ];
    }
    return [];
  });
}

async function hydrateManagedAttachments(
  messages: ChatMessage[],
  paneId: string,
  sessionPath: string,
  resolveAttachment: ManagedAttachmentResolver,
): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user") return message;

      const content: ChatPart[] = [];
      for (const part of message.content) {
        if (part.type !== "text") {
          content.push(part);
          continue;
        }

        const extracted = extractManagedAttachments(part.text);
        if (extracted.text) content.push({ type: "text", text: extracted.text });
        for (const uploadId of extracted.uploadIds) {
          const resolved = await resolveAttachment(uploadId, paneId, sessionPath);
          if (resolved) {
            content.push({
              type: "image",
              image: resolved.image,
              name: resolved.name,
              mimeType: resolved.mimeType,
              uploadId,
              sha256: resolved.sha256,
            });
          } else {
            content.push({
              type: "text",
              text: `[Image attachment unavailable: ${uploadId}]`,
            });
          }
        }
      }
      return { ...message, content };
    }),
  );
}

function imageSha256(part: object, data: string): string {
  const cached = imageHashes.get(part);
  if (cached) return cached;
  const hash = createHash("sha256").update(data, "base64").digest("hex");
  imageHashes.set(part, hash);
  return hash;
}

/**
 * Line budget for one projected diff. Real `edit` diffs are small (p90 ≈ 4k
 * characters), so this only fires on a pathological payload; when it does, the
 * client is told (`truncated`) instead of silently receiving a short diff.
 */
const CHAT_DIFF_MAX_LINES = 2_000;
/**
 * Character budget for one projected diff. The line budget alone does not bound
 * the payload (2 000 lines of 200k characters would be ~400 MB), and `display`
 * is a second downlink channel next to `result`, so the total is capped here.
 */
const CHAT_DIFF_MAX_CHARS = 200_000;
/** Longest single diff line; a longer line is clipped and marks the diff truncated. */
const CHAT_DIFF_MAX_LINE_CHARS = 2_000;

/** Text parts of a tool result, in order, as the projection reads them. */
function toolResultText(value: PiMessage["content"]): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) =>
      part.type === "text" && "text" in part && typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n");
}

/**
 * Whitelisted projection of one tool result's `details` into display metadata.
 *
 * `details` is `any`: it may carry large or unrelated fields, and Pi makes no
 * compatibility promise about it. Only the fields named here are copied, each
 * after an explicit shape check, and an unrecognised shape means "no display"
 * so the client falls back to the raw result instead of a guess.
 */
export function projectToolDisplay(
  toolName: string | undefined,
  details: unknown,
  resultText: string,
): ChatToolDisplay | undefined {
  const record = isRecord(details) ? details : undefined;
  const display: ChatToolDisplay = {};

  if (toolName === "edit" && record) {
    const diff = parsePiDisplayDiff(record.diff);
    if (diff) {
      const firstChangedLine = nonNegativeInteger(record.firstChangedLine);
      display.diff = {
        lines: diff.lines,
        ...(firstChangedLine !== undefined ? { firstChangedLine } : {}),
        ...(diff.truncated ? { truncated: true } : {}),
      };
    }
  }

  if ((toolName === "read" || toolName === "bash") && record) {
    const truncation = projectTruncation(record.truncation);
    if (truncation) display.truncation = truncation;
  }

  if (toolName === "read") {
    const readRange = parseReadRangeSummary(resultText);
    if (readRange) display.readRange = readRange;
  }

  if ((toolName === "ffgrep" || toolName === "fffind") && record) {
    const matchCount = projectMatchCount(record);
    if (matchCount) display.matchCount = matchCount;
  }

  if (toolName === "ask_user_question" && record) {
    const question = projectQuestion(record);
    if (question) display.question = question;
  }

  if (toolName === "todo" && record) {
    const todo = projectTodoChange(record);
    if (todo) display.todo = todo;
  }

  return Object.keys(display).length > 0 ? display : undefined;
}

/**
 * Parses Pi's display-oriented diff (`generateDiffString`): every line starts
 * with `+`, `-` or a space, followed by a right-aligned line number and a
 * space, then the content. Folded-away context is written as a blank line
 * number plus `...`, and there is no `@@` hunk header (that is `details.patch`,
 * a different field).
 *
 * All-or-nothing: a single line that does not match the format makes the whole
 * diff unusable, because a partially parsed diff would show wrong line numbers.
 */
export function parsePiDisplayDiff(
  diff: unknown,
): { lines: ChatDiffLine[]; truncated: boolean } | undefined {
  if (typeof diff !== "string" || !diff.trim()) return undefined;
  const raw = diff.split("\n");
  if (raw.at(-1) === "") raw.pop();

  const parsed: ChatDiffLine[] = [];
  for (const line of raw) {
    const marker = line[0];
    if (marker !== "+" && marker !== "-" && marker !== " ") return undefined;
    const rest = line.slice(1);
    // Folded context: only reached as the `...` placeholder; a real content
    // line `...` is preceded by its line number and never trims to just it.
    if (rest.trim() === "...") {
      parsed.push({ kind: "skip", text: "..." });
      continue;
    }
    const match = /^ *(\d+)(?: (.*))?$/u.exec(rest);
    if (!match) return undefined;
    parsed.push({
      kind: marker === "+" ? "add" : marker === "-" ? "remove" : "context",
      lineNumber: Number(match[1]),
      text: match[2] ?? "",
    });
  }
  if (!parsed.length) return undefined;

  // Everything below only shapes the payload: the whole diff had to match the
  // format first, so a partly parsed diff can never reach the client.
  const lines: ChatDiffLine[] = [];
  let budget = CHAT_DIFF_MAX_CHARS;
  let truncated = parsed.length > CHAT_DIFF_MAX_LINES;
  for (const line of parsed) {
    if (lines.length >= CHAT_DIFF_MAX_LINES) break;
    const clipped = clipDisplayText(line.text, CHAT_DIFF_MAX_LINE_CHARS);
    if (clipped.length > budget) {
      truncated = true;
      break;
    }
    budget -= clipped.length;
    if (clipped !== line.text) truncated = true;
    lines.push(clipped === line.text ? line : { ...line, text: clipped });
  }
  return { lines, truncated };
}

function clipDisplayText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Range summary Pi appends to a truncated `read` result. Only the two shapes
 * Pi actually writes are accepted; anything else yields no range, and the
 * client then falls back to plain text.
 */
const READ_SHOWING_LINES =
  /^\[Showing lines (\d+)-(\d+) of (\d+)(?: \([^)]*\))?\. Use offset=(\d+) to continue\.\]$/u;

export function parseReadRangeSummary(
  text: string,
): ChatToolDisplay["readRange"] | undefined {
  if (!text) return undefined;
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    const match = READ_SHOWING_LINES.exec(line);
    if (!match) return undefined;
    return {
      from: Number(match[1]),
      to: Number(match[2]),
      total: Number(match[3]),
      nextOffset: Number(match[4]),
    };
  }
  return undefined;
}

function projectTruncation(
  value: unknown,
): ChatToolDisplay["truncation"] | undefined {
  if (!isRecord(value) || typeof value.truncated !== "boolean") return undefined;
  const by =
    value.truncatedBy === "lines" || value.truncatedBy === "bytes"
      ? value.truncatedBy
      : undefined;
  const outputLines = nonNegativeInteger(value.outputLines);
  const totalLines = nonNegativeInteger(value.totalLines);
  return {
    truncated: value.truncated,
    ...(by ? { by } : {}),
    ...(outputLines !== undefined ? { outputLines } : {}),
    ...(totalLines !== undefined ? { totalLines } : {}),
  };
}

function projectMatchCount(
  record: ChatJsonObject,
): ChatToolDisplay["matchCount"] | undefined {
  const matched = nonNegativeInteger(record.totalMatched);
  const files = nonNegativeInteger(record.totalFiles);
  if (matched === undefined || files === undefined) return undefined;
  const hasMore = typeof record.hasMore === "boolean" ? record.hasMore : undefined;
  return { matched, files, ...(hasMore !== undefined ? { hasMore } : {}) };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Longest string copied out of `details`; longer values are clipped and marked. */
const DISPLAY_STRING_MAX = 1_000;
/** Longest array copied out of `details`; longer arrays are refused, not cut. */
const DISPLAY_ARRAY_MAX = 64;

/** A bounded non-empty string, with an explicit marker when it was clipped. */
function boundedString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.length > DISPLAY_STRING_MAX
    ? `${value.slice(0, DISPLAY_STRING_MAX)}…`
    : value;
}

function boundedStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > DISPLAY_ARRAY_MAX) return undefined;
  // Each item is bounded too: an array of <= 64 huge strings would otherwise be
  // the largest projection in the whole structure.
  const strings = value
    .map((entry) => boundedString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return strings.length ? strings : undefined;
}

function boundedNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length > DISPLAY_ARRAY_MAX) return undefined;
  const numbers = value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isSafeInteger(entry),
  );
  return numbers.length ? numbers : undefined;
}

/**
 * `ask_user_question` result: the recorded answers and the cancelled flag.
 *
 * An answer entry that is not an object makes the whole list unusable (a
 * partially listed questionnaire would misrepresent what was answered). An
 * object entry that has none of the recognised fields is skipped instead: it
 * carries no information to show, and dropping it cannot change an answer that
 * was shown. `cancelled` and `globalNote` are independent of the list and are
 * still projected when it is refused.
 */
function projectQuestion(
  record: ChatJsonObject,
): ChatToolDisplay["question"] | undefined {
  const answers = Array.isArray(record.answers) && record.answers.length <= DISPLAY_ARRAY_MAX
    ? projectQuestionAnswers(record.answers)
    : undefined;
  const cancelled =
    typeof record.cancelled === "boolean" ? record.cancelled : undefined;
  const globalNote = boundedString(record.globalNote);
  if (!answers && cancelled === undefined && globalNote === undefined) {
    return undefined;
  }
  return {
    answers: answers ?? [],
    ...(cancelled === undefined ? {} : { cancelled }),
    ...(globalNote === undefined ? {} : { globalNote }),
  };
}

function projectQuestionAnswers(value: unknown[]): ChatQuestionAnswer[] | undefined {
  const answers: ChatQuestionAnswer[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const questionIndex = nonNegativeInteger(entry.questionIndex);
    const question = boundedString(entry.question);
    const kind = boundedString(entry.kind);
    const answer = boundedString(entry.answer);
    const selected = boundedStringArray(entry.selected);
    const notes = boundedString(entry.notes);
    const projected: ChatQuestionAnswer = {
      ...(questionIndex === undefined ? {} : { questionIndex }),
      ...(question === undefined ? {} : { question }),
      ...(kind === undefined ? {} : { kind }),
      ...(answer === undefined ? {} : { answer }),
      ...(selected === undefined ? {} : { selected }),
      ...(notes === undefined ? {} : { notes }),
    };
    // An entry with nothing recognised carries no information; dropping it is
    // not a loss, but it must not be counted as an answer either.
    if (Object.keys(projected).length === 0) continue;
    answers.push(projected);
  }
  // Nothing recognised means no answers were projected at all; an empty list
  // would read as "the user answered nothing".
  return answers.length ? answers : undefined;
}

/** `todo` result: the action and the parameters that describe this call. */
function projectTodoChange(
  record: ChatJsonObject,
): ChatToolDisplay["todo"] | undefined {
  const params = isRecord(record.params) ? record.params : undefined;
  const action = boundedString(record.action);
  const taskId = nonNegativeInteger(params?.id);
  const subject = boundedString(params?.subject);
  const status = boundedString(params?.status);
  const activeForm = boundedString(params?.activeForm);
  const description = boundedString(params?.description);
  const blockedBy = boundedNumberArray(params?.blockedBy);
  const todo: ChatToolDisplay["todo"] = {
    ...(action === undefined ? {} : { action }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(subject === undefined ? {} : { subject }),
    ...(status === undefined ? {} : { status }),
    ...(activeForm === undefined ? {} : { activeForm }),
    ...(description === undefined ? {} : { description }),
    ...(blockedBy === undefined ? {} : { blockedBy }),
  };
  return Object.keys(todo).length > 0 ? todo : undefined;
}

function toolResultValue(value: PiMessage["content"]): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;

  const textValues: string[] = [];
  const images: ChatToolResultPayload["images"] = [];
  for (const part of value) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      textValues.push(part.text);
      continue;
    }
    if (
      part.type === "image" &&
      "data" in part &&
      "mimeType" in part &&
      typeof part.data === "string" &&
      typeof part.mimeType === "string"
    ) {
      images.push({
        image: `data:${part.mimeType};base64,${part.data}`,
        mimeType: part.mimeType,
        sha256: imageSha256(part, part.data),
      });
    }
  }

  const textResult =
    textValues.length <= 1 ? (textValues[0] ?? "") : textValues;
  if (images.length === 0) return textResult;
  return {
    type: "herzi-tool-result",
    value: textResult,
    images,
  } satisfies ChatToolResultPayload;
}

function statusFromStopReason(stopReason?: string): ChatMessage["status"] {
  switch (stopReason) {
    case "error":
      return { type: "incomplete", reason: "error" };
    case "aborted":
    case "cancelled":
      return { type: "incomplete", reason: "cancelled" };
    case "length":
      return { type: "incomplete", reason: "length" };
    default:
      return { type: "complete", reason: "stop" };
  }
}

function isRecord(value: unknown): value is ChatJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
