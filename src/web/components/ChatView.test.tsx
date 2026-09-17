// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaneSummary, PromptDeliveryEvent } from "../../shared/protocol";
import { apiFetch } from "../api";
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
