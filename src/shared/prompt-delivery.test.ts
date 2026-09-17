import { describe, expect, it } from "vitest";

import {
  parsePromptDeliveryEvent,
  isPromptCorrelationId,
} from "./prompt-delivery.js";

const now = 1_760_000_000_000;

describe("parsePromptDeliveryEvent", () => {
  it("keeps only allowlisted fields and bounds the values", () => {
    const event = parsePromptDeliveryEvent(
      {
        requestId: "request-1",
        paneId: "w1:p1",
        phase: "client.response",
        at: now + 5_000,
        attempt: 2,
        transport: "pi-native",
        status: "queued",
        httpStatus: 200,
        errorCode: "http-502",
        errorClass: "TypeError",
        latencyMs: 1_234.6,
        queueStatus: "queued",
        commandId: "8f3c1a2b-0000-4000-8000-000000000000",
      },
      { source: "client", now },
    );

    expect(event).toEqual({
      requestId: "request-1",
      paneId: "w1:p1",
      source: "client",
      phase: "client.response",
      at: now + 5_000,
      attempt: 2,
      transport: "pi-native",
      status: "queued",
      httpStatus: 200,
      errorCode: "http-502",
      errorClass: "TypeError",
      latencyMs: 1_235,
      queueStatus: "queued",
      commandId: "8f3c1a2b-0000-4000-8000-000000000000",
    });
  });

  it("never carries prompt content, image data, tokens or session paths", () => {
    const event = parsePromptDeliveryEvent(
      {
        requestId: "request-1",
        paneId: "w1:p1",
        phase: "client.submit",
        at: now,
        text: "SECRET-PROMPT",
        images: ["data:image/png;base64,SECRET"],
        token: "SECRET-TOKEN",
        sessionPath: "/Users/someone/.pi/sessions/private.jsonl",
        error: "model echoed SECRET-PROMPT",
      },
      { source: "client", now },
    );

    expect(event).not.toBeNull();
    expect(Object.keys(event ?? {}).sort()).toEqual([
      "at",
      "paneId",
      "phase",
      "requestId",
      "source",
    ]);
    expect(JSON.stringify(event)).not.toContain("SECRET");
    expect(JSON.stringify(event)).not.toContain("private.jsonl");
  });

  it("rejects misattributed phases and malformed correlation ids", () => {
    const base = { requestId: "request-1", paneId: "w1:p1", at: now };
    expect(
      parsePromptDeliveryEvent({ ...base, phase: "queue.dispatched" }, { source: "client", now }),
    ).toBeNull();
    expect(
      parsePromptDeliveryEvent({ ...base, phase: "client.submit" }, { source: "server", now }),
    ).toBeNull();
    expect(
      parsePromptDeliveryEvent(
        { ...base, phase: "client.submit", requestId: "bad id with spaces" },
        { source: "client", now },
      ),
    ).toBeNull();
    expect(
      parsePromptDeliveryEvent(
        { ...base, phase: "client.submit", paneId: "../../etc/passwd" },
        { source: "client", now },
      ),
    ).toBeNull();
    expect(
      parsePromptDeliveryEvent(
        { phase: "client.submit", paneId: "w1:p1", at: now },
        { source: "client", now },
      ),
    ).toBeNull();
  });

  it("clamps client clocks instead of trusting them", () => {
    const base = { requestId: "request-1", paneId: "w1:p1", phase: "client.submit" };
    expect(parsePromptDeliveryEvent({ ...base, at: now + 600_000 }, { source: "client", now })?.at).toBe(now);
    expect(parsePromptDeliveryEvent({ ...base, at: now - 600_000_000 }, { source: "client", now })?.at).toBe(now);
    expect(parsePromptDeliveryEvent({ ...base, at: "yesterday" }, { source: "client", now })?.at).toBe(now);
    expect(parsePromptDeliveryEvent(base, { source: "client", now })?.at).toBe(now);
  });

  it("drops out-of-range optional values but keeps the event", () => {
    const event = parsePromptDeliveryEvent(
      {
        requestId: "request-1",
        paneId: "w1:p1",
        phase: "client.error",
        at: now,
        attempt: 0,
        httpStatus: 999,
        latencyMs: -5,
        status: "not-a-status",
        transport: "carrier-pigeon",
      },
      { source: "client", now },
    );

    expect(event).toEqual({
      requestId: "request-1",
      paneId: "w1:p1",
      source: "client",
      phase: "client.error",
      at: now,
    });
  });

  it("recognizes usable correlation ids", () => {
    expect(isPromptCorrelationId("8f3c1a2b-0000-4000-8000-000000000000")).toBe(true);
    expect(isPromptCorrelationId("w1:p2")).toBe(true);
    expect(isPromptCorrelationId("")).toBe(false);
    expect(isPromptCorrelationId("-leading-dash")).toBe(false);
    expect(isPromptCorrelationId("a".repeat(129))).toBe(false);
    expect(isPromptCorrelationId(42)).toBe(false);
  });
});
