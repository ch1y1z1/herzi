// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "./api";
import {
  createPromptDeliveryTrace,
  flushPromptDeliveryTrace,
  recentPromptDeliveryEvents,
  recordClientPromptDeliveryEvent,
  resetPromptDeliveryTrace,
} from "./promptDeliveryTrace";

vi.mock("./api", () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

afterEach(() => {
  mockedApiFetch.mockReset();
  resetPromptDeliveryTrace();
});

function okResponse(accepted: number): Response {
  return new Response(JSON.stringify({ ok: true, accepted }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function postedEvents(callIndex = 0): unknown[] {
  const init = mockedApiFetch.mock.calls[callIndex]?.[1];
  const body = JSON.parse(String(init?.body ?? "{}")) as { events?: unknown[] };
  return body.events ?? [];
}

describe("prompt delivery client trace", () => {
  it("batches client stage events and drops unknown fields", async () => {
    mockedApiFetch.mockResolvedValue(okResponse(3));
    const trace = createPromptDeliveryTrace({
      paneId: "pane-1",
      requestId: "request-1",
      attempt: 1,
    });

    trace.record("client.submit");
    trace.record("client.response", {
      httpStatus: 200,
      transport: "text",
      status: "submitted",
    });
    // Anything outside the allowlist (prompt text, image data, tokens) must be
    // discarded before the event is buffered or uploaded.
    recordClientPromptDeliveryEvent({
      requestId: "request-1",
      paneId: "pane-1",
      phase: "client.submit",
      text: "SECRET-PROMPT",
      token: "SECRET-TOKEN",
    } as never);

    const local = recentPromptDeliveryEvents();
    expect(local.map((event) => event.phase)).toEqual([
      "client.submit",
      "client.response",
      "client.submit",
    ]);
    expect(JSON.stringify(local)).not.toContain("SECRET");

    await flushPromptDeliveryTrace();

    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch.mock.calls[0]?.[0]).toBe("/api/prompt-delivery/events");
    const events = postedEvents();
    expect(events).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain("SECRET");
    expect(events[0]).toMatchObject({
      requestId: "request-1",
      paneId: "pane-1",
      source: "client",
      phase: "client.submit",
    });

    // A flushed batch is not sent twice.
    await flushPromptDeliveryTrace();
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds the buffered batch and the local ring", async () => {
    mockedApiFetch.mockResolvedValue(okResponse(20));
    const trace = createPromptDeliveryTrace({ paneId: "pane-1", requestId: "request-1" });

    for (let index = 0; index < 260; index += 1) {
      trace.record("client.submit", {
        errorClass: `stage-${index}`,
        ...(index % 2 ? { httpStatus: 200 } : {}),
      });
    }

    expect(recentPromptDeliveryEvents()).toHaveLength(200);
    expect(recentPromptDeliveryEvents()[0]?.errorClass).toBe("stage-60");

    await flushPromptDeliveryTrace();
    expect(postedEvents()).toHaveLength(20);

    let flushes = 0;
    while (flushes < 5 && mockedApiFetch.mock.calls.length > flushes) {
      const before = mockedApiFetch.mock.calls.length;
      await flushPromptDeliveryTrace();
      if (mockedApiFetch.mock.calls.length === before) break;
      flushes += 1;
    }
    // 260 recorded, 200 kept in the pending buffer, so 10 batches of 20 maximum.
    expect(mockedApiFetch.mock.calls.length).toBeLessThanOrEqual(10);
    for (let index = 0; index < mockedApiFetch.mock.calls.length; index += 1) {
      expect(postedEvents(index).length).toBeLessThanOrEqual(20);
    }
  });

  it("keeps events buffered when the server is unavailable", async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error("network down"));
    const trace = createPromptDeliveryTrace({ paneId: "pane-1", requestId: "request-1" });
    trace.record("client.submit");

    await expect(flushPromptDeliveryTrace()).resolves.toBeUndefined();

    mockedApiFetch.mockResolvedValue(okResponse(1));
    await flushPromptDeliveryTrace();
    expect(postedEvents(mockedApiFetch.mock.calls.length - 1)).toHaveLength(1);
  });
});
