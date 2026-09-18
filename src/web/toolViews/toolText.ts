/**
 * Pure text parsers for the tool detail views.
 *
 * No React, no I/O: every function here takes the result text (or the `args`
 * object) and returns a structure, or `undefined` when the text does not have
 * the expected shape. `undefined` is the normal outcome for unknown formats —
 * the view then renders the raw `Arguments`/`Result` fallback instead of a
 * near-miss, because a wrong structure is worse than an unreadable one.
 *
 * Every shape below was validated against real tool output (see
 * `docs/tool-call-detail-ui-plan.md` §4/§9); nothing is inferred from a single
 * sample and nothing is invented when a field is missing.
 */

import type { ChatJsonObject, ChatToolDisplay } from "../../shared/protocol";

/**
 * Text of a tool result, or `undefined` when it is not plain text.
 *
 * A result that carries images is deliberately not treated as text: the image
 * preview (`ToolResultImagePreview`) is the honest rendering for it, and the
 * views fall back to it.
 */
export function toolResultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const candidate = result as { type?: unknown; value?: unknown; images?: unknown };
  if (candidate.type !== "herzi-tool-result") return undefined;
  if (Array.isArray(candidate.images) && candidate.images.length > 0) {
    return undefined;
  }
  const value = candidate.value;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.join("\n");
  }
  return undefined;
}

export interface LineSlice {
  lines: string[];
  /** How many lines were dropped from the head. */
  hidden: number;
}

/**
 * The last `limit` lines of `text`.
 *
 * A single trailing empty entry (the artifact of a final newline) is dropped so
 * that a result ending with `\n` is not reported as one line longer than it is.
 */
export function tailLines(text: string, limit: number): LineSlice {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  if (lines.length <= limit) return { lines, hidden: 0 };
  return { lines: lines.slice(-limit), hidden: lines.length - limit };
}

/** Splits `text` into display lines, dropping only the final-newline artifact. */
export function resultLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * Marker lines Pi appends to a `read` result. The server parses the range out
 * of the first shape (`parseReadRangeSummary` in `src/server/pi-session-reader.ts`);
 * the view needs the same knowledge to keep the marker out of the numbered code
 * display, since the marker is not file content.
 */
const READ_MARKER_PATTERNS = [
  /^\[Showing lines (\d+)-(\d+) of (\d+)(?: \([^)]*\))?\. Use offset=(\d+) to continue\.\]$/u,
  /^\[\d+ more lines in file\. Use offset=(\d+) to continue\.\]$/u,
];

export interface ReadResult {
  /** Result text without the trailing marker block. */
  body: string;
  /** The marker line itself, when one was present. */
  marker?: string;
}

/**
 * Removes the trailing truncation marker from a `read` result.
 *
 * Only a marker that matches one of Pi's two known shapes is removed; any other
 * text is returned unchanged, so an unrecognised format cannot lose a real line
 * of file content.
 */
export function splitReadResult(text: string): ReadResult {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end -= 1;
  const candidate = end > 0 ? (lines[end - 1] ?? "").trim() : "";
  if (!READ_MARKER_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return { body: text };
  }
  let cut = end - 1;
  while (cut > 0 && (lines[cut - 1] ?? "").trim() === "") cut -= 1;
  return { body: lines.slice(0, cut).join("\n"), marker: candidate };
}

/**
 * First line number of a `read` result.
 *
 * `args.offset` is what the call asked for, so it wins when present. An offset
 * that is present but not a positive integer means the request shape is not
 * what this view understands, and then no line numbers are shown at all — a
 * wrong number is worse than no number.
 */
export function readStartLine(
  args: ChatJsonObject,
  display: ChatToolDisplay | undefined,
): number | undefined {
  const raw = args.offset;
  if (raw !== undefined && raw !== null) return positiveInteger(raw);
  return positiveInteger(display?.readRange?.from) ?? 1;
}

export interface GrepMatch {
  line: number;
  text: string;
  /** `行号: 内容` is a match; `行号- 内容` is a context line. */
  isMatch: boolean;
}

export interface GrepFile {
  /** Absent when matches appeared before any file header. */
  path?: string;
  matches: GrepMatch[];
}

export interface GrepParse {
  files: GrepFile[];
  /** Total match lines (context lines are not counted). */
  matched: number;
  /** Bracketed summary lines, kept verbatim as a trailing note. */
  notes: string[];
}

const GREP_MATCH_LINE = /^(\d+):(.*)$/u;
const GREP_CONTEXT_LINE = /^(\d+)-(.*)$/u;

/**
 * `ffgrep` result text: a file path header line, then `行号: 内容` match lines
 * and `行号- 内容` context lines.
 *
 * All-or-nothing: a line that is neither a match, a context line, a bracketed
 * summary nor a plausible path makes the whole result unparseable, because
 * treating prose as a file header would make the grouping wrong.
 */
export function parseGrepText(text: string): GrepParse | undefined {
  if (!text.trim()) return undefined;
  const files: GrepFile[] = [];
  const notes: string[] = [];
  let current: GrepFile | undefined;
  let matched = 0;

  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) continue;
    const match = GREP_MATCH_LINE.exec(rawLine);
    const context = match ? null : GREP_CONTEXT_LINE.exec(rawLine);
    if (match || context) {
      current ??= pushFile(files);
      current.matches.push({
        line: Number((match ?? context)?.[1]),
        text: (match ?? context)?.[2] ?? "",
        isMatch: Boolean(match),
      });
      if (match) matched += 1;
      continue;
    }
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      notes.push(line);
      continue;
    }
    if (!looksLikePath(line)) return undefined;
    current = pushFile(files, line);
  }

  if (!matched && !files.some((file) => file.matches.length > 0)) return undefined;
  return { files, matched, notes };
}

function pushFile(files: GrepFile[], path?: string): GrepFile {
  const file: GrepFile = { ...(path === undefined ? {} : { path }), matches: [] };
  files.push(file);
  return file;
}

export interface PathListParse {
  paths: string[];
  notes: string[];
}

/** `fffind` result text: one path per line. */
export function parsePathList(text: string): PathListParse | undefined {
  const paths: string[] = [];
  const notes: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      notes.push(line);
      continue;
    }
    if (!looksLikePath(line)) return undefined;
    paths.push(line);
  }
  return paths.length ? { paths, notes } : undefined;
}

/**
 * A path as the search tools print it: no whitespace, and at least one `.` or
 * `/`. Deliberately narrow — it is the check that keeps a prose result ("No
 * files found") from being rendered as a one-entry file list.
 */
function looksLikePath(line: string): boolean {
  return !/\s/u.test(line) && /[./\\]/u.test(line);
}

export interface WebSearchParse {
  /** Text before the first numbered result; rendered above the list. */
  preamble: string;
  /** One entry per result, numbering stripped (`**Title**` + source lines). */
  entries: string[];
}

/** `^\d+.\s+\*\*` starts a result; the measured hit rate on real output is 98%. */
const WEB_SEARCH_ITEM = /^\d+\.\s+(?=\*\*)/u;

export function parseWebSearchText(text: string): WebSearchParse | undefined {
  if (!text.trim()) return undefined;
  const entries: string[] = [];
  const preambleLines: string[] = [];
  let current: string[] | undefined;

  for (const line of text.split("\n")) {
    if (WEB_SEARCH_ITEM.test(line)) {
      if (current) entries.push(current.join("\n"));
      current = [line.replace(/^\d+\.\s+/u, "")];
      continue;
    }
    if (current) current.push(line);
    else preambleLines.push(line);
  }
  if (current) entries.push(current.join("\n"));
  if (!entries.length) return undefined;
  return { preamble: preambleLines.join("\n").trim(), entries };
}

export interface WebFetchParse {
  /** First line of the result when it is a Markdown heading. */
  title?: string;
  /** Result text without the title line. */
  body: string;
  /** Verbatim line that reports truncation, when the text has one. */
  truncationNote?: string;
}

export function parseWebFetchText(text: string): WebFetchParse {
  const lines = text.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  const heading =
    firstIndex >= 0 ? /^#{1,6}\s+(.+)$/u.exec((lines[firstIndex] ?? "").trim()) : null;
  const title = heading?.[1]?.trim() || undefined;
  const body = (title === undefined
    ? lines
    : [...lines.slice(0, firstIndex), ...lines.slice(firstIndex + 1)]
  )
    .join("\n")
    .trim();
  const truncationNote = detectTruncationNote(text);
  return {
    ...(title === undefined ? {} : { title }),
    body,
    ...(truncationNote === undefined ? {} : { truncationNote }),
  };
}

/**
 * The first short line that mentions truncation, returned verbatim.
 *
 * The note is shown as-is so the claim can be checked against the result text;
 * long lines are ignored because a paragraph mentioning "truncated" is not a
 * truncation notice.
 */
export function detectTruncationNote(text: string): string | undefined {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.length > 200) continue;
    if (/truncat/iu.test(line)) return line;
  }
  return undefined;
}

/**
 * Human wording for `display.truncation`, or `undefined` when nothing was
 * truncated. Only the reported numbers are used; an absent field is left out of
 * the sentence instead of being filled in.
 */
export function truncationSummary(
  truncation: ChatToolDisplay["truncation"] | undefined,
): string | undefined {
  if (!truncation?.truncated) return undefined;
  const by =
    truncation.by === "lines"
      ? "（达到行数上限）"
      : truncation.by === "bytes"
        ? "（达到字节上限）"
        : "";
  const total =
    truncation.totalLines === undefined
      ? ""
      : `，共 ${truncation.totalLines} 行`;
  const output =
    truncation.outputLines === undefined
      ? ""
      : `，本次返回 ${truncation.outputLines} 行`;
  return `输出被截断${by}${total}${output}`;
}

export interface AskQuestionOption {
  label: string;
  description?: string;
}

/** One question of an `ask_user_question` call, from the call's own `args`. */
export interface AskedQuestion {
  header?: string;
  question?: string;
  multiSelect?: boolean;
  options: AskQuestionOption[];
}

/**
 * `args.questions` of an `ask_user_question` call (1–4 questions, each with
 * 2–4 options and an optional `multiSelect`).
 *
 * `undefined` means the arguments are not the shape this view understands; an
 * empty list means the call asked nothing usable.
 */
export function parseAskedQuestions(
  args: ChatJsonObject,
): AskedQuestion[] | undefined {
  const questions = Array.isArray(args.questions) ? args.questions : undefined;
  if (!questions) return undefined;

  const parsed: AskedQuestion[] = [];
  for (const entry of questions) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const record = entry as Record<string, unknown>;
    const question = nonEmptyString(record.question);
    const header = nonEmptyString(record.header);
    const options = parseOptions(record.options);
    if (!question && !header && !options.length) continue;
    parsed.push({
      ...(header === undefined ? {} : { header }),
      ...(question === undefined ? {} : { question }),
      ...(typeof record.multiSelect === "boolean"
        ? { multiSelect: record.multiSelect }
        : {}),
      options,
    });
  }
  return parsed.length ? parsed : undefined;
}

function parseOptions(value: unknown): AskQuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AskQuestionOption[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const label = nonEmptyString(record.label);
    if (label === undefined) return [];
    const description = nonEmptyString(record.description);
    return [{ label, ...(description === undefined ? {} : { description }) }];
  });
}

/** What one `todo` call changed, merged from the projection and the arguments. */
export interface TodoChange {
  action?: string;
  taskId?: number;
  subject?: string;
  status?: string;
  activeForm?: string;
  description?: string;
  blockedBy?: number[];
}

/**
 * Field-wise merge of the projected `details` values with the call's arguments.
 *
 * The projection wins when it has a field (it is what the tool reported), the
 * argument is the fallback (it is what the call asked for). Neither is invented:
 * a field present in neither stays absent.
 */
export function todoChange(
  projected: ChatToolDisplay["todo"] | undefined,
  args: ChatJsonObject,
): TodoChange {
  const blockedBy = projected?.blockedBy ?? numberFields(args.blockedBy);
  return {
    ...mergeField("action", projected?.action, nonEmptyString(args.action)),
    ...mergeField("taskId", projected?.taskId, nonNegativeInteger(args.id)),
    ...mergeField("subject", projected?.subject, nonEmptyString(args.subject)),
    ...mergeField("status", projected?.status, nonEmptyString(args.status)),
    ...mergeField("activeForm", projected?.activeForm, nonEmptyString(args.activeForm)),
    ...mergeField(
      "description",
      projected?.description,
      nonEmptyString(args.description),
    ),
    ...(blockedBy === undefined ? {} : { blockedBy }),
  };
}

function mergeField<K extends keyof TodoChange>(
  key: K,
  projected: TodoChange[K] | undefined,
  fromArgs: TodoChange[K] | undefined,
): Pick<TodoChange, K> | Record<string, never> {
  const value = projected ?? fromArgs;
  return value === undefined ? {} : ({ [key]: value } as Pick<TodoChange, K>);
}

/**
 * Chinese label for a `todo` status. The four known values match the wording of
 * the composer's status bar; an unknown status is returned unchanged so the
 * card still reports what the extension said.
 */
export function todoStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待办";
    case "in_progress":
      return "进行中";
    case "completed":
      return "已完成";
    case "deleted":
      return "已删除";
    default:
      return status;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function numberFields(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isSafeInteger(entry),
  );
  return numbers.length ? numbers : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}
