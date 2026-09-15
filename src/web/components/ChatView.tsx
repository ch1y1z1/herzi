import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  TextMessagePartProvider,
  ThreadPrimitive,
  type AppendMessage,
  type DataMessagePartProps,
  type ThreadMessageLike,
  type ToolCallMessagePartProps,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Square,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { markdownShared } from "../markdownPlugins";
import type {
  ChatJsonObject,
  ChatMessage,
  ChatPart,
  ChatRealtimeState,
  ChatSnapshot,
  PaneSummary,
} from "../../shared/protocol";

type ActivityItem =
  | { type: "message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; image: string }
  | {
      type: "tool";
      toolCallId: string;
      toolName: string;
      args: ChatJsonObject;
      result?: unknown;
      isError?: boolean;
    };

type ToolActivityItem = Extract<ActivityItem, { type: "tool" }>;

type ActivityRenderItem =
  | ActivityItem
  | { type: "tool-group"; items: ToolActivityItem[] };

interface ActivityGroupData {
  kind: "work" | "tools";
  durationMs?: number;
  items: ActivityItem[];
}

type DisplayPart = ChatPart | { type: "data-activity"; data: ActivityGroupData };

interface DisplayMessage extends Omit<ChatMessage, "content"> {
  content: DisplayPart[];
}

interface PendingUserMessage extends ChatMessage {
  authoritativeOccurrence: number;
}

export function ChatView({
  pane,
  realtime,
}: {
  pane: PaneSummary;
  realtime?: ChatRealtimeState;
}) {
  const [chat, setChat] = useState<ChatSnapshot>({
    paneId: pane.id,
    running: pane.agentStatus === "working",
    updatedAt: 0,
    messages: [],
  });
  const [pendingUserMessages, setPendingUserMessages] = useState<
    PendingUserMessage[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const acknowledgedDoneRef = useRef(false);

  useEffect(() => {
    setChat({
      paneId: pane.id,
      running: pane.agentStatus === "working",
      updatedAt: 0,
      messages: [],
    });
    setPendingUserMessages([]);
    setLoading(true);
    setError("");
    acknowledgedDoneRef.current = false;
  }, [pane.id]);

  const loadChat = useCallback(async () => {
    const response = await fetch(`/api/panes/${encodeURIComponent(pane.id)}/chat`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? `Chat request failed (${response.status})`);
    }
    const next = (await response.json()) as ChatSnapshot;
    setChat(next);
    setError("");
    setLoading(false);
  }, [pane.id]);

  useEffect(() => {
    let disposed = false;
    const update = async () => {
      try {
        await loadChat();
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "读取 Chat 失败");
          setLoading(false);
        }
      }
    };
    void update();
    const timer = window.setInterval(update, 1_500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [loadChat]);

  useEffect(() => {
    if (realtime) void loadChat();
  }, [loadChat, realtime?.branchRevision, realtime?.runtimeId]);

  useEffect(() => {
    if (pane.agentStatus !== "done") {
      acknowledgedDoneRef.current = false;
      return;
    }
    // A failed/unfinished transcript load is not considered "read".
    if (loading || error || acknowledgedDoneRef.current) return;

    acknowledgedDoneRef.current = true;
    let disposed = false;
    const markSeen = async () => {
      try {
        const response = await fetch(
          `/api/panes/${encodeURIComponent(pane.id)}/seen`,
          { method: "POST" },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `Mark seen failed (${response.status})`);
        }
      } catch (seenError) {
        if (!disposed) {
          acknowledgedDoneRef.current = false;
          setError(
            seenError instanceof Error
              ? seenError.message
              : "无法将 Herdr Agent 标记为已读",
          );
        }
      }
    };
    void markSeen();
    return () => {
      disposed = true;
    };
  }, [error, loading, pane.agentStatus, pane.id]);

  const authoritativeMessages = useMemo(
    () => mergeRealtime(chat.messages, realtime),
    [chat.messages, realtime],
  );
  const messages = useMemo(
    () => mergePendingUserMessages(authoritativeMessages, pendingUserMessages),
    [authoritativeMessages, pendingUserMessages],
  );

  useEffect(() => {
    setPendingUserMessages((current) => {
      const unmatched = unmatchedPendingUserMessages(authoritativeMessages, current);
      return unmatched.length === current.length ? current : unmatched;
    });
  }, [authoritativeMessages]);

  const running = realtime ? realtime.status !== "idle" : chat.running;
  const displayMessages = useMemo(
    () => groupAssistantTurns(messages, running),
    [messages, running],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!text) return;

      const optimisticMessage: ChatMessage = {
        id: `optimistic:${pane.id}:${crypto.randomUUID()}`,
        role: "user",
        createdAt: Date.now(),
        content: [{ type: "text", text }],
      };
      setPendingUserMessages((current) => {
        const unmatched = unmatchedPendingUserMessages(
          authoritativeMessages,
          current,
        );
        const authoritativeOccurrence =
          countUserMessages(authoritativeMessages, text) +
          countUserMessages(unmatched, text);
        return [
          ...unmatched,
          { ...optimisticMessage, authoritativeOccurrence },
        ];
      });

      try {
        const response = await fetch(
          `/api/panes/${encodeURIComponent(pane.id)}/prompt`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text }),
          },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `Prompt failed (${response.status})`);
        }
        window.setTimeout(() => void loadChat(), 250);
      } catch (submitError) {
        setPendingUserMessages((current) =>
          current.filter((item) => item.id !== optimisticMessage.id),
        );
        throw submitError;
      }
    },
    [authoritativeMessages, loadChat, pane.id],
  );

  const runtime = useExternalStoreRuntime<DisplayMessage>({
    messages: displayMessages,
    convertMessage,
    isLoading: loading,
    isRunning: running,
    isDisabled: pane.agent !== "pi",
    onNew,
    onCancel: async () => {
      const response = await fetch(
        `/api/panes/${encodeURIComponent(pane.id)}/cancel`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(`Cancel failed (${response.status})`);
      window.setTimeout(() => void loadChat(), 200);
    },
    unstable_enableToolInvocations: false,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="chat-thread">
        <ThreadPrimitive.Viewport className="chat-viewport">
          <ThreadPrimitive.Empty>
            <div className="chat-empty">
              <Brain size={24} />
              <h2>Pi Chat</h2>
              <p>这个会话还没有消息。你可以从下方直接向当前 Herdr Pane 发送请求。</p>
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />

          {running && (
            <div className="agent-working" role="status" aria-live="polite">
              <span>{realtime?.status === "waiting" ? "waiting" : "working"}</span>
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            </div>
          )}

          <ThreadPrimitive.ViewportFooter className="chat-footer">
            <ThreadPrimitive.ScrollToBottom className="scroll-to-bottom">
              <ArrowDown size={15} />
            </ThreadPrimitive.ScrollToBottom>
            {error && (
              <div className="chat-error">
                <CircleAlert size={14} />
                {error}
              </div>
            )}
            <ComposerPrimitive.Root className="chat-composer">
              <ComposerPrimitive.Input
                className="chat-input"
                placeholder="Chat via Herzi…"
                submitMode="enter"
                rows={1}
              />
              <ThreadPrimitive.If running={true}>
                <ComposerPrimitive.Cancel
                  className="chat-send chat-cancel"
                  aria-label="停止"
                >
                  <Square size={13} fill="currentColor" />
                </ComposerPrimitive.Cancel>
              </ThreadPrimitive.If>
              <ThreadPrimitive.If running={false}>
                <ComposerPrimitive.Send className="chat-send" aria-label="发送">
                  <ArrowUp size={17} />
                </ComposerPrimitive.Send>
              </ThreadPrimitive.If>
            </ComposerPrimitive.Root>
            <div className="composer-hint">
              <span className={`chat-sync ${realtime ? realtime.status : "polling"}`}>
                {realtime ? realtimeLabel(realtime.status) : "JSONL 同步"}
              </span>
              <span>Enter 发送 · Shift+Enter 换行 · 写入当前 Pi Pane</span>
            </div>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="chat-message user-message">
      <div className="user-bubble">
        <MessagePrimitive.Parts
          components={{
            Text: UserText,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chat-message assistant-message">
      <MessagePrimitive.Parts
        components={{
          Text: AssistantText,
          Reasoning: ReasoningPart,
          tools: { Fallback: ToolFallback },
          data: { by_name: { activity: ActivityGroup } },
        }}
      />
    </MessagePrimitive.Root>
  );
}

function UserText() {
  return <MessagePartPrimitive.Text />;
}

function AssistantText() {
  return <MarkdownTextPrimitive className="markdown-body" {...markdownShared} />;
}

function ReasoningPart({ text }: { text: string }) {
  return (
    <details className="reasoning-block">
      <summary>
        <Brain size={14} />
        <strong>Thinking</strong>
        <span className="activity-preview">{shortPreview(text)}</span>
        <ChevronRight className="activity-chevron" size={14} />
      </summary>
      <div className="reasoning-detail">{text}</div>
    </details>
  );
}

function ToolFallback({
  toolName,
  args,
  result,
  isError,
}: ToolCallMessagePartProps) {
  const complete = result !== undefined;
  return (
    <details className={`tool-card ${isError ? "tool-error" : ""}`}>
      <summary>
        <span className="tool-icon">
          <Wrench size={13} />
        </span>
        <strong>{toolName}</strong>
        <span className="activity-preview">{toolPreview(args)}</span>
        <span className="tool-state">
          {isError ? (
            <CircleAlert size={13} />
          ) : complete ? (
            <Check size={13} />
          ) : (
            <LoaderCircle className="spin" size={13} />
          )}
        </span>
        <ChevronRight className="tool-chevron" size={14} />
      </summary>
      <div className="tool-detail">
        <ToolData label="Arguments" value={args} />
        {complete && <ToolData label={isError ? "Error" : "Result"} value={result} />}
      </div>
    </details>
  );
}

function ActivityGroup({ data }: DataMessagePartProps<ActivityGroupData>) {
  const activity = data as ActivityGroupData;
  const duration = formatDuration(activity.durationMs ?? 0);
  const renderItems: ActivityRenderItem[] =
    activity.kind === "work"
      ? groupActivityTools(activity.items)
      : activity.items;

  if (activity.kind === "work" && activity.items.length === 0) {
    return (
      <div className="worked-row">
        <Clock3 size={14} />
        <span>Worked for {duration}</span>
      </div>
    );
  }

  return (
    <details className={`activity-group ${activity.kind === "work" ? "work-group" : "tool-group"}`}>
      <summary>
        {activity.kind === "work" ? <Clock3 size={14} /> : <Wrench size={14} />}
        <strong>
          {activity.kind === "work"
            ? `Worked for ${duration}`
            : `Ran ${activity.items.length} tools`}
        </strong>
        {activity.kind === "tools" && (
          <span className="activity-preview">{toolGroupPreview(activity.items)}</span>
        )}
        <ChevronRight className="activity-chevron" size={14} />
      </summary>
      <div className="activity-list">
        {renderItems.map((item, index) =>
          item.type === "tool-group" ? (
            <ActivityToolGroup
              key={`tool-group-${item.items[0]?.toolCallId ?? index}`}
              items={item.items}
            />
          ) : (
            <ActivityItemRow
              key={item.type === "tool" ? item.toolCallId : `${item.type}-${index}`}
              item={item}
            />
          ),
        )}
      </div>
    </details>
  );
}

function ActivityToolGroup({ items }: { items: ToolActivityItem[] }) {
  const hasError = items.some((item) => item.isError);
  const complete = items.every((item) => item.result !== undefined);

  return (
    <details className={`activity-item activity-tool-group ${hasError ? "tool-error" : ""}`}>
      <summary>
        <Wrench size={13} />
        <strong>Ran {items.length} tools</strong>
        <span className="activity-preview">{toolGroupPreview(items)}</span>
        <span className="tool-state">
          {hasError ? (
            <CircleAlert size={12} />
          ) : complete ? (
            <Check size={12} />
          ) : (
            <LoaderCircle className="spin" size={12} />
          )}
        </span>
        <ChevronRight className="activity-chevron" size={13} />
      </summary>
      <div className="activity-tool-list">
        {items.map((item) => (
          <ActivityItemRow key={item.toolCallId} item={item} />
        ))}
      </div>
    </details>
  );
}

function ActivityItemRow({ item }: { item: ActivityItem }) {
  if (item.type === "message") {
    return (
      <div className="activity-message">
        <TextMessagePartProvider text={item.text}>
          <MarkdownTextPrimitive
            className="markdown-body"
            smooth={false}
            {...markdownShared}
          />
        </TextMessagePartProvider>
      </div>
    );
  }

  if (item.type === "image") {
    return <img className="activity-image" src={item.image} alt="Agent output" />;
  }

  if (item.type === "reasoning") {
    return (
      <details className="activity-item reasoning-item">
        <summary>
          <Brain size={13} />
          <strong>Thinking</strong>
          <span className="activity-preview">{shortPreview(item.text)}</span>
          <ChevronRight className="activity-chevron" size={13} />
        </summary>
        <div className="reasoning-detail">{item.text}</div>
      </details>
    );
  }

  const complete = item.result !== undefined;
  return (
    <details className={`activity-item tool-item ${item.isError ? "tool-error" : ""}`}>
      <summary>
        <Wrench size={13} />
        <strong>{item.toolName}</strong>
        <span className="activity-preview">{toolPreview(item.args)}</span>
        <span className="tool-state">
          {item.isError ? (
            <CircleAlert size={12} />
          ) : complete ? (
            <Check size={12} />
          ) : (
            <LoaderCircle className="spin" size={12} />
          )}
        </span>
        <ChevronRight className="activity-chevron" size={13} />
      </summary>
      <div className="tool-detail">
        <ToolData label="Arguments" value={item.args} />
        {complete && (
          <ToolData label={item.isError ? "Error" : "Result"} value={item.result} />
        )}
      </div>
    </details>
  );
}

function ToolData({ label, value }: { label: string; value: unknown }) {
  return (
    <section>
      <label>{label}</label>
      <pre>{formatValue(value)}</pre>
    </section>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function groupActivityTools(items: ActivityItem[]): ActivityRenderItem[] {
  const grouped: ActivityRenderItem[] = [];
  let index = 0;

  while (index < items.length) {
    if (items[index].type !== "tool") {
      grouped.push(items[index]);
      index += 1;
      continue;
    }

    const tools: ToolActivityItem[] = [];
    while (index < items.length && items[index].type === "tool") {
      tools.push(items[index] as ToolActivityItem);
      index += 1;
    }

    if (tools.length === 1) grouped.push(tools[0]);
    else grouped.push({ type: "tool-group", items: tools });
  }

  return grouped;
}

function groupAssistantTurns(
  messages: ChatMessage[],
  running: boolean,
): DisplayMessage[] {
  const grouped: DisplayMessage[] = [];
  let index = 0;
  let turnStartedAt: number | undefined;

  while (index < messages.length) {
    const message = messages[index];
    if (message.role === "user") {
      grouped.push(message);
      turnStartedAt = message.createdAt;
      index += 1;
      continue;
    }

    const assistantMessages: ChatMessage[] = [];
    while (index < messages.length && messages[index].role === "assistant") {
      assistantMessages.push(messages[index]);
      index += 1;
    }

    const isLatestTurn = index === messages.length;
    const turnRunning =
      assistantMessages.some((item) => item.status?.type === "running") ||
      (running && isLatestTurn);
    grouped.push(combineAssistantTurn(assistantMessages, turnStartedAt, turnRunning));
  }

  return grouped;
}

function combineAssistantTurn(
  messages: ChatMessage[],
  turnStartedAt: number | undefined,
  running: boolean,
): DisplayMessage {
  const parts = messages.flatMap((message) => message.content);
  const finalOutputIndex = findLastOutputIndex(parts);
  const activityLimit = finalOutputIndex >= 0 ? finalOutputIndex : parts.length;
  const workItems = running
    ? []
    : parts
        .slice(0, activityLimit)
        .flatMap((part): ActivityItem[] => {
          const activity = toActivityItem(part);
          return activity ? [activity] : [];
        });
  const lastMessage = messages.at(-1)!;
  const firstMessage = messages[0];
  const startedAt = validTimestamp(turnStartedAt) ?? validTimestamp(firstMessage.createdAt) ?? 0;
  const endedAt =
    messages.reduce(
      (latest, message) =>
        Math.max(latest, validTimestamp(message.completedAt) ?? message.createdAt),
      startedAt,
    ) || startedAt;
  const workPart: DisplayPart = {
    type: "data-activity",
    data: {
      kind: "work",
      durationMs: Math.max(0, endedAt - startedAt),
      items: workItems,
    },
  };

  const content: DisplayPart[] = [];
  let workInserted = false;
  parts.forEach((part, partIndex) => {
    const belongsToWork =
      !running && partIndex < activityLimit && isWorkPart(part);
    if (belongsToWork) {
      if (!workInserted) {
        content.push(workPart);
        workInserted = true;
      }
      return;
    }
    content.push(part);
  });

  if (!running && !workInserted) {
    const lastOutput = findLastOutputIndex(content);
    content.splice(lastOutput >= 0 ? lastOutput : 0, 0, workPart);
  }

  return {
    id: `turn:${lastMessage.id}`,
    role: "assistant",
    createdAt: firstMessage.createdAt,
    ...(lastMessage.completedAt ? { completedAt: lastMessage.completedAt } : {}),
    content: groupConsecutiveTools(content),
    ...(lastMessage.status ? { status: lastMessage.status } : {}),
  };
}

function groupConsecutiveTools(parts: DisplayPart[]): DisplayPart[] {
  const grouped: DisplayPart[] = [];
  let index = 0;

  while (index < parts.length) {
    if (parts[index].type !== "tool-call") {
      grouped.push(parts[index]);
      index += 1;
      continue;
    }

    const tools: ActivityItem[] = [];
    const firstTool = parts[index];
    while (index < parts.length && parts[index].type === "tool-call") {
      const activity = toActivityItem(parts[index]);
      if (activity) tools.push(activity);
      index += 1;
    }

    if (tools.length === 1) {
      grouped.push(firstTool);
    } else {
      grouped.push({ type: "data-activity", data: { kind: "tools", items: tools } });
    }
  }

  return grouped;
}

function toActivityItem(part: DisplayPart): ActivityItem | null {
  if (part.type === "text") return { type: "message", text: part.text };
  if (part.type === "reasoning") return { type: "reasoning", text: part.text };
  if (part.type === "image") return { type: "image", image: part.image };
  if (part.type !== "tool-call") return null;
  return {
    type: "tool",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    args: part.args,
    ...(part.result !== undefined ? { result: part.result } : {}),
    ...(part.isError !== undefined ? { isError: part.isError } : {}),
  };
}

function isWorkPart(part: DisplayPart): boolean {
  return (
    part.type === "text" ||
    part.type === "reasoning" ||
    part.type === "image" ||
    part.type === "tool-call"
  );
}

function findLastOutputIndex(parts: DisplayPart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part.type === "image" || (part.type === "text" && part.text.trim())) return index;
  }
  return -1;
}

function validTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function shortPreview(value: string, limit = 92): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (!line) return "…";
  const clipped = line.length > limit ? line.slice(0, limit).trimEnd() : line;
  return `${clipped.replace(/[.…]+$/u, "")}…`;
}

function toolPreview(args: ChatJsonObject): string {
  const preferredKeys = [
    "path",
    "file",
    "command",
    "cmd",
    "query",
    "q",
    "url",
    "pattern",
    "description",
  ];
  for (const key of preferredKeys) {
    if (!(key in args)) continue;
    const value = args[key];
    if (typeof value === "string" || typeof value === "number") {
      return shortPreview(String(value));
    }
  }
  return shortPreview(formatValue(args), 72);
}

function toolGroupPreview(items: ActivityItem[]): string {
  const names = items
    .filter((item): item is Extract<ActivityItem, { type: "tool" }> => item.type === "tool")
    .map((item) => item.toolName)
    .join(", ");
  return shortPreview(names, 72);
}

function mergeRealtime(
  persisted: ChatMessage[],
  realtime?: ChatRealtimeState,
): ChatMessage[] {
  if (!realtime) return persisted;

  const persistedKeys = new Set(
    persisted.map((message) => `${message.role}:${message.createdAt}`),
  );
  const live = realtime.messages.filter(
    (message) => !persistedKeys.has(`${message.role}:${message.createdAt}`),
  );
  const tools = new Map(realtime.tools.map((tool) => [tool.toolCallId, tool]));

  return [...persisted, ...live]
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((message) => ({
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-call") return part;
        const liveTool = tools.get(part.toolCallId);
        if (!liveTool) return part;

        const args = Object.keys(liveTool.args).length ? liveTool.args : part.args;
        if (liveTool.status !== "complete" || part.result !== undefined) {
          return { ...part, args };
        }
        return {
          ...part,
          args,
          result: liveTool.result,
          isError: liveTool.isError,
        };
      }),
    }));
}

function mergePendingUserMessages(
  authoritative: ChatMessage[],
  pending: PendingUserMessage[],
): ChatMessage[] {
  const unmatched = unmatchedPendingUserMessages(authoritative, pending);
  return [...authoritative, ...unmatched].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}

function unmatchedPendingUserMessages(
  authoritative: ChatMessage[],
  pending: PendingUserMessage[],
): PendingUserMessage[] {
  return pending.filter(
    (candidate) =>
      countUserMessages(authoritative, userMessageText(candidate)) <=
      candidate.authoritativeOccurrence,
  );
}

function countUserMessages(messages: ChatMessage[], text: string): number {
  return messages.filter(
    (message) =>
      message.role === "user" && userMessageText(message) === text,
  ).length;
}

function userMessageText(message: ChatMessage): string {
  return message.content
    .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function realtimeLabel(status: ChatRealtimeState["status"]): string {
  switch (status) {
    case "working":
      return "实时生成中";
    case "waiting":
      return "等待终端确认";
    default:
      return "实时已连接";
  }
}

function convertMessage(message: DisplayMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: message.content,
    ...(message.role === "assistant" && message.status
      ? { status: message.status }
      : {}),
  };
}
