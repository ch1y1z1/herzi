import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import type { WebSocket } from "ws";

import type {
  ChatSnapshot,
  ClientMessage,
  PromptDeliveryEvent,
  PromptDeliveryPhase,
  PromptDeliveryStatus,
  PromptResponse,
  ServerMessage,
} from "../shared/protocol.js";
import { isPaneActive } from "../shared/pane-activity.js";
import {
  isPromptCorrelationId,
  parsePromptDeliveryEvent,
} from "../shared/prompt-delivery.js";
import { HerdrClient } from "./herdr-client.js";
import { ImageUploadError, ImageUploadStore } from "./image-upload-store.js";
import { appendManagedAttachments } from "./managed-attachments.js";
import {
  PiCommandQueue,
  parseBridgeIdentity,
  queueLifecycleEvent,
} from "./pi-command-queue.js";
import { PiRealtimeStore, parsePiBridgeBatch } from "./pi-realtime.js";
import { PiSessionReader } from "./pi-session-reader.js";
import { PromptDeliveryTrace } from "./prompt-delivery-trace.js";
import { TerminalObserver } from "./terminal-observer.js";

const host = "127.0.0.1";
const port = Number(process.env.HERZI_PORT ?? 3030);
const isDevelopment = process.env.HERZI_DEV === "1";
const app = Fastify({ logger: true });
const herdr = new HerdrClient();
const clients = new Set<WebSocket>();
const observers = new Map<WebSocket, TerminalObserver>();
const uploads = new ImageUploadStore();
const piSessions = new PiSessionReader((uploadId, paneId, sessionPath) =>
  uploads.dataUrlFor(uploadId, paneId, sessionPath),
);
const piRealtime = new PiRealtimeStore();
const promptTrace = new PromptDeliveryTrace({
  onWriteError: (error) =>
    app.log.warn({ err: error }, "Failed to append the prompt delivery trace"),
  onDroppedEvent: (reason) =>
    app.log.warn({ reason }, "Dropped an unsanitizable prompt delivery event"),
});
// Queue lifecycle events are the only place where "HTTP succeeded but the prompt
// was never delivered" becomes visible, so they are traced and pushed live.
const piCommands = new PiCommandQueue((event) => {
  const recorded = promptTrace.record(queueLifecycleEvent(event));
  if (recorded && recorded.phase !== "queue.enqueued") {
    broadcast({
      channel: "chat",
      type: "prompt-delivery",
      paneId: recorded.paneId,
      payload: recorded,
    });
  }
});
const requestToken = randomBytes(32).toString("base64url");

interface TabCreatedResult {
  root_pane: { pane_id: string };
}

await app.register(fastifyWebsocket);
await app.register(fastifyMultipart, {
  limits: { files: 1, fileSize: 10 * 1024 * 1024, parts: 2 },
});

app.addHook("preHandler", async (request, reply) => {
  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS" ||
    request.url.startsWith("/api/integrations/pi/")
  ) {
    return;
  }

  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return reply.code(403).send({ error: "Cross-origin mutation rejected" });
  }
  if (request.headers["x-herzi-request-token"] !== requestToken) {
    return reply.code(403).send({ error: "Missing or invalid request token" });
  }
});

app.get("/api/request-token", async (_request, reply) => {
  reply.header("cache-control", "no-store");
  return { token: requestToken };
});

app.get("/api/health", async () => ({
  ok: true,
  herdrConnected: Boolean(herdr.latest),
}));

app.get("/api/bootstrap", async (_request, reply) => {
  try {
    return herdr.latest ?? (await herdr.refresh());
  } catch (error) {
    reply.code(503);
    return {
      connected: false,
      error: error instanceof Error ? error.message : "Herdr unavailable",
    };
  }
});

app.post<{ Params: { workspaceId: string } }>(
  "/api/workspaces/:workspaceId/tabs",
  async (request, reply) => {
    const workspace = herdr.getWorkspace(request.params.workspaceId);
    if (!workspace) return reply.code(404).send({ error: "Workspace not found" });

    try {
      const result = await herdr.request<TabCreatedResult>("tab.create", {
        workspace_id: workspace.id,
        focus: true,
      });
      await herdr.refresh();
      return { ok: true, paneId: result.root_pane.pane_id };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to create Herdr tab");
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Herdr tab create failed",
      });
    }
  },
);

app.patch<{
  Params: { workspaceId: string };
  Body: { label?: unknown };
}>("/api/workspaces/:workspaceId", async (request, reply) => {
  const workspace = herdr.getWorkspace(request.params.workspaceId);
  if (!workspace) return reply.code(404).send({ error: "Workspace not found" });
  const label =
    typeof request.body?.label === "string" ? request.body.label.trim() : "";
  if (!label) return reply.code(400).send({ error: "Workspace name is required" });

  try {
    await herdr.request("workspace.rename", {
      workspace_id: workspace.id,
      label,
    });
    await herdr.refresh();
    return { ok: true };
  } catch (error) {
    request.log.warn({ err: error }, "Failed to rename Herdr workspace");
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Herdr workspace rename failed",
    });
  }
});

app.delete<{ Params: { workspaceId: string } }>(
  "/api/workspaces/:workspaceId",
  async (request, reply) => {
    const workspace = herdr.getWorkspace(request.params.workspaceId);
    if (!workspace) return reply.code(404).send({ error: "Workspace not found" });

    try {
      await herdr.request("workspace.close", { workspace_id: workspace.id });
      await herdr.refresh();
      return { ok: true };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to close Herdr workspace");
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Herdr workspace close failed",
      });
    }
  },
);

app.patch<{
  Params: { tabId: string };
  Body: { label?: unknown };
}>("/api/tabs/:tabId", async (request, reply) => {
  const tab = herdr.getTab(request.params.tabId);
  if (!tab) return reply.code(404).send({ error: "Tab not found" });
  const label =
    typeof request.body?.label === "string" ? request.body.label.trim() : "";
  if (!label) return reply.code(400).send({ error: "Tab name is required" });

  try {
    await herdr.request("tab.rename", { tab_id: tab.id, label });
    await herdr.refresh();
    return { ok: true };
  } catch (error) {
    request.log.warn({ err: error }, "Failed to rename Herdr tab");
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Herdr tab rename failed",
    });
  }
});

app.delete<{ Params: { tabId: string } }>(
  "/api/tabs/:tabId",
  async (request, reply) => {
    const tab = herdr.getTab(request.params.tabId);
    if (!tab) return reply.code(404).send({ error: "Tab not found" });

    try {
      await herdr.request("tab.close", { tab_id: tab.id });
      await herdr.refresh();
      return { ok: true };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to close Herdr tab");
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Herdr tab close failed",
      });
    }
  },
);

app.post<{ Params: { paneId: string } }>(
  "/api/panes/:paneId/uploads",
  async (request, reply) => {
    const pane = herdr.getPane(request.params.paneId);
    if (!pane || pane.agent !== "pi") {
      return reply.code(404).send({ error: "Pi pane not found" });
    }

    try {
      const part = await request.file();
      if (!part) return reply.code(400).send({ error: "Image file is required" });
      const upload = await uploads.create({
        paneId: pane.id,
        sessionPath: herdr.getPiSessionPath(pane.id),
        name: part.filename,
        stream: part.file,
      });
      if (part.file.truncated) {
        await uploads.delete(upload.uploadId);
        return reply.code(413).send({ error: "Image exceeds the 10 MiB limit" });
      }
      return reply.code(201).send(upload);
    } catch (error) {
      if (error instanceof ImageUploadError) {
        const status = error.code === "too-large" ? 413 : 400;
        return reply.code(status).send({ error: error.message });
      }
      if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
        return reply.code(413).send({ error: "Image exceeds the 10 MiB limit" });
      }
      request.log.warn({ err: error }, "Failed to store image upload");
      return reply.code(500).send({ error: "Image upload failed" });
    }
  },
);

app.delete<{ Params: { paneId: string; uploadId: string } }>(
  "/api/panes/:paneId/uploads/:uploadId",
  async (request, reply) => {
    const pane = herdr.getPane(request.params.paneId);
    if (!pane || pane.agent !== "pi") {
      return reply.code(404).send({ error: "Pi pane not found" });
    }
    try {
      await uploads.getBound(
        request.params.uploadId,
        pane.id,
        herdr.getPiSessionPath(pane.id),
      );
      await uploads.delete(request.params.uploadId);
      return { ok: true };
    } catch (error) {
      if (error instanceof ImageUploadError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  },
);

app.get<{ Params: { paneId: string } }>(
  "/api/panes/:paneId/chat",
  async (request, reply) => {
    const pane = herdr.getPane(request.params.paneId);
    const sessionPath = herdr.getPiSessionPath(request.params.paneId);
    if (!pane || pane.agent !== "pi") {
      return reply.code(404).send({ error: "No Pi chat session for this pane" });
    }
    if (!sessionPath) return emptyChatSnapshot(pane);

    try {
      return await piSessions.read(
        pane.id,
        sessionPath,
        isPaneActive(pane.agentStatus),
        piRealtime.getBranchLeafId(pane.id, sessionPath),
      );
    } catch (error) {
      if (isMissingFile(error)) return emptyChatSnapshot(pane);
      request.log.warn({ err: error }, "Failed to read Pi session");
      return reply.code(503).send({ error: "Pi session is temporarily unavailable" });
    }
  },
);

function emptyChatSnapshot(pane: { id: string; agentStatus: string }): ChatSnapshot {
  return {
    paneId: pane.id,
    running: isPaneActive(pane.agentStatus),
    updatedAt: 0,
    messages: [],
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

app.post<{ Body: unknown }>("/api/integrations/pi/events", async (request, reply) => {
  const batch = parsePiBridgeBatch(request.body);
  if (!batch) return reply.code(400).send({ error: "Invalid Pi bridge event batch" });

  let pane = herdr.getPane(batch.paneId);
  let sessionPath = herdr.getPiSessionPath(batch.paneId);
  if (!pane || pane.agent !== "pi" || sessionPath !== batch.sessionPath) {
    try {
      await herdr.refresh();
    } catch {
      return reply.code(503).send({ error: "Herdr state is temporarily unavailable" });
    }
    pane = herdr.getPane(batch.paneId);
    sessionPath = herdr.getPiSessionPath(batch.paneId);
  }

  if (!pane || pane.agent !== "pi" || sessionPath !== batch.sessionPath) {
    return reply.code(409).send({ error: "Pi bridge identity does not match Herdr" });
  }

  const state = piRealtime.ingest(batch);
  broadcast({
    channel: "chat",
    type: "realtime",
    paneId: batch.paneId,
    payload: state,
  });
  return { ok: true };
});

app.post<{ Body: unknown }>(
  "/api/integrations/pi/commands/poll",
  async (request, reply) => {
    const identity = parseBridgeIdentity(request.body);
    if (!identity || !bridgeIdentityMatches(identity)) {
      return reply.code(409).send({ error: "Pi bridge identity does not match Herdr" });
    }
    const controller = new AbortController();
    request.raw.once("aborted", () => controller.abort());
    const command = await piCommands.poll(identity, controller.signal);
    return { command };
  },
);

app.post<{
  Params: { commandId: string };
  Body: unknown;
}>("/api/integrations/pi/commands/:commandId/ack", async (request, reply) => {
  const identity = parseBridgeIdentity(request.body);
  const body = isRecord(request.body) ? request.body : null;
  const status = body?.status;
  if (
    !identity ||
    !bridgeIdentityMatches(identity) ||
    (status !== "dispatched" && status !== "failed")
  ) {
    return reply.code(409).send({ error: "Invalid Pi command acknowledgement" });
  }
  const accepted = piCommands.ack(
    identity,
    request.params.commandId,
    status,
    typeof body?.error === "string" ? body.error : undefined,
  );
  return accepted
    ? { ok: true }
    : reply.code(409).send({ error: "Pi command is not claimed by this runtime" });
});

app.post<{
  Params: { uploadId: string };
  Body: unknown;
}>("/api/integrations/pi/uploads/:uploadId", async (request, reply) => {
  const identity = parseBridgeIdentity(request.body);
  const body = isRecord(request.body) ? request.body : null;
  if (
    !identity ||
    !bridgeIdentityMatches(identity) ||
    typeof body?.commandId !== "string" ||
    !piCommands.ownsClaim(identity, body.commandId)
  ) {
    return reply.code(409).send({ error: "Pi bridge cannot access this image" });
  }
  try {
    return await uploads.readBase64(
      request.params.uploadId,
      identity.paneId,
      identity.sessionPath,
    );
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return reply.code(404).send({ error: error.message });
    }
    throw error;
  }
});

app.get<{ Querystring: { requestId?: string; limit?: string } }>(
  "/api/prompt-delivery",
  async (request, reply) => {
    const requestId = request.query.requestId;
    if (requestId !== undefined && !isPromptCorrelationId(requestId)) {
      return reply.code(400).send({ error: "Invalid requestId" });
    }
    return {
      events: promptTrace.query({
        ...(requestId ? { requestId } : {}),
        limit: Number(request.query.limit ?? 50),
      }),
    };
  },
);

app.post<{ Body: unknown }>("/api/prompt-delivery/events", async (request, reply) => {
  const body = isRecord(request.body) ? request.body : null;
  const rawEvents = body?.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > 50) {
    return reply.code(400).send({ error: "Invalid prompt delivery event batch" });
  }

  const now = Date.now();
  let accepted = 0;
  for (const rawEvent of rawEvents) {
    // Client events are re-sanitized here: unknown fields such as prompt text
    // are dropped before anything is stored.
    const event = parsePromptDeliveryEvent(rawEvent, { source: "client", now });
    if (!event) {
      return reply.code(400).send({ error: "Invalid prompt delivery event" });
    }
    if (promptTrace.record(event)) accepted += 1;
  }
  return { ok: true, accepted };
});

app.post<{
  Params: { paneId: string };
  Body: { text?: unknown; requestId?: unknown; attachments?: unknown };
}>("/api/panes/:paneId/prompt", async (request, reply) => {
  const requestedPaneId = request.params.paneId;
  const requestId =
    typeof request.body?.requestId === "string" &&
    isPromptCorrelationId(request.body.requestId)
      ? request.body.requestId
      : randomUUID();
  const trace = createPromptTraceContext(requestedPaneId, requestId);
  trace.record("server.received");

  const pane = herdr.getPane(requestedPaneId);
  if (!pane || pane.agent !== "pi") {
    trace.record("server.rejected", { httpStatus: 404, errorCode: "pane-not-found" });
    return reply.code(404).send({ error: "Pi pane not found" });
  }

  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  const uploadIds = parseUploadIds(request.body?.attachments);
  if (!uploadIds) {
    trace.record("server.rejected", { httpStatus: 400, errorCode: "invalid-attachments" });
    return reply.code(400).send({ error: "Invalid image attachments" });
  }
  if (!text && uploadIds.length === 0) {
    trace.record("server.rejected", { httpStatus: 400, errorCode: "empty-prompt" });
    return reply.code(400).send({ error: "Prompt text or an image is required" });
  }
  if (text.length > 100_000) {
    trace.record("server.rejected", { httpStatus: 413, errorCode: "prompt-too-large" });
    return reply.code(413).send({ error: "Prompt is too large" });
  }
  trace.record("server.validated");

  const sessionPath = herdr.getPiSessionPath(pane.id);

  try {
    const attachmentRecords = await Promise.all(
      uploadIds.map((uploadId) => uploads.getBound(uploadId, pane.id, sessionPath)),
    );
    const totalImageBytes = attachmentRecords.reduce(
      (total, record) => total + record.size,
      0,
    );
    if (totalImageBytes > 20 * 1024 * 1024) {
      trace.record("server.rejected", {
        httpStatus: 413,
        errorCode: "images-too-large",
      });
      return reply.code(413).send({ error: "Images exceed the 20 MiB message limit" });
    }

    const capabilities = sessionPath
      ? piRealtime.getCapabilities(pane.id, sessionPath)
      : undefined;
    if (
      uploadIds.length > 0 &&
      sessionPath &&
      piCommands.isAvailable(pane.id, sessionPath) &&
      capabilities?.commands &&
      capabilities.imageInput &&
      capabilities.modelAcceptsImages !== false
    ) {
      const images = attachmentRecords.map((record) => ({
        uploadId: record.uploadId,
        name: record.name,
        mimeType: record.mimeType,
        size: record.size,
        sha256: record.sha256,
      }));
      trace.record("server.transport-selected", { transport: "pi-native" });
      piCommands.enqueue({
        paneId: pane.id,
        sessionPath,
        requestId,
        text,
        images,
      });
      await Promise.all(
        uploadIds.map((uploadId) => uploads.markSubmitted(uploadId, "native")),
      );
      const response: PromptResponse = {
        ok: true,
        requestId,
        transport: "pi-native",
        status: "queued",
      };
      return response;
    }

    const managed = await Promise.all(
      attachmentRecords.map(async (record) => ({
        id: record.uploadId,
        path: await uploads.managedPath(record.uploadId, pane.id, sessionPath),
        mimeType: record.mimeType,
      })),
    );
    const promptText = managed.length
      ? appendManagedAttachments(text, managed)
      : text;
    const transport = managed.length ? "host-path" : "text";

    trace.record("server.transport-selected", { transport });
    await herdr.request("agent.prompt", {
      target: pane.id,
      text: promptText,
    });
    trace.record("server.submitted", { transport, status: "submitted" });
    await Promise.all(uploadIds.map((uploadId) => uploads.markSubmitted(uploadId, "fallback")));

    const response: PromptResponse = {
      ok: true,
      requestId,
      transport,
      status: "submitted",
    };
    return response;
  } catch (error) {
    if (error instanceof ImageUploadError) {
      trace.record("server.error", {
        httpStatus: 409,
        errorCode: `image-${error.code}`,
        errorClass: error.name,
      });
      return reply.code(409).send({ error: error.message });
    }
    trace.record("server.error", {
      httpStatus: 502,
      errorCode: "herdr-prompt-failed",
      errorClass: errorClassName(error),
    });
    request.log.warn({ err: error }, "Failed to prompt Pi pane");
    return reply.code(502).send({
      error: error instanceof Error ? error.message : "Herdr prompt failed",
    });
  }
});

app.post<{ Params: { paneId: string } }>(
  "/api/panes/:paneId/seen",
  async (request, reply) => {
    const pane = herdr.getPane(request.params.paneId);
    if (!pane?.agent) {
      return reply.code(404).send({ error: "Agent pane not found" });
    }
    if (pane.agentStatus !== "done") return { ok: true, changed: false };

    try {
      // Herdr has no separate acknowledge API. Focusing an agent is the
      // official operation that marks a completed background tab as seen.
      await herdr.request("agent.focus", { target: pane.id });
      await herdr.refresh();
      return { ok: true, changed: true };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to mark Herdr agent as seen");
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Herdr focus failed",
      });
    }
  },
);

app.post<{ Params: { paneId: string } }>(
  "/api/panes/:paneId/cancel",
  async (request, reply) => {
    const pane = herdr.getPane(request.params.paneId);
    if (!pane || pane.agent !== "pi") {
      return reply.code(404).send({ error: "Pi pane not found" });
    }

    try {
      await herdr.request("agent.send_keys", {
        target: pane.id,
        keys: ["esc"],
      });
      return { ok: true };
    } catch (error) {
      request.log.warn({ err: error }, "Failed to cancel Pi run");
      return reply.code(502).send({
        error: error instanceof Error ? error.message : "Herdr cancel failed",
      });
    }
  },
);

app.get("/ws", { websocket: true }, (socket) => {
  clients.add(socket);
  const initial = herdr.latest;
  if (initial) send(socket, { channel: "state", type: "snapshot", payload: initial });
  for (const state of piRealtime.snapshots()) {
    send(socket, {
      channel: "chat",
      type: "realtime",
      paneId: state.paneId,
      payload: state,
    });
  }

  socket.on("message", (buffer) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(buffer.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (message.channel !== "terminal") return;
    if (message.type === "stop") {
      stopObserver(socket);
      return;
    }

    if (message.type === "input") {
      const observer = observers.get(socket);
      if (
        observer?.mode === "control" &&
        observer.paneId === message.paneId &&
        message.text.length <= 64_000
      ) {
        observer.input(message.text);
      }
      return;
    }
    if (message.type === "resize") {
      const observer = observers.get(socket);
      if (observer?.mode === "control" && observer.paneId === message.paneId) {
        observer.resize(message.cols, message.rows);
      }
      return;
    }
    if (message.type === "scroll") {
      const observer = observers.get(socket);
      if (
        observer?.mode === "control" &&
        observer.paneId === message.paneId &&
        (message.direction === "up" || message.direction === "down")
      ) {
        observer.scroll(message.direction, message.lines);
      }
      return;
    }
    if (message.type === "release") {
      const observer = observers.get(socket);
      if (observer?.mode === "control" && observer.paneId === message.paneId) {
        observer.release();
        send(socket, {
          channel: "terminal",
          type: "control-released",
          paneId: message.paneId,
        });
      }
      return;
    }
    if (message.type !== "observe" && message.type !== "control") return;

    const paneExists = herdr.latest?.workspaces.some((workspace) =>
      workspace.tabs.some((tab) =>
        tab.panes.some((pane) => pane.id === message.paneId),
      ),
    );
    if (!paneExists) {
      send(socket, {
        channel: "terminal",
        type: "error",
        paneId: message.paneId,
        message: "Pane no longer exists",
      });
      return;
    }

    stopObserver(socket);
    const observer = new TerminalObserver(
      message.paneId,
      message.cols,
      message.rows,
      message.type,
    );
    observers.set(socket, observer);
    let controlAnnounced = false;
    observer.on("frame", (frame) => {
      if (observer.mode === "control" && !controlAnnounced) {
        controlAnnounced = true;
        send(socket, {
          channel: "terminal",
          type: "control-acquired",
          paneId: message.paneId,
        });
      }
      send(socket, {
        channel: "terminal",
        type: "frame",
        paneId: message.paneId,
        frame,
      });
    });
    observer.on("error", (error: Error) => {
      send(socket, {
        channel: "terminal",
        type: "error",
        paneId: message.paneId,
        message: error.message,
      });
    });
    observer.on("stopped", () => {
      if (observers.get(socket) === observer) observers.delete(socket);
    });
    observer.start();
    if (observer.mode === "control") {
      send(socket, {
        channel: "terminal",
        type: "control-pending",
        paneId: message.paneId,
      });
    } else {
      send(socket, {
        channel: "terminal",
        type: "started",
        paneId: message.paneId,
        cols: observer.cols,
        rows: observer.rows,
      });
    }
  });

  socket.once("close", () => {
    clients.delete(socket);
    stopObserver(socket);
  });
});

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = isDevelopment
  ? process.cwd()
  : path.resolve(currentDir, "../..");
const webRoot = path.join(projectRoot, "dist/web");

if (isDevelopment) {
  app.get("/", async (_request, reply) => {
    return reply.redirect("http://127.0.0.1:5173/");
  });
} else if (fs.existsSync(path.join(webRoot, "index.html"))) {
  await app.register(fastifyStatic, {
    root: webRoot,
    // Resolve files at request time so a running production server can serve
    // assets emitted by a later `npm run build:web` without being restarted.
    wildcard: true,
    setHeaders(response, filePath) {
      if (path.basename(filePath) === "index.html") {
        response.header("cache-control", "no-store");
      }
    },
  });
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?", 1)[0] ?? "/";
    const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
    const isAssetRequest = pathname.startsWith("/assets/") || path.extname(pathname);

    if (
      request.raw.method === "GET" &&
      acceptsHtml &&
      !isAssetRequest &&
      !pathname.startsWith("/api/") &&
      pathname !== "/ws"
    ) {
      reply.header("cache-control", "no-store");
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
} else {
  app.get("/", async (_request, reply) => {
    return reply.code(503).type("text/plain").send(
      "Herzi Web UI has not been built. Run `npm run build`, then restart `npm start`.",
    );
  });
}

herdr.on("snapshot", (snapshot) => {
  broadcast({ channel: "state", type: "snapshot", payload: snapshot });
});
herdr.on("error", (error) => app.log.warn({ err: error }, "Herdr connection error"));
herdr.startPolling();
void uploads.cleanup().catch((error) =>
  app.log.warn({ err: error }, "Failed to clean expired image uploads"),
);
const uploadCleanupTimer = setInterval(() => {
  void uploads.cleanup().catch((error) =>
    app.log.warn({ err: error }, "Failed to clean expired image uploads"),
  );
}, 30 * 60 * 1_000);
uploadCleanupTimer.unref();

// The command queue TTL is 60s; sweeping often keeps "queued but never claimed"
// and "claimed but never acknowledged" visible to the UI within about a minute.
const promptQueueCleanupTimer = setInterval(() => piCommands.cleanup(), 15_000);
promptQueueCleanupTimer.unref();

const shutdown = async () => {
  for (const observer of observers.values()) observer.stop();
  observers.clear();
  clearInterval(uploadCleanupTimer);
  clearInterval(promptQueueCleanupTimer);
  piCommands.stop();
  promptTrace.stop();
  await promptTrace.flush().catch(() => undefined);
  herdr.stop();
  await app.close();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ host, port });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage): void {
  for (const socket of clients) send(socket, message);
}

function stopObserver(socket: WebSocket): void {
  observers.get(socket)?.stop();
  observers.delete(socket);
}

function bridgeIdentityMatches(identity: {
  paneId: string;
  sessionPath: string;
}): boolean {
  const pane = herdr.getPane(identity.paneId);
  return (
    pane?.agent === "pi" &&
    herdr.getPiSessionPath(identity.paneId) === identity.sessionPath
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

interface PromptTraceFields {
  transport?: PromptResponse["transport"];
  status?: PromptDeliveryStatus;
  httpStatus?: number;
  errorCode?: string;
  errorClass?: string;
}

interface PromptTraceContext {
  record: (phase: PromptDeliveryPhase, fields?: PromptTraceFields) => void;
}

/**
 * Records server-side prompt stages for one request. Events carry only metadata:
 * the pane id, request id, phase, transport, status, latency and a stable error
 * code. Prompt text, images and session paths are never passed in.
 */
function createPromptTraceContext(
  paneId: string,
  requestId: string,
): PromptTraceContext {
  const startedAt = Date.now();
  const traceable = isPromptCorrelationId(paneId) && isPromptCorrelationId(requestId);
  return {
    record(phase, fields = {}) {
      if (!traceable) return;
      promptTrace.record({
        requestId,
        paneId,
        source: "server",
        phase,
        at: Date.now(),
        latencyMs: Date.now() - startedAt,
        ...fields,
      });
    },
  };
}

function errorClassName(error: unknown): string {
  const name =
    error instanceof Error && error.name ? error.name : typeof error;
  return name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "unknown";
}

function parseUploadIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) return null;
  const ids = value.map((item) =>
    typeof item === "object" && item !== null && "uploadId" in item
      ? item.uploadId
      : null,
  );
  if (ids.some((id) => typeof id !== "string" || id.length > 100)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids as string[];
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1")
    );
  } catch {
    return false;
  }
}
