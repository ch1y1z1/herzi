import { randomUUID } from "node:crypto";

type JsonObject = Record<string, unknown>;

type ChatPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: JsonObject;
      result?: unknown;
      isError?: boolean;
    };

interface ChatMessage {
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

type BridgeEvent =
  | { type: "session" }
  | { type: "status"; status: "idle" | "working" | "waiting" }
  | { type: "message"; message: ChatMessage }
  | {
      type: "tool";
      tool: {
        toolCallId: string;
        toolName: string;
        args: JsonObject;
        status: "running" | "complete";
        result?: unknown;
        isError?: boolean;
      };
    }
  | {
      type: "branch";
      mode: "latest" | "leaf";
      leafId?: string | null;
    };

interface PiContextLike {
  mode?: string;
  isIdle?: () => boolean;
  sessionManager?: {
    getSessionFile?: () => string | undefined;
  };
}

interface PiApiLike {
  on(
    event: string,
    handler: (event: Record<string, unknown>, ctx: PiContextLike) => void | Promise<void>,
  ): void;
  events: {
    on(event: string, handler: (value: Record<string, unknown>) => void): void;
  };
}

const paneId = process.env.HERDR_PANE_ID ?? "";
const enabled = process.env.HERDR_ENV === "1" && Boolean(paneId);
const endpoint =
  process.env.HERZI_REALTIME_URL ??
  `http://127.0.0.1:${process.env.HERZI_PORT ?? "3030"}/api/integrations/pi/events`;

export default function herziBridge(pi: PiApiLike): void {
  if (!enabled) return;

  const runtimeId = randomUUID();
  const pending = new Map<string, BridgeEvent>();
  let sessionPath = "";
  let sequence = 0;
  let rootSession = false;
  let sendTimer: NodeJS.Timeout | undefined;
  let sending = false;
  let agentActive = false;
  let waitingCount = 0;

  const updateSession = (ctx: PiContextLike): boolean => {
    const next = ctx.sessionManager?.getSessionFile?.();
    if (typeof next === "string" && next.length > 0) sessionPath = next;
    return Boolean(sessionPath);
  };

  const queue = (key: string, event: BridgeEvent, ctx?: PiContextLike): void => {
    if (!rootSession || (ctx && !updateSession(ctx)) || !sessionPath) return;
    pending.set(key, event);
    if (!sendTimer && !sending) {
      sendTimer = setTimeout(() => {
        sendTimer = undefined;
        void flush();
      }, 60);
      sendTimer.unref?.();
    }
  };

  const flush = async (): Promise<void> => {
    if (sending || pending.size === 0 || !sessionPath) return;
    sending = true;
    const events = Array.from(pending.values());
    pending.clear();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 750);
    timeout.unref?.();

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          paneId,
          sessionPath,
          runtimeId,
          sequence: ++sequence,
          events,
        }),
        signal: controller.signal,
      });
    } catch {
      // The bridge is optional: connection failures must never interrupt Pi.
    } finally {
      clearTimeout(timeout);
      sending = false;
      if (pending.size > 0) {
        sendTimer = setTimeout(() => {
          sendTimer = undefined;
          void flush();
        }, 60);
        sendTimer.unref?.();
      }
    }
  };

  const publishStatus = (ctx?: PiContextLike): void => {
    queue(
      "status",
      {
        type: "status",
        status: waitingCount > 0 ? "waiting" : agentActive ? "working" : "idle",
      },
      ctx,
    );
  };

  const beginWaiting = (ctx?: PiContextLike): void => {
    waitingCount += 1;
    publishStatus(ctx);
  };

  const endWaiting = (ctx?: PiContextLike): void => {
    waitingCount = Math.max(0, waitingCount - 1);
    publishStatus(ctx);
  };

  pi.on("session_start", (event, ctx) => {
    if (ctx.mode !== "tui" || !updateSession(ctx)) return;
    rootSession = true;
    agentActive = ctx.isIdle?.() === false;
    waitingCount = 0;
    pending.clear();
    queue("session", { type: "session" }, ctx);
    publishStatus(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!rootSession) return;
    agentActive = true;
    publishStatus(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!rootSession || ctx.isIdle?.() === false) return;
    agentActive = false;
    waitingCount = 0;
    publishStatus(ctx);
  });

  pi.on("ui_prompt_start", (_event, ctx) => {
    if (rootSession) beginWaiting(ctx);
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    if (rootSession) endWaiting(ctx);
  });

  pi.events.on("herdr:blocked", (event) => {
    if (!rootSession) return;
    if (event?.active) beginWaiting();
    else endWaiting();
  });

  for (const eventName of ["message_start", "message_update", "message_end"] as const) {
    pi.on(eventName, (event, ctx) => {
      if (!rootSession) return;
      const message = toChatMessage(event.message, runtimeId, eventName === "message_end");
      if (message) queue(`message:${message.id}`, { type: "message", message }, ctx);

      if (eventName === "message_end") {
        const followTimer = setTimeout(() => {
          queue("branch", { type: "branch", mode: "latest" }, ctx);
        }, 25);
        followTimer.unref?.();
      }
    });
  }

  for (const eventName of ["tool_execution_start", "tool_execution_update"] as const) {
    pi.on(eventName, (event, ctx) => {
      if (!rootSession || typeof event.toolCallId !== "string") return;
      queue(
        `tool:${event.toolCallId}`,
        {
          type: "tool",
          tool: {
            toolCallId: event.toolCallId,
            toolName: typeof event.toolName === "string" ? event.toolName : "tool",
            args: toJsonObject(event.args),
            status: "running",
          },
        },
        ctx,
      );
    });
  }

  pi.on("tool_execution_end", (event, ctx) => {
    if (!rootSession || typeof event.toolCallId !== "string") return;
    queue(
      `tool:${event.toolCallId}`,
      {
        type: "tool",
        tool: {
          toolCallId: event.toolCallId,
          toolName: typeof event.toolName === "string" ? event.toolName : "tool",
          args: {},
          status: "complete",
          result: toolResultValue(event.result),
          isError: event.isError === true,
        },
      },
      ctx,
    );
  });

  pi.on("session_tree", (event, ctx) => {
    if (!rootSession) return;
    const leafId = typeof event.newLeafId === "string" ? event.newLeafId : null;
    queue("branch", { type: "branch", mode: "leaf", leafId }, ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!rootSession) return;
    agentActive = false;
    waitingCount = 0;
    publishStatus(ctx);
    if (sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = undefined;
    }
    await flush();
    rootSession = false;
  });
}

function toChatMessage(
  value: unknown,
  runtimeId: string,
  complete: boolean,
): ChatMessage | null {
  if (!isRecord(value)) return null;
  if (value.role !== "user" && value.role !== "assistant") return null;

  const createdAt =
    typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
      ? value.timestamp
      : Date.now();
  const content = toChatParts(value.content);

  return {
    id: `live:${runtimeId}:${value.role}:${createdAt}`,
    role: value.role,
    createdAt,
    ...(value.role === "assistant" && complete ? { completedAt: Date.now() } : {}),
    content,
    ...(value.role === "assistant"
      ? {
          status: complete
            ? statusFromStopReason(value.stopReason)
            : ({ type: "running" } as const),
        }
      : {}),
  };
}

function toChatParts(value: unknown): ChatPart[] {
  if (typeof value === "string") {
    return value ? [{ type: "text", text: clip(value) }] : [];
  }
  if (!Array.isArray(value)) return [];

  return value.flatMap((part): ChatPart[] => {
    if (!isRecord(part) || typeof part.type !== "string") return [];
    if (part.type === "text" && typeof part.text === "string") {
      return part.text ? [{ type: "text", text: clip(part.text) }] : [];
    }
    if (part.type === "thinking" && typeof part.thinking === "string") {
      return part.thinking
        ? [{ type: "reasoning", text: clip(part.thinking) }]
        : [];
    }
    if (
      part.type === "toolCall" &&
      typeof part.id === "string" &&
      typeof part.name === "string"
    ) {
      return [
        {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          args: toJsonObject(part.arguments),
        },
      ];
    }
    if (part.type === "image") {
      return [{ type: "text", text: "[image]" }];
    }
    return [];
  });
}

function statusFromStopReason(value: unknown): ChatMessage["status"] {
  switch (value) {
    case "error":
      return { type: "incomplete", reason: "error" };
    case "aborted":
    case "cancelled":
      return { type: "incomplete", reason: "cancelled" };
    case "length":
      return { type: "incomplete", reason: "length" };
    case "stop":
      return { type: "complete", reason: "stop" };
    default:
      return { type: "complete", reason: "unknown" };
  }
}

function toolResultValue(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.content)) {
    const text = value.content
      .flatMap((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
    if (text) return clip(text);
  }
  return toJsonValue(value);
}

function toJsonObject(value: unknown): JsonObject {
  const normalized = toJsonValue(value);
  return isRecord(normalized) ? normalized : { value: normalized };
}

function toJsonValue(value: unknown): unknown {
  try {
    const json = JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    );
    if (json === undefined) return null;
    if (json.length > 256_000) return `${json.slice(0, 256_000)}\n…[truncated]`;
    return JSON.parse(json) as unknown;
  } catch {
    return String(value);
  }
}

function clip(value: string): string {
  return value.length > 256_000 ? `${value.slice(0, 256_000)}\n…[truncated]` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
