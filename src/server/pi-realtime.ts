import type {
  ChatRealtimeEvent,
  ChatRealtimeState,
  ChatRealtimeTool,
} from "../shared/protocol.js";

export interface PiBridgeBatch {
  version: 1;
  paneId: string;
  sessionPath: string;
  runtimeId: string;
  sequence: number;
  events: ChatRealtimeEvent[];
}

interface StoredState extends ChatRealtimeState {
  sessionPath: string;
  messageMap: Map<string, ChatRealtimeState["messages"][number]>;
  toolMap: Map<string, ChatRealtimeTool>;
}

export class PiRealtimeStore {
  private states = new Map<string, StoredState>();

  ingest(batch: PiBridgeBatch): ChatRealtimeState {
    let state = this.states.get(batch.paneId);
    if (!state || state.runtimeId !== batch.runtimeId) {
      state = createState(batch);
      this.states.set(batch.paneId, state);
    } else if (batch.sequence <= state.sequence) {
      return publicState(state);
    }

    state.sequence = batch.sequence;
    state.updatedAt = Date.now();
    state.sessionPath = batch.sessionPath;

    for (const event of batch.events) {
      switch (event.type) {
        case "session":
          state.status = "idle";
          state.branchLeafId = undefined;
          state.branchRevision += 1;
          state.messageMap.clear();
          state.toolMap.clear();
          break;
        case "status":
          state.status = event.status;
          break;
        case "message":
          state.messageMap.set(event.message.id, event.message);
          trimMap(state.messageMap, 64);
          break;
        case "tool":
          state.toolMap.set(event.tool.toolCallId, event.tool);
          trimMap(state.toolMap, 256);
          break;
        case "branch":
          state.branchLeafId = event.mode === "leaf" ? event.leafId ?? null : undefined;
          state.branchRevision += 1;
          if (event.mode === "leaf") {
            state.messageMap.clear();
            state.toolMap.clear();
          }
          break;
      }
    }

    return publicState(state);
  }

  getBranchLeafId(paneId: string, sessionPath: string): string | null | undefined {
    const state = this.states.get(paneId);
    return state?.sessionPath === sessionPath ? state.branchLeafId : undefined;
  }

  snapshots(): ChatRealtimeState[] {
    return Array.from(this.states.values(), publicState);
  }
}

export function parsePiBridgeBatch(value: unknown): PiBridgeBatch | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== 1 ||
    typeof value.paneId !== "string" ||
    typeof value.sessionPath !== "string" ||
    typeof value.runtimeId !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    !Array.isArray(value.events) ||
    value.events.length > 100
  ) {
    return null;
  }

  const events = value.events.filter(isRealtimeEvent);
  if (events.length !== value.events.length) return null;

  return {
    version: 1,
    paneId: value.paneId,
    sessionPath: value.sessionPath,
    runtimeId: value.runtimeId,
    sequence: value.sequence,
    events,
  };
}

function createState(batch: PiBridgeBatch): StoredState {
  return {
    paneId: batch.paneId,
    runtimeId: batch.runtimeId,
    sequence: -1,
    status: "idle",
    branchLeafId: undefined,
    branchRevision: 0,
    messages: [],
    tools: [],
    updatedAt: Date.now(),
    sessionPath: batch.sessionPath,
    messageMap: new Map(),
    toolMap: new Map(),
  };
}

function publicState(state: StoredState): ChatRealtimeState {
  return {
    paneId: state.paneId,
    runtimeId: state.runtimeId,
    sequence: state.sequence,
    status: state.status,
    ...(state.branchLeafId !== undefined
      ? { branchLeafId: state.branchLeafId }
      : {}),
    branchRevision: state.branchRevision,
    messages: Array.from(state.messageMap.values()),
    tools: Array.from(state.toolMap.values()),
    updatedAt: state.updatedAt,
  };
}

function isRealtimeEvent(value: unknown): value is ChatRealtimeEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "session":
      return true;
    case "status":
      return value.status === "idle" || value.status === "working" || value.status === "waiting";
    case "message":
      return isRecord(value.message) && typeof value.message.id === "string";
    case "tool":
      return (
        isRecord(value.tool) &&
        typeof value.tool.toolCallId === "string" &&
        typeof value.tool.toolName === "string"
      );
    case "branch":
      return (
        value.mode === "latest" ||
        (value.mode === "leaf" &&
          (value.leafId === null || typeof value.leafId === "string"))
      );
    default:
      return false;
  }
}

function trimMap<Key, Value>(map: Map<Key, Value>, maximum: number): void {
  while (map.size > maximum) {
    const oldest = map.keys().next().value as Key | undefined;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
