import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import net from "node:net";
import { promisify } from "node:util";

import type {
  AppSnapshot,
  PaneSummary,
  TabSummary,
  WorkspaceSummary,
} from "../shared/protocol.js";

const execFileAsync = promisify(execFile);

interface HerdrServerStatus {
  running: boolean;
  version: string;
  protocol: number;
  compatible: boolean;
  socket: string;
}

interface RawWorkspace {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  active_tab_id: string | null;
  agent_status: string;
}

interface RawTab {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  agent_status: string;
}

interface RawPane {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  terminal_title_stripped?: string;
  terminal_title?: string;
  cwd?: string | null;
  foreground_cwd?: string | null;
  focused: boolean;
  agent: string | null;
  agent_status: string;
  agent_session: {
    agent?: string;
    kind?: string;
    source?: string;
    value?: string;
  } | null;
}

interface RawSnapshot {
  version: string;
  protocol: number;
  focused_pane_id: string | null;
  workspaces: RawWorkspace[];
  tabs: RawTab[];
  panes: RawPane[];
}

interface ApiEnvelope<T = unknown> {
  id?: string;
  result?: T;
  error?: { code?: string | number; message?: string } | string;
}

interface SnapshotResult {
  type: "session_snapshot";
  snapshot: RawSnapshot;
}

export async function discoverHerdr(): Promise<HerdrServerStatus> {
  const { stdout } = await execFileAsync("herdr", ["status", "server", "--json"], {
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  const status = JSON.parse(stdout) as HerdrServerStatus;

  if (!status.running || !status.socket) {
    throw new Error("Herdr server is not running");
  }
  if (!status.compatible) {
    throw new Error(
      `Herdr protocol ${status.protocol} is not compatible with this client`,
    );
  }

  return status;
}

export class HerdrClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = "";
  private requestId = 0;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private pollTimer: NodeJS.Timeout | null = null;
  private connecting: Promise<void> | null = null;
  private lastSerialized = "";
  private _latest: AppSnapshot | null = null;
  private piSessionPaths = new Map<string, string>();

  get latest(): AppSnapshot | null {
    return this._latest;
  }

  getPiSessionPath(paneId: string): string | null {
    return this.piSessionPaths.get(paneId) ?? null;
  }

  getPane(paneId: string): PaneSummary | null {
    for (const workspace of this._latest?.workspaces ?? []) {
      for (const tab of workspace.tabs) {
        const pane = tab.panes.find((candidate) => candidate.id === paneId);
        if (pane) return pane;
      }
    }
    return null;
  }

  getWorkspace(workspaceId: string): WorkspaceSummary | null {
    return (
      this._latest?.workspaces.find(
        (workspace) => workspace.id === workspaceId,
      ) ?? null
    );
  }

  getTab(tabId: string): TabSummary | null {
    for (const workspace of this._latest?.workspaces ?? []) {
      const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
      if (tab) return tab;
    }
    return null;
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.openSocket().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async openSocket(): Promise<void> {
    const status = await discoverHerdr();

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(status.socket);
      const onError = (error: Error) => {
        socket.off("connect", onConnect);
        reject(error);
      };
      const onConnect = () => {
        socket.off("error", onError);
        this.socket = socket;
        this.bindSocket(socket);
        resolve();
      };
      socket.once("error", onError);
      socket.once("connect", onConnect);
    });
  }

  private bindSocket(socket: net.Socket): void {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) this.handleLine(line);
        newline = this.buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.rejectPending(new Error("Herdr socket closed"));
      this.emit("disconnected");
    });
    socket.on("error", (error) => this.emit("error", error));
  }

  private handleLine(line: string): void {
    let message: ApiEnvelope;
    try {
      message = JSON.parse(line) as ApiEnvelope;
    } catch {
      return;
    }

    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      const detail =
        typeof message.error === "string"
          ? message.error
          : message.error.message ?? "Unknown Herdr API error";
      pending.reject(new Error(detail));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  async request<T>(method: string, params: object = {}): Promise<T> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("Herdr socket unavailable");

    const id = `herzi-${++this.requestId}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Herdr request timed out: ${method}`));
      }, 5_000);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async refresh(): Promise<AppSnapshot> {
    const result = await this.request<SnapshotResult>("session.snapshot");
    this.piSessionPaths = new Map(
      result.snapshot.panes.flatMap((pane) =>
        pane.agent === "pi" &&
        pane.agent_session?.kind === "path" &&
        pane.agent_session.value
          ? [[pane.pane_id, pane.agent_session.value] as const]
          : [],
      ),
    );
    const snapshot = toAppSnapshot(result.snapshot);
    const serialized = JSON.stringify(snapshot);
    this._latest = snapshot;

    if (serialized !== this.lastSerialized) {
      this.lastSerialized = serialized;
      this.emit("snapshot", snapshot);
    }
    return snapshot;
  }

  startPolling(intervalMs = 1_500): void {
    if (this.pollTimer) return;

    const poll = async () => {
      try {
        await this.refresh();
      } catch (error) {
        this.emit("error", error);
      }
    };
    void poll();
    this.pollTimer = setInterval(poll, intervalMs);
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.socket?.destroy();
    this.socket = null;
  }
}

function toAppSnapshot(raw: RawSnapshot): AppSnapshot {
  const panesByTab = new Map<string, PaneSummary[]>();
  for (const pane of raw.panes) {
    const summary: PaneSummary = {
      id: pane.pane_id,
      workspaceId: pane.workspace_id,
      tabId: pane.tab_id,
      title:
        pane.terminal_title_stripped?.trim() ||
        pane.terminal_title?.trim() ||
        pane.agent ||
        "Terminal",
      cwd: pane.foreground_cwd ?? pane.cwd ?? null,
      focused: pane.focused,
      agent: pane.agent,
      agentStatus: pane.agent_status,
      hasChatSession:
        pane.agent === "pi" &&
        pane.agent_session?.kind === "path" &&
        Boolean(pane.agent_session.value),
    };
    const panes = panesByTab.get(pane.tab_id) ?? [];
    panes.push(summary);
    panesByTab.set(pane.tab_id, panes);
  }

  const tabsByWorkspace = new Map<string, TabSummary[]>();
  for (const tab of raw.tabs) {
    const summary: TabSummary = {
      id: tab.tab_id,
      workspaceId: tab.workspace_id,
      number: tab.number,
      label: tab.label,
      focused: tab.focused,
      agentStatus: tab.agent_status,
      panes: panesByTab.get(tab.tab_id) ?? [],
    };
    const tabs = tabsByWorkspace.get(tab.workspace_id) ?? [];
    tabs.push(summary);
    tabsByWorkspace.set(tab.workspace_id, tabs);
  }

  const workspaces: WorkspaceSummary[] = raw.workspaces
    .map((workspace) => ({
      id: workspace.workspace_id,
      number: workspace.number,
      label: workspace.label,
      focused: workspace.focused,
      activeTabId: workspace.active_tab_id,
      agentStatus: workspace.agent_status,
      tabs: (tabsByWorkspace.get(workspace.workspace_id) ?? []).sort(
        (a, b) => a.number - b.number,
      ),
    }))
    .sort((a, b) => a.number - b.number);

  return {
    version: raw.version,
    protocol: raw.protocol,
    connected: true,
    focusedPaneId: raw.focused_pane_id,
    workspaces,
  };
}
