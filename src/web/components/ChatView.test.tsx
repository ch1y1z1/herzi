// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ChatJsonObject,
  ChatMessage,
  ChatPart,
  ChatRealtimeState,
  PaneSummary,
  PromptDeliveryEvent,
} from "../../shared/protocol";
import { apiFetch } from "../api";
import { resetPanelOpenStores } from "../panelOpenState";
import {
  flushPromptDeliveryTrace,
  resetPromptDeliveryTrace,
} from "../promptDeliveryTrace";
import { ChatView } from "./ChatView";

vi.mock("../api", () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

const pane: PaneSummary = {
  id: "pane-1",
  workspaceId: "w1",
  tabId: "t1",
  title: "pi",
  cwd: null,
  focused: true,
  agent: "pi",
  agentStatus: "idle",
  hasChatSession: true,
};

const PROMPT_MESSAGE = "帮我看看这个报错";

beforeEach(() => {
  resetPromptDeliveryTrace();
  traceBatches = [];
  mockedApiFetch.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom has no layout engine; assistant-ui's auto-scroll needs these.
  Object.defineProperty(window.Element.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
  Object.defineProperty(window.Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({ paneId: pane.id, running: false, updatedAt: 0, messages: [] }),
    ),
  );
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    vi.stubGlobal("crypto", {
      randomUUID: () => `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14)}`,
    });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetPromptDeliveryTrace();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ApiFetchCall = Parameters<typeof apiFetch>;

function promptCalls(): ApiFetchCall[] {
  return mockedApiFetch.mock.calls.filter(([url]) =>
    String(url).includes("/prompt"),
  );
}

function requestIdOf(call: ApiFetchCall): string {
  const body = JSON.parse(String(call[1]?.body ?? "{}")) as { requestId?: string };
  return body.requestId ?? "";
}

/** Uploaded client trace batches, flattened for assertions. */
let traceBatches: PromptDeliveryEvent[][] = [];

function traceEvents(): PromptDeliveryEvent[] {
  return traceBatches.flat();
}

function collectTraceBatch(init: RequestInit | undefined): Response {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    events?: PromptDeliveryEvent[];
  };
  const events = body.events ?? [];
  traceBatches.push(events);
  return jsonResponse({ ok: true, accepted: events.length });
}

async function sendPrompt(): Promise<void> {
  const input = await screen.findByPlaceholderText(/Chat via Herzi/);
  fireEvent.change(input, { target: { value: PROMPT_MESSAGE } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}

describe("ChatView prompt delivery visibility", () => {
  it("keeps a failed prompt in the thread with an explicit error and recovery actions", async () => {
    mockedApiFetch.mockImplementation(async (url) => {
      if (String(url) === "/api/prompt-delivery/events") {
        return jsonResponse({ ok: true, accepted: 1 });
      }
      return jsonResponse({ error: "Herdr prompt failed" }, 502);
    });

    render(<ChatView pane={pane} />);
    await sendPrompt();

    await waitFor(() => expect(screen.getByText("未送达")).toBeTruthy());
    // The optimistic bubble and its content are still there.
    expect(screen.getByText(PROMPT_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Herdr prompt failed");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制内容" })).toBeTruthy();
    expect(promptCalls()).toHaveLength(1);
    // No automatic retry: the user stays in control.
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(promptCalls()).toHaveLength(1);
  });

  it("resends only on an explicit retry and uses a fresh request id", async () => {
    mockedApiFetch.mockImplementation(async (url) => {
      if (String(url) === "/api/prompt-delivery/events") {
        return jsonResponse({ ok: true, accepted: 1 });
      }
      return jsonResponse({ error: "Herdr prompt failed" }, 502);
    });

    render(<ChatView pane={pane} />);
    await sendPrompt();
    await waitFor(() => expect(screen.getByText("未送达")).toBeTruthy());
    const firstRequestId = requestIdOf(promptCalls()[0]!);
    expect(firstRequestId).not.toBe("");

    mockedApiFetch.mockImplementation(async (url) => {
      if (String(url) === "/api/prompt-delivery/events") {
        return jsonResponse({ ok: true, accepted: 1 });
      }
      return jsonResponse({
        ok: true,
        requestId: "server-ignored",
        transport: "text",
        status: "submitted",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(promptCalls()).toHaveLength(2));
    expect(requestIdOf(promptCalls()[1]!)).not.toBe(firstRequestId);
    expect(screen.getByText(PROMPT_MESSAGE)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("未送达")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks a queued prompt as unconfirmed when the bridge never claims it", async () => {
    mockedApiFetch.mockImplementation(async (url) => {
      if (String(url) === "/api/prompt-delivery/events") {
        return jsonResponse({ ok: true, accepted: 1 });
      }
      return jsonResponse({
        ok: true,
        requestId: "server-ignored",
        transport: "pi-native",
        status: "queued",
      });
    });

    const { rerender } = render(<ChatView pane={pane} />);
    await sendPrompt();
    await waitFor(() => expect(screen.getByText("等待 Pi 接收…")).toBeTruthy());

    const requestId = requestIdOf(promptCalls()[0]!);
    const expired: PromptDeliveryEvent = {
      requestId,
      paneId: pane.id,
      source: "server",
      phase: "queue.expired",
      at: Date.now(),
      seq: 7,
      // The shape the server actually emits for a never-claimed command.
      queueStatus: "expired",
      status: "delivery-unconfirmed",
      errorCode: "queue-expired-unclaimed",
      latencyMs: 60_000,
    };

    rerender(<ChatView pane={pane} deliveryEvents={[expired]} />);

    await waitFor(() => expect(screen.getByText("未确认送达")).toBeTruthy());
    expect(screen.getByText(PROMPT_MESSAGE)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(requestId.slice(0, 8));
  });

  it("shows a claimed prompt as received and hides the status row once dispatched", async () => {
    mockedApiFetch.mockImplementation(async (url) => {
      if (String(url) === "/api/prompt-delivery/events") {
        return jsonResponse({ ok: true, accepted: 1 });
      }
      return jsonResponse({
        ok: true,
        requestId: "server-ignored",
        transport: "pi-native",
        status: "queued",
      });
    });

    const { rerender } = render(<ChatView pane={pane} />);
    await sendPrompt();
    await waitFor(() => expect(screen.getByText("等待 Pi 接收…")).toBeTruthy());
    const requestId = requestIdOf(promptCalls()[0]!);
    const base = {
      requestId,
      paneId: pane.id,
      source: "server" as const,
      at: Date.now(),
    };

    rerender(
      <ChatView
        pane={pane}
        deliveryEvents={[
          { ...base, phase: "queue.claimed", seq: 1, queueStatus: "claimed", status: "claimed" },
        ]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Pi 已接收，正在写入会话…")).toBeTruthy(),
    );

    rerender(
      <ChatView
        pane={pane}
        deliveryEvents={[
          { ...base, phase: "queue.claimed", seq: 1, queueStatus: "claimed", status: "claimed" },
          {
            ...base,
            phase: "queue.dispatched",
            seq: 2,
            queueStatus: "dispatched",
            status: "dispatched",
          },
        ]}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText("Pi 已接收，正在写入会话…")).toBeNull(),
    );
    expect(screen.queryByText("等待 Pi 接收…")).toBeNull();
    expect(screen.getByText(PROMPT_MESSAGE)).toBeTruthy();
  });

  it("requires an explicit confirmation before resending a claim whose receipt was lost", async () => {
    mockedApiFetch.mockImplementation(async (url, init) => {
      if (String(url) === "/api/prompt-delivery/events") {
        return collectTraceBatch(init);
      }
      return jsonResponse({
        ok: true,
        requestId: "server-ignored",
        transport: "pi-native",
        status: "queued",
      });
    });

    const { rerender } = render(<ChatView pane={pane} />);
    await sendPrompt();
    await waitFor(() => expect(screen.getByText("等待 Pi 接收…")).toBeTruthy());
    const requestId = requestIdOf(promptCalls()[0]!);

    rerender(
      <ChatView
        pane={pane}
        deliveryEvents={[
          {
            requestId,
            paneId: pane.id,
            source: "server",
            phase: "queue.expired",
            at: Date.now(),
            seq: 9,
            queueStatus: "expired",
            status: "delivery-unconfirmed",
            errorCode: "queue-expired-unacked",
            latencyMs: 60_200,
          },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByText("回执丢失（可能已送达）")).toBeTruthy());
    expect(screen.getByText(/建议先查看 Terminal/)).toBeTruthy();

    // A single click must not silently duplicate the prompt.
    fireEvent.click(screen.getByRole("button", { name: "重试…" }));
    expect(promptCalls()).toHaveLength(1);
    expect(screen.getByText("重试会重复发送这条消息")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("重试会重复发送这条消息")).toBeNull();
    expect(promptCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "重试…" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重复发送" }));
    await waitFor(() => expect(promptCalls()).toHaveLength(2));

    // The traced client status has to match what the user actually saw: an
    // expired claim must never be recorded as `claimed`.
    await flushPromptDeliveryTrace();
    const deliveryStatusEvents = traceEvents().filter(
      (event) =>
        event.phase === "client.delivery-status" && event.requestId === requestId,
    );
    expect(deliveryStatusEvents).toHaveLength(1);
    expect(deliveryStatusEvents[0]).toMatchObject({
      status: "delivery-unconfirmed",
      queueStatus: "expired",
      errorCode: "queue-expired-unacked",
      source: "client",
    });
    expect(deliveryStatusEvents.some((event) => event.status === "claimed")).toBe(
      false,
    );
  });

  it("traces the same status it shows for a never-claimed expiry", async () => {
    mockedApiFetch.mockImplementation(async (url, init) => {
      if (String(url) === "/api/prompt-delivery/events") {
        return collectTraceBatch(init);
      }
      return jsonResponse({
        ok: true,
        requestId: "server-ignored",
        transport: "pi-native",
        status: "queued",
      });
    });

    const { rerender } = render(<ChatView pane={pane} />);
    await sendPrompt();
    await waitFor(() => expect(screen.getByText("等待 Pi 接收…")).toBeTruthy());
    const requestId = requestIdOf(promptCalls()[0]!);

    rerender(
      <ChatView
        pane={pane}
        deliveryEvents={[
          {
            requestId,
            paneId: pane.id,
            source: "server",
            phase: "queue.expired",
            at: Date.now(),
            seq: 11,
            queueStatus: "expired",
            status: "delivery-unconfirmed",
            errorCode: "queue-expired-unclaimed",
            latencyMs: 60_000,
          },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByText("未确认送达")).toBeTruthy());
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();

    await flushPromptDeliveryTrace();
    expect(
      traceEvents().find(
        (event) =>
          event.phase === "client.delivery-status" &&
          event.requestId === requestId,
      ),
    ).toMatchObject({
      status: "delivery-unconfirmed",
      queueStatus: "expired",
      errorCode: "queue-expired-unclaimed",
    });
  });
});

describe("ChatView composer focus", () => {
  it("focuses the composer as soon as the chat view is mounted", async () => {
    render(<ChatView pane={pane} />);

    const input = await screen.findByPlaceholderText(/Chat via Herzi/);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("keeps the composer focusable after the pane changes", async () => {
    const { unmount } = render(<ChatView pane={pane} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByPlaceholderText(/Chat via Herzi/),
      ),
    );

    unmount();
    // App renders `<ChatView key={pane.id}>`, so a pane switch remounts it.
    render(<ChatView pane={{ ...pane, id: "pane-2" }} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByPlaceholderText(/Chat via Herzi/),
      ),
    );
  });
});

const TURN_STARTED_AT = Date.parse("2026-09-15T00:00:00.000Z");

function userMessage(): ChatMessage {
  return {
    id: "u1",
    role: "user",
    createdAt: TURN_STARTED_AT - 1_000,
    content: [{ type: "text", text: "do it" }],
  };
}

function assistantMessage(
  id: string,
  content: ChatPart[],
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "assistant",
    createdAt: TURN_STARTED_AT,
    completedAt: TURN_STARTED_AT + 30_000,
    content,
    status: { type: "complete", reason: "stop" },
    ...extra,
  };
}

function toolPart(
  toolCallId: string,
  toolName: string,
  args: ChatJsonObject,
  options: { result?: unknown; isError?: boolean } = {},
): ChatPart {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    args,
    ...(options.result !== undefined ? { result: options.result } : {}),
    ...(options.isError !== undefined ? { isError: options.isError } : {}),
  };
}

function dividerPart(input: {
  kind?: "compaction" | "branch-summary";
  summary: string;
  tokensBefore?: number;
  modifiedFiles?: string[];
  readFiles?: string[];
  at?: number;
}): ChatPart {
  return {
    type: "divider",
    kind: input.kind ?? "compaction",
    summary: input.summary,
    ...(input.tokensBefore === undefined ? {} : { tokensBefore: input.tokensBefore }),
    ...(input.modifiedFiles ? { modifiedFiles: input.modifiedFiles } : {}),
    ...(input.readFiles ? { readFiles: input.readFiles } : {}),
    at: input.at ?? TURN_STARTED_AT,
  };
}

function stubChat(messages: ChatMessage[], running: boolean, todos?: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        paneId: pane.id,
        running,
        updatedAt: Date.now(),
        messages,
        ...(todos === undefined ? {} : { todos }),
      }),
    ),
  );
}

function realtimeTick(branchRevision: number): ChatRealtimeState {
  return {
    paneId: pane.id,
    runtimeId: "runtime-1",
    sequence: branchRevision,
    status: "idle",
    branchRevision,
    messages: [],
    tools: [],
    updatedAt: Date.now(),
  };
}

function groupHeader(): HTMLElement {
  const header = document.querySelector(".work-group > summary");
  if (!header) throw new Error("the worked-for group was not rendered");
  return header as HTMLElement;
}

function rows(selector = ".work-group .activity-item"): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[];
}

function cell(row: HTMLElement, selector: string): string | null {
  return row.querySelector(selector)?.textContent ?? null;
}

/**
 * Message ids as they reach the DOM. assistant-ui writes the `DisplayMessage`
 * id of every message into `data-message-id`, so this is also what React uses
 * as the key of the message subtree.
 */
function messageIds(): string[] {
  return Array.from(document.querySelectorAll("[data-message-id]")).map(
    (element) => element.getAttribute("data-message-id") ?? "",
  );
}

/**
 * Landmarks of the rendered transcript in document order.
 *
 * Class-only queries (`document.querySelectorAll(".work-group")`) cannot see
 * where a landmark sits relative to the text around it, which is exactly how a
 * `Worked for` group rendered below the final answer went unnoticed. Only
 * outermost landmarks count: rows nested inside a group, and the folded summary
 * inside a divider, are already represented by their container.
 */
function landmarks(root: ParentNode = document): string[] {
  const kinds: Array<[string, string]> = [
    [".work-group", "group"],
    [".worked-row", "row"],
    [".activity-group.tool-group", "toolgroup"],
    [".chat-divider", "divider"],
    [".markdown-body", "text"],
    [".reasoning-block", "reasoning"],
    [".tool-card", "tool"],
  ];
  const selector = kinds.map(([candidate]) => candidate).join(", ");
  return Array.from(root.querySelectorAll(selector))
    .filter((element) => !element.parentElement?.closest(selector))
    .map(
      (element) =>
        kinds.find(([candidate]) => element.matches(candidate))?.[1] ?? "?",
    );
}

describe("ChatView turn order", () => {
  beforeEach(() => {
    resetPanelOpenStores();
    stubChat([], false);
  });

  afterEach(() => {
    resetPanelOpenStores();
  });

  it("keeps the Worked for group above the turn's final answer", async () => {
    // The exact shape the regression was reported on: thinking -> tool -> answer.
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "先看代码", durationMs: 12_000 },
          toolPart("call-1", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "这是最终答复" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("这是最终答复");

    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(1));
    const turn = document.querySelector('[data-message-id="turn:a1"]') as HTMLElement;
    const group = turn.querySelector(".work-group") as HTMLElement;
    const answer = Array.from(turn.querySelectorAll(".markdown-body")).find(
      (element) => element.textContent?.includes("这是最终答复"),
    ) as HTMLElement;
    expect(answer).toBeTruthy();
    // `FOLLOWING` means the answer sits after the group in document order.
    expect(
      group.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The rows that were folded into the group stay inside it.
    expect(cell(group, ".activity-preview")).toContain("先看代码");
    expect(turn.querySelectorAll(".work-group .tool-item")).toHaveLength(1);
    expect(turn.querySelector(".work-group .reasoning-item")).toBeTruthy();
    expect(landmarks(turn)).toEqual(["group", "text"]);
  });

  it("renders group -> rule -> group -> answer around a mid-turn compaction", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "reasoning", text: "压缩前的思考" }]),
        {
          id: "divider:c1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "早前的工作被压缩。", at: TURN_STARTED_AT })],
        },
        assistantMessage("a2", [
          { type: "reasoning", text: "压缩后的思考" },
          toolPart("call-1", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "最终答复" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("最终答复");

    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(2));
    // The final answer is the turn's last output: it stays outside both groups
    // and below the second one, which itself stays below the rule.
    expect(landmarks()).toEqual(["group", "divider", "group", "text"]);
    // Both segments report the turn's whole span. The compaction time is not a
    // work boundary, so no per-segment duration is fabricated. (The visible
    // label may be a phase verb once a segment holds tool rows, so the shared
    // duration is read from the group title.)
    const titles = Array.from(document.querySelectorAll(".work-group > summary")).map(
      (element) => element.getAttribute("title") ?? "",
    );
    expect(titles).toHaveLength(2);
    expect(titles[0]).toBe(titles[1]);
    expect(titles[0]).toMatch(/^Worked for \d/);
  });

  it("keeps a trailing divider below the group without inventing another one", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "收尾工作", durationMs: 1_000 },
          toolPart("call-1", "bash", { command: "npm test" }, { result: "ok" }),
        ]),
        {
          id: "divider:c9",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "末尾压缩", at: 0 })],
        },
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(1));

    // One group, one rule, nothing after the rule.
    expect(landmarks()).toEqual(["group", "divider"]);
  });

  it("keeps the answer, then a trailing divider, for a turn that ends with the rule", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "已经答完" }]),
        {
          id: "divider:c8",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "答完后压缩", at: 0 })],
        },
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("已经答完");

    // The text-only turn keeps its single `Worked for` row (empty group), the
    // answer, and then the rule; no second group is fabricated below the rule.
    await waitFor(() => expect(document.querySelectorAll(".worked-row")).toHaveLength(1));
    expect(landmarks()).toEqual(["row", "text", "divider"]);
  });

  it("renders a divider-only turn as just the rule", async () => {
    stubChat(
      [
        userMessage(),
        {
          id: "divider:c7",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "独立分界", at: 0 })],
        },
      ],
      false,
    );

    render(<ChatView pane={pane} />);

    await waitFor(() =>
      expect(document.querySelectorAll(".chat-divider")).toHaveLength(1),
    );
    // No work, no timed message: the turn must not invent a `Worked for` row.
    expect(document.querySelector(".work-group")).toBeNull();
    expect(document.querySelector(".worked-row")).toBeNull();
    expect(landmarks()).toEqual(["divider"]);
  });

  it("puts a divider at the start of a turn above the group it introduces", async () => {
    stubChat(
      [
        userMessage(),
        {
          id: "divider:c3",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "开场压缩", at: TURN_STARTED_AT })],
        },
        assistantMessage("a1", [
          { type: "reasoning", text: "新的思考" },
          { type: "text", text: "新的答复" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("新的答复");

    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(1));
    expect(landmarks()).toEqual(["divider", "group", "text"]);
  });

  it("renders consecutive dividers without opening an empty segment", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "reasoning", text: "第一段" }]),
        {
          id: "divider:c1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "第一次压缩", at: TURN_STARTED_AT })],
        },
        {
          id: "divider:b1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [
            dividerPart({
              kind: "branch-summary",
              summary: "分支摘要",
              at: TURN_STARTED_AT + 1_000,
            }),
          ],
        },
        assistantMessage("a2", [{ type: "reasoning", text: "第二段" }]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);

    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(2));
    // Two rules in a row do not create a group of their own.
    expect(landmarks()).toEqual(["group", "divider", "divider", "group"]);
  });

  it("does not merge a run of tool rows across a divider", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "先想一下" },
          { type: "text", text: "先说明" },
          toolPart("call-1", "bash", { command: "npm test" }, { result: "ok" }),
          toolPart("call-2", "bash", { command: "npm run build" }, { result: "ok" }),
        ]),
        {
          id: "divider:c1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "压缩", at: TURN_STARTED_AT })],
        },
        assistantMessage("a2", [
          { type: "reasoning", text: "再想一下" },
          { type: "text", text: "再说一句" },
          toolPart("call-3", "bash", { command: "npm run typecheck" }, { result: "ok" }),
          toolPart("call-4", "bash", { command: "npm run lint" }, { result: "ok" }),
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("先说明");

    // Both tool runs sit behind their segment's text, so they stay inline rows;
    // `groupConsecutiveTools` runs after the turn was split and a divider is not
    // a tool call, so the two runs stay two rows instead of one merged run.
    await waitFor(() =>
      expect(document.querySelectorAll(".activity-group.tool-group")).toHaveLength(2),
    );
    expect(landmarks()).toEqual([
      "group",
      "text",
      "toolgroup",
      "divider",
      "group",
      "text",
      "toolgroup",
    ]);
  });

  it("folds each segment around its own last output", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "答题前的思考" },
          toolPart("call-1", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "这是答复" },
        ]),
        {
          id: "divider:c1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "答复之后压缩", at: TURN_STARTED_AT })],
        },
        assistantMessage("a2", [
          { type: "reasoning", text: "答复后的续作" },
          toolPart("call-2", "bash", { command: "npm run build" }, { result: "ok" }),
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("这是答复");

    // A divider is a real segment boundary: the work that happened after it is
    // summarized by its own group instead of leaking out as bare rows, so no
    // work part of a segment is left outside a group.
    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(2));
    expect(landmarks()).toEqual(["group", "text", "divider", "group"]);
    const groups = Array.from(document.querySelectorAll(".work-group"));
    expect(groups[0]?.textContent).toContain("答题前的思考");
    expect(groups[0]?.textContent).not.toContain("答复后的续作");
    expect(groups[1]?.textContent).toContain("答复后的续作");
  });

  it("keeps each segment's expanded state separate (unique segment ids)", async () => {
    const messages: ChatMessage[] = [
      userMessage(),
      assistantMessage("a1", [{ type: "reasoning", text: "第一段" }]),
      {
        id: "divider:c1",
        role: "assistant",
        createdAt: TURN_STARTED_AT,
        content: [dividerPart({ summary: "压缩", at: TURN_STARTED_AT })],
      },
      assistantMessage("a2", [{ type: "reasoning", text: "第二段" }]),
    ];
    stubChat(messages, false);

    const { rerender } = render(<ChatView pane={pane} realtime={realtimeTick(1)} />);
    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(2));
    const groups = Array.from(
      document.querySelectorAll(".work-group"),
    ) as HTMLDetailsElement[];
    groups[0]!.open = true;
    fireEvent(groups[0]!, new Event("toggle"));

    // A poll returns new objects; both segments must keep their own flag. If the
    // segment ids collided, opening the first group would open the second too.
    stubChat(messages, false);
    rerender(<ChatView pane={pane} realtime={realtimeTick(2)} />);
    await waitFor(() =>
      expect((document.querySelectorAll(".work-group")[0] as HTMLDetailsElement).open).toBe(
        true,
      ),
    );
    expect((document.querySelectorAll(".work-group")[1] as HTMLDetailsElement).open).toBe(
      false,
    );
  });

  it("keeps the divider above its neighbour through the realtime merge", async () => {
    // The reader anchors the divider to the timestamp of the message it
    // precedes, because the client re-sorts by `createdAt` here.
    const messages: ChatMessage[] = [
      userMessage(),
      assistantMessage("a1", [{ type: "reasoning", text: "第一段" }]),
      {
        id: "divider:c1",
        role: "assistant",
        createdAt: TURN_STARTED_AT + 20_000,
        content: [dividerPart({ summary: "压缩", at: TURN_STARTED_AT })],
      },
      assistantMessage("a2", [
        { type: "reasoning", text: "第二段" },
        { type: "text", text: "最终答复" },
      ], { createdAt: TURN_STARTED_AT + 20_000, completedAt: TURN_STARTED_AT + 40_000 }),
    ];
    stubChat(messages, false);

    const { rerender } = render(<ChatView pane={pane} realtime={realtimeTick(1)} />);
    await screen.findByText("最终答复");
    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(2));
    expect(landmarks()).toEqual(["group", "divider", "group", "text"]);

    // A pane switch and one more realtime tick must not move the marker: its
    // `createdAt` equals the next message's, and the sort is stable.
    const otherPane: PaneSummary = { ...pane, id: "pane-2", title: "pi 2" };
    stubChat(messages, false);
    rerender(<ChatView pane={otherPane} realtime={realtimeTick(3)} />);
    await screen.findByText("最终答复");
    expect(landmarks()).toEqual(["group", "divider", "group", "text"]);
  });

  it("shows a divider below an unmodified turn when the marker is not live", async () => {
    // Limitation, pinned on purpose: assistant-ui marks only the *last* part of
    // a running message as running. A divider that ends a still-running turn is
    // that last part, so the live reasoning row above it loses its `思考中`
    // label until the next part arrives. The divider itself is still rendered.
    stubChat(
      [
        userMessage(),
        assistantMessage(
          "a1",
          [{ type: "reasoning", text: "正在推敲" }],
          { status: { type: "running" }, completedAt: undefined },
        ),
        {
          id: "divider:c6",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "压缩中", at: 0 })],
        },
      ],
      true,
    );

    render(<ChatView pane={pane} />);

    const block = await waitFor(() => {
      const element = document.querySelector(".reasoning-block");
      if (!element) throw new Error("no live reasoning block");
      return element as HTMLElement;
    });
    expect(cell(block, "strong")).toBe("Thinking");
    expect(document.querySelector(".chat-divider")).toBeTruthy();
    // The turn keeps its running status all the same: no divider can make the
    // runtime stop treating the turn as live (the runtime's own `isRunning`
    // decides that, and the display status now comes from the last real
    // message).
    expect(document.querySelector('.assistant-message [data-status="running"]')).toBeTruthy();
  });
});

describe("ChatView activity presentation", () => {
  beforeEach(() => {
    resetPanelOpenStores();
    stubChat([], false);
  });

  afterEach(() => {
    resetPanelOpenStores();
  });

  it("summarizes a finished turn and gives every tool row an action and a target", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "先看一下现有实现", durationMs: 12_000 },
          toolPart("call-bash", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "命令跑完了" },
          toolPart(
            "call-edit",
            "edit",
            {
              path: "src/web/toolCatalog.ts",
              edits: [{ oldText: "old line", newText: "new line" }],
            },
            { result: "ok" },
          ),
          { type: "text", text: "文件也改了" },
          toolPart(
            "call-todo",
            "todo",
            { action: "update", id: 1, status: "completed" },
            { result: "ok" },
          ),
          { type: "text", text: "done" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("done");

    const header = await waitFor(() => {
      const element = groupHeader();
      expect(element).toBeTruthy();
      return element;
    });
    // Phase verb + fixed-order counters + diff total.
    expect(cell(header, ".activity-verb")).toBe("已修改");
    expect(cell(header, ".activity-counts")).toBe("1 次文件操作、1 条命令");
    expect(cell(header, ".diff-add")).toBe("+1");
    expect(cell(header, ".diff-remove")).toBe("−1");

    const rendered = rows(".work-group .tool-item");
    expect(rendered.map((row) => cell(row, ".tool-action"))).toEqual([
      "运行命令",
      "编辑",
      "更新计划",
    ]);
    // The targets are the real arguments, including the full path tooltip.
    const [bashRow, editRow, todoRow] = rendered as [HTMLElement, HTMLElement, HTMLElement];
    expect(cell(bashRow, ".tool-target")).toBe("npm test");
    expect(cell(editRow, ".tool-target")).toBe("toolCatalog.ts");
    expect(editRow.querySelector(".tool-target")?.getAttribute("title")).toBe(
      "src/web/toolCatalog.ts",
    );
    expect(todoRow.querySelector(".tool-target")?.textContent).toBe("#1");

    // Thinking keeps its own row, with the server-provided span.
    const reasoningRow = document.querySelector(".reasoning-item") as HTMLElement;
    expect(cell(reasoningRow, "strong")).toBe("已思考 12s");

    // todo rows are displayed but never counted (decision D2).
    expect(header.textContent).not.toContain("步");
  });

  it("uses the same summary wording for a nested run of tools", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          toolPart("call-1", "bash", { command: "npm run typecheck" }, { result: "ok" }),
          toolPart("call-2", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "both green" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("both green");

    await waitFor(() => expect(document.querySelector(".activity-tool-group")).toBeTruthy());
    expect(cell(groupHeader(), ".activity-verb")).toBe("已运行");
    expect(cell(groupHeader(), ".activity-counts")).toBe("2 条命令");

    const nested = document.querySelector(".activity-tool-group") as HTMLElement;
    expect(cell(nested, ".activity-verb")).toBe("已运行");
    expect(cell(nested, ".activity-counts")).toBe("2 条命令");
    // The tool names are still reachable, as the group tooltip.
    expect(nested.querySelector("summary")?.getAttribute("title")).toBe("bash");
    expect(rows(".activity-tool-group .tool-item")).toHaveLength(2);
  });

  it("still renders rows for unknown tools, missing arguments and failed calls", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          toolPart(
            "call-unknown",
            "mcp__linear__create_issue",
            { query: "fix build" },
            { result: "created" },
          ),
          { type: "text", text: "外部工具完成" },
          toolPart(
            "call-failed",
            "bash",
            { command: "npm test" },
            { result: "boom", isError: true },
          ),
          { type: "text", text: "命令失败了" },
          toolPart("call-empty", "mystery_tool", {}, { result: "ok" }),
          { type: "text", text: "done" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("done");

    await waitFor(() => expect(rows()).toHaveLength(3));
    const rendered = rows();
    // Unknown tool: the tool name itself is the action word.
    expect(cell(rendered[0]!, ".tool-action")).toBe("mcp__linear__create_issue");
    expect(cell(rendered[0]!, ".tool-target")).toBe("fix build");
    // A failed call is still a readable row.
    expect(rendered[1]!.className).toContain("tool-error");
    expect(cell(rendered[1]!, ".tool-target")).toBe("npm test");
    // No arguments at all: the row shows the empty-arguments JSON, never blank.
    expect(cell(rendered[2]!, ".tool-target")).toBe("{}");
    for (const row of rendered) {
      expect(row.textContent).not.toContain("undefined");
      expect(cell(row, ".tool-target")).not.toBe("");
    }

    // An unknown tool counts as one neutral step, next to the real command.
    expect(cell(groupHeader(), ".activity-counts")).toBe("1 条命令、2 步");
  });

  it("shows a thinking duration only when the transcript provides one", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "有跨度的思考", durationMs: 12_000 },
          { type: "text", text: "先记一笔" },
          { type: "reasoning", text: "无法判定的思考" },
          { type: "text", text: "答案" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("答案");

    await waitFor(() => expect(rows(".reasoning-item")).toHaveLength(2));
    const [timed, unknown] = rows(".reasoning-item") as [HTMLElement, HTMLElement];
    expect(cell(timed, "strong")).toBe("已思考 12s");
    // No duration is guessed.
    expect(cell(unknown, "strong")).toBe("Thinking");

    // Without a single tool row the header keeps the original wording.
    expect(cell(groupHeader(), ".activity-verb")).toMatch(/^Worked for /);
    expect(cell(groupHeader(), ".activity-counts")).toBeNull();
  });

  it("labels live reasoning as in progress", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage(
          "a1",
          [{ type: "reasoning", text: "正在推敲" }],
          { status: { type: "running" } },
        ),
      ],
      true,
    );

    render(<ChatView pane={pane} />);
    const block = await waitFor(() => {
      const element = document.querySelector(".reasoning-block");
      if (!element) throw new Error("no live reasoning block");
      return element as HTMLElement;
    });
    expect(cell(block, "strong")).toBe("思考中");
  });

  it("keeps a group expanded across the end of a turn and hides its diff while running", async () => {
    const streaming: ChatMessage[] = [
      userMessage(),
      assistantMessage(
        "a1",
        [
          toolPart("call-1", "bash", { command: "npm run typecheck" }),
          toolPart("call-2", "bash", { command: "npm test" }),
        ],
        { status: { type: "running" }, completedAt: undefined },
      ),
    ];
    stubChat(streaming, true);

    const { rerender } = render(<ChatView pane={pane} />);
    const group = await waitFor(() => {
      const element = document.querySelector(".activity-group.tool-group");
      if (!element) throw new Error("the running tool group was not rendered");
      return element as HTMLDetailsElement;
    });
    // A running group never shows a diff total for work that may still change.
    expect(group.querySelector(".activity-diff")).toBeNull();

    group.open = true;
    fireEvent(group, new Event("toggle"));
    expect(group.open).toBe(true);

    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          toolPart("call-1", "bash", { command: "npm run typecheck" }, { result: "ok" }),
          toolPart("call-2", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "done" },
        ]),
      ],
      false,
    );
    rerender(<ChatView pane={pane} realtime={realtimeTick(2)} />);

    await waitFor(() =>
      expect(document.querySelector(".activity-tool-group")).toBeTruthy(),
    );
    const nested = document.querySelector(
      ".activity-tool-group",
    ) as HTMLDetailsElement;
    expect(nested.open).toBe(true);
  });

  it("keeps a row expanded while streaming once the turn is grouped", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage(
          "a1",
          [toolPart("call-1", "bash", { command: "npm test" })],
          { status: { type: "running" }, completedAt: undefined },
        ),
      ],
      true,
    );

    const { rerender } = render(<ChatView pane={pane} />);
    const card = await waitFor(() => {
      const element = document.querySelector(".tool-card");
      if (!element) throw new Error("the running tool card was not rendered");
      return element as HTMLDetailsElement;
    });
    expect(card.open).toBe(false);

    // The user expands the running row. jsdom does not toggle <details> itself,
    // so drive the handler the browser fires.
    card.open = true;
    fireEvent(card, new Event("toggle"));
    expect(card.open).toBe(true);

    // The turn finishes: the same tool call is now a row inside the group, i.e.
    // the message was re-created with a different id.
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          toolPart("call-1", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "done" },
        ]),
      ],
      false,
    );
    rerender(<ChatView pane={pane} realtime={realtimeTick(1)} />);

    await waitFor(() => expect(document.querySelector(".work-group")).toBeTruthy());
    const row = document.querySelector(".work-group .tool-item") as HTMLDetailsElement;
    expect(row).toBeTruthy();
    expect(row.open).toBe(true);
  });

  it("keeps the latest turn expanded until the pane actually settles", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "先做一半" }], {
          status: { type: "running" },
          completedAt: undefined,
        }),
      ],
      true,
    );

    const { rerender } = render(
      <ChatView pane={pane} realtime={{ ...realtimeTick(1), status: "working" }} />,
    );
    await screen.findByText("先做一半");
    expect(document.querySelector(".work-group")).toBeNull();

    // Gap between two model outputs: the message level signal is gone and the
    // realtime status fell back to `idle`, but the pane is blocked (the agent is
    // waiting for the user), so the turn is not over yet.
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "text", text: "先做一半，然后在等你确认" },
        ]),
      ],
      false,
    );
    rerender(
      <ChatView
        pane={{ ...pane, agentStatus: "blocked" }}
        realtime={{ ...realtimeTick(2), status: "idle" }}
      />,
    );
    await screen.findByText("先做一半，然后在等你确认");
    expect(screen.queryByText(/Worked for/)).toBeNull();

    // Settle: the pane reports `done` and every other source is idle as well.
    rerender(
      <ChatView
        pane={{ ...pane, agentStatus: "done" }}
        realtime={{ ...realtimeTick(3), status: "idle" }}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Worked for/)).toBeTruthy());
  });

  it("does not fold the latest turn while the polled snapshot still reports work", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "先做一半" }], {
          status: { type: "running" },
          completedAt: undefined,
        }),
      ],
      true,
    );

    const { rerender } = render(
      <ChatView pane={pane} realtime={{ ...realtimeTick(1), status: "working" }} />,
    );
    await screen.findByText("先做一半");

    // The bridge status fell back to `idle` for the same runtime (R1.3 in the
    // bug report), but the pane is still working: one source going quiet must
    // not fold the turn while another one still reports activity.
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "先做一半，还在跑" }]),
      ],
      true,
    );
    rerender(
      <ChatView
        pane={{ ...pane, agentStatus: "working" }}
        realtime={{ ...realtimeTick(2), status: "idle" }}
      />,
    );
    await screen.findByText("先做一半，还在跑");
    expect(screen.queryByText(/Worked for/)).toBeNull();
  });

  it("keeps the turn's message id stable while the turn grows", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "第一段" }]),
        assistantMessage("a2", [{ type: "text", text: "第二段" }]),
      ],
      false,
    );

    const { rerender } = render(<ChatView pane={pane} realtime={realtimeTick(1)} />);
    await screen.findByText("第二段");
    const before = messageIds();
    const turnNode = document.querySelector('[data-message-id^="turn:"]');
    // The turn is keyed by its first message, never by its newest one.
    expect(before).toContain("turn:a1");

    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "第一段" }]),
        assistantMessage("a2", [{ type: "text", text: "第二段" }]),
        assistantMessage("a3", [{ type: "text", text: "第三段" }]),
      ],
      false,
    );
    rerender(<ChatView pane={pane} realtime={realtimeTick(2)} />);
    await screen.findByText("第三段");

    // Appending a message must not change any id, so React never remounts the
    // turn subtree (which is what made the UI flicker and collapse groups).
    expect(messageIds()).toEqual(before);
    expect(document.querySelector('[data-message-id^="turn:"]')).toBe(turnNode);
  });
});

describe("ChatView compaction dividers", () => {
  beforeEach(() => {
    resetPanelOpenStores();
    stubChat([], false);
  });

  afterEach(() => {
    resetPanelOpenStores();
  });

  it("breaks a turn into two Worked for groups around a compaction divider", async () => {
    // 8986 characters, the size seen in real sessions (6.8k-9k).
    const summary = "摘要".repeat(4_493);
    const dividerMessage: ChatMessage = {
      // The reader emits the divider as its own assistant message, anchored to
      // the timestamp of the message it precedes.
      id: "divider:c1",
      role: "assistant",
      createdAt: TURN_STARTED_AT,
      content: [dividerPart({ summary, tokensBefore: 111_867 })],
    };
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "先看代码", durationMs: 12_000 },
          { type: "text", text: "看完了" },
        ]),
        dividerMessage,
        assistantMessage("a2", [
          { type: "reasoning", text: "继续做", durationMs: 8_000 },
          { type: "text", text: "done" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("done");

    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(2));
    const renderedOrder = Array.from(
      document.querySelectorAll(".work-group, .chat-divider"),
    ).map((element) =>
      element.classList.contains("chat-divider") ? "divider" : "group",
    );
    expect(renderedOrder).toEqual(["group", "divider", "group"]);
    for (const group of document.querySelectorAll(".work-group")) {
      expect(cell(group as HTMLElement, ".activity-verb")).toMatch(/^Worked for /);
    }
    // The divider is a boundary, not a work row: it never lands inside a group,
    // and the work rows really are split by it.
    expect(document.querySelector(".work-group .chat-divider")).toBeNull();
    const groups = Array.from(document.querySelectorAll(".work-group"));
    expect(groups[0]?.textContent).toContain("先看代码");
    expect(groups[0]?.textContent).not.toContain("继续做");
    expect(groups[1]?.textContent).toContain("继续做");
    expect(groups[1]?.textContent).not.toContain("先看代码");

    const divider = document.querySelector(".chat-divider") as HTMLDetailsElement;
    expect(cell(divider, ".divider-label")).toBe(
      "上下文已压缩 · 压缩前 111,867 tokens · 摘要 8.9k 字",
    );
    // The summary and the file lists stay folded: a real summary is 7-9k chars.
    expect(divider.open).toBe(false);
    expect(divider.querySelector(".divider-detail")).toBeTruthy();
  });

  it("renders no divider and a single group when nothing was compacted", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "先看代码", durationMs: 12_000 },
          { type: "text", text: "看完了" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("看完了");

    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(1));
    expect(document.querySelector(".chat-divider")).toBeNull();
  });

  it("shows the summary and the file counts once the divider is expanded", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "先看代码", durationMs: 12_000 },
          { type: "text", text: "看完了" },
        ]),
        {
          id: "divider:c1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [
            dividerPart({
              summary: "早前的工作被压缩。",
              tokensBefore: 396_805,
              modifiedFiles: ["src/a.ts", "src/b.ts"],
              readFiles: ["src/c.ts"],
              at: TURN_STARTED_AT + 60_000,
            }),
          ],
        },
        assistantMessage("a2", [{ type: "text", text: "done" }]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("done");

    const divider = await waitFor(() => {
      const element = document.querySelector(".chat-divider");
      if (!element) throw new Error("the compaction divider was not rendered");
      return element as HTMLDetailsElement;
    });
    expect(divider.open).toBe(false);
    // jsdom never toggles <details> itself, so drive the handler the browser fires.
    divider.open = true;
    fireEvent(divider, new Event("toggle"));

    expect(screen.getByText(/早前的工作被压缩/)).toBeTruthy();
    expect(cell(divider, ".divider-files")).toContain("涉及文件 2");
    expect(cell(divider, ".divider-files")).toContain("src/a.ts");
    expect(cell(divider, ".divider-files")).toContain("已读文件 1");
    expect(cell(divider, ".divider-files")).toContain("src/c.ts");
    // The real compaction time is kept, even though the marker sits earlier.
    expect(cell(divider, ".divider-time")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("keeps the expanded divider across the 1.5s poll refresh", async () => {
    const messages: ChatMessage[] = [
      userMessage(),
      assistantMessage("a1", [{ type: "text", text: "before" }]),
      {
        id: "divider:c1",
        role: "assistant",
        createdAt: TURN_STARTED_AT,
        content: [dividerPart({ summary: "摘要内容", at: TURN_STARTED_AT + 1_000 })],
      },
      assistantMessage("a2", [{ type: "text", text: "after" }]),
    ];
    stubChat(messages, false);

    const { rerender } = render(<ChatView pane={pane} realtime={realtimeTick(1)} />);
    await screen.findByText("after");
    const divider = document.querySelector(".chat-divider") as HTMLDetailsElement;
    divider.open = true;
    fireEvent(divider, new Event("toggle"));
    expect(divider.open).toBe(true);

    // A new poll returns new message objects; the expansion state lives outside
    // React and is keyed by the divider's own timestamp.
    stubChat(messages, false);
    rerender(<ChatView pane={pane} realtime={realtimeTick(2)} />);
    await waitFor(() =>
      expect((document.querySelector(".chat-divider") as HTMLDetailsElement).open).toBe(
        true,
      ),
    );
  });

  it("renders a trailing divider without inventing an extra group", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "done" }]),
        {
          id: "divider:c9",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "末尾压缩", at: 0 })],
        },
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("done");

    await waitFor(() => expect(document.querySelectorAll(".worked-row")).toHaveLength(1));
    // The text-only turn keeps its `Worked for` row (rendered inline because it
    // has no work rows) and the trailing marker comes after it.
    expect(screen.getByText(/Worked for /)).toBeTruthy();
    const renderedOrder = Array.from(
      document.querySelectorAll(".work-group, .worked-row, .chat-divider"),
    ).map((element) =>
      element.classList.contains("chat-divider") ? "divider" : "group",
    );
    expect(renderedOrder).toEqual(["group", "divider"]);
  });

  it("labels a branch summary as such and never invents token numbers", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "before" }]),
        {
          id: "divider:b1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [
            dividerPart({
              kind: "branch-summary",
              summary: "分支摘要内容",
              at: TURN_STARTED_AT + 30_000,
            }),
          ],
        },
        assistantMessage("a2", [{ type: "text", text: "after" }]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("after");

    const divider = document.querySelector(".chat-divider") as HTMLElement;
    expect(cell(divider, ".divider-label")).toBe("分支摘要 · 摘要 6 字");
    expect(cell(divider, ".divider-label")).not.toContain("压缩前");
  });

  it("renders a bare marker when the transcript carries no summary or files", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "text", text: "before" }]),
        {
          id: "divider:c2",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "", at: 0 })],
        },
        assistantMessage("a2", [{ type: "text", text: "after" }]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("after");

    const divider = document.querySelector(".chat-divider") as HTMLElement;
    expect(divider.tagName).toBe("DIV");
    // No timestamp either: only what the transcript actually provided.
    expect(cell(divider, ".divider-label")).toBe("上下文已压缩");
    expect(cell(divider, ".divider-time")).toBeNull();
  });
});

describe("ChatView todo bar", () => {
  beforeEach(() => {
    resetPanelOpenStores();
    stubChat([], false);
  });

  afterEach(() => {
    resetPanelOpenStores();
  });

  const todos = {
    nextId: 6,
    updatedAt: TURN_STARTED_AT,
    tasks: [
      { id: 1, subject: "第一个任务", status: "in_progress", activeForm: "正在写测试" },
      { id: 2, subject: "第二个任务", status: "pending", blockedBy: [1] },
      { id: 3, subject: "第三个任务", status: "pending", blockedBy: [5] },
      { id: 4, subject: "已经完成的任务", status: "completed" },
      { id: 5, subject: "被删除的任务", status: "deleted" },
    ],
  };

  it("shows non-zero counts above the composer and groups the tasks when expanded", async () => {
    stubChat([userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])], false, todos);

    const { rerender } = render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    const bar = await waitFor(() => {
      const element = document.querySelector(".chat-todo-bar");
      if (!element) throw new Error("the todo bar was not rendered");
      return element as HTMLDetailsElement;
    });
    expect(bar.open).toBe(false);
    expect(cell(bar, ".todo-counts")).toBe("待办 2 · 进行中 1 · 完成 1");

    const composer = document.querySelector(".chat-composer") as HTMLElement;
    expect(
      bar.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    bar.open = true;
    fireEvent(bar, new Event("toggle"));

    // in_progress comes first and prefers activeForm; pending shows the subject.
    expect(document.querySelector(".todo-group")?.classList.contains("in_progress")).toBe(
      true,
    );
    expect(screen.getByText("正在写测试")).toBeTruthy();
    expect(screen.queryByText("第一个任务")).toBeNull();
    expect(screen.getByText("第二个任务")).toBeTruthy();
    expect(screen.getByText("已经完成的任务")).toBeTruthy();
    // Tombstones never show up, even expanded.
    expect(screen.queryByText("被删除的任务")).toBeNull();
    expect(bar.textContent).not.toContain("被删除的任务");
    // A dependency that is still open is reported as a blocker; a dependency
    // that only exists as a tombstone cannot block anything.
    expect(screen.getByText(/被阻塞：依赖 #1（未完成）/)).toBeTruthy();
    expect(screen.getByText(/依赖 #5（未知）/)).toBeTruthy();

    // The bar keeps its expansion state across the 1.5s poll refresh.
    stubChat(
      [userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])],
      false,
      todos,
    );
    rerender(<ChatView pane={pane} realtime={realtimeTick(1)} />);
    await waitFor(() =>
      expect((document.querySelector(".chat-todo-bar") as HTMLDetailsElement).open).toBe(
        true,
      ),
    );
    expect(screen.getByText("正在写测试")).toBeTruthy();
  });

  it("renders nothing without a todo snapshot or with an empty one", async () => {
    stubChat([userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])], false);
    const { rerender } = render(<ChatView pane={pane} />);
    await screen.findByText("hi");
    expect(document.querySelector(".chat-todo-bar")).toBeNull();

    stubChat(
      [userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])],
      false,
      { nextId: 1, updatedAt: 0, tasks: [] },
    );
    rerender(<ChatView pane={pane} realtime={realtimeTick(1)} />);
    await waitFor(() => expect(document.querySelector(".chat-todo-bar")).toBeNull());
  });

  it("renders nothing for a degraded snapshot that only kept its nextId", async () => {
    stubChat(
      [userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])],
      false,
      { nextId: 4001, updatedAt: TURN_STARTED_AT, tasks: [], truncated: true },
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    expect(document.querySelector(".chat-todo-bar")).toBeNull();
  });

  it("renders nothing when every task is a tombstone", async () => {
    stubChat([userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])], false, {
      nextId: 3,
      updatedAt: TURN_STARTED_AT,
      tasks: [
        { id: 1, subject: "删掉一", status: "deleted" },
        { id: 2, subject: "删掉二", status: "deleted" },
      ],
    });

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    // No live task means no bar at all: the tombstones must not leave an empty
    // container (or a zero count line) behind.
    expect(document.querySelector(".chat-todo-bar")).toBeNull();
    expect(document.body.textContent).not.toContain("删掉");
  });

  it("keeps an unknown status visible as pending work", async () => {
    stubChat([userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])], false, {
      nextId: 4,
      updatedAt: TURN_STARTED_AT,
      tasks: [
        { id: 1, subject: "未来状态的任务", status: "paused" },
        { id: 3, subject: "依赖快照外任务", status: "pending", blockedBy: [99] },
      ],
    });

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    const bar = document.querySelector(".chat-todo-bar") as HTMLDetailsElement;
    // An unknown status is not guessed into a known group silently: it counts
    // as pending work, which is where it is shown.
    expect(cell(bar, ".todo-counts")).toBe("待办 2");
    bar.open = true;
    fireEvent(bar, new Event("toggle"));
    expect(screen.getByText("未来状态的任务")).toBeTruthy();
    // A dependency outside the snapshot cannot be judged, so it neither blocks
    // nor counts as completed.
    expect(screen.getByText(/依赖 #99（未知）/)).toBeTruthy();
    expect(bar.textContent).not.toContain("被阻塞");
  });

  it("renders a snapshot that carries no nextId", async () => {
    // `nextId` is never rendered, so a snapshot without it must behave like any
    // other one (review finding F2).
    stubChat([userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])], false, {
      updatedAt: TURN_STARTED_AT,
      tasks: [
        { id: 1, subject: "第一个任务", status: "in_progress", activeForm: "正在写测试" },
        { id: 2, subject: "第二个任务", status: "pending" },
      ],
    });

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    const bar = await waitFor(() => {
      const element = document.querySelector(".chat-todo-bar");
      if (!element) throw new Error("the todo bar was not rendered");
      return element as HTMLDetailsElement;
    });
    expect(cell(bar, ".todo-counts")).toBe("待办 1 · 进行中 1");

    bar.open = true;
    fireEvent(bar, new Event("toggle"));
    expect(screen.getByText("正在写测试")).toBeTruthy();
    expect(screen.getByText("第二个任务")).toBeTruthy();
  });

  it("adds no bar or spacing for a pane that is not a Pi session", async () => {
    const codePane: PaneSummary = { ...pane, id: "pane-3", agent: "codex" };
    stubChat([userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])], false);

    const { container, rerender } = render(<ChatView pane={codePane} />);
    await screen.findByText("hi");

    expect(document.querySelector(".chat-todo-bar")).toBeNull();
    const composer = document.querySelector(".chat-composer");
    expect(composer).toBeTruthy();
    // The composer is still the direct sibling of the footer controls: no empty
    // container was inserted between them.
    expect(composer?.previousElementSibling?.classList.contains("chat-todo-bar")).toBe(
      false,
    );

    rerender(<ChatView pane={pane} />);
    await screen.findByText("hi");
    expect(container.querySelector(".chat-todo-bar")).toBeNull();
  });
});

describe("ChatView degraded snapshots", () => {
  beforeEach(() => {
    resetPanelOpenStores();
    stubChat([], false);
  });

  afterEach(() => {
    resetPanelOpenStores();
  });

  it("leaves no placeholder when there is no todo snapshot and no divider", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [
          { type: "reasoning", text: "看代码" },
          toolPart("call-1", "bash", { command: "npm test" }, { result: "ok" }),
          { type: "text", text: "hi" },
        ]),
      ],
      false,
    );

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    // Nothing in the transcript is missing here, so no degraded affordance may
    // show up: one group, no rule, no bar, no empty list container.
    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(1));
    expect(document.querySelector(".chat-divider")).toBeNull();
    expect(document.querySelector(".chat-todo-bar")).toBeNull();
    expect(document.querySelector(".todo-list")).toBeNull();
    expect(document.querySelector(".divider-detail")).toBeNull();
    expect(document.body.textContent).not.toContain("待办");
  });

  it("still renders the divider when the todo snapshot was degraded", async () => {
    stubChat(
      [
        userMessage(),
        assistantMessage("a1", [{ type: "reasoning", text: "第一段" }]),
        {
          id: "divider:c1",
          role: "assistant",
          createdAt: TURN_STARTED_AT,
          content: [dividerPart({ summary: "压缩", at: TURN_STARTED_AT })],
        },
        assistantMessage("a2", [{ type: "reasoning", text: "第二段" }]),
      ],
      false,
      { nextId: 900, updatedAt: TURN_STARTED_AT, tasks: [], truncated: true },
    );

    render(<ChatView pane={pane} />);

    await waitFor(() => expect(document.querySelectorAll(".work-group")).toHaveLength(2));
    // The two degradations are independent: the divider still shows while the
    // over-budget todo snapshot renders nothing at all.
    expect(document.querySelectorAll(".chat-divider")).toHaveLength(1);
    expect(document.querySelector(".chat-todo-bar")).toBeNull();
    expect(landmarks()).toEqual(["group", "divider", "group"]);
  });
});

describe("ChatView footer reservation", () => {
  beforeEach(() => {
    resetPanelOpenStores();
    stubChat([], false);
  });

  afterEach(() => {
    resetPanelOpenStores();
  });

  /** One live task, no `nextId`: enough to render the bar. */
  function todoSnapshot() {
    return {
      updatedAt: TURN_STARTED_AT,
      tasks: [{ id: 1, subject: "第一个任务", status: "pending" }],
    };
  }

  function footerInsetVar(): string {
    const viewport = document.querySelector(".chat-viewport") as HTMLElement;
    return viewport.style.getPropertyValue("--chat-footer-inset");
  }

  /** jsdom lays nothing out, so both rects and heights are stubbed by hand. */
  function stubRect(element: HTMLElement, top: number, bottom: number): void {
    Object.defineProperty(element, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          top,
          bottom,
          height: bottom - top,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect,
    });
  }

  function chatMessages(): ChatMessage[] {
    return [userMessage(), assistantMessage("a1", [{ type: "text", text: "hi" }])];
  }

  /**
   * jsdom never runs a ResizeObserver, so the tests drive the observer by hand.
   * Only callbacks registered for the footer are collected; assistant-ui registers
   * one for the same element, and both callbacks only re-read it.
   */
  function stubResizeObserver(): Array<() => void> {
    const footerCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          if (target.classList.contains("chat-footer")) {
            footerCallbacks.push(() =>
              this.callback([], this as unknown as ResizeObserver),
            );
          }
        }
        unobserve() {}
        disconnect() {}
      },
    );
    return footerCallbacks;
  }

  it("follows the space the fixed footer covers", async () => {
    const footerCallbacks = stubResizeObserver();
    stubChat(chatMessages(), false, todoSnapshot());

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    const viewport = document.querySelector(".chat-viewport") as HTMLElement;
    const footer = document.querySelector(".chat-footer") as HTMLElement;
    expect(footerCallbacks.length).toBeGreaterThan(0);
    // Nothing has been laid out, so the conservative reservation has to hold.
    expect(footerInsetVar()).toBe("496px");

    // A collapsed footer: its top edge is 480px above the pane's bottom edge…
    Object.defineProperty(footer, "offsetHeight", { value: 421, configurable: true });
    stubRect(viewport, 100, 900);
    stubRect(footer, 420, 841);
    for (const notify of footerCallbacks) notify();
    expect(footerInsetVar()).toBe("480px");

    // …and an expanded todo bar moves that edge up, which the reservation has to
    // follow; that is what kept the end of the transcript reachable.
    stubRect(footer, 300, 721);
    for (const notify of footerCallbacks) notify();
    expect(footerInsetVar()).toBe("600px");
  });

  it("never reserves less than the previous constant", async () => {
    const footerCallbacks = stubResizeObserver();
    stubChat(chatMessages(), false);

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    const viewport = document.querySelector(".chat-viewport") as HTMLElement;
    const footer = document.querySelector(".chat-footer") as HTMLElement;
    // A footer that barely reaches over the pane's bottom edge must not shrink
    // the reservation below what already shipped.
    Object.defineProperty(footer, "offsetHeight", { value: 120, configurable: true });
    stubRect(viewport, 100, 900);
    stubRect(footer, 880, 1000);
    for (const notify of footerCallbacks) notify();
    expect(footerInsetVar()).toBe("176px");
  });

  it("reserves the conservative height while the footer reports no layout", async () => {
    // jsdom reports every element as 0px tall, which is what an unmeasured or
    // hidden footer looks like in a real browser too. A live observer may still
    // correct the value later, so the reservation has to be conservative until
    // it does: otherwise expanding the bar would hide transcript content.
    const footerCallbacks = stubResizeObserver();
    stubChat(chatMessages(), false, todoSnapshot());

    render(<ChatView pane={pane} />);
    await screen.findByText("hi");

    expect(footerCallbacks.length).toBeGreaterThan(0);
    const reserved = Number.parseInt(footerInsetVar(), 10);
    // Base footer plus at least the list `max-height` the bar can reach.
    expect(reserved).toBeGreaterThanOrEqual(176 + 260);
    // Still just the bar: the interaction itself is unchanged.
    const bar = document.querySelector(".chat-todo-bar") as HTMLDetailsElement;
    expect(bar.open).toBe(false);
  });

  it("keeps the base reservation when the todo bar renders nothing", async () => {
    stubChat(chatMessages(), false, {
      updatedAt: TURN_STARTED_AT,
      tasks: [{ id: 1, subject: "被删除的任务", status: "deleted" }],
    });

    const { rerender } = render(<ChatView pane={pane} realtime={realtimeTick(1)} />);
    await screen.findByText("hi");

    expect(document.querySelector(".chat-todo-bar")).toBeNull();
    // No bar means nothing taller to reserve.
    expect(footerInsetVar()).toBe("176px");

    // The same holds when the session never used `todo` at all.
    stubChat(chatMessages(), false);
    rerender(<ChatView pane={pane} realtime={realtimeTick(2)} />);
    await screen.findByText("hi");
    expect(footerInsetVar()).toBe("176px");
  });

  it("keeps the stylesheet wired to the footer inset variable", () => {
    // jsdom does not resolve `var()` in the cascade, so the contract between
    // this component and the layout is asserted on the rule itself: without the
    // `padding-bottom` below, the variable above would change nothing.
    const source = readFileSync(
      path.join(process.cwd(), "src/web/styles.css"),
      "utf8",
    );
    const viewportRules = Array.from(
      source.matchAll(/^\.chat-viewport \{([^}]*)\}/gm),
      (match) => match[1] ?? "",
    );
    expect(viewportRules.join("\n")).toContain(
      "padding-bottom: var(--chat-footer-inset, 176px)",
    );
  });
});
