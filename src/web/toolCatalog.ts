/**
 * Tool catalog: turns one tool call into the action word + target shown on a
 * collapsed row, and summarizes a run of tool calls for a group header.
 *
 * Rules that the rest of the UI depends on (see
 * `docs/chat-tool-presentation-plan.md`):
 * - Every label is derived from the real arguments only. Nothing is inferred
 *   about the effect of a call; when a value is missing the row degrades to an
 *   arguments preview instead of guessing.
 * - A tool that is not in the catalog still renders: the tool name becomes the
 *   action word, the arguments preview becomes the target, and it counts as one
 *   `steps`.
 * - `fragment: null` means "render the row, do not count it" (decision D2 for
 *   `todo`). Those rows are also excluded from the phase verb, so plan updates
 *   cannot drown the header.
 * - File operations are deduplicated by path only for `edit`/`write`
 *   (`dedupeKey`); `read` and every other fragment are counted per call
 *   (decision D1).
 * - The word lists are written for Herzi; no text is copied from another
 *   product.
 */

import type { ChatJsonObject } from "../shared/protocol";

/** Coarse activity class; decides the phase verb of a group header. */
export type ToolBucket = "browse" | "edit" | "run" | "other";

/** Fine-grained counter. `null` on a display means the row is not counted. */
export type SummaryFragment =
  | "fileOperations"
  | "searches"
  | "commands"
  | "steps";

/** Fixed counter order, independent of call order. */
export const SUMMARY_FRAGMENT_ORDER = [
  "fileOperations",
  "searches",
  "commands",
  "steps",
] as const satisfies readonly SummaryFragment[];

export interface ToolDiff {
  add: number;
  remove: number;
}

export type ReadVariant = "image" | "pdf" | "range";

export interface ToolDisplay {
  /** Action word shown in the first column of the row. */
  action: string;
  /** Target shown in the second column; never empty. */
  target: string;
  /** Full target for the tooltip when `target` is clipped. */
  fullTarget?: string;
  bucket: ToolBucket;
  fragment: SummaryFragment | null;
  diff?: ToolDiff;
  variant?: ReadVariant;
  /**
   * Unique key for the file-operation count. Only `edit`/`write` set it, as
   * decided for D1: those are deduplicated by path.
   */
  dedupeKey?: string;
}

/** The subset of a tool activity item that the summary needs. */
export interface ToolRunItem {
  toolName: string;
  args: ChatJsonObject;
  /** Absent while the call is still running. */
  result?: unknown;
}

export interface ToolRunSummary {
  bucket: ToolBucket;
  counts: Array<{ fragment: SummaryFragment; count: number }>;
  diff: ToolDiff;
  running: boolean;
}

const COMMAND_TARGET_LIMIT = 80;
const TARGET_LIMIT = 92;
const FALLBACK_TARGET_LIMIT = 72;
const PATTERN_LIMIT = 56;
const PATTERN_PATH_LIMIT = 40;
const PROMPT_TARGET_LIMIT = 60;
const FULL_TARGET_LIMIT = 300;

/**
 * Tie order for the phase verb. Equal counts resolve deterministically to the
 * more consequential activity first (an edit is a result, a command is an
 * action, browsing is intermediate).
 */
const BUCKET_TIE_ORDER: readonly ToolBucket[] = [
  "edit",
  "run",
  "browse",
  "other",
];

const TOOL_META: Record<
  string,
  { bucket: ToolBucket; fragment: SummaryFragment | null }
> = {
  bash: { bucket: "run", fragment: "commands" },
  read: { bucket: "browse", fragment: "fileOperations" },
  write: { bucket: "edit", fragment: "fileOperations" },
  edit: { bucket: "edit", fragment: "fileOperations" },
  ffgrep: { bucket: "browse", fragment: "searches" },
  fffind: { bucket: "browse", fragment: "searches" },
  web_search: { bucket: "browse", fragment: "searches" },
  web_fetch: { bucket: "browse", fragment: "searches" },
  ask_user_question: { bucket: "other", fragment: "steps" },
  todo: { bucket: "other", fragment: null },
};

/** Keys the generic preview looks at, in the same order as the old fallback. */
const PREVIEW_KEYS = [
  "path",
  "file",
  "command",
  "cmd",
  "query",
  "q",
  "url",
  "pattern",
  "description",
] as const;

/**
 * `rpiv-todo` 的 action 取值是 create / update / get / list / delete / clear
 * （见该包的 `docs/tool-schema.md`）。真实会话里出现的是 create、update、
 * list、delete，因此这里按真实词表映射，不按猜测。
 */
const TODO_ACTIONS: Record<string, string> = {
  create: "新增计划",
  update: "更新计划",
  get: "查看计划",
  list: "查看计划",
  delete: "删除计划",
  clear: "清空计划",
};

/** Collapses whitespace, clips to `limit` characters and marks the cut. */
export function clipText(value: string, limit: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (line.length <= limit) return line;
  return `${line.slice(0, limit).trimEnd()}…`;
}

/** Number of lines a diff-style payload adds or removes. */
export function countLines(value: string): number {
  if (!value) return 0;
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

export function baseName(value: string): string {
  const trimmed = value.replace(/[\\/]+$/u, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/**
 * Generic target used by unknown tools and by known tools whose expected
 * argument is missing. It is never empty, so a row can never render blank.
 */
export function argsTarget(args: ChatJsonObject): string {
  for (const key of PREVIEW_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return clipText(value, TARGET_LIMIT);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return clipText(safeJson(args), FALLBACK_TARGET_LIMIT);
}

export function describeToolCall(
  toolName: string,
  args: ChatJsonObject,
): ToolDisplay {
  const meta = TOOL_META[toolName];
  const describer = TOOL_DESCRIBERS[toolName];
  if (!meta || !describer) {
    return {
      action: toolName || "未知工具",
      target: argsTarget(args),
      bucket: "other",
      fragment: "steps",
    };
  }
  return { ...describer(args), bucket: meta.bucket, fragment: meta.fragment };
}

/**
 * `+N −M` from the real `edit` payload. Returns undefined when there is nothing
 * to count, so a row never shows `+0 −0`.
 */
export function editDiff(args: ChatJsonObject): ToolDiff | undefined {
  const pairs: Array<{ oldText: string; newText: string }> = [];
  const edits = Array.isArray(args.edits) ? args.edits : [];
  for (const entry of edits) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.newText !== "string") continue;
    pairs.push({
      oldText: typeof record.oldText === "string" ? record.oldText : "",
      newText: record.newText,
    });
  }
  if (!pairs.length) {
    if (typeof args.newText !== "string") return undefined;
    pairs.push({
      oldText: typeof args.oldText === "string" ? args.oldText : "",
      newText: args.newText,
    });
  }
  const diff = pairs.reduce<ToolDiff>(
    (total, pair) => ({
      add: total.add + countLines(pair.newText),
      remove: total.remove + countLines(pair.oldText),
    }),
    { add: 0, remove: 0 },
  );
  return diff.add > 0 || diff.remove > 0 ? diff : undefined;
}

export function summarizeToolRun(
  items: readonly ToolRunItem[],
): ToolRunSummary {
  const bucketCounts = new Map<ToolBucket, number>();
  const fragmentCounts = new Map<SummaryFragment, number>();
  const countedPaths = new Set<string>();
  const diff: ToolDiff = { add: 0, remove: 0 };
  let running = false;

  for (const item of items) {
    const display = describeToolCall(item.toolName, item.args);
    if (item.result === undefined) running = true;

    // D2: rows with `fragment: null` (today only `todo`) are displayed but are
    // not part of the summary, including the phase verb.
    if (display.fragment === null) continue;

    bucketCounts.set(display.bucket, (bucketCounts.get(display.bucket) ?? 0) + 1);

    // D1: `edit`/`write` are deduplicated by path, everything else per call.
    if (display.dedupeKey !== undefined) {
      if (countedPaths.has(display.dedupeKey)) continue;
      countedPaths.add(display.dedupeKey);
    }
    fragmentCounts.set(
      display.fragment,
      (fragmentCounts.get(display.fragment) ?? 0) + 1,
    );

    if (display.diff) {
      diff.add += display.diff.add;
      diff.remove += display.diff.remove;
    }
  }

  let bucket: ToolBucket = "other";
  let best = 0;
  for (const candidate of BUCKET_TIE_ORDER) {
    const count = bucketCounts.get(candidate) ?? 0;
    if (count > best) {
      best = count;
      bucket = candidate;
    }
  }

  return {
    bucket,
    counts: SUMMARY_FRAGMENT_ORDER.flatMap((fragment) => {
      const count = fragmentCounts.get(fragment) ?? 0;
      return count > 0 ? [{ fragment, count }] : [];
    }),
    diff,
    running,
  };
}

const BUCKET_VERBS: Record<ToolBucket, { running: string; done: string }> = {
  run: { running: "运行中", done: "已运行" },
  edit: { running: "修改中", done: "已修改" },
  browse: { running: "探索中", done: "已探索" },
  other: { running: "处理中", done: "已处理" },
};

export function toolRunVerb(summary: ToolRunSummary): string {
  const verbs = BUCKET_VERBS[summary.bucket];
  return summary.running ? verbs.running : verbs.done;
}

const FRAGMENT_UNITS: Record<SummaryFragment, string> = {
  fileOperations: "次文件操作",
  searches: "次搜索",
  commands: "条命令",
  steps: "步",
};

export function formatToolCounts(
  counts: readonly { fragment: SummaryFragment; count: number }[],
): string {
  return counts
    .map(({ fragment, count }) => `${count} ${FRAGMENT_UNITS[fragment]}`)
    .join("、");
}

/**
 * Diff total for a group header. Undefined while the group is still running
 * (the total would disagree with the per-row increments underneath it) and when
 * there is nothing to report.
 */
export function toolRunDiff(summary: ToolRunSummary): ToolDiff | undefined {
  if (summary.running) return undefined;
  return summary.diff.add > 0 || summary.diff.remove > 0
    ? summary.diff
    : undefined;
}

function stringArg(args: ChatJsonObject, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(args: ChatJsonObject, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function clipFull(value: string): string {
  return value.length > FULL_TARGET_LIMIT
    ? clipText(value, FULL_TARGET_LIMIT)
    : value.trim();
}

type ToolDescriptor = Pick<
  ToolDisplay,
  "action" | "target" | "fullTarget" | "diff" | "variant" | "dedupeKey"
>;

function describeCommand(args: ChatJsonObject): ToolDescriptor {
  const command = stringArg(args, "command") ?? stringArg(args, "cmd");
  if (!command) {
    const description = stringArg(args, "description");
    return {
      action: "运行命令",
      target: description
        ? clipText(description, COMMAND_TARGET_LIMIT)
        : argsTarget(args),
    };
  }
  const firstLine = command.split("\n").find((line) => line.trim()) ?? command;
  return {
    action: "运行命令",
    target: clipText(firstLine, COMMAND_TARGET_LIMIT),
    fullTarget: clipFull(command),
  };
}

function describeRead(args: ChatJsonObject): ToolDescriptor {
  const rawPath = stringArg(args, "path") ?? stringArg(args, "file");
  if (!rawPath) return { action: "读取", target: argsTarget(args) };

  const name = baseName(rawPath) || rawPath;
  const lower = name.toLowerCase();
  const isImage = /\.(png|jpe?g|webp|gif|bmp)$/u.test(lower);
  const isPdf = lower.endsWith(".pdf");
  const offset = numberArg(args, "offset");
  const limit = numberArg(args, "limit");

  const variant: ReadVariant | undefined = isImage
    ? "image"
    : isPdf
      ? "pdf"
      : offset !== undefined
        ? "range"
        : undefined;
  const action = isImage ? "读取图片" : isPdf ? "读取文档" : "读取";
  const range =
    offset === undefined
      ? ""
      : limit !== undefined && limit > 0
        ? `第 ${offset}–${offset + limit - 1} 行`
        : `从第 ${offset} 行`;

  return {
    action,
    target: [name, range].filter(Boolean).join(" · "),
    fullTarget: rawPath,
    variant,
  };
}

function describeWrite(args: ChatJsonObject): ToolDescriptor {
  const rawPath = stringArg(args, "path") ?? stringArg(args, "file");
  const content = typeof args.content === "string" ? args.content : undefined;
  const added = content === undefined ? 0 : countLines(content);
  const diff = added > 0 ? { add: added, remove: 0 } : undefined;

  if (!rawPath) {
    return {
      action: "新建",
      target: argsTarget(args),
      ...(diff ? { diff } : {}),
    };
  }
  return {
    action: "新建",
    target: baseName(rawPath) || rawPath,
    fullTarget: rawPath,
    ...(diff ? { diff } : {}),
    dedupeKey: `file:${rawPath}`,
  };
}

function describeEdit(args: ChatJsonObject): ToolDescriptor {
  const rawPath = stringArg(args, "path") ?? stringArg(args, "file");
  const diff = editDiff(args);
  return {
    action: "编辑",
    target: rawPath ? baseName(rawPath) || rawPath : argsTarget(args),
    ...(rawPath ? { fullTarget: rawPath, dedupeKey: `file:${rawPath}` } : {}),
    ...(diff ? { diff } : {}),
  };
}

function describeSearch(args: ChatJsonObject, action: string): ToolDescriptor {
  const pattern =
    stringArg(args, "pattern") ??
    stringArg(args, "query") ??
    stringArg(args, "q");
  if (!pattern) return { action, target: argsTarget(args) };

  const scope = stringArg(args, "path");
  const quoted = `"${clipText(pattern, PATTERN_LIMIT)}"`;
  return {
    action,
    target: scope
      ? `${quoted} @ ${clipText(scope, PATTERN_PATH_LIMIT)}`
      : quoted,
    fullTarget: scope ? `${pattern} @ ${scope}` : pattern,
  };
}

function describeWebSearch(args: ChatJsonObject): ToolDescriptor {
  const query = stringArg(args, "query") ?? stringArg(args, "q");
  if (!query) return { action: "网络搜索", target: argsTarget(args) };
  return {
    action: "网络搜索",
    target: `"${clipText(query, PATTERN_LIMIT)}"`,
    fullTarget: query,
  };
}

function describeWebFetch(args: ChatJsonObject): ToolDescriptor {
  const url = stringArg(args, "url");
  if (!url) return { action: "抓取网页", target: argsTarget(args) };
  return { action: "抓取网页", target: webHost(url), fullTarget: url };
}

/**
 * Host of a URL, used as the collapsed row's target and by the `web_fetch`
 * detail view. Falls back to the clipped URL when it does not parse as one.
 */
export function webHost(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host || clipText(url, TARGET_LIMIT);
  } catch {
    return clipText(url, TARGET_LIMIT);
  }
}

function describeQuestion(args: ChatJsonObject): ToolDescriptor {
  const questions = Array.isArray(args.questions) ? args.questions : [];
  const first = questions.find(
    (entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  const record = first as Record<string, unknown> | undefined;
  const header =
    typeof record?.header === "string" && record.header.trim()
      ? record.header.trim()
      : undefined;
  const question =
    typeof record?.question === "string" && record.question.trim()
      ? record.question.trim()
      : undefined;
  const label = header ?? question;
  return {
    action: "询问",
    target: label ? clipText(label, PROMPT_TARGET_LIMIT) : argsTarget(args),
    ...(question ? { fullTarget: question } : {}),
  };
}

function describeTodo(args: ChatJsonObject): ToolDescriptor {
  const rawAction = typeof args.action === "string" ? args.action : undefined;
  const subject = stringArg(args, "subject");
  const id = args.id;
  const idLabel =
    typeof id === "string" || typeof id === "number" ? `#${String(id)}` : undefined;
  const status = stringArg(args, "status");

  return {
    action: (rawAction ? TODO_ACTIONS[rawAction] : undefined) ?? "更新计划",
    target: subject
      ? clipText(subject, PROMPT_TARGET_LIMIT)
      : (idLabel ?? status ?? argsTarget(args)),
    ...(subject ? { fullTarget: subject } : {}),
  };
}

const TOOL_DESCRIBERS: Record<
  string,
  (args: ChatJsonObject) => ToolDescriptor
> = {
  bash: describeCommand,
  read: describeRead,
  write: describeWrite,
  edit: describeEdit,
  ffgrep: (args) => describeSearch(args, "内容搜索"),
  fffind: (args) => describeSearch(args, "查找文件"),
  web_search: describeWebSearch,
  web_fetch: describeWebFetch,
  ask_user_question: describeQuestion,
  todo: describeTodo,
};
