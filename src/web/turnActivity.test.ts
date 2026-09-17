import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatPart } from "../shared/protocol";
import {
  createTurnActivityTracker,
  latestAssistantTurn,
  type TurnActivitySignals,
} from "./turnActivity";

const T0 = Date.parse("2026-09-15T00:00:00.000Z");

function userMessage(id: string): ChatMessage {
  return { id, role: "user", createdAt: T0, content: [{ type: "text", text: "hi" }] };
}

function assistantMessage(
  id: string,
  status: ChatMessage["status"] = { type: "complete", reason: "stop" },
  content: ChatPart[] = [{ type: "text", text: id }],
): ChatMessage {
  return { id, role: "assistant", createdAt: T0 + 1, content, status };
}

function signals(overrides: Partial<TurnActivitySignals> = {}): TurnActivitySignals {
  return {
    latestTurn: { id: "a1", hasRunningMessage: false },
    sessionKey: "pane-1:runtime-1",
    chatRunning: false,
    realtimeStatus: "idle",
    paneStatus: "idle",
    ...overrides,
  };
}

describe("latestAssistantTurn", () => {
  it("takes the trailing assistant run and reports its running messages", () => {
    expect(
      latestAssistantTurn([
        userMessage("u1"),
        assistantMessage("a1"),
        assistantMessage("a2", { type: "running" }),
      ]),
    ).toEqual({ id: "a1", hasRunningMessage: true });
  });

  it("treats a turn followed by a user message as history, not the latest turn", () => {
    expect(
      latestAssistantTurn([userMessage("u1"), assistantMessage("a1"), userMessage("u2")]),
    ).toBeNull();
  });

  it("returns null when there is no assistant output at all", () => {
    expect(latestAssistantTurn([])).toBeNull();
    expect(latestAssistantTurn([userMessage("u1")])).toBeNull();
  });
});

describe("createTurnActivityTracker", () => {
  it("folds a turn that was never observed running", () => {
    const tracker = createTurnActivityTracker();
    expect(tracker.observe(signals())).toEqual({ running: false, settled: false });
    expect(tracker.sawRunning).toBe(false);
  });

  it("keeps the latest turn running while the pane is blocked", () => {
    const tracker = createTurnActivityTracker();
    // The agent is waiting for the user: realtime is idle, the polled snapshot
    // is already false and no message is marked running.
    const observation = tracker.observe(
      signals({ chatRunning: false, realtimeStatus: "idle", paneStatus: "blocked" }),
    );
    expect(observation).toEqual({ running: true, settled: false });
  });

  it("keeps the turn running while any other source still reports activity", () => {
    const tracker = createTurnActivityTracker();
    expect(tracker.observe(signals({ realtimeStatus: "working" })).running).toBe(true);
    // Bridge lost the status (reset to idle) but the polled snapshot is current.
    expect(
      tracker.observe(signals({ realtimeStatus: "idle", chatRunning: true })).running,
    ).toBe(true);
    // A running message alone is enough as well.
    expect(
      tracker.observe(
        signals({ latestTurn: { id: "a1", hasRunningMessage: true } }),
      ).running,
    ).toBe(true);
  });

  it("releases the sticky marker once every source agrees the turn is over", () => {
    const tracker = createTurnActivityTracker();
    expect(tracker.observe(signals({ realtimeStatus: "working" })).running).toBe(true);
    expect(tracker.observe(signals({ realtimeStatus: "idle" }))).toEqual({
      running: false,
      settled: true,
    });
    // Repeated identical observations are idempotent (React StrictMode).
    expect(tracker.observe(signals({ realtimeStatus: "idle" }))).toEqual({
      running: false,
      settled: true,
    });
    expect(tracker.sawRunning).toBe(true);
  });

  it("does not release while the pane is only blocked", () => {
    const tracker = createTurnActivityTracker();
    tracker.observe(signals({ realtimeStatus: "working" }));
    expect(
      tracker.observe(signals({ realtimeStatus: "idle", paneStatus: "blocked" })),
    ).toEqual({ running: true, settled: false });
  });

  it("clears the marker when the session changes", () => {
    const tracker = createTurnActivityTracker();
    tracker.observe(signals({ realtimeStatus: "working" }));
    expect(
      tracker.observe(signals({ sessionKey: "pane-1:runtime-2", realtimeStatus: "idle" })),
    ).toEqual({ running: false, settled: false });
    expect(tracker.sawRunning).toBe(false);
  });

  it("clears the marker when a new turn starts", () => {
    const tracker = createTurnActivityTracker();
    tracker.observe(signals({ realtimeStatus: "working" }));
    expect(
      tracker.observe(
        signals({ latestTurn: { id: "a2", hasRunningMessage: false } }),
      ),
    ).toEqual({ running: false, settled: false });
  });

  it("never reports a running turn when the thread ends with a user message", () => {
    const tracker = createTurnActivityTracker();
    expect(tracker.observe(signals({ latestTurn: null, chatRunning: true }))).toEqual({
      running: false,
      settled: false,
    });
  });
});
