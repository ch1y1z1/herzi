import { createHash, randomUUID } from "node:crypto";

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
      display?: ChatToolDisplay;
    };

/**
 * Mirrors `ChatToolDisplay` in `src/shared/protocol.ts`.
 *
 * The bridge is installed as a standalone Pi package (`pi install
 * ./integrations/pi`), so it cannot import from the Herzi sources; the types
 * and the projection below are therefore kept in sync by hand. The canonical
 * implementation — with the format notes and the tests — lives in
 * `src/server/pi-session-reader.ts` (`projectToolDisplay`); change both.
 */
type ChatDiffLine = {
  kind: "add" | "remove" | "context" | "skip";
  lineNumber?: number;
  text: string;
};

type ChatToolDisplay = {
  diff?: {
    lines: ChatDiffLine[];
    firstChangedLine?: number;
    truncated?: boolean;
  };
  truncation?: {
    truncated: boolean;
    by?: "lines" | "bytes";
    outputLines?: number;
    totalLines?: number;
  };
  readRange?: { from: number; to: number; total?: number; nextOffset?: number };
  matchCount?: { matched: number; files: number; hasMore?: boolean };
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
  | {
      type: "capabilities";
      capabilities: {
        commands: boolean;
        imageInput: boolean;
        modelAcceptsImages: boolean | null;
      };
    }
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
        display?: ChatToolDisplay;
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
  model?: { input?: string[] };
  sessionManager?: {
    getSessionFile?: () => string | undefined;
  };
}

interface PiApiLike {
  sendUserMessage(
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    >,
    options?: { deliverAs?: "steer" | "followUp" },
  ): void;
  on(
    event: string,
    handler: (event: Record<string, unknown>, ctx: PiContextLike) => void | Promise<void>,
  ): void;
  events: {
    on(event: string, handler: (value: Record<string, unknown>) => void): void;
  };
}

interface BridgeCommand {
  id: string;
  requestId: string;
  type: "user-message";
  text: string;
  images: Array<{
    uploadId: string;
    name: string;
    mimeType: string;
    size: number;
    sha256: string;
  }>;
  delivery: "immediate-or-steer";
}

interface BridgeImagePayload {
  data: string;
  mimeType: string;
  sha256: string;
}

const paneId = process.env.HERDR_PANE_ID ?? "";
const enabled = process.env.HERDR_ENV === "1" && Boolean(paneId);
const endpoint =
  process.env.HERZI_REALTIME_URL ??
  `http://127.0.0.1:${process.env.HERZI_PORT ?? "3030"}/api/integrations/pi/events`;
const integrationBase = new URL("/api/integrations/pi/", endpoint);

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
  let activeContext: PiContextLike | null = null;
  let commandAbort: AbortController | null = null;

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
          version: 2,
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

  const publishCapabilities = (ctx: PiContextLike): void => {
    const modelInput = ctx.model?.input;
    queue(
      "capabilities",
      {
        type: "capabilities",
        capabilities: {
          commands: true,
          imageInput: true,
          modelAcceptsImages: Array.isArray(modelInput)
            ? modelInput.includes("image")
            : null,
        },
      },
      ctx,
    );
  };

  const bridgeIdentity = () => ({ paneId, sessionPath, runtimeId });

  const acknowledgeCommand = async (
    commandId: string,
    status: "dispatched" | "failed",
    error?: string,
  ): Promise<void> => {
    try {
      await fetch(new URL(`commands/${encodeURIComponent(commandId)}/ack`, integrationBase), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...bridgeIdentity(), status, ...(error ? { error } : {}) }),
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      // Command acknowledgement is diagnostic; Pi input must not depend on it.
    }
  };

  const fetchCommandImage = async (
    command: BridgeCommand,
    image: BridgeCommand["images"][number],
  ): Promise<BridgeImagePayload> => {
    const response = await fetch(
      new URL(`uploads/${encodeURIComponent(image.uploadId)}`, integrationBase),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...bridgeIdentity(), commandId: command.id }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
    const payload = (await response.json()) as BridgeImagePayload;
    if (
      typeof payload.data !== "string" ||
      payload.mimeType !== image.mimeType ||
      payload.sha256 !== image.sha256
    ) {
      throw new Error("Image metadata mismatch");
    }
    const bytes = Buffer.from(payload.data, "base64");
    if (
      bytes.length !== image.size ||
      createHash("sha256").update(bytes).digest("hex") !== image.sha256
    ) {
      throw new Error("Image integrity check failed");
    }
    return payload;
  };

  const processCommand = async (command: BridgeCommand): Promise<void> => {
    try {
      const images = await Promise.all(
        command.images.map((image) => fetchCommandImage(command, image)),
      );
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [
        ...(command.text ? [{ type: "text" as const, text: command.text }] : []),
        ...images.map((image) => ({
          type: "image" as const,
          data: image.data,
          mimeType: image.mimeType,
        })),
      ];
      pi.sendUserMessage(
        content,
        activeContext?.isIdle?.() === false ? { deliverAs: "steer" } : undefined,
      );
      await acknowledgeCommand(command.id, "dispatched");
    } catch (error) {
      await acknowledgeCommand(
        command.id,
        "failed",
        error instanceof Error ? error.message : "Unknown image command failure",
      );
    }
  };

  const startCommandLoop = (ctx: PiContextLike): void => {
    activeContext = ctx;
    commandAbort?.abort();
    const controller = new AbortController();
    commandAbort = controller;

    const run = async () => {
      while (rootSession && !controller.signal.aborted) {
        try {
          updateSession(ctx);
          const response = await fetch(new URL("commands/poll", integrationBase), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(bridgeIdentity()),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Command poll failed (${response.status})`);
          const payload = (await response.json()) as { command?: unknown };
          if (isBridgeCommand(payload.command)) await processCommand(payload.command);
        } catch {
          if (controller.signal.aborted) return;
          await delay(1_000, controller.signal);
        }
      }
    };
    void run();
  };

  pi.on("session_start", (event, ctx) => {
    if (ctx.mode !== "tui" || !updateSession(ctx)) return;
    rootSession = true;
    agentActive = ctx.isIdle?.() === false;
    waitingCount = 0;
    pending.clear();
    queue("session", { type: "session" }, ctx);
    publishCapabilities(ctx);
    publishStatus(ctx);
    startCommandLoop(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    if (rootSession) publishCapabilities(ctx);
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
    const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
    const display = projectToolDisplay(toolName, event.result);
    queue(
      `tool:${event.toolCallId}`,
      {
        type: "tool",
        tool: {
          toolCallId: event.toolCallId,
          toolName,
          args: {},
          status: "complete",
          result: toolResultValue(event.result),
          isError: event.isError === true,
          ...(display ? { display } : {}),
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
    commandAbort?.abort();
    commandAbort = null;
    activeContext = null;
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
  if (
    value.role === "user" &&
    Array.isArray(value.content) &&
    value.content.some((part) => isRecord(part) && part.type === "image")
  ) {
    // Keep image bytes out of the realtime HTTP batch. The optimistic UI remains
    // until the authoritative JSONL user message is available.
    return null;
  }

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

/**
 * Live-path counterpart of `projectToolDisplay` in
 * `src/server/pi-session-reader.ts`. It must produce the same structure, or a
 * running card and the same card after the JSONL entry lands would render
 * differently.
 */
function projectToolDisplay(
  toolName: string,
  result: unknown,
): ChatToolDisplay | undefined {
  const details =
    isRecord(result) && isRecord(result.details) ? result.details : undefined;
  const display: ChatToolDisplay = {};

  if (toolName === "edit" && details) {
    const diff = parsePiDisplayDiff(details.diff);
    if (diff) {
      const firstChangedLine = nonNegativeInteger(details.firstChangedLine);
      display.diff = {
        lines: diff.lines,
        ...(firstChangedLine !== undefined ? { firstChangedLine } : {}),
        ...(diff.truncated ? { truncated: true } : {}),
      };
    }
  }

  if ((toolName === "read" || toolName === "bash") && details) {
    const truncation = projectTruncation(details.truncation);
    if (truncation) display.truncation = truncation;
  }

  if (toolName === "read") {
    const readRange = parseReadRangeSummary(toolResultText(result));
    if (readRange) display.readRange = readRange;
  }

  if ((toolName === "ffgrep" || toolName === "fffind") && details) {
    const matched = nonNegativeInteger(details.totalMatched);
    const files = nonNegativeInteger(details.totalFiles);
    if (matched !== undefined && files !== undefined) {
      display.matchCount = {
        matched,
        files,
        ...(typeof details.hasMore === "boolean" ? { hasMore: details.hasMore } : {}),
      };
    }
  }

  return Object.keys(display).length > 0 ? display : undefined;
}

const DIFF_MAX_LINES = 2_000;

function parsePiDisplayDiff(
  value: unknown,
): { lines: ChatDiffLine[]; truncated: boolean } | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.split("\n");
  if (raw.at(-1) === "") raw.pop();

  const lines: ChatDiffLine[] = [];
  for (const line of raw) {
    const marker = line[0];
    if (marker !== "+" && marker !== "-" && marker !== " ") return undefined;
    const rest = line.slice(1);
    if (rest.trim() === "...") {
      lines.push({ kind: "skip", text: "..." });
      continue;
    }
    const match = /^ *(\d+)(?: (.*))?$/u.exec(rest);
    if (!match) return undefined;
    lines.push({
      kind: marker === "+" ? "add" : marker === "-" ? "remove" : "context",
      lineNumber: Number(match[1]),
      text: match[2] ?? "",
    });
  }
  if (!lines.length) return undefined;

  const truncated = lines.length > DIFF_MAX_LINES;
  return {
    lines: truncated ? lines.slice(0, DIFF_MAX_LINES) : lines,
    truncated,
  };
}

const READ_SHOWING_LINES =
  /^\[Showing lines (\d+)-(\d+) of (\d+)(?: \([^)]*\))?\. Use offset=(\d+) to continue\.\]$/u;

function parseReadRangeSummary(
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

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function toolResultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && Array.isArray(value.content)) {
    return value.content
      .flatMap((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
  }
  return "";
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

function isBridgeCommand(value: unknown): value is BridgeCommand {
  if (!isRecord(value) || value.type !== "user-message") return false;
  return (
    typeof value.id === "string" &&
    typeof value.requestId === "string" &&
    typeof value.text === "string" &&
    value.delivery === "immediate-or-steer" &&
    Array.isArray(value.images) &&
    value.images.length > 0 &&
    value.images.length <= 4 &&
    value.images.every(
      (image) =>
        isRecord(image) &&
        typeof image.uploadId === "string" &&
        typeof image.name === "string" &&
        typeof image.mimeType === "string" &&
        typeof image.size === "number" &&
        typeof image.sha256 === "string",
    )
  );
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
