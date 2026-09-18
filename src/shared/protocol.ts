export type AgentStatus =
  | "idle"
  | "working"
  | "blocked"
  | "done"
  | "waiting"
  | "error"
  | "down"
  | "unknown"
  | string;

export interface WorkspaceSummary {
  id: string;
  number: number;
  label: string;
  focused: boolean;
  activeTabId: string | null;
  agentStatus: AgentStatus;
  tabs: TabSummary[];
}

export interface TabSummary {
  id: string;
  workspaceId: string;
  number: number;
  label: string;
  focused: boolean;
  agentStatus: AgentStatus;
  panes: PaneSummary[];
}

export interface PaneSummary {
  id: string;
  workspaceId: string;
  tabId: string;
  title: string;
  cwd: string | null;
  focused: boolean;
  agent: string | null;
  agentStatus: AgentStatus;
  hasChatSession: boolean;
}

export interface AppSnapshot {
  version: string;
  protocol: number;
  connected: boolean;
  focusedPaneId: string | null;
  workspaces: WorkspaceSummary[];
}

export interface TerminalFrame {
  seq: number;
  /** Decoded stream format. Herdr currently reports `ansi`; `bytes` is base64. */
  encoding: "ansi" | string;
  width: number;
  height: number;
  full: boolean;
  bytes: string;
}

/**
 * One line of a structured tool diff.
 *
 * `kind` is the line's role only; `lineNumber` is a number inside the file the
 * line belongs to (the new file for `add`/`context`, the old file for
 * `remove`) and is absent on `skip`, which stands for context that Pi folded
 * away and for which no number is reported. `text` is always the line content
 * without the diff marker and without the line number.
 */
export interface ChatDiffLine {
  kind: "add" | "remove" | "context" | "skip";
  lineNumber?: number;
  text: string;
}

/**
 * Whitelisted, server-projected display metadata for one tool call.
 *
 * This is never the raw `details` object: only the fields below are copied
 * over, each one after an explicit shape check, so an unknown or enlarged Pi
 * `details` payload cannot reach the browser. Every field is optional and a
 * client must render nothing for a missing field instead of guessing — the raw
 * `result` stays available as the one source of truth for every fallback.
 */
export interface ChatToolDisplay {
  /** Line-level diff, when the tool reported one (`edit`). */
  diff?: {
    lines: ChatDiffLine[];
    /** First changed line in the new file, as reported by Pi. */
    firstChangedLine?: number;
    /** True when the server dropped lines from an over-long diff. */
    truncated?: boolean;
  };
  /** Output truncation metadata, when the tool reported it (`read`/`bash`). */
  truncation?: {
    truncated: boolean;
    by?: "lines" | "bytes";
    outputLines?: number;
    totalLines?: number;
  };
  /** Range parsed from the read result's trailing summary line. */
  readRange?: {
    from: number;
    to: number;
    total?: number;
    nextOffset?: number;
  };
  /** Match counters reported by the search tools (`ffgrep`/`fffind`). */
  matchCount?: { matched: number; files: number; hasMore?: boolean };
}

export interface ChatToolResultImage {
  image: string;
  mimeType: string;
  sha256: string;
}

export interface ChatToolResultPayload {
  type: "herzi-tool-result";
  value: unknown;
  images: ChatToolResultImage[];
}

/**
 * Which kind of context boundary a `divider` part marks.
 *
 * - `compaction`: Pi replaced older history with a generated summary.
 * - `branch-summary`: Pi summarized an abandoned branch before continuing.
 */
export type ChatDividerKind = "compaction" | "branch-summary";

/**
 * A context boundary in the transcript.
 *
 * It is a pure marker: it hides nothing (the summarized history stays in the
 * transcript) and it renders as a labelled rule between the parts it splits.
 * `at` is the timestamp of the Pi entry that produced it, i.e. when the
 * boundary was written, which is not necessarily the time of the messages next
 * to it (see `convertActiveBranch`).
 */
export interface ChatDividerPart {
  type: "divider";
  kind: ChatDividerKind;
  summary: string;
  tokensBefore?: number;
  modifiedFiles?: string[];
  readFiles?: string[];
  at: number;
}

export type ChatPart =
  | { type: "text"; text: string }
  | {
      type: "reasoning";
      text: string;
      /**
       * Server-side approximation of how long the model thought before this
       * reasoning block finished, in milliseconds. It is derived from adjacent
       * transcript entry timestamps only, so it is absent whenever that span
       * cannot be derived; clients then show no duration instead of a guess.
       */
      durationMs?: number;
    }
  | {
      type: "image";
      image: string;
      name?: string;
      mimeType?: string;
      uploadId?: string;
      sha256?: string;
    }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: ChatJsonObject;
      result?: unknown;
      isError?: boolean;
      /**
       * Server-projected display metadata. `result` keeps its meaning (the raw
       * tool output) and stays the fallback whenever `display` is absent or the
       * client cannot render it.
       */
      display?: ChatToolDisplay;
    }
  | ChatDividerPart;

export type ChatJsonValue =
  | string
  | number
  | boolean
  | null
  | ChatJsonObject
  | readonly ChatJsonValue[];

export interface ChatJsonObject {
  readonly [key: string]: ChatJsonValue;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  completedAt?: number;
  content: ChatPart[];
  status?:
    | { type: "running" }
    | { type: "complete"; reason: "stop" | "unknown" }
    | {
        type: "incomplete";
        reason: "cancelled" | "length" | "other" | "error";
      };
}

export interface ChatSnapshot {
  paneId: string;
  running: boolean;
  updatedAt: number;
  messages: ChatMessage[];
  /** Last `todo` tool snapshot on the active branch; absent until it is used. */
  todos?: ChatTodosSnapshot;
}

/**
 * Status of one `todo` task. Only these four values were observed in real
 * sessions; the open string keeps unknown future values renderable instead of
 * dropping the task.
 */
export type TodoTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "deleted"
  | string;

/**
 * One task from the `todo` extension's snapshot. Only fields verified against
 * real session data are declared; everything else is dropped in the reader
 * rather than re-serialized into the snapshot.
 */
export interface TodoTask {
  id: number;
  subject: string;
  status: TodoTaskStatus;
  /** Present participle shown while the task is in progress. */
  activeForm?: string;
  description?: string;
  blockedBy?: number[];
}

/**
 * Last-write-wins projection of the `todo` tool state (the extension returns
 * the complete state on every successful call), plus the entry timestamp it was
 * read from.
 */
export interface ChatTodosSnapshot {
  tasks: TodoTask[];
  /**
   * Next task id the extension reported. Optional and never rendered: it is kept
   * only when the extension really reported a number, so a snapshot stays usable
   * when the field is missing instead of being dropped for it.
   */
  nextId?: number;
  /** Entry timestamp of the tool result this snapshot was read from. */
  updatedAt: number;
  /**
   * True when the projected snapshot exceeded the size budget and `tasks` was
   * dropped; the client then shows nothing rather than a partial list.
   */
  truncated?: boolean;
}

export type ChatRealtimeStatus = "idle" | "working" | "waiting";

export interface PiBridgeCapabilities {
  commands: boolean;
  imageInput: boolean;
  modelAcceptsImages: boolean | null;
}

export type ImageInputCapability =
  | { mode: "none"; reason: string }
  | { mode: "host-path"; reason?: string }
  | { mode: "pi-native"; modelAcceptsImages: boolean | null };

export interface ImageUploadResponse {
  uploadId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  expiresAt: number;
}

export type PromptDeliveryStatus =
  | "submitted"
  | "queued"
  | "claimed"
  | "dispatched"
  | "observed-live"
  | "persisted"
  | "delivery-unconfirmed"
  | "failed";

export type PromptTransport = "text" | "host-path" | "pi-native";

export interface PromptResponse {
  ok: true;
  requestId: string;
  transport: PromptTransport;
  status: PromptDeliveryStatus;
}

/**
 * Lifecycle stages of a single prompt delivery attempt. Every stage is recorded
 * as metadata only: prompt text, image bytes, tokens and absolute session paths
 * must never appear in a trace event.
 *
 * Client stages run in the browser, server stages in the Herzi server process,
 * and `queue.*` stages describe the Pi bridge command queue.
 */
export type PromptDeliveryPhase =
  | "client.submit"
  | "client.optimistic"
  | "client.response"
  | "client.error"
  | "client.retry"
  | "client.delivery-status"
  | "client.reconciliation"
  | "server.received"
  | "server.rejected"
  | "server.validated"
  | "server.transport-selected"
  | "server.submitted"
  | "server.error"
  | "queue.enqueued"
  | "queue.claimed"
  | "queue.dispatched"
  | "queue.failed"
  | "queue.expired";

export type PromptDeliverySource = "client" | "server";

export type PromptQueueStatus =
  | "queued"
  | "claimed"
  | "dispatched"
  | "failed"
  | "expired";

/**
 * One bounded, metadata-only prompt delivery trace event. Field values are
 * restricted by the shared sanitizer so that correlation stays possible without
 * ever persisting prompt content or private paths.
 */
export interface PromptDeliveryEvent {
  /** Server-assigned monotonic ordering, absent before the event is recorded. */
  seq?: number;
  requestId: string;
  paneId: string;
  source: PromptDeliverySource;
  phase: PromptDeliveryPhase;
  /** Epoch milliseconds; client values are clamped to a sane window. */
  at: number;
  /** 1-based delivery attempt for the same visible message. */
  attempt?: number;
  transport?: PromptTransport;
  status?: PromptDeliveryStatus;
  httpStatus?: number;
  errorCode?: string;
  errorClass?: string;
  latencyMs?: number;
  queueStatus?: PromptQueueStatus;
  /** Pi bridge command id (opaque UUID), never a session path. */
  commandId?: string;
}

export interface PiBridgeCommandImage {
  uploadId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface PiBridgeCommand {
  id: string;
  requestId: string;
  type: "user-message";
  text: string;
  images: PiBridgeCommandImage[];
  delivery: "immediate-or-steer";
}

export interface ChatRealtimeTool {
  toolCallId: string;
  toolName: string;
  args: ChatJsonObject;
  status: "running" | "complete";
  result?: unknown;
  isError?: boolean;
  /** Same projection as `ChatPart`'s tool-call `display` (see above). */
  display?: ChatToolDisplay;
}

export type ChatRealtimeEvent =
  | { type: "session" }
  | { type: "capabilities"; capabilities: PiBridgeCapabilities }
  | { type: "status"; status: ChatRealtimeStatus }
  | { type: "message"; message: ChatMessage }
  | { type: "tool"; tool: ChatRealtimeTool }
  | {
      type: "branch";
      mode: "latest" | "leaf";
      leafId?: string | null;
    };

export interface ChatRealtimeState {
  paneId: string;
  runtimeId: string;
  sequence: number;
  status: ChatRealtimeStatus;
  /** Undefined means follow the last JSONL entry; null means the branch root. */
  branchLeafId?: string | null;
  branchRevision: number;
  capabilities?: PiBridgeCapabilities;
  messages: ChatMessage[];
  tools: ChatRealtimeTool[];
  updatedAt: number;
}

export type ServerMessage =
  | { channel: "state"; type: "snapshot"; payload: AppSnapshot }
  | {
      channel: "chat";
      type: "realtime";
      paneId: string;
      payload: ChatRealtimeState;
    }
  | {
      channel: "chat";
      type: "prompt-delivery";
      paneId: string;
      payload: PromptDeliveryEvent;
    }
  | {
      channel: "terminal";
      type: "started";
      paneId: string;
      cols: number;
      rows: number;
    }
  | {
      channel: "terminal";
      type: "control-pending" | "control-acquired" | "control-released";
      paneId: string;
    }
  | {
      channel: "terminal";
      type: "frame";
      paneId: string;
      frame: TerminalFrame;
    }
  | {
      channel: "terminal";
      type: "stopped" | "error";
      paneId: string;
      message?: string;
    };

export type ClientMessage =
  | {
      channel: "terminal";
      type: "observe";
      paneId: string;
      cols: number;
      rows: number;
    }
  | {
      channel: "terminal";
      type: "control";
      paneId: string;
      cols: number;
      rows: number;
    }
  | {
      channel: "terminal";
      type: "input";
      paneId: string;
      text: string;
    }
  | {
      channel: "terminal";
      type: "resize";
      paneId: string;
      cols: number;
      rows: number;
    }
  | {
      channel: "terminal";
      type: "scroll";
      paneId: string;
      direction: "up" | "down";
      lines: number;
    }
  | { channel: "terminal"; type: "release"; paneId: string }
  | { channel: "terminal"; type: "stop" };
