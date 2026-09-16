import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PromptDeliveryEvent } from "../shared/protocol.js";
import { PromptDeliveryTrace } from "./prompt-delivery-trace.js";

async function tempTracePath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "herzi-trace-test-"));
  return path.join(directory, "prompt-delivery.jsonl");
}

function serverEvent(overrides: Partial<PromptDeliveryEvent> = {}): PromptDeliveryEvent {
  return {
    requestId: "request-1",
    paneId: "w1:p1",
    source: "server",
    phase: "server.received",
    at: Date.now(),
    ...overrides,
  };
}

describe("PromptDeliveryTrace", () => {
  it("keeps a bounded global ring and assigns increasing sequence numbers", async () => {
    const trace = new PromptDeliveryTrace({
      filePath: await tempTracePath(),
      maxEvents: 3,
    });

    for (let index = 0; index < 5; index += 1) {
      trace.record(serverEvent({ requestId: `request-${index}` }));
    }

    const events = trace.query();
    expect(events.map((event) => event.requestId)).toEqual([
      "request-2",
      "request-3",
      "request-4",
    ]);
    expect(events.map((event) => event.seq)).toEqual([3, 4, 5]);
    await trace.flush();
    trace.stop();
  });

  it("bounds and orders events per request id", async () => {
    const trace = new PromptDeliveryTrace({
      filePath: await tempTracePath(),
      maxEventsPerRequest: 2,
    });

    trace.record(serverEvent({ phase: "server.received" }));
    trace.record(serverEvent({ phase: "server.validated" }));
    trace.record(serverEvent({ phase: "server.submitted" }));
    trace.record(serverEvent({ requestId: "request-2", phase: "server.received" }));

    expect(trace.query({ requestId: "request-1" }).map((event) => event.phase)).toEqual([
      "server.validated",
      "server.submitted",
    ]);
    expect(trace.query({ requestId: "missing" })).toEqual([]);
    await trace.flush();
    trace.stop();
  });

  it("forgets the least recently used request ids", async () => {
    const trace = new PromptDeliveryTrace({
      filePath: await tempTracePath(),
      maxRequests: 1,
    });

    trace.record(serverEvent({ requestId: "request-1" }));
    trace.record(serverEvent({ requestId: "request-2" }));

    expect(trace.query({ requestId: "request-1" })).toEqual([]);
    expect(trace.query({ requestId: "request-2" })).toHaveLength(1);
    await trace.flush();
    trace.stop();
  });

  it("drops prompt content and private fields instead of persisting them", async () => {
    const filePath = await tempTracePath();
    const trace = new PromptDeliveryTrace({ filePath });
    const secret = "SECRET-PROMPT-TEXT-42";

    const recorded = trace.record({
      ...serverEvent({ phase: "server.submitted", transport: "text" }),
      text: secret,
      sessionPath: "/Users/someone/.pi/sessions/private.jsonl",
      token: "token-value",
    } as unknown as PromptDeliveryEvent);

    expect(recorded).not.toBeNull();
    expect(recorded && "text" in recorded).toBe(false);
    expect(recorded && "sessionPath" in recorded).toBe(false);
    expect(recorded && "token" in recorded).toBe(false);

    await trace.flush();
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain('"phase":"server.submitted"');
    expect(contents).not.toContain(secret);
    expect(contents).not.toContain("private.jsonl");
    expect(contents).not.toContain("token-value");
    trace.stop();
  });

  it("rejects phases that do not belong to the reported source", async () => {
    const trace = new PromptDeliveryTrace({ filePath: await tempTracePath() });

    expect(
      trace.record({
        ...serverEvent(),
        source: "client",
        phase: "server.received",
      }),
    ).toBeNull();
    expect(trace.record(serverEvent({ phase: "queue.dispatched" }))).not.toBeNull();

    await trace.flush();
    trace.stop();
  });

  it("rotates the JSONL file so it cannot grow unbounded", async () => {
    const filePath = await tempTracePath();
    const trace = new PromptDeliveryTrace({ filePath, maxFileBytes: 300 });

    for (let index = 0; index < 30; index += 1) {
      trace.record(serverEvent({ requestId: `request-${index}` }));
    }
    await trace.flush();

    expect((await stat(filePath)).size).toBeLessThanOrEqual(300);
    expect((await stat(`${filePath}.1`)).size).toBeLessThanOrEqual(300);
    trace.stop();
  });

  it("rotates an oversized pre-existing file on startup", async () => {
    const filePath = await tempTracePath();
    await writeFile(filePath, "x".repeat(500), "utf8");

    const trace = new PromptDeliveryTrace({ filePath, maxFileBytes: 100 });
    trace.record(serverEvent());
    await trace.flush();

    expect((await stat(`${filePath}.1`)).size).toBe(500);
    expect((await stat(filePath)).size).toBeLessThan(500);
    trace.stop();
  });

  it("notifies subscribers and survives listener failures", async () => {
    const trace = new PromptDeliveryTrace({ filePath: await tempTracePath() });
    const seen: string[] = [];
    const unsubscribe = trace.subscribe((event) => {
      seen.push(event.phase);
      throw new Error("listener exploded");
    });
    trace.subscribe((event) => seen.push(`second:${event.phase}`));

    expect(trace.record(serverEvent())).not.toBeNull();
    unsubscribe();
    trace.record(serverEvent({ phase: "server.validated" }));

    expect(seen).toEqual([
      "server.received",
      "second:server.received",
      "second:server.validated",
    ]);
    await trace.flush();
    trace.stop();
  });

  it("records nothing after stop and never throws on write failures", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "herzi-trace-test-"));
    // A directory path used as a file makes every append fail.
    const trace = new PromptDeliveryTrace({ filePath: directory });

    expect(trace.record(serverEvent())).not.toBeNull();
    await trace.flush();
    expect(trace.lastWriteError).toBeInstanceOf(Error);

    trace.stop();
    expect(trace.record(serverEvent())).toBeNull();
  });
});
