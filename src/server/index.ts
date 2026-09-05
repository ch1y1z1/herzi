import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import type { WebSocket } from "ws";

import type {
  ChatSnapshot,
  ClientMessage,
  ServerMessage,
} from "../shared/protocol.js";
import { HerdrClient } from "./herdr-client.js";
import { PiRealtimeStore, parsePiBridgeBatch } from "./pi-realtime.js";
import { PiSessionReader } from "./pi-session-reader.js";
import { TerminalObserver } from "./terminal-observer.js";

const host = "127.0.0.1";
const port = Number(process.env.HERZI_PORT ?? 3030);
const isDevelopment = process.env.HERZI_DEV === "1";
const app = Fastify({ logger: true });
const herdr = new HerdrClient();
const clients = new Set<WebSocket>();
const observers = new Map<WebSocket, TerminalObserver>();
const piSessions = new PiSessionReader();
const piRealtime = new PiRealtimeStore();

interface TabCreatedResult {
  root_pane: { pane_id: string };
}

await app.register(fastifyWebsocket);

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
        pane.agentStatus === "working",
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
    running: pane.agentStatus === "working",
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

app.post<{
  Params: { paneId: string };
  Body: { text?: unknown };
}>("/api/panes/:paneId/prompt", async (request, reply) => {
  const pane = herdr.getPane(request.params.paneId);
  if (!pane || pane.agent !== "pi") {
    return reply.code(404).send({ error: "Pi pane not found" });
  }

  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (!text) return reply.code(400).send({ error: "Prompt text is required" });
  if (text.length > 100_000) {
    return reply.code(413).send({ error: "Prompt is too large" });
  }

  try {
    await herdr.request("agent.prompt", {
      target: pane.id,
      text,
    });
    return { ok: true };
  } catch (error) {
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

const shutdown = async () => {
  for (const observer of observers.values()) observer.stop();
  observers.clear();
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
