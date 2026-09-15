import { describe, expect, it } from "vitest";

import { PiCommandQueue, parseBridgeIdentity } from "./pi-command-queue.js";

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
