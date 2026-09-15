import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { ImageUploadStore } from "./image-upload-store.js";
import { appendManagedAttachments } from "./managed-attachments.js";
import { PiSessionReader } from "./pi-session-reader.js";

const testRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("PiSessionReader image messages", () => {
  it("restores managed fallback images while hiding the generated marker", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-herzi-session-test-"));
    testRoots.push(root);
    const sessionPath = path.join(root, "session.jsonl");
    const uploads = new ImageUploadStore(path.join(root, "uploads"));
    const upload = await uploads.create({
      paneId: "pane-1",
      sessionPath,
      name: "screen.png",
      stream: Readable.from(pngBytes()),
    });
    const managedPath = await uploads.managedPath(upload.uploadId, "pane-1", sessionPath);
    const prompt = appendManagedAttachments("Review this", [
      { id: upload.uploadId, path: managedPath, mimeType: upload.mimeType },
    ]);
    await writeFile(
      sessionPath,
      [
        JSON.stringify({ type: "session", version: 3 }),
        JSON.stringify({
          type: "message",
          id: "entry-1",
          parentId: null,
          timestamp: "2026-09-15T00:00:00.000Z",
          message: { role: "user", content: prompt, timestamp: 1 },
        }),
        "",
      ].join("\n"),
    );

    const reader = new PiSessionReader((uploadId, paneId, currentSessionPath) =>
      uploads.dataUrlFor(uploadId, paneId, currentSessionPath),
    );
    const snapshot = await reader.read("pane-1", sessionPath, false);

    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]?.content[0]).toEqual({ type: "text", text: "Review this" });
    expect(snapshot.messages[0]?.content[1]).toMatchObject({
      type: "image",
      uploadId: upload.uploadId,
      mimeType: "image/png",
      sha256: upload.sha256,
    });
  });

  it("keeps read tool result images for the tool card preview", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-herzi-session-test-"));
    testRoots.push(root);
    const sessionPath = path.join(root, "session.jsonl");
    const data = pngBytes().toString("base64");
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: "message",
          id: "assistant-entry",
          parentId: null,
          message: {
            role: "assistant",
            timestamp: 1,
            content: [
              {
                type: "toolCall",
                id: "read-call",
                name: "read",
                arguments: { path: "screenshot.png" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "result-entry",
          parentId: "assistant-entry",
          message: {
            role: "toolResult",
            toolCallId: "read-call",
            toolName: "read",
            isError: false,
            content: [
              { type: "text", text: "Read image file [image/png]" },
              { type: "image", data, mimeType: "image/png" },
            ],
          },
        }),
        "",
      ].join("\n"),
    );

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    expect(snapshot.messages[0]?.content[0]).toMatchObject({
      type: "tool-call",
      toolName: "read",
      result: {
        type: "herzi-tool-result",
        value: "Read image file [image/png]",
        images: [
          {
            image: `data:image/png;base64,${data}`,
            mimeType: "image/png",
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        ],
      },
    });
  });

  it("hashes native Pi image content for optimistic reconciliation", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-herzi-session-test-"));
    testRoots.push(root);
    const sessionPath = path.join(root, "session.jsonl");
    const data = pngBytes().toString("base64");
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "entry-1",
        parentId: null,
        message: {
          role: "user",
          timestamp: 1,
          content: [{ type: "image", data, mimeType: "image/png" }],
        },
      })}\n`,
    );

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    expect(snapshot.messages[0]?.content[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});

function pngBytes(): Buffer {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return bytes;
}
