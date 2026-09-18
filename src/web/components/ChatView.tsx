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
  CircleCheck,
  CircleDashed,
  Clock3,
  Copy,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Square,
  Wrench,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { apiFetch } from "../api";
import { markdownShared } from "../markdownPlugins";
import {
  PanelOpenScopeContext,
  groupPanelKey,
  reasoningPanelKey,
  toolPanelKey,
  usePanelOpenState,
} from "../panelOpenState";
import { createPromptDeliveryTrace } from "../promptDeliveryTrace";
import {
  describeToolCall,
  formatToolCounts,
  summarizeToolRun,
  toolRunDiff,
  toolRunVerb,
  type ToolDiff,
} from "../toolCatalog";
import { toolViewFor, type ToolDetailItem } from "../toolViews";
import { latestAssistantTurn, useLatestTurnActivity } from "../turnActivity";
import {
  ChatImagePart,
  ComposerAddImage,
  ComposerAttachments,
  HerziImageAttachmentAdapter,
  ToolResultImagePreview,
} from "./ChatAttachments";
import { isPaneActive } from "../../shared/pane-activity";
import type {
  ChatDividerKind,
  ChatJsonObject,
  ChatMessage,
  ChatPart,
  ChatRealtimeState,
  ChatSnapshot,
  ChatToolDisplay,
  PaneSummary,
  PromptDeliveryEvent,
  PromptDeliveryStatus,
  PromptTransport,
  TodoTask,
  TodoTaskStatus,
} from "../../shared/protocol";

type ReasoningActivityItem = {
  type: "reasoning";
  text: string;
  /** Server-side approximation (decision D3); absent when unknown. */
  durationMs?: number;
};

type ActivityItem =
  | { type: "message"; text: string }
  | ReasoningActivityItem
  | { type: "image"; image: string }
  | {
      type: "tool";
      toolCallId: string;
      toolName: string;
      args: ChatJsonObject;
      result?: unknown;
      isError?: boolean;
      /** Server-projected tool display metadata; absent without one. */
      display?: ChatToolDisplay;
    };

type ToolActivityItem = Extract<ActivityItem, { type: "tool" }>;

type ActivityRenderItem =
  | ActivityItem
  | { type: "tool-group"; id: string; items: ToolActivityItem[] };

/** One context boundary from the transcript, as the reader produced it. */
interface DividerPartData {
  kind: ChatDividerKind;
  summary: string;
  tokensBefore?: number;
  modifiedFiles?: string[];
  readFiles?: string[];
  at: number;
}

/**
 * Raw chat parts that assistant-ui accepts unchanged. A `divider` is never
 * rendered as a raw part: it always becomes a `data-divider` part, which is
 * also what makes it invisible to `toActivityItem`.
 */
type DisplayChatPart = Exclude<ChatPart, { type: "divider" }>;

type DisplayPart =
  | DisplayChatPart
  | { type: "data-divider"; data: DividerPartData }
  | { type: "data-activity"; data: ActivityGroupData }
  | { type: "data-delivery"; data: DeliveryPartData };

interface ActivityGroupData {
  /** Stable identifier for the expansion state (decision D5). */
  id: string;
  kind: "work" | "tools";
  durationMs?: number;
  items: ActivityItem[];
}

type PendingDeliveryState =
  | "sending"
  | "queued"
  | "claimed"
  | "sent"
  | "unconfirmed"
  | "unacked"
  | "failed";

interface PendingDelivery {
  state: PendingDeliveryState;
  requestId: string;
  /** 1-based; manual retries increment it and use a fresh request id. */
  attempt: number;
  error?: string;
  transport?: PromptTransport;
  /** Expiry of the server-side image uploads kept for a manual retry. */
  imageExpiresAt?: number;
  updatedAt: number;
}

interface DisplayMessage extends Omit<ChatMessage, "content"> {
  content: DisplayPart[];
  delivery?: PendingDelivery;
}

interface PendingUserMessage extends ChatMessage {
  authoritativeOccurrence: number;
  delivery: PendingDelivery;
}

interface DeliveryPartData {
  messageId: string;
  state: PendingDeliveryState;
  requestId: string;
  attempt: number;
  error?: string;
  transport?: PromptTransport;
  imageExpiresAt?: number;
}

interface PromptDeliveryActionsState {
  retry: (messageId: string) => void;
  /**
   * Two-step retry for states where the prompt may already have reached Pi.
   * A single click must not look like a safe resend.
   */
  requestRetryConfirmation: (messageId: string) => void;
  cancelRetryConfirmation: () => void;
  confirmingMessageId: string | null;
  copy: (messageId: string) => void;
  copiedMessageId: string | null;
}

/**
 * assistant-ui renders the thread from serializable message data, so the actions
 * for a failed bubble are shared through a context instead of being embedded in
 * the message parts.
 */
const PromptDeliveryActionsContext =
  createContext<PromptDeliveryActionsState | null>(null);

function deliveryTraceStatus(state: PendingDeliveryState): PromptDeliveryStatus {
  switch (state) {
    case "queued":
      return "queued";
    case "claimed":
      return "claimed";
    case "sent":
      return "submitted";
    case "unconfirmed":
    case "unacked":
      return "delivery-unconfirmed";
    case "failed":
      return "failed";
    default:
      return "submitted";
  }
}

function pendingStateForQueueEvent(
  event: PromptDeliveryEvent,
): PendingDeliveryState | null {
  switch (event.phase) {
    case "queue.claimed":
      return "claimed";
    case "queue.dispatched":
      return "sent";
    case "queue.failed":
      return "failed";
    case "queue.expired":
      // An unacknowledged claim means Pi very likely already received the
      // prompt and only the receipt was lost; an unclaimed command never
      // reached Pi at all. The two need different guidance.
      return event.errorCode === "queue-expired-unacked" ? "unacked" : "unconfirmed";
    default:
      return null;
  }
}

const DELIVERY_LABELS: Record<PendingDeliveryState, string> = {
  sending: "正在发送…",
  queued: "等待 Pi 接收…",
  claimed: "Pi 已接收，正在写入会话…",
  sent: "已送达",
  unconfirmed: "未确认送达",
  unacked: "回执丢失（可能已送达）",
  failed: "未送达",
};

const DELIVERY_HINTS: Partial<Record<PendingDeliveryState, string>> = {
  unconfirmed: "Pi 没有认领这条命令，它很可能没有进入会话。",
  unacked: "Pi 可能已经收到并写入了这条消息，只是回执没有到达 Herzi；建议先查看 Terminal 或会话内容再决定是否重试。",
  failed: "Pi bridge 报告投递失败，这条消息没有进入会话。",
};

function shortRequestId(requestId: string): string {
  return requestId.length > 8 ? requestId.slice(0, 8) : requestId;
}

/**
 * Custom property holding how much of the transcript's bottom edge is covered by
 * the fixed footer overlay. `.chat-viewport` reserves exactly that much space at
 * its bottom (see the `.chat-viewport` rule in `../styles.css`), so the last
 * transcript line can always be scrolled above the footer.
 *
 * It is the footer's *inset*, not its height: the footer floats 35px above the
 * window while the transcript pane ends 19px above it, so the space to keep
 * clear is the footer's height plus that 16px gap. Those are the CSS values of
 * today; the reservation is measured, so it does not depend on them.
 */
const CHAT_FOOTER_INSET_VAR = "--chat-footer-inset";

/**
 * Reservation used before the footer is measured: the previous hard-coded
 * value, which is also the CSS fallback of the custom property.
 */
const CHAT_FOOTER_MIN_RESERVE_PX = 176;

/**
 * Worst case a rendered todo bar adds on top of the base footer: the list's
 * `max-height: 260px` (see `.todo-list` in `../styles.css`) plus the bar's
 * summary row, border, margin and padding. Kept slightly above the sum so the
 * fallback below never under-reserves.
 */
const CHAT_FOOTER_TODO_BAR_PX = 320;

/**
 * Keeps the transcript's bottom reservation in sync with the space the fixed
 * footer really covers.
 *
 * The footer is a `position: fixed` overlay, so it does not push the transcript
 * up by itself: the viewport has to reserve its footprint. A constant was
 * correct until the todo bar could be expanded, which roughly doubles the footer
 * height and buried the end of the transcript behind it (review finding F1).
 *
 * The reservation never depends on the observer for its value: the fallback is
 * computed from the known state and used whenever there is no *live* measurement
 * — without `ResizeObserver` (jsdom, old browsers) the height can never be
 * observed at all, and a footer that reports zero height has not been laid out
 * yet (first frame, hidden pane, jsdom). Reserving the conservative height in
 * both cases beats reserving a number that a later expansion would invalidate.
 *
 * A layout effect, not a passive one: the todo bar's expansion state survives a
 * remount (`panelOpenState` is per pane) while ChatView is remounted on every
 * Terminal↔Chat and pane switch (`key={pane.id}`). With a passive effect the
 * first painted frame of such a remount would still use the stylesheet's 176px
 * fallback although the footer is already tall (review finding F-D).
 */
function useChatFooterInset(
  viewport: HTMLDivElement | null,
  footer: HTMLDivElement | null,
  reserveTodoBar: boolean,
): void {
  useLayoutEffect(() => {
    if (!viewport || !footer) return;
    const fallbackPx =
      CHAT_FOOTER_MIN_RESERVE_PX + (reserveTodoBar ? CHAT_FOOTER_TODO_BAR_PX : 0);

    let observer: ResizeObserver | null = null;

    /**
     * Space between the footer's top edge and the pane's bottom edge, or `null`
     * when there is nothing to measure or nothing that would report a change.
     */
    const measureInset = (): number | null => {
      if (observer === null) return null;
      // A footer without height has not been laid out (jsdom, first frame).
      if (!Number.isFinite(footer.offsetHeight) || footer.offsetHeight <= 0) {
        return null;
      }
      return Math.round(
        viewport.getBoundingClientRect().bottom - footer.getBoundingClientRect().top,
      );
    };

    const apply = () => {
      const measured = measureInset();
      // Never reserve less than the constant that was already in use, so this can
      // only ever make the transcript *more* visible, never less.
      const reserve =
        measured === null
          ? fallbackPx
          : Math.max(measured, CHAT_FOOTER_MIN_RESERVE_PX);
      viewport.style.setProperty(CHAT_FOOTER_INSET_VAR, `${reserve}px`);
    };

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(apply);
      // The footer growing is the interesting case, but the pane's own bottom can
      // move too (window resize, the sidebar opening on narrow screens).
      observer.observe(footer);
      observer.observe(viewport);
    }
    apply();
    return () => observer?.disconnect();
  }, [footer, viewport, reserveTodoBar]);
}

export function ChatView({
  pane,
  realtime,
  deliveryEvents,
}: {
  pane: PaneSummary;
  realtime?: ChatRealtimeState;
  /** Live Pi bridge command queue status for this pane (WS push). */
  deliveryEvents?: PromptDeliveryEvent[];
}) {
  const [chat, setChat] = useState<ChatSnapshot>({
    paneId: pane.id,
    running: isPaneActive(pane.agentStatus),
    updatedAt: 0,
    messages: [],
  });
  const [pendingUserMessages, setPendingUserMessages] = useState<
    PendingUserMessage[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /**
   * Delivery failures are tracked separately from `error` because the 1.5s chat
   * poll resets `error` on every successful load, which used to erase the only
   * visible trace of a failed prompt.
   */
  const [deliveryError, setDeliveryError] = useState<
    { message: string; requestId: string } | null
  >(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  /**
   * Message id whose "maybe already delivered" resend still needs an explicit
   * second confirmation. A one-click retry would look safe while silently
   * duplicating the prompt.
   */
  const [confirmingRetryId, setConfirmingRetryId] = useState<string | null>(null);
  const [lastTransport, setLastTransport] = useState<"host-path" | "pi-native" | null>(null);
  const acknowledgedDoneRef = useRef(false);
  const reconciledRef = useRef(new Set<string>());
  const appliedDeliveryEventsRef = useRef(new Set<string>());
  /**
   * The fixed footer and the viewport whose bottom padding follows the space it
   * covers. Kept as state (not refs) so the measuring effect re-runs if either
   * element is ever replaced, and so the reservation is applied as soon as both
   * exist.
   */
  const [chatViewportElement, setChatViewportElement] =
    useState<HTMLDivElement | null>(null);
  const [chatFooterElement, setChatFooterElement] = useState<HTMLDivElement | null>(
    null,
  );
  /** Tasks the todo bar really shows: tombstones never render (decision P6). */
  const visibleTodoTasks = useMemo(
    () => (chat.todos?.tasks ?? []).filter((task) => task.status !== "deleted"),
    [chat.todos],
  );
  useChatFooterInset(
    chatViewportElement,
    chatFooterElement,
    visibleTodoTasks.length > 0,
  );
  const imageAttachmentAdapter = useMemo(
    () => new HerziImageAttachmentAdapter(pane.id),
    [pane.id],
  );

  useEffect(() => {
    setChat({
      paneId: pane.id,
      running: isPaneActive(pane.agentStatus),
      updatedAt: 0,
      messages: [],
    });
    setPendingUserMessages([]);
    setLoading(true);
    setError("");
    setDeliveryError(null);
    setCopiedMessageId(null);
    setConfirmingRetryId(null);
    setLastTransport(null);
    reconciledRef.current = new Set();
    appliedDeliveryEventsRef.current = new Set();
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
        const response = await apiFetch(
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

  /**
   * A pending bubble may only disappear because the authoritative transcript now
   * contains the same user message. The correlation id of that transition is what
   * closes the lifecycle trace on the client side.
   */
  useEffect(() => {
    const matched = pendingUserMessages.filter(
      (item) =>
        countUserMessages(authoritativeMessages, userMessageFingerprint(item)) >
        item.authoritativeOccurrence,
    );
    const fresh = matched.filter((item) => !reconciledRef.current.has(item.id));
    if (fresh.length === 0) return;

    for (const item of fresh) {
      reconciledRef.current.add(item.id);
      createPromptDeliveryTrace({
        paneId: pane.id,
        requestId: item.delivery.requestId,
        attempt: item.delivery.attempt,
      }).record("client.reconciliation", {
        status: deliveryTraceStatus(item.delivery.state),
        latencyMs: Math.max(0, Date.now() - item.createdAt),
        ...(item.delivery.transport ? { transport: item.delivery.transport } : {}),
      });
      setDeliveryError((current) =>
        current?.requestId === item.delivery.requestId ? null : current,
      );
    }
  }, [authoritativeMessages, pane.id, pendingUserMessages]);

  /**
   * Queue lifecycle pushes from the server. The Pi-native transport answers
   * `queued` before the bridge command is claimed, so without these events an
   * "HTTP 200" could hide a prompt that was never delivered.
   */
  useEffect(() => {
    if (!deliveryEvents?.length) return;

    for (const event of deliveryEvents) {
      if (event.paneId !== pane.id) continue;
      const key = `${event.requestId}:${event.seq ?? event.at}`;
      if (appliedDeliveryEventsRef.current.has(key)) continue;
      appliedDeliveryEventsRef.current.add(key);
      if (appliedDeliveryEventsRef.current.size > 400) {
        appliedDeliveryEventsRef.current = new Set([key]);
      }

      const nextState = pendingStateForQueueEvent(event);
      if (!nextState) continue;

      createPromptDeliveryTrace({
        paneId: pane.id,
        requestId: event.requestId,
      }).record("client.delivery-status", {
        // Always the status the user actually sees, never the raw queue status:
        // an expired claim must not be traced as `claimed` while the UI says
        // "delivery unconfirmed".
        status: deliveryTraceStatus(nextState),
        ...(event.queueStatus ? { queueStatus: event.queueStatus } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.transport ? { transport: event.transport } : {}),
        ...(event.latencyMs !== undefined ? { latencyMs: event.latencyMs } : {}),
      });

      setPendingUserMessages((current) =>
        current.map((item) =>
          item.delivery.requestId === event.requestId
            ? {
                ...item,
                delivery: {
                  ...item.delivery,
                  state: nextState,
                  updatedAt: Date.now(),
                  ...(DELIVERY_HINTS[nextState] ? { error: DELIVERY_HINTS[nextState] } : {}),
                },
              }
            : item,
        ),
      );

      if (DELIVERY_HINTS[nextState]) {
        setDeliveryError({
          message: `${DELIVERY_LABELS[nextState]}：requestId ${shortRequestId(event.requestId)}`,
          requestId: event.requestId,
        });
      }
    }
  }, [deliveryEvents, pane.id]);

  /**
   * Fail-open "the pane is busy" signal for the composer and the working row:
   * every source can keep it busy, and a source that goes quiet never clears it
   * while another one still reports activity.
   */
  const running =
    isPaneActive(pane.agentStatus) ||
    chat.running ||
    (realtime ? realtime.status !== "idle" : false);
  /**
   * The latest turn only, with the sticky marker that keeps it expanded until
   * every source agrees the turn is over (fail-open, see `../turnActivity`).
   */
  const latestTurn = useMemo(() => latestAssistantTurn(messages), [messages]);
  const latestTurnRunning = useLatestTurnActivity({
    latestTurn,
    sessionKey: `${pane.id}:${realtime?.runtimeId ?? "poll"}`,
    chatRunning: chat.running,
    realtimeStatus: realtime?.status ?? null,
    paneStatus: pane.agentStatus,
  });
  const displayMessages = useMemo(
    () => groupAssistantTurns(messages, latestTurnRunning),
    [messages, latestTurnRunning],
  );

  const updatePendingDelivery = useCallback(
    (messageId: string, patch: Partial<PendingDelivery>) => {
      setPendingUserMessages((current) =>
        current.map((item) =>
          item.id === messageId
            ? { ...item, delivery: { ...item.delivery, ...patch } }
            : item,
        ),
      );
    },
    [],
  );

  /**
   * Posts one delivery attempt and always resolves: failures are surfaced in the
   * thread instead of silently dropping the optimistic message, and nothing is
   * retried automatically (a double send is worse than a visible failure).
   */
  const deliverPrompt = useCallback(
    async (input: {
      messageId: string;
      requestId: string;
      attempt: number;
      text: string;
      uploadIds: string[];
    }) => {
      const trace = createPromptDeliveryTrace({
        paneId: pane.id,
        requestId: input.requestId,
        attempt: input.attempt,
      });
      try {
        const response = await apiFetch(
          `/api/panes/${encodeURIComponent(pane.id)}/prompt`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              requestId: input.requestId,
              text: input.text,
              attachments: input.uploadIds.map((uploadId) => ({ uploadId })),
            }),
          },
        );
        const body = (await response.json().catch(() => null)) as
          | {
              error?: string;
              transport?: PromptTransport;
              status?: PromptDeliveryStatus;
            }
          | null;

        if (!response.ok) {
          const message = body?.error ?? `Prompt failed (${response.status})`;
          trace.record("client.error", {
            httpStatus: response.status,
            errorCode: `http-${response.status}`,
            errorClass: "PromptRequestError",
          });
          updatePendingDelivery(input.messageId, {
            state: "failed",
            error: message,
            updatedAt: Date.now(),
          });
          setDeliveryError({
            message: `${message}（requestId ${shortRequestId(input.requestId)}）`,
            requestId: input.requestId,
          });
          return;
        }

        trace.record("client.response", {
          httpStatus: response.status,
          ...(body?.transport ? { transport: body.transport } : {}),
          ...(body?.status ? { status: body.status } : {}),
        });
        updatePendingDelivery(input.messageId, {
          state: body?.status === "queued" ? "queued" : "sent",
          ...(body?.transport ? { transport: body.transport } : {}),
          updatedAt: Date.now(),
        });
        setDeliveryError(null);
        if (body?.transport === "host-path" || body?.transport === "pi-native") {
          setLastTransport(body.transport);
        }
        window.setTimeout(() => void loadChat(), 250);
      } catch (submitError) {
        const message =
          submitError instanceof Error ? submitError.message : "发送失败";
        trace.record("client.error", {
          errorCode: "client-transport-error",
          errorClass: errorClassName(submitError),
        });
        updatePendingDelivery(input.messageId, {
          state: "failed",
          error: message,
          updatedAt: Date.now(),
        });
        setDeliveryError({
          message: `${message}（requestId ${shortRequestId(input.requestId)}）`,
          requestId: input.requestId,
        });
      }
    },
    [loadChat, pane.id, updatePendingDelivery],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      const uploadedImages = (message.attachments ?? []).flatMap((attachment) => {
        const upload = imageAttachmentAdapter.getUpload(attachment.id);
        return upload ? [upload] : [];
      });
      if (!text && uploadedImages.length === 0) return;

      const content: ChatPart[] = [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...uploadedImages.map((upload) => ({
          type: "image" as const,
          image: upload.preview,
          name: upload.name,
          mimeType: upload.mimeType,
          uploadId: upload.uploadId,
          sha256: upload.sha256,
        })),
      ];
      const requestId = crypto.randomUUID();
      const attempt = 1;
      const imageExpiresAt = uploadedImages.length
        ? Math.min(...uploadedImages.map((upload) => upload.expiresAt))
        : undefined;
      const trace = createPromptDeliveryTrace({ paneId: pane.id, requestId, attempt });
      trace.record("client.submit");

      const optimisticMessage: ChatMessage = {
        id: `optimistic:${pane.id}:${crypto.randomUUID()}`,
        role: "user",
        createdAt: Date.now(),
        content,
      };
      setPendingUserMessages((current) => {
        const unmatched = unmatchedPendingUserMessages(
          authoritativeMessages,
          current,
        );
        const fingerprint = userMessageFingerprint(optimisticMessage);
        const authoritativeOccurrence =
          countUserMessages(authoritativeMessages, fingerprint) +
          countUserMessages(unmatched, fingerprint);
        return [
          ...unmatched,
          {
            ...optimisticMessage,
            authoritativeOccurrence,
            delivery: {
              state: "sending",
              requestId,
              attempt,
              updatedAt: Date.now(),
              ...(imageExpiresAt ? { imageExpiresAt } : {}),
            },
          },
        ];
      });
      trace.record("client.optimistic");

      await deliverPrompt({
        messageId: optimisticMessage.id,
        requestId,
        attempt,
        text,
        uploadIds: uploadedImages.map((upload) => upload.uploadId),
      });
    },
    [authoritativeMessages, deliverPrompt, imageAttachmentAdapter, pane.id],
  );

  const retryPendingMessage = useCallback(
    async (messageId: string) => {
      const pending = pendingUserMessages.find((item) => item.id === messageId);
      if (!pending) return;

      // A manual retry is a new attempt with a new request id: reusing the old id
      // would be deduplicated by the Pi command queue and silently do nothing.
      const requestId = crypto.randomUUID();
      const attempt = pending.delivery.attempt + 1;
      createPromptDeliveryTrace({ paneId: pane.id, requestId, attempt }).record(
        "client.retry",
      );
      updatePendingDelivery(messageId, {
        state: "sending",
        requestId,
        attempt,
        error: undefined,
        updatedAt: Date.now(),
      });
      setDeliveryError(null);
      setConfirmingRetryId(null);

      await deliverPrompt({
        messageId,
        requestId,
        attempt,
        text: messageText(pending),
        uploadIds: messageUploadIds(pending),
      });
    },
    [deliverPrompt, pane.id, pendingUserMessages, updatePendingDelivery],
  );

  const copyPendingMessage = useCallback(
    async (messageId: string) => {
      const pending = pendingUserMessages.find((item) => item.id === messageId);
      if (!pending) return;
      try {
        await navigator.clipboard.writeText(messageText(pending));
        setCopiedMessageId(messageId);
        window.setTimeout(
          () =>
            setCopiedMessageId((current) =>
              current === messageId ? null : current,
            ),
          1_500,
        );
      } catch {
        setDeliveryError({
          message: "复制失败，请手动选择消息内容",
          requestId: pending.delivery.requestId,
        });
      }
    },
    [pendingUserMessages],
  );

  const deliveryActions = useMemo<PromptDeliveryActionsState>(
    () => ({
      retry: (messageId) => void retryPendingMessage(messageId),
      requestRetryConfirmation: (messageId) => setConfirmingRetryId(messageId),
      cancelRetryConfirmation: () => setConfirmingRetryId(null),
      confirmingMessageId: confirmingRetryId,
      copy: (messageId) => void copyPendingMessage(messageId),
      copiedMessageId,
    }),
    [confirmingRetryId, copiedMessageId, copyPendingMessage, retryPendingMessage],
  );


  const runtime = useExternalStoreRuntime<DisplayMessage>({
    messages: displayMessages,
    convertMessage,
    isLoading: loading,
    isRunning: running,
    isDisabled: pane.agent !== "pi",
    onNew,
    adapters: { attachments: imageAttachmentAdapter },
    onCancel: async () => {
      const response = await apiFetch(
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
        <ThreadPrimitive.Viewport
          className="chat-viewport"
          ref={setChatViewportElement}
        >
          <ThreadPrimitive.Empty>
            <div className="chat-empty">
              <Brain size={24} />
              <h2>Pi Chat</h2>
              <p>这个会话还没有消息。你可以从下方直接向当前 Herdr Pane 发送请求。</p>
            </div>
          </ThreadPrimitive.Empty>

          <PromptDeliveryActionsContext.Provider value={deliveryActions}>
            <PanelOpenScopeContext.Provider value={pane.id}>
              <ThreadPrimitive.Messages
                components={{
                  UserMessage,
                  AssistantMessage,
                }}
              />
            </PanelOpenScopeContext.Provider>
          </PromptDeliveryActionsContext.Provider>

          {running && (
            <div className="agent-working" role="status" aria-live="polite">
              <span>{realtime?.status === "waiting" ? "waiting" : "working"}</span>
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            </div>
          )}

          <ThreadPrimitive.ViewportFooter
            className="chat-footer"
            ref={setChatFooterElement}
          >
            <ThreadPrimitive.ScrollToBottom className="scroll-to-bottom">
              <ArrowDown size={15} />
            </ThreadPrimitive.ScrollToBottom>
            {error && (
              <div className="chat-error">
                <CircleAlert size={14} />
                {error}
              </div>
            )}
            {deliveryError && (
              <div className="chat-error" role="alert">
                <CircleAlert size={14} />
                {deliveryError.message}
              </div>
            )}
            <TodoStatusBar tasks={visibleTodoTasks} />
            <ComposerPrimitive.Root className="chat-composer">
              <ComposerPrimitive.AttachmentDropzone className="composer-dropzone">
                <ComposerAttachments />
                <div className="composer-input-row">
                  <ComposerAddImage />
                  <ComposerPrimitive.Input
                    className="chat-input"
                    placeholder="Chat via Herzi… 粘贴图片"
                    submitMode="enter"
                    rows={1}
                    /* ChatView only mounts when the Chat view becomes visible
                       (App renders Terminal/Chat conditionally), so this is
                       what makes "switch to Chat" also focus the composer.
                       assistant-ui skips the focus when the composer is
                       disabled, so non-Pi panes are unaffected. */
                    autoFocus
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
                </div>
              </ComposerPrimitive.AttachmentDropzone>
            </ComposerPrimitive.Root>
            <div className="composer-hint">
              <span className={`chat-sync ${realtime ? realtime.status : "polling"}`}>
                {imageCapabilityLabel(realtime, lastTransport)}
              </span>
              <span>Enter 发送 · Shift+Enter 换行 · 可粘贴图片</span>
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
            Image: ChatImagePart,
            data: { by_name: { delivery: UserDeliveryStatus } },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

const deliveryActionButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  border: "1px solid #ddc7c3",
  borderRadius: 999,
  color: "#a5534e",
  background: "#fff",
  fontSize: 11,
  cursor: "pointer",
};

/**
 * Rendered inside a pending user bubble. The message itself is never removed on
 * failure: it keeps its text, image previews and request id so the user can see
 * exactly what happened and manually resend it.
 */
function UserDeliveryStatus({ data }: DataMessagePartProps<DeliveryPartData>) {
  const actions = useContext(PromptDeliveryActionsContext);
  const info = data as DeliveryPartData;
  const actionable = info.state === "failed" || info.state === "unconfirmed";
  const maybeDelivered = info.state === "unacked";
  const confirming = maybeDelivered && actions?.confirmingMessageId === info.messageId;
  const imageHint = deliveryImageHint(info);

  return (
    <div className={`user-delivery ${info.state}`} role="status">
      <span className="user-delivery-line">
        {info.state === "sending" ? (
          <LoaderCircle className="spin" size={12} aria-hidden="true" />
        ) : info.state === "failed" ||
          info.state === "unconfirmed" ||
          info.state === "unacked" ? (
          <CircleAlert size={12} aria-hidden="true" />
        ) : (
          <Clock3 size={12} aria-hidden="true" />
        )}
        <span>{DELIVERY_LABELS[info.state]}</span>
        <span className="user-delivery-request">
          requestId {shortRequestId(info.requestId)}
          {info.attempt > 1 ? ` · 第 ${info.attempt} 次尝试` : ""}
        </span>
      </span>
      {info.error && <span className="user-delivery-error">{info.error}</span>}
      {imageHint && <span className="user-delivery-hint">{imageHint}</span>}
      {actions && actionable && (
        <span className="user-delivery-actions">
          <button
            type="button"
            style={deliveryActionButtonStyle}
            onClick={() => actions.retry(info.messageId)}
          >
            <RefreshCw size={11} aria-hidden="true" />
            重试
          </button>
          <button
            type="button"
            style={deliveryActionButtonStyle}
            onClick={() => actions.copy(info.messageId)}
          >
            <Copy size={11} aria-hidden="true" />
            {actions.copiedMessageId === info.messageId ? "已复制" : "复制内容"}
          </button>
        </span>
      )}
      {actions && maybeDelivered && (
        <span className="user-delivery-actions">
          {confirming ? (
            <>
              <span className="user-delivery-warning">重试会重复发送这条消息</span>
              <button
                type="button"
                style={deliveryActionButtonStyle}
                onClick={() => actions.retry(info.messageId)}
              >
                <RefreshCw size={11} aria-hidden="true" />
                确认重复发送
              </button>
              <button
                type="button"
                style={deliveryActionButtonStyle}
                onClick={() => actions.cancelRetryConfirmation()}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                style={deliveryActionButtonStyle}
                onClick={() => actions.requestRetryConfirmation(info.messageId)}
              >
                <RefreshCw size={11} aria-hidden="true" />
                重试…
              </button>
              <button
                type="button"
                style={deliveryActionButtonStyle}
                onClick={() => actions.copy(info.messageId)}
              >
                <Copy size={11} aria-hidden="true" />
                {actions.copiedMessageId === info.messageId ? "已复制" : "复制内容"}
              </button>
            </>
          )}
        </span>
      )}
    </div>
  );
}

function deliveryImageHint(info: DeliveryPartData): string | null {
  if (!info.imageExpiresAt) return null;
  const remainingMs = info.imageExpiresAt - Date.now();
  if (remainingMs <= 0) return "图片附件已过期，请重新粘贴后再发送";
  return `图片附件仍可重发（约 ${Math.max(1, Math.round(remainingMs / 60_000))} 分钟后过期）`;
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chat-message assistant-message">
      <MessagePrimitive.Parts
        components={{
          Text: AssistantText,
          Image: ChatImagePart,
          Reasoning: ReasoningPart,
          tools: { Fallback: ToolFallback },
          data: { by_name: { activity: ActivityGroup, divider: ChatDivider } },
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

function ReasoningPart(props: { text: string; status?: { type: string } }) {
  const label = reasoningLabel(
    partDurationMs(props),
    props.status?.type === "running",
  );
  const [open, setOpen] = usePanelOpenState(reasoningPanelKey(props.text));
  return (
    <details
      className="reasoning-block"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Brain size={14} />
        <strong>{label}</strong>
        <span className="activity-preview">{shortPreview(props.text)}</span>
        <ChevronRight className="activity-chevron" size={14} />
      </summary>
      <div className="reasoning-detail">{props.text}</div>
    </details>
  );
}

function ToolFallback({
  toolCallId,
  toolName,
  args,
  result,
  isError,
  ...rest
}: ToolCallMessagePartProps) {
  const complete = result !== undefined;
  const [open, setOpen] = usePanelOpenState(toolPanelKey(toolCallId));
  // `display` is part of the raw tool-call part; assistant-ui spreads the part
  // into this component unchanged, so the optional field is read defensively
  // exactly like the reasoning part's `durationMs`.
  const display = partToolDisplay(rest);
  const item: ToolDetailItem = {
    toolCallId,
    toolName,
    args,
    ...(complete ? { result } : {}),
    ...(isError === undefined ? {} : { isError }),
    ...(display === undefined ? {} : { display }),
  };
  return (
    <details
      className={`tool-card ${isError ? "tool-error" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ToolRowSummary
          toolName={toolName}
          args={args}
          complete={complete}
          isError={Boolean(isError)}
        />
      </summary>
      <div className="tool-detail">
        <ToolDetail item={item} />
      </div>
    </details>
  );
}

function ActivityGroup({ data }: DataMessagePartProps<ActivityGroupData>) {
  const activity = data as ActivityGroupData;
  const duration = formatDuration(activity.durationMs ?? 0);
  const toolItems = useMemo(
    () => activity.items.filter(isToolActivityItem),
    [activity.items],
  );
  const summary = useMemo(() => summarizeToolRun(toolItems), [toolItems]);
  const [open, setOpen] = usePanelOpenState(groupPanelKey(activity.id));
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

  // Without a single tool row there is no phase to report, so the header keeps
  // the original duration wording instead of inventing an activity verb.
  const hasTools = toolItems.length > 0;
  const headerText =
    activity.kind === "work" && !hasTools
      ? `Worked for ${duration}`
      : toolRunVerb(summary);
  const countsText = hasTools ? formatToolCounts(summary.counts) : "";
  const diff = toolRunDiff(summary);

  return (
    <details
      className={`activity-group ${activity.kind === "work" ? "work-group" : "tool-group"}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        title={
          activity.kind === "work" ? `Worked for ${duration}` : toolNameList(toolItems)
        }
      >
        {activity.kind === "work" ? <Clock3 size={14} /> : <Wrench size={14} />}
        <strong className="activity-verb">{headerText}</strong>
        {countsText && <span className="activity-counts">{countsText}</span>}
        {diff && <ToolDiffText className="activity-diff" diff={diff} />}
        <ChevronRight className="activity-chevron" size={14} />
      </summary>
      <div className="activity-list">
        {renderItems.map((item, index) =>
          item.type === "tool-group" ? (
            <ActivityToolGroup key={item.id} id={item.id} items={item.items} />
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

function ActivityToolGroup({
  id,
  items,
}: {
  id: string;
  items: ToolActivityItem[];
}) {
  const hasError = items.some((item) => item.isError);
  const complete = items.every((item) => item.result !== undefined);
  const summary = useMemo(() => summarizeToolRun(items), [items]);
  const [open, setOpen] = usePanelOpenState(groupPanelKey(id));
  const countsText = formatToolCounts(summary.counts);
  const diff = toolRunDiff(summary);

  return (
    <details
      className={`activity-item activity-tool-group ${hasError ? "tool-error" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary title={toolNameList(items)}>
        <Wrench size={13} />
        <strong className="activity-verb">{toolRunVerb(summary)}</strong>
        {countsText && <span className="activity-counts">{countsText}</span>}
        {diff && <ToolDiffText className="activity-diff" diff={diff} />}
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
          <ToolItemRow key={item.toolCallId} item={item} />
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

  if (item.type === "reasoning") return <ReasoningItemRow item={item} />;

  return <ToolItemRow item={item} />;
}

function ReasoningItemRow({ item }: { item: ReasoningActivityItem }) {
  const [open, setOpen] = usePanelOpenState(reasoningPanelKey(item.text));
  return (
    <details
      className="activity-item reasoning-item"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Brain size={13} />
        <strong>{reasoningLabel(item.durationMs, false)}</strong>
        <span className="activity-preview">{shortPreview(item.text)}</span>
        <ChevronRight className="activity-chevron" size={13} />
      </summary>
      <div className="reasoning-detail">{item.text}</div>
    </details>
  );
}

function ToolItemRow({ item }: { item: ToolActivityItem }) {
  const complete = item.result !== undefined;
  const [open, setOpen] = usePanelOpenState(toolPanelKey(item.toolCallId));
  return (
    <details
      className={`activity-item tool-item ${item.isError ? "tool-error" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ToolRowSummary
          toolName={item.toolName}
          args={item.args}
          complete={complete}
          isError={Boolean(item.isError)}
          stateIconSize={12}
          chevronSize={13}
        />
      </summary>
      <div className="tool-detail">
        <ToolDetail item={item} />
      </div>
    </details>
  );
}

/**
 * Expansion content of one tool row: the registered view for the tool, or the
 * generic Arguments/Result detail. Every view receives the generic detail as
 * `fallback`, so a tool whose data does not parse still shows its raw result
 * instead of an empty panel.
 */
function ToolDetail({ item }: { item: ToolDetailItem }) {
  const View = toolViewFor(item.toolName);
  const fallback = <GenericToolDetail item={item} />;
  if (!View) return fallback;
  return <View item={item} fallback={fallback} />;
}

function GenericToolDetail({ item }: { item: ToolDetailItem }) {
  return (
    <>
      <ToolData label="Arguments" value={item.args} />
      {item.result !== undefined && (
        <ToolResultData
          toolName={item.toolName}
          label={item.isError ? "Error" : "Result"}
          value={item.result}
        />
      )}
    </>
  );
}

/**
 * One tool row: action word + target + `+N −M`, from the tool catalog. Unknown
 * tools render their own name as the action instead of disappearing.
 */
function ToolRowSummary({
  toolName,
  args,
  complete,
  isError,
  stateIconSize = 13,
  chevronSize = 14,
}: {
  toolName: string;
  args: ChatJsonObject;
  complete: boolean;
  isError: boolean;
  stateIconSize?: number;
  chevronSize?: number;
}) {
  const display = describeToolCall(toolName, args);
  return (
    <>
      <span className="tool-icon">
        <Wrench size={13} />
      </span>
      <strong className="tool-action" title={toolName}>
        {display.action}
      </strong>
      <span className="tool-target" title={display.fullTarget}>
        {display.target}
      </span>
      {display.diff && <ToolDiffText className="tool-diff" diff={display.diff} />}
      <span className="tool-state">
        {isError ? (
          <CircleAlert size={stateIconSize} />
        ) : complete ? (
          <Check size={stateIconSize} />
        ) : (
          <LoaderCircle className="spin" size={stateIconSize} />
        )}
      </span>
      <ChevronRight className="tool-chevron" size={chevronSize} />
    </>
  );
}

function ToolDiffText({ diff, className }: { diff: ToolDiff; className: string }) {
  return (
    <span className={className}>
      {diff.add > 0 && <span className="diff-add">{`+${diff.add}`}</span>}
      {diff.remove > 0 && <span className="diff-remove">{`−${diff.remove}`}</span>}
    </span>
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

function ToolResultData({
  toolName,
  label,
  value,
}: {
  toolName: string;
  label: string;
  value: unknown;
}) {
  const payload = asToolResultPayload(value);
  const visibleValue = payload ? payload.value : value;
  const formattedValue = formatValue(visibleValue);
  return (
    <section>
      <label>{label}</label>
      {formattedValue && <pre>{formattedValue}</pre>}
      <ToolResultImagePreview toolName={toolName} result={value} />
    </section>
  );
}

function asToolResultPayload(value: unknown):
  | { type: "herzi-tool-result"; value: unknown; images: unknown[] }
  | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    type?: unknown;
    value?: unknown;
    images?: unknown;
  };
  return candidate.type === "herzi-tool-result" && Array.isArray(candidate.images)
    ? { type: "herzi-tool-result", value: candidate.value, images: candidate.images }
    : null;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Maximum file names listed per list inside a divider detail; the rest is only
 * counted (`…另有 N 个`), because a real compaction can touch dozens of files.
 */
const DIVIDER_FILE_NAME_LIMIT = 12;

/**
 * One context boundary (`compaction` / `branch_summary`) as a labelled rule.
 *
 * The summary and the file lists stay folded: real summaries are 7-9k
 * characters. Nothing is invented — without a summary the marker is a plain
 * rule, and without a timestamp no time is shown.
 */
function ChatDivider({ data }: DataMessagePartProps<DividerPartData>) {
  const divider = data as DividerPartData;
  const [open, setOpen] = usePanelOpenState(dividerPanelKey(divider));
  const modifiedFiles = divider.modifiedFiles ?? [];
  const readFiles = divider.readFiles ?? [];
  const hasSummary = divider.summary.trim().length > 0;
  const hasFiles = modifiedFiles.length > 0 || readFiles.length > 0;
  const hasDetail = hasSummary || hasFiles || validTimestamp(divider.at) !== undefined;

  const rule = (
    <>
      <span className="divider-rule" aria-hidden="true" />
      <span className="divider-label">
        {hasDetail && <ChevronRight className="divider-chevron" size={13} />}
        {dividerLabel(divider)}
      </span>
      <span className="divider-rule" aria-hidden="true" />
    </>
  );

  if (!hasDetail) {
    return <div className={`chat-divider ${divider.kind}`}>{rule}</div>;
  }

  return (
    <details
      className={`chat-divider ${divider.kind}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{rule}</summary>
      <div className="divider-detail">
        {hasSummary && (
          <TextMessagePartProvider text={divider.summary}>
            <MarkdownTextPrimitive
              className="markdown-body"
              smooth={false}
              {...markdownShared}
            />
          </TextMessagePartProvider>
        )}
        {hasFiles && (
          <div className="divider-files">
            {modifiedFiles.length > 0 && (
              <span className="divider-file-line">
                {dividerFileListLabel("涉及文件", modifiedFiles)}
              </span>
            )}
            {readFiles.length > 0 && (
              <span className="divider-file-line">
                {dividerFileListLabel("已读文件", readFiles)}
              </span>
            )}
          </div>
        )}
        {validTimestamp(divider.at) !== undefined && (
          <span className="divider-time">{formatDateTime(divider.at)}</span>
        )}
      </div>
    </details>
  );
}

/**
 * Expansion state key of one divider. The timestamp of the compaction entry is
 * stable for the life of the session, so the state survives re-renders; two
 * dividers of the same kind without a timestamp share one flag, which is
 * harmless because they are degenerated markers.
 */
function dividerPanelKey(divider: DividerPartData): string {
  return `divider:${divider.kind}:${divider.at}`;
}

function dividerLabel(divider: DividerPartData): string {
  const label = [divider.kind === "compaction" ? "上下文已压缩" : "分支摘要"];
  if (divider.tokensBefore !== undefined) {
    label.push(`压缩前 ${formatCount(divider.tokensBefore)} tokens`);
  }
  if (divider.summary.length > 0) {
    label.push(`摘要 ${formatSummarySize(divider.summary.length)}`);
  }
  return label.join(" · ");
}

function dividerFileListLabel(label: string, files: string[]): string {
  const shown = files.slice(0, DIVIDER_FILE_NAME_LIMIT).join("、");
  const hidden = files.length - DIVIDER_FILE_NAME_LIMIT;
  return `${label} ${files.length}：${shown}${hidden > 0 ? ` …另有 ${hidden} 个` : ""}`;
}

/** `111867` -> `111,867`. */
function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Truncated to one decimal, so 8986 characters read as `8.9k 字`. */
function formatSummarySize(characters: number): string {
  if (characters < 1_000) return `${characters} 字`;
  return `${(Math.floor(characters / 100) / 10).toFixed(1)}k 字`;
}

function formatDateTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
}

/** Display order and titles of the todo groups (in_progress first). */
const TODO_GROUP_ORDER = ["in_progress", "pending", "completed"] as const;

type TodoGroupStatus = (typeof TODO_GROUP_ORDER)[number];

const TODO_GROUP_TITLES: Record<TodoGroupStatus, string> = {
  in_progress: "进行中",
  pending: "待办",
  completed: "已完成",
};

/**
 * Order and wording of the folded count line, which reads like a summary of the
 * remaining work: `待办 3 · 进行中 1 · 完成 12`.
 */
const TODO_COUNT_ORDER = ["pending", "in_progress", "completed"] as const;

const TODO_COUNT_LABELS: Record<TodoGroupStatus, string> = {
  pending: "待办",
  in_progress: "进行中",
  completed: "完成",
};

/**
 * Collapsible todo bar above the composer.
 *
 * It mirrors what the `todo` extension reports for this session; the parent
 * filters the tombstones out and uses the same list to know whether the fixed
 * footer needs the taller reservation (`useChatFooterInset`). An empty list —
 * including a snapshot that had to be degraded for size — renders nothing at
 * all instead of an empty container. The list refreshes with the existing 1.5s
 * chat poll; there is no separate push channel.
 */
function TodoStatusBar({ tasks }: { tasks: TodoTask[] }) {
  const [open, setOpen] = usePanelOpenState(TODO_PANEL_KEY);
  if (!tasks.length) return null;

  const counts: Record<TodoGroupStatus, number> = {
    in_progress: 0,
    pending: 0,
    completed: 0,
  };
  for (const task of tasks) counts[todoGroupStatus(task.status)] += 1;
  const byId = new Map(tasks.map((task) => [task.id, task]));

  return (
    <details
      className="chat-todo-bar"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ListChecks className="todo-icon" size={14} aria-hidden="true" />
        <span className="todo-counts">{todoCountsLabel(counts)}</span>
        <ChevronRight className="todo-chevron" size={14} aria-hidden="true" />
      </summary>
      <div className="todo-list">
        {TODO_GROUP_ORDER.map((status) => {
          const groupTasks = tasks.filter(
            (task) => todoGroupStatus(task.status) === status,
          );
          if (!groupTasks.length) return null;
          return (
            <section key={status} className={`todo-group ${status}`}>
              <h4>
                {TODO_GROUP_TITLES[status]}
                <span className="todo-group-count">{groupTasks.length}</span>
              </h4>
              <ul>
                {groupTasks.map((task) => {
                  const blocked = todoBlockedLabel(task, byId);
                  return (
                    <li key={task.id} className="todo-task">
                      <TodoStatusIcon status={status} />
                      <span className="todo-subject">{todoTaskLabel(task)}</span>
                      {blocked && <span className="todo-blocked">{blocked}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}

/** One flag per pane, like every other row in `../panelOpenState`. */
const TODO_PANEL_KEY = "todo:bar";

/**
 * Maps a task status onto the three visible groups. Unknown statuses stay
 * visible as pending work instead of being silently dropped.
 */
function todoGroupStatus(status: TodoTaskStatus): TodoGroupStatus {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  return "pending";
}

/** `in_progress` shows the present participle when the task has one. */
function todoTaskLabel(task: TodoTask): string {
  return task.status === "in_progress" && task.activeForm
    ? task.activeForm
    : task.subject;
}

function todoCountsLabel(counts: Record<TodoGroupStatus, number>): string {
  return TODO_COUNT_ORDER.filter((status) => counts[status] > 0)
    .map((status) => `${TODO_COUNT_LABELS[status]} ${counts[status]}`)
    .join(" · ");
}

/**
 * Dependency note of an open task: a dependency that is still open blocks it,
 * one that is completed does not, and a dependency that is not part of the
 * snapshot (for example a tombstone) cannot be judged and is reported as
 * unknown instead of being guessed.
 */
function todoBlockedLabel(
  task: TodoTask,
  byId: Map<number, TodoTask>,
): string | undefined {
  if (task.status === "completed" || !task.blockedBy?.length) return undefined;
  const dependencies = task.blockedBy.map((id) => {
    const dependency = byId.get(id);
    const state =
      dependency === undefined
        ? "未知"
        : dependency.status === "completed"
          ? "已完成"
          : "未完成";
    return { id, state, blocking: state === "未完成" };
  });
  const list = dependencies.map(({ id, state }) => `#${id}（${state}）`).join("、");
  return dependencies.some((dependency) => dependency.blocking)
    ? `被阻塞：依赖 ${list}`
    : `依赖 ${list}`;
}

function TodoStatusIcon({ status }: { status: TodoGroupStatus }) {
  if (status === "completed") return <CircleCheck size={13} aria-hidden="true" />;
  if (status === "in_progress") return <LoaderCircle size={13} aria-hidden="true" />;
  return <CircleDashed size={13} aria-hidden="true" />;
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
    else {
      grouped.push({
        type: "tool-group",
        id: `tools:${tools[0]?.toolCallId ?? index}`,
        items: tools,
      });
    }
  }

  return grouped;
}

function groupAssistantTurns(
  messages: ChatMessage[],
  latestTurnRunning: boolean,
): DisplayMessage[] {
  const grouped: DisplayMessage[] = [];
  let index = 0;
  let turnStartedAt: number | undefined;

  while (index < messages.length) {
    const message = messages[index];
    if (message.role === "user") {
      // User messages never carry a divider (the reader emits those as their own
      // assistant message), but they are normalized anyway so that no raw
      // divider part can ever reach assistant-ui.
      grouped.push({ ...message, content: message.content.map(toDisplayPart) });
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
      (latestTurnRunning && isLatestTurn);
    grouped.push(combineAssistantTurn(assistantMessages, turnStartedAt, turnRunning));
  }

  return grouped;
}

/**
 * Builds the single display message of one assistant turn.
 *
 * The turn is split into as many `Worked for` groups as there are dividers
 * between its work parts: a compaction in the middle of a turn must read as
 * `Worked for` → rule → `Worked for`, while a turn without a divider keeps its
 * single group exactly as before.
 *
 * Two order guarantees hold for every finished turn:
 * - a group is inserted where its segment's first folded part was, never at the
 *   end of the turn (folding must not move a group below the text it belongs
 *   above); and
 * - a divider is a real boundary: each segment is folded on its own, so the rule
 *   sits between two groups and no work row of a segment is left outside it.
 */
function combineAssistantTurn(
  messages: ChatMessage[],
  turnStartedAt: number | undefined,
  running: boolean,
): DisplayMessage {
  const parts = messages.flatMap((message) => message.content.map(toDisplayPart));
  // Divider-only messages carry no output and no duration of their own, so they
  // must not stretch the turn: the compaction is written at an arbitrary moment
  // relative to the messages around it.
  const timedMessages = messages.filter((message) =>
    message.content.some((part) => part.type !== "divider"),
  );
  // Status and completion time come from the last message that actually carried
  // them: a trailing divider message has neither, so reading `messages.at(-1)`
  // would describe the turn as status-less. Leaving the status off is
  // DOM-neutral today (the runtime gives the thread's last message its status),
  // but the display message should describe the real turn.
  const lastTimedMessage = timedMessages.at(-1);
  const firstMessage = messages[0];
  const startedAt =
    validTimestamp(turnStartedAt) ??
    validTimestamp(timedMessages[0]?.createdAt ?? firstMessage.createdAt) ??
    0;
  const endedAt = timedMessages.length
    ? timedMessages.reduce(
        (latest, message) =>
          Math.max(latest, validTimestamp(message.completedAt) ?? message.createdAt),
        startedAt,
      ) || startedAt
    : startedAt;
  const durationMs = Math.max(0, endedAt - startedAt);
  // Stable across the whole turn: the group keeps its expansion state while the
  // turn is still growing (see `../panelOpenState`).
  const workGroupId = (segment: number) =>
    segment === 0 ? `work:${firstMessage.id}` : `work:${firstMessage.id}:${segment}`;

  const content: DisplayPart[] = [];

  if (running) {
    // While the turn can still grow, every part renders on its own; the group is
    // only built once the turn is over.
    content.push(...parts);
  } else {
    // Every segment gets exactly one group per folded run, inserted where the
    // segment's first folded part was: folding the parts must never move the
    // group behind the parts it summarizes (that is the `组 → 正文` regression)
    // or behind a divider.
    //
    // A divider is a real boundary, so each segment applies the turn rule on its
    // own — everything before the segment's *own* last output is folded, and the
    // rest stays visible. Without a divider there is exactly one segment, which
    // makes this the unchanged `dc8282c` behaviour.
    let items: ActivityItem[] = [];
    let segment = 0;
    let openGroup = false;
    let segmentStart = 0;

    const foldSegment = (segmentParts: DisplayPart[]) => {
      const limit = segmentOutputLimit(segmentParts);
      segmentParts.forEach((part, offset) => {
        if (offset < limit && isWorkPart(part)) {
          const item = toActivityItem(part);
          // Unreachable: `isWorkPart` and `toActivityItem` cover the same types.
          if (!item) return;
          if (!openGroup) {
            openGroup = true;
            content.push({
              type: "data-activity",
              data: { id: workGroupId(segment), kind: "work", durationMs, items },
            });
          }
          items.push(item);
          return;
        }
        content.push(part);
      });
      // A segment without foldable parts consumes no group number, and
      // consecutive dividers therefore leave no empty group behind.
      if (openGroup) {
        openGroup = false;
        items = [];
        segment += 1;
      }
    };

    for (let index = 0; index <= parts.length; index += 1) {
      const part = parts[index];
      if (part && part.type !== "data-divider") continue;
      foldSegment(parts.slice(segmentStart, index));
      segmentStart = index + 1;
      if (part) content.push(part);
    }

    // A finished turn with no work rows still shows how long it ran — but only
    // when it has a real message to time. A turn made of divider messages only
    // gets no fabricated `Worked for` row. The row is inserted once per turn,
    // before the turn's last output, so a turn whose segments all fold nothing
    // still reports its span exactly once (the pre-existing `dc8282c` rule).
    if (
      timedMessages.length > 0 &&
      !content.some((part) => part.type === "data-activity")
    ) {
      const lastOutput = findLastOutputIndex(content);
      content.splice(lastOutput >= 0 ? lastOutput : 0, 0, {
        type: "data-activity",
        data: { id: workGroupId(0), kind: "work", durationMs, items: [] },
      });
    }
  }

  return {
    id: `turn:${firstMessage.id}`,
    role: "assistant",
    createdAt: firstMessage.createdAt,
    ...(lastTimedMessage?.completedAt
      ? { completedAt: lastTimedMessage.completedAt }
      : {}),
    content: groupConsecutiveTools(content),
    ...(lastTimedMessage?.status ? { status: lastTimedMessage.status } : {}),
  };
}

/**
 * Turns a divider part into an assistant-ui data part, which is what renders the
 * rule and what keeps it out of the activity rows (a divider is not work).
 */
function toDisplayPart(part: ChatPart): DisplayPart {
  if (part.type !== "divider") return part;
  return {
    type: "data-divider",
    data: {
      kind: part.kind,
      summary: part.summary,
      ...(part.tokensBefore === undefined ? {} : { tokensBefore: part.tokensBefore }),
      ...(part.modifiedFiles ? { modifiedFiles: part.modifiedFiles } : {}),
      ...(part.readFiles ? { readFiles: part.readFiles } : {}),
      at: part.at,
    },
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

    const tools: ToolActivityItem[] = [];
    const firstTool = parts[index];
    while (index < parts.length && parts[index].type === "tool-call") {
      const activity = toActivityItem(parts[index]);
      if (activity?.type === "tool") tools.push(activity);
      index += 1;
    }

    if (tools.length === 1) {
      grouped.push(firstTool);
    } else {
      grouped.push({
        type: "data-activity",
        data: {
          id: `tools:${tools[0]?.toolCallId ?? index}`,
          kind: "tools",
          items: tools,
        },
      });
    }
  }

  return grouped;
}

function toActivityItem(part: DisplayPart): ActivityItem | null {
  if (part.type === "text") return { type: "message", text: part.text };
  if (part.type === "reasoning") {
    return {
      type: "reasoning",
      text: part.text,
      ...(part.durationMs !== undefined ? { durationMs: part.durationMs } : {}),
    };
  }
  if (part.type === "image") return { type: "image", image: part.image };
  if (part.type !== "tool-call") return null;
  return {
    type: "tool",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    args: part.args,
    ...(part.result !== undefined ? { result: part.result } : {}),
    ...(part.isError !== undefined ? { isError: part.isError } : {}),
    ...(part.display !== undefined ? { display: part.display } : {}),
  };
}

/**
 * `display` off a raw tool-call part. It is not part of assistant-ui's declared
 * props but the part object is passed through unchanged, so it is read like the
 * reasoning part's `durationMs`: defensively, and only when it is an object.
 */
function partToolDisplay(part: object): ChatToolDisplay | undefined {
  const value = (part as { display?: unknown }).display;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ChatToolDisplay)
    : undefined;
}

/**
 * A divider is a boundary marker, never work: it is excluded from the group
 * items here and from `toActivityItem` below (which returns `null` for it).
 * Every display part that is not listed is not work either.
 */
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

/**
 * Cut-off of one segment: everything before the segment's own last output is
 * folded into its `Worked for` group. A segment without output folds all of its
 * work; an empty one folds nothing.
 */
function segmentOutputLimit(segmentParts: DisplayPart[]): number {
  const lastOutput = findLastOutputIndex(segmentParts);
  return lastOutput >= 0 ? lastOutput : segmentParts.length;
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

function isToolActivityItem(item: ActivityItem): item is ToolActivityItem {
  return item.type === "tool";
}

/** Distinct tool names of a run, used as the group tooltip. */
function toolNameList(items: ToolActivityItem[]): string {
  return Array.from(new Set(items.map((item) => item.toolName))).join(", ");
}

/** Reasoning runs for at least a second before a duration is worth reporting. */
const REASONING_MIN_DURATION_MS = 1_000;

function reasoningLabel(durationMs: number | undefined, running: boolean): string {
  if (running) return "思考中";
  if (durationMs !== undefined && durationMs >= REASONING_MIN_DURATION_MS) {
    return `已思考 ${formatDuration(durationMs)}`;
  }
  // Unknown span: no number, because a guess would be worse than none.
  return "Thinking";
}

/**
 * assistant-ui's reasoning part type does not declare `durationMs`, but the part
 * object is passed through unchanged, so the optional field is read defensively.
 */
function partDurationMs(part: object): number | undefined {
  const value = (part as { durationMs?: unknown }).durationMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
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
        // The live projection is the only one available while the call runs;
        // once the JSONL entry lands, its projection (or the live one, when the
        // entry has none) is used.
        const display = part.display ?? liveTool.display;
        const withDisplay = display === undefined ? {} : { display };
        if (liveTool.status !== "complete" || part.result !== undefined) {
          return { ...part, args, ...withDisplay };
        }
        return {
          ...part,
          args,
          result: liveTool.result,
          isError: liveTool.isError,
          ...withDisplay,
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
      countUserMessages(authoritative, userMessageFingerprint(candidate)) <=
      candidate.authoritativeOccurrence,
  );
}

function countUserMessages(messages: ChatMessage[], fingerprint: string): number {
  return messages.filter(
    (message) =>
      message.role === "user" && userMessageFingerprint(message) === fingerprint,
  ).length;
}

function userMessageFingerprint(message: ChatMessage): string {
  const text = message.content
    .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const images = message.content
    .filter((part): part is Extract<ChatPart, { type: "image" }> => part.type === "image")
    .map((part) => part.sha256 ?? part.uploadId ?? part.image);
  return JSON.stringify({ text, images });
}

function messageText(message: ChatMessage): string {
  return message.content
    .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function messageUploadIds(message: ChatMessage): string[] {
  return message.content
    .filter((part): part is Extract<ChatPart, { type: "image" }> => part.type === "image")
    .map((part) => part.uploadId)
    .filter((uploadId): uploadId is string => Boolean(uploadId));
}

function errorClassName(error: unknown): string {
  const name = error instanceof Error && error.name ? error.name : typeof error;
  return name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "unknown";
}

function imageCapabilityLabel(
  realtime: ChatRealtimeState | undefined,
  lastTransport: "host-path" | "pi-native" | null,
): string {
  if (realtime?.capabilities?.modelAcceptsImages === false) {
    return "当前模型不支持图片";
  }
  if (lastTransport === "host-path") return "图片经宿主路径发送";
  if (lastTransport === "pi-native") return "Pi 原生图片";
  if (realtime?.capabilities?.imageInput) return "Pi 原生图片可用";
  return realtime ? realtimeLabel(realtime.status) : "图片将经宿主路径发送";
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
    content: withDeliveryStatusPart(message),
    ...(message.role === "assistant" && message.status
      ? { status: message.status }
      : {}),
  };
}

/**
 * Adds the delivery status row to a pending user message. `sent` needs no row;
 * every other state tells the user whether the prompt actually left the browser.
 */
function withDeliveryStatusPart(message: DisplayMessage): DisplayPart[] {
  const delivery = message.delivery;
  if (message.role !== "user" || !delivery || delivery.state === "sent") {
    return message.content;
  }
  return [
    ...message.content,
    {
      type: "data-delivery",
      data: {
        messageId: message.id,
        state: delivery.state,
        requestId: delivery.requestId,
        attempt: delivery.attempt,
        ...(delivery.error ? { error: delivery.error } : {}),
        ...(delivery.transport ? { transport: delivery.transport } : {}),
        ...(delivery.imageExpiresAt
          ? { imageExpiresAt: delivery.imageExpiresAt }
          : {}),
      },
    },
  ];
}
