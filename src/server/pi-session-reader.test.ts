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

describe("PiSessionReader reasoning durations", () => {
  it("approximates the thinking span from adjacent entry timestamps", async () => {
    const sessionPath = await writeSession([
      userEntry("u1", null, "2026-09-15T00:00:00.000Z"),
      assistantEntry("a1", "u1", {
        startedAt: "2026-09-15T00:00:00.000Z",
        writtenAt: "2026-09-15T00:00:30.000Z",
        thinking: "let me look",
        text: "answer",
      }),
      assistantEntry("a2", "a1", {
        startedAt: "2026-09-15T00:00:31.000Z",
        writtenAt: "2026-09-15T00:00:40.000Z",
        text: "more",
      }),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    expect(snapshot.messages[1]?.content[0]).toEqual({
      type: "reasoning",
      text: "let me look",
      durationMs: 30_000,
    });
    // Non-reasoning parts never carry a duration.
    expect(snapshot.messages[1]?.content[1]).toEqual({ type: "text", text: "answer" });
  });

  it("never counts the pause before the next user message", async () => {
    const sessionPath = await writeSession([
      assistantEntry("a1", null, {
        startedAt: "2026-09-15T00:00:00.000Z",
        writtenAt: "2026-09-15T00:00:30.000Z",
        thinking: "quick check",
        text: "done",
      }),
      // The user replies ten minutes later; that idle time is not thinking.
      userEntry("u2", "a1", "2026-09-15T00:10:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    expect(snapshot.messages[0]?.content[0]).toMatchObject({ durationMs: 30_000 });
  });

  it("uses the entry write time when the branch ends after the reasoning", async () => {
    const sessionPath = await writeSession([
      assistantEntry("a1", null, {
        startedAt: "2026-09-15T00:00:00.000Z",
        writtenAt: "2026-09-15T00:00:20.000Z",
        thinking: "last thought",
        text: "final",
      }),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    expect(snapshot.messages[0]?.content[0]).toMatchObject({ durationMs: 20_000 });
  });

  it("omits the duration when several reasoning blocks share one message", async () => {
    const sessionPath = await writeSession([
      assistantEntry("a1", null, {
        startedAt: "2026-09-15T00:00:00.000Z",
        writtenAt: "2026-09-15T00:00:30.000Z",
        thinking: ["first", "second"],
        text: "answer",
      }),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    const content = snapshot.messages[0]?.content ?? [];
    expect(content.filter((part) => part.type === "reasoning")).toHaveLength(2);
    for (const part of content) {
      expect(part).not.toHaveProperty("durationMs");
    }
  });

  it("omits the duration when the timestamps cannot produce a span", async () => {
    const sessionPath = await writeSession([
      {
        type: "message",
        id: "a1",
        parentId: null,
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "no timestamps" }],
        },
      },
      {
        type: "message",
        id: "a2",
        parentId: "a1",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      },
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    expect(snapshot.messages[0]?.content[0]).toEqual({
      type: "reasoning",
      text: "no timestamps",
    });
  });
});

async function writeSession(entries: unknown[]): Promise<string> {
  const root = await mkdtemp(path.join(process.cwd(), ".tmp-herzi-session-test-"));
  testRoots.push(root);
  const sessionPath = path.join(root, "session.jsonl");
  await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return sessionPath;
}

function userEntry(id: string, parentId: string | null, timestamp: string) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      timestamp: Date.parse(timestamp),
      content: `prompt ${id}`,
    },
  };
}

function assistantEntry(
  id: string,
  parentId: string | null,
  input: {
    startedAt: string;
    writtenAt: string;
    thinking?: string | string[];
    text?: string;
  },
) {
  const thinking = input.thinking === undefined
    ? []
    : (Array.isArray(input.thinking) ? input.thinking : [input.thinking]).map(
        (value) => ({ type: "thinking", thinking: value }),
      );
  return {
    type: "message",
    id,
    parentId,
    timestamp: input.writtenAt,
    message: {
      role: "assistant",
      timestamp: Date.parse(input.startedAt),
      stopReason: "stop",
      content: [
        ...thinking,
        ...(input.text ? [{ type: "text", text: input.text }] : []),
      ],
    },
  };
}

function pngBytes(): Buffer {
  const bytes = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  return bytes;
}
