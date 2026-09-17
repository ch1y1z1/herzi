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

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
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
    };

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
