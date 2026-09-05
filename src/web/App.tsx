import { MessageCircle, Monitor, PanelLeft, PlugZap } from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  AppSnapshot,
  ChatRealtimeState,
  ClientMessage,
  PaneSummary,
  ServerMessage,
} from "../shared/protocol";
import { TerminalView } from "./components/TerminalView";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";

type ViewMode = "terminal" | "chat";
interface ViewSelection {
  paneId: string;
  mode: ViewMode;
}

const ChatView = lazy(() =>
  import("./components/ChatView").then((module) => ({ default: module.ChatView })),
);

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [viewSelection, setViewSelection] = useState<ViewSelection | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 760px)").matches,
  );
  const [connectionState, setConnectionState] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [terminalMessage, setTerminalMessage] = useState<ServerMessage | null>(
    null,
  );
  const [chatRealtime, setChatRealtime] = useState<
    Record<string, ChatRealtimeState>
  >({});
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      setConnectionState("connecting");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socketRef.current = socket;

      socket.addEventListener("open", () => setConnectionState("connected"));
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.channel === "state" && message.type === "snapshot") {
          setSnapshot(message.payload);
        } else if (message.channel === "chat" && message.type === "realtime") {
          setChatRealtime((current) => ({
            ...current,
            [message.paneId]: message.payload,
          }));
        } else if (message.channel === "terminal") {
          setTerminalMessage(message);
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (!disposed) {
          setConnectionState("disconnected");
          retryTimer = window.setTimeout(connect, 1_500);
        }
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, []);

  const allPanes = useMemo(
    () =>
      snapshot?.workspaces.flatMap((workspace) =>
        workspace.tabs.flatMap((tab) => tab.panes),
      ) ?? [],
    [snapshot],
  );

  const selectedPane = useMemo<PaneSummary | null>(() => {
    if (!allPanes.length) return null;
    return (
      allPanes.find((pane) => pane.id === selectedPaneId) ??
      allPanes.find((pane) => pane.id === snapshot?.focusedPaneId) ??
      allPanes[0]
    );
  }, [allPanes, selectedPaneId, snapshot?.focusedPaneId]);

  useEffect(() => {
    if (selectedPane && selectedPane.id !== selectedPaneId) {
      setSelectedPaneId(selectedPane.id);
    }
  }, [selectedPane, selectedPaneId]);

  const mode: ViewMode = selectedPane
    ? viewSelection?.paneId === selectedPane.id
      ? viewSelection.mode
      : selectedPane.agent
        ? "chat"
        : "terminal"
    : "terminal";

  const selectedRealtime = selectedPane
    ? chatRealtime[selectedPane.id]
    : undefined;

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  return (
    <main className="app-shell">
      <div className="app-window">
        {sidebarOpen && (
          <WorkspaceSidebar
            snapshot={snapshot}
            selectedPaneId={selectedPane?.id ?? null}
            onSelectPane={(paneId) => {
              setViewSelection(null);
              setSelectedPaneId(paneId);
              if (window.matchMedia("(max-width: 760px)").matches) {
                setSidebarOpen(false);
              }
            }}
          />
        )}

        <section className="content-column">
          <header className="content-header">
            <button
              className="icon-button mobile-sidebar-button"
              aria-label="切换侧栏"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <PanelLeft size={17} />
            </button>

            <div className="pane-heading">
              <div className={`connection-dot ${connectionState}`} />
              <div className="pane-heading-copy">
                <strong>{selectedPane?.title ?? "正在连接 Herdr…"}</strong>
                <span>
                  {selectedPane?.agent
                    ? `${selectedPane.agent} · ${selectedRealtime?.status ?? selectedPane.agentStatus}`
                    : selectedPane?.cwd ?? "等待会话快照"}
                </span>
              </div>
            </div>

            <div className="view-switch" role="tablist" aria-label="视图模式">
              <button
                role="tab"
                aria-selected={mode === "terminal"}
                className={mode === "terminal" ? "active" : ""}
                onClick={() =>
                  selectedPane &&
                  setViewSelection({ paneId: selectedPane.id, mode: "terminal" })
                }
              >
                <Monitor size={14} />
                Term
              </button>
              <button
                role="tab"
                aria-selected={mode === "chat"}
                className={mode === "chat" ? "active" : ""}
                onClick={() =>
                  selectedPane &&
                  setViewSelection({ paneId: selectedPane.id, mode: "chat" })
                }
              >
                <MessageCircle size={14} />
                Chat
              </button>
            </div>
          </header>

          <div className="view-body">
            {!selectedPane ? (
              <EmptyState
                icon={<PlugZap size={26} />}
                title="还没有可显示的 Pane"
                description="请确认 Herdr server 已运行并包含至少一个 workspace。"
              />
            ) : mode === "terminal" ? (
              <TerminalView
                pane={selectedPane}
                connected={connectionState === "connected"}
                serverMessage={terminalMessage}
                send={send}
              />
            ) : selectedPane.agent === "pi" || selectedPane.hasChatSession ? (
              <Suspense
                fallback={
                  <EmptyState
                    icon={<MessageCircle size={26} />}
                    title="正在载入 Chat…"
                    description="首次切换会按需载入 Chat 渲染组件。"
                  />
                }
              >
                <ChatView
                  key={selectedPane.id}
                  pane={selectedPane}
                  realtime={selectedRealtime}
                />
              </Suspense>
            ) : (
              <EmptyState
                icon={<MessageCircle size={26} />}
                title="这个 Pane 暂无 Chat 数据"
                description="Chat 视图首版只支持带会话引用的 Pi Agent，Terminal 仍可正常查看。"
              />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
