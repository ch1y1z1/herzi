import { describe, expect, it, vi } from "vitest";

import {
  PiCommandQueue,
  parseBridgeIdentity,
  queueLifecycleEvent,
  queueStatusToDeliveryStatus,
  type PiCommandLifecycleEvent,
} from "./pi-command-queue.js";

const identity = {
  paneId: "pane-1",
  sessionPath: "/session/a.jsonl",
  runtimeId: "runtime-1",
};
const image = {
  uploadId: "upload-1",
  name: "image.png",
  mimeType: "image/png",
  size: 12,
  sha256: "a".repeat(64),
};

describe("PiCommandQueue", () => {
  it("tracks fresh bridge presence and claims a command once", async () => {
    const queue = new PiCommandQueue();
    queue.touch(identity);
    expect(queue.isAvailable(identity.paneId, identity.sessionPath)).toBe(true);

    const created = queue.enqueue({
      paneId: identity.paneId,
      sessionPath: identity.sessionPath,
      requestId: "request-1",
      text: "review",
      images: [image],
    });
    expect(await queue.poll(identity)).toEqual(created);
    expect(queue.ownsClaim(identity, created.id)).toBe(true);
    expect(queue.ack(identity, created.id, "dispatched")).toBe(true);
    queue.stop();
  });

  it("releases an aborted long poll before a later command is enqueued", async () => {
    const queue = new PiCommandQueue();
    const controller = new AbortController();
    const abandoned = queue.poll(identity, controller.signal);
    controller.abort();
    expect(await abandoned).toBeNull();

    const command = queue.enqueue({
      paneId: identity.paneId,
      sessionPath: identity.sessionPath,
      requestId: "request-after-abort",
      text: "review",
      images: [image],
    });
    const nextIdentity = { ...identity, runtimeId: "runtime-2" };
    expect(await queue.poll(nextIdentity)).toEqual(command);
    expect(queue.ownsClaim(nextIdentity, command.id)).toBe(true);
    queue.stop();
  });

  it("deduplicates browser retries by request id", () => {
    const queue = new PiCommandQueue();
    const first = queue.enqueue({
      paneId: identity.paneId,
      sessionPath: identity.sessionPath,
      requestId: "request-1",
      text: "review",
      images: [image],
    });
    const second = queue.enqueue({
      paneId: identity.paneId,
      sessionPath: identity.sessionPath,
      requestId: "request-1",
      text: "changed retry body",
      images: [image],
    });
    expect(second.id).toBe(first.id);
    expect(second.text).toBe("review");
    queue.stop();
  });

  it("rejects malformed identities and cross-runtime acknowledgements", async () => {
    expect(parseBridgeIdentity({ paneId: "p" })).toBeNull();
    const queue = new PiCommandQueue();
    const command = queue.enqueue({
      paneId: identity.paneId,
      sessionPath: identity.sessionPath,
      requestId: "request-1",
      text: "review",
      images: [image],
    });
    await queue.poll(identity);
    expect(
      queue.ack({ ...identity, runtimeId: "runtime-2" }, command.id, "dispatched"),
    ).toBe(false);
    queue.stop();
  });
});

describe("PiCommandQueue lifecycle tracing", () => {
  it("reports enqueue, claim, dispatch and expiry without leaking the error text", async () => {
    const lifecycle: PiCommandLifecycleEvent[] = [];
    const queue = new PiCommandQueue((event) => lifecycle.push(event));
    queue.touch(identity);

    const command = queue.enqueue({
      paneId: identity.paneId,
      sessionPath: identity.sessionPath,
      requestId: "request-1",
      text: "review",
      images: [image],
    });
    expect(lifecycle.map((event) => event.phase)).toEqual(["queue.enqueued"]);
    expect(lifecycle[0].latencyMs).toBeGreaterThanOrEqual(0);

    await queue.poll(identity);
    expect(lifecycle.map((event) => event.phase)).toEqual([
      "queue.enqueued",
      "queue.claimed",
    ]);
    expect(lifecycle[1]).toMatchObject({
      requestId: "request-1",
      paneId: identity.paneId,
      commandId: command.id,
      queueStatus: "claimed",
    });

    queue.ack(identity, command.id, "dispatched");
    expect(lifecycle.at(-1)).toMatchObject({
      phase: "queue.dispatched",
      queueStatus: "dispatched",
    });
    queue.stop();
  });

  it("records a bridge failure as a stable code only", async () => {
    const lifecycle: PiCommandLifecycleEvent[] = [];
    const queue = new PiCommandQueue((event) => lifecycle.push(event));
    queue.touch(identity);
    const command = queue.enqueue({
      paneId: identity.paneId,
      sessionPath: identity.sessionPath,
      requestId: "request-1",
      text: "review",
      images: [image],
    });
    await queue.poll(identity);

    queue.ack(identity, command.id, "failed", "model said: SECRET PROMPT ECHO");

    const failed = lifecycle.at(-1);
    expect(failed).toMatchObject({
      phase: "queue.failed",
      queueStatus: "failed",
      errorCode: "bridge-failed",
    });
    expect(JSON.stringify(failed)).not.toContain("SECRET");
    queue.stop();
  });

  it("expires commands that are never claimed with an explicit unclaimed code", async () => {
    vi.useFakeTimers();
    try {
      const lifecycle: PiCommandLifecycleEvent[] = [];
      const queue = new PiCommandQueue((event) => lifecycle.push(event));
      queue.touch({ ...identity, sessionPath: "/session/other.jsonl" });

      const command = queue.enqueue({
        paneId: identity.paneId,
        sessionPath: "/session/other.jsonl",
        requestId: "request-queued",
        text: "review",
        images: [image],
      });
      vi.advanceTimersByTime(61_000);
      queue.cleanup();

      expect(lifecycle.map((event) => event.phase)).toEqual([
        "queue.enqueued",
        "queue.expired",
      ]);
      expect(lifecycle.at(-1)).toMatchObject({
        requestId: "request-queued",
        commandId: command.id,
        // The pre-expiry status must not be reused; the cause lives in errorCode.
        queueStatus: "expired",
        errorCode: "queue-expired-unclaimed",
        latencyMs: 61_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a claimed but never acknowledged command as unacked", async () => {
    vi.useFakeTimers();
    try {
      const lifecycle: PiCommandLifecycleEvent[] = [];
      const queue = new PiCommandQueue((event) => lifecycle.push(event));
      queue.touch(identity);

      const command = queue.enqueue({
        paneId: identity.paneId,
        sessionPath: identity.sessionPath,
        requestId: "request-claimed",
        text: "review",
        images: [image],
      });
      expect((await queue.poll(identity))?.id).toBe(command.id);
      vi.advanceTimersByTime(61_000);
      queue.cleanup();

      expect(lifecycle.map((event) => event.phase)).toEqual([
        "queue.enqueued",
        "queue.claimed",
        "queue.expired",
      ]);
      expect(lifecycle.at(-1)).toMatchObject({
        queueStatus: "expired",
        errorCode: "queue-expired-unacked",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps queue lifecycle events to non-misleading trace events", () => {
    expect(
      queueStatusToDeliveryStatus("expired"),
    ).toBe("delivery-unconfirmed");
    expect(queueStatusToDeliveryStatus("claimed")).toBe("claimed");
    expect(queueStatusToDeliveryStatus("dispatched")).toBe("dispatched");
    expect(queueStatusToDeliveryStatus("failed")).toBe("failed");
    expect(queueStatusToDeliveryStatus("queued")).toBe("queued");

    expect(
      queueLifecycleEvent(
        {
          phase: "queue.expired",
          requestId: "request-1",
          paneId: "w1:p1",
          commandId: "command-1",
          latencyMs: 60_100,
          queueStatus: "expired",
          errorCode: "queue-expired-unacked",
        },
        1_760_000_000_000,
      ),
    ).toEqual({
      requestId: "request-1",
      paneId: "w1:p1",
      source: "server",
      phase: "queue.expired",
      at: 1_760_000_000_000,
      latencyMs: 60_100,
      queueStatus: "expired",
      status: "delivery-unconfirmed",
      commandId: "command-1",
      errorCode: "queue-expired-unacked",
    });
  });

  it("ignores a lifecycle observer that throws", () => {
    const queue = new PiCommandQueue(() => {
      throw new Error("observer exploded");
    });
    expect(() =>
      queue.enqueue({
        paneId: identity.paneId,
        sessionPath: identity.sessionPath,
        requestId: "request-1",
        text: "review",
        images: [image],
      }),
    ).not.toThrow();
    queue.stop();
  });
});
