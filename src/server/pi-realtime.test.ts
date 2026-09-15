import { describe, expect, it } from "vitest";

import { PiRealtimeStore, parsePiBridgeBatch } from "./pi-realtime.js";

describe("Pi realtime bridge v2", () => {
  it("accepts capability events and exposes them in the public state", () => {
    const batch = parsePiBridgeBatch({
      version: 2,
      paneId: "pane-1",
      sessionPath: "/session/a.jsonl",
      runtimeId: "runtime-1",
      sequence: 1,
      events: [
        {
          type: "capabilities",
          capabilities: {
            commands: true,
            imageInput: true,
            modelAcceptsImages: true,
          },
        },
      ],
    });
    expect(batch).not.toBeNull();

    const store = new PiRealtimeStore();
    const state = store.ingest(batch!);
    expect(state.capabilities).toEqual({
      commands: true,
      imageInput: true,
      modelAcceptsImages: true,
    });
    expect(store.getCapabilities("pane-1", "/session/a.jsonl")).toEqual(
      state.capabilities,
    );
  });

  it("continues to accept v1 event batches", () => {
    expect(
      parsePiBridgeBatch({
        version: 1,
        paneId: "pane-1",
        sessionPath: "/session/a.jsonl",
        runtimeId: "runtime-1",
        sequence: 1,
        events: [{ type: "status", status: "idle" }],
      }),
    ).not.toBeNull();
  });
});
