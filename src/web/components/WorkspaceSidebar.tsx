import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers3,
  Pencil,
  Plus,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type {
  AppSnapshot,
  PaneSummary,
  TabSummary,
  WorkspaceSummary,
} from "../../shared/protocol";
import { apiFetch } from "../api";

type SidebarMenu =
  | {
      kind: "workspace";
      workspace: WorkspaceSummary;
      x: number;
      y: number;
    }
  | {
      kind: "tab";
      workspace: WorkspaceSummary;
      tab: TabSummary;
      pane: PaneSummary;
      x: number;
      y: number;
    };

type MenuAction =
  | "new-tab"
  | "rename"
  | "copy-path"
  | "close-workspace"
  | "close-tab";

interface SidebarNotice {
  tone: "success" | "error";
  text: string;
}

export function WorkspaceSidebar({
  snapshot,
  selectedPaneId,
  onSelectPane,
}: {
  snapshot: AppSnapshot | null;
  selectedPaneId: string | null;
  onSelectPane: (paneId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [notice, setNotice] = useState<SidebarNotice | null>(null);
  const [pendingPaneId, setPendingPaneId] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot || expanded.size > 0) return;
    setExpanded(
      new Set(
        snapshot.workspaces
          .filter((workspace) => workspace.focused || workspace.tabs.length > 0)
          .map((workspace) => workspace.id),
      ),
    );
  }, [snapshot, expanded.size]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!pendingPaneId || !snapshot) return;
    const exists = snapshot.workspaces.some((workspace) =>
      workspace.tabs.some((tab) =>
        tab.panes.some((pane) => pane.id === pendingPaneId),
      ),
    );
    if (!exists) return;
    onSelectPane(pendingPaneId);
    setPendingPaneId(null);
  }, [onSelectPane, pendingPaneId, snapshot]);

  const toggleWorkspace = (workspace: WorkspaceSummary) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(workspace.id)) next.delete(workspace.id);
      else next.add(workspace.id);
      return next;
    });
  };

  const openWorkspaceMenu = (
    event: React.MouseEvent,
    workspace: WorkspaceSummary,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const position = clampMenuPosition(event.clientX, event.clientY, 4);
    setMenu({ kind: "workspace", workspace, ...position });
  };

  const openTabMenu = (
    event: React.MouseEvent,
    workspace: WorkspaceSummary,
    tab: TabSummary,
    pane: PaneSummary,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const position = clampMenuPosition(event.clientX, event.clientY, 3);
    setMenu({ kind: "tab", workspace, tab, pane, ...position });
  };

  const showNotice = (tone: SidebarNotice["tone"], text: string) => {
    setNotice({ tone, text });
  };

  const handleMenuAction = async (action: MenuAction) => {
    const target = menu;
    if (!target) return;
    setMenu(null);

    try {
      if (action === "copy-path") {
        const path =
          target.kind === "workspace"
            ? workspacePath(target.workspace)
            : tabPath(target.tab, target.pane);
        if (!path) throw new Error("当前项目没有可复制的路径");
        await copyToClipboard(path);
        showNotice("success", "路径已复制");
        return;
      }

      if (action === "new-tab" && target.kind === "workspace") {
        const result = await requestJson<{ paneId: string }>(
          `/api/workspaces/${encodeURIComponent(target.workspace.id)}/tabs`,
          { method: "POST" },
        );
        setExpanded((current) => new Set(current).add(target.workspace.id));
        setPendingPaneId(result.paneId);
        showNotice("success", "已新建 Tab");
        return;
      }

      if (action === "rename") {
        const currentLabel =
          target.kind === "workspace" ? target.workspace.label : target.tab.label;
        const nextLabel = window.prompt("输入新名称", currentLabel);
        if (nextLabel === null) return;
        const label = nextLabel.trim();
        if (!label) throw new Error("名称不能为空");
        const url =
          target.kind === "workspace"
            ? `/api/workspaces/${encodeURIComponent(target.workspace.id)}`
            : `/api/tabs/${encodeURIComponent(target.tab.id)}`;
        await requestJson(url, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label }),
        });
        showNotice("success", "名称已更新");
        return;
      }

      if (action === "close-workspace" && target.kind === "workspace") {
        const confirmed = window.confirm(
          `关闭 Workspace“${target.workspace.label}”？其中所有 Tab、Pane 和运行中的进程都会终止。`,
        );
        if (!confirmed) return;
        await requestJson(
          `/api/workspaces/${encodeURIComponent(target.workspace.id)}`,
          { method: "DELETE" },
        );
        showNotice("success", "Workspace 已关闭");
        return;
      }

      if (action === "close-tab" && target.kind === "tab") {
        const confirmed = window.confirm(
          `关闭 Tab“${target.tab.label}”？其中所有 Pane 和运行中的进程都会终止。`,
        );
        if (!confirmed) return;
        await requestJson(`/api/tabs/${encodeURIComponent(target.tab.id)}`, {
          method: "DELETE",
        });
        showNotice("success", "Tab 已关闭");
      }
    } catch (actionError) {
      showNotice(
        "error",
        actionError instanceof Error ? actionError.message : "操作失败",
      );
    }
  };

  return (
    <aside className="workspace-sidebar">
      <div className="brand-row">
        <div className="brand-mark">
          <Layers3 size={16} />
        </div>
        <span>Herzi</span>
        <span className="version-badge">alpha</span>
      </div>

      <div className="sidebar-label">WORKSPACES</div>
      <nav className="workspace-tree" aria-label="Herdr workspaces">
        {!snapshot ? (
          <div className="sidebar-loading">正在读取 Herdr…</div>
        ) : (
          snapshot.workspaces.map((workspace) => {
            const isExpanded = expanded.has(workspace.id);
            return (
              <div className="workspace-group" key={workspace.id}>
                <button
                  className="workspace-row"
                  onClick={() => toggleWorkspace(workspace)}
                  onContextMenu={(event) => openWorkspaceMenu(event, workspace)}
                >
                  {isExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <span className="workspace-name">
                    {workspace.number}. {workspace.label}
                  </span>
                  <StatusDot status={workspace.agentStatus} />
                </button>

                {isExpanded && (
                  <div className="pane-list">
                    {workspace.tabs.flatMap((tab) =>
                      tab.panes.map((pane) => (
                        <button
                          key={pane.id}
                          className={`pane-row ${selectedPaneId === pane.id ? "selected" : ""}`}
                          onClick={() => onSelectPane(pane.id)}
                          onContextMenu={(event) =>
                            openTabMenu(event, workspace, tab, pane)
                          }
                          aria-label={`${tab.label}，${describePaneKind(pane)}`}
                          title={`${tab.label} · ${pane.title} · ${pane.id}`}
                        >
                          <PaneKindIcon pane={pane} />
                          <span className="pane-name">{tab.label}</span>
                          <StatusDot status={pane.agentStatus} />
                        </button>
                      )),
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>

      <footer className="sidebar-footer">
        <span className="server-dot" />
        <span>
          {snapshot ? `Herdr ${snapshot.version} · protocol ${snapshot.protocol}` : "Connecting"}
        </span>
      </footer>

      {notice && (
        <div className={`sidebar-notice ${notice.tone}`} role="status">
          {notice.text}
        </div>
      )}

      {menu &&
        createPortal(
          <SidebarContextMenu menu={menu} onAction={handleMenuAction} />,
          document.body,
        )}
    </aside>
  );
}

function SidebarContextMenu({
  menu,
  onAction,
}: {
  menu: SidebarMenu;
  onAction: (action: MenuAction) => void;
}) {
  const path =
    menu.kind === "workspace"
      ? workspacePath(menu.workspace)
      : tabPath(menu.tab, menu.pane);

  return (
    <div
      className="sidebar-context-menu"
      role="menu"
      aria-label={menu.kind === "workspace" ? "Workspace 操作" : "Tab 操作"}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {menu.kind === "workspace" && (
        <ContextMenuButton
          icon={<Plus size={14} />}
          label="新建 Tab"
          onClick={() => onAction("new-tab")}
          autoFocus
        />
      )}
      <ContextMenuButton
        icon={<Pencil size={14} />}
        label="重命名"
        onClick={() => onAction("rename")}
        autoFocus={menu.kind === "tab"}
      />
      <ContextMenuButton
        icon={<Copy size={14} />}
        label="复制路径"
        onClick={() => onAction("copy-path")}
        disabled={!path}
      />
      <div className="context-menu-separator" />
      <ContextMenuButton
        icon={<Trash2 size={14} />}
        label={menu.kind === "workspace" ? "关闭 Workspace" : "关闭 Tab"}
        onClick={() =>
          onAction(menu.kind === "workspace" ? "close-workspace" : "close-tab")
        }
        danger
      />
    </div>
  );
}

function ContextMenuButton({
  icon,
  label,
  onClick,
  autoFocus = false,
  disabled = false,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? "danger" : ""}
      onClick={onClick}
      autoFocus={autoFocus}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function PaneKindIcon({ pane }: { pane: PaneSummary }) {
  if (pane.agent === "pi") {
    return (
      <span className="pi-pane-icon" aria-hidden="true">
        π
      </span>
    );
  }

  if (pane.agent) {
    return <Bot className="pane-kind-icon" size={15} aria-hidden="true" />;
  }

  return (
    <TerminalSquare className="pane-kind-icon" size={15} aria-hidden="true" />
  );
}

function describePaneKind(pane: PaneSummary) {
  if (pane.agent === "pi") return "Pi agent";
  if (pane.agent) return `${pane.agent} agent`;
  return "Terminal";
}

function StatusDot({ status }: { status: string }) {
  const normalized = status.trim().toLowerCase();
  if (!ATTENTION_STATUSES.has(normalized)) return null;
  return (
    <span
      className={`status-dot status-${normalized}`}
      title={normalized}
      aria-label={`Agent status: ${normalized}`}
    />
  );
}

function workspacePath(workspace: WorkspaceSummary): string | null {
  const activeTab =
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ??
    workspace.tabs.find((tab) => tab.focused) ??
    workspace.tabs[0];
  return activeTab ? tabPath(activeTab) : null;
}

function tabPath(tab: TabSummary, sourcePane?: PaneSummary): string | null {
  return (
    sourcePane?.cwd ??
    tab.panes.find((pane) => pane.focused && pane.cwd)?.cwd ??
    tab.panes.find((pane) => pane.cwd)?.cwd ??
    null
  );
}

function clampMenuPosition(clientX: number, clientY: number, itemCount: number) {
  const width = 206;
  const height = itemCount * 34 + 24;
  return {
    x: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
  };
}

async function requestJson<T = { ok: boolean }>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await apiFetch(url, init);
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null;
  if (!response.ok) {
    const error =
      typeof body === "object" && body !== null && "error" in body
        ? body.error
        : null;
    throw new Error(error || `操作失败 (${response.status})`);
  }
  return body as T;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("无法写入剪贴板");
}

const ATTENTION_STATUSES = new Set([
  "working",
  "running",
  "blocked",
  "done",
  "waiting",
  "error",
  "down",
]);
