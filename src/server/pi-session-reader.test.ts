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

describe("PiSessionReader compaction dividers", () => {
  it("places the compaction divider before the first kept entry (semantic boundary)", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "first", "2026-09-15T00:00:00.000Z"),
      messageEntry("m2", "m1", "assistant", "first answer", "2026-09-15T00:00:10.000Z"),
      messageEntry("m3", "m2", "user", "kept question", "2026-09-15T00:01:00.000Z"),
      messageEntry("m4", "m3", "assistant", "kept answer", "2026-09-15T00:01:10.000Z"),
      {
        type: "compaction",
        id: "c1",
        parentId: "m4",
        timestamp: "2026-09-15T00:02:00.000Z",
        summary: "## 摘要\n\n早前的工作被压缩。",
        firstKeptEntryId: "m3",
        tokensBefore: 111_867,
        fromHook: false,
        details: { modifiedFiles: ["src/a.ts", "src/b.ts"], readFiles: ["src/c.ts"] },
        usage: { input: 1, output: 2 },
      },
      messageEntry("m5", "c1", "assistant", "after compaction", "2026-09-15T00:03:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    // Historical messages are never hidden; the divider only marks where the
    // model's context now starts.
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "divider:c1",
      "m3",
      "m4",
      "m5",
    ]);
    expect(snapshot.messages[2]?.content).toEqual([
      {
        type: "divider",
        kind: "compaction",
        summary: "## 摘要\n\n早前的工作被压缩。",
        tokensBefore: 111_867,
        modifiedFiles: ["src/a.ts", "src/b.ts"],
        readFiles: ["src/c.ts"],
        at: Date.parse("2026-09-15T00:02:00.000Z"),
      },
    ]);
    // The divider is a position marker: its message keeps the timestamp of the
    // message it precedes, because the client re-sorts messages by `createdAt`
    // and would otherwise move the marker below the kept history. The real
    // compaction time stays on the part as `at`.
    const divider = snapshot.messages[2]!;
    expect(divider.createdAt).toBe(snapshot.messages[3]!.createdAt);
    expect(divider.createdAt).not.toBe(Date.parse("2026-09-15T00:02:00.000Z"));
  });

  it("falls back to the compaction entry position when firstKeptEntryId is missing", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "a", "2026-09-15T00:00:00.000Z"),
      messageEntry("m2", "m1", "assistant", "b", "2026-09-15T00:00:10.000Z"),
      {
        type: "compaction",
        id: "c1",
        parentId: "m2",
        timestamp: "2026-09-15T00:02:00.000Z",
        summary: "no kept id",
      },
      messageEntry("m3", "c1", "assistant", "c", "2026-09-15T00:03:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "divider:c1",
      "m3",
    ]);
    // Missing numeric fields are omitted instead of guessed.
    expect(snapshot.messages[2]?.content[0]).toEqual({
      type: "divider",
      kind: "compaction",
      summary: "no kept id",
      at: Date.parse("2026-09-15T00:02:00.000Z"),
    });
  });

  it("falls back to the compaction entry position when firstKeptEntryId is off the branch", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "a", "2026-09-15T00:00:00.000Z"),
      {
        type: "compaction",
        id: "c1",
        parentId: "m1",
        timestamp: "2026-09-15T00:02:00.000Z",
        summary: "kept id lives elsewhere",
        firstKeptEntryId: "other-branch-entry",
        tokensBefore: 396_805,
      },
      messageEntry("m2", "c1", "assistant", "b", "2026-09-15T00:03:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "divider:c1",
      "m2",
    ]);
  });

  it("keeps several compaction dividers and marks branch summaries", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "a", "2026-09-15T00:00:00.000Z"),
      messageEntry("m2", "m1", "assistant", "b", "2026-09-15T00:00:10.000Z"),
      messageEntry("m3", "m2", "assistant", "c", "2026-09-15T00:00:20.000Z"),
      {
        type: "compaction",
        id: "c1",
        parentId: "m3",
        timestamp: "2026-09-15T00:02:00.000Z",
        summary: "first compaction",
        firstKeptEntryId: "m3",
        tokensBefore: 100,
      },
      messageEntry("m4", "c1", "assistant", "d", "2026-09-15T00:03:00.000Z"),
      {
        type: "branch_summary",
        id: "b1",
        parentId: "m4",
        timestamp: "2026-09-15T00:03:30.000Z",
        summary: "summary of the abandoned branch",
        fromId: "m2",
      },
      messageEntry("m5", "b1", "assistant", "e", "2026-09-15T00:04:00.000Z"),
      {
        type: "compaction",
        id: "c2",
        parentId: "m5",
        timestamp: "2026-09-15T00:05:00.000Z",
        summary: "second compaction",
        firstKeptEntryId: "m5",
        tokensBefore: 200,
      },
      messageEntry("m6", "c2", "assistant", "f", "2026-09-15T00:06:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "divider:c1",
      "m3",
      "m4",
      "divider:b1",
      "divider:c2",
      "m5",
      "m6",
    ]);
    const dividers = snapshot.messages.flatMap((message) =>
      message.content.flatMap((part) => (part.type === "divider" ? [part] : [])),
    );
    expect(dividers.map((divider) => divider.kind)).toEqual([
      "compaction",
      "branch-summary",
      "compaction",
    ]);
    expect(dividers.map((divider) => divider.summary)).toEqual([
      "first compaction",
      "summary of the abandoned branch",
      "second compaction",
    ]);
    // `branch_summary` has no `tokensBefore`; nothing is invented for it.
    expect(dividers[1]).not.toHaveProperty("tokensBefore");
  });

  it("keeps the divider with at 0 when the entry timestamp is unusable", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "a", timestampMs(0)),
      { type: "compaction", id: "c1", parentId: "m1", summary: "no timestamp" },
      messageEntry("m2", "c1", "assistant", "b", timestampMs(10_000)),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "divider:c1",
      "m2",
    ]);
    expect(snapshot.messages[1]?.content[0]).toMatchObject({
      type: "divider",
      at: 0,
    });
  });

  it("keeps both dividers in branch order when they share a first kept entry", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "a", "2026-09-15T00:00:00.000Z"),
      messageEntry("m2", "m1", "assistant", "b", "2026-09-15T00:00:10.000Z"),
      {
        type: "compaction",
        id: "c1",
        parentId: "m2",
        timestamp: "2026-09-15T00:01:00.000Z",
        summary: "first",
        firstKeptEntryId: "m2",
        tokensBefore: 10,
      },
      messageEntry("m3", "c1", "assistant", "c", "2026-09-15T00:02:00.000Z"),
      {
        type: "compaction",
        id: "c2",
        parentId: "m3",
        timestamp: "2026-09-15T00:03:00.000Z",
        summary: "second",
        firstKeptEntryId: "m2",
        tokensBefore: 20,
      },
      messageEntry("m4", "c2", "assistant", "d", "2026-09-15T00:04:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    // Both markers announce the same kept entry, so both land directly above it
    // in branch order; message ids stay unique either way.
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "divider:c1",
      "divider:c2",
      "m2",
      "m3",
      "m4",
    ]);
    expect(new Set(snapshot.messages.map((message) => message.id)).size).toBe(
      snapshot.messages.length,
    );
  });

  it("borrows the previous message timestamp for a divider that ends the branch", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "a", "2026-09-15T00:00:00.000Z"),
      messageEntry("m2", "m1", "assistant", "b", "2026-09-15T00:00:10.000Z"),
      {
        type: "compaction",
        id: "c1",
        parentId: "m2",
        timestamp: "2026-09-15T00:05:00.000Z",
        summary: "tail",
      },
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    // The compaction has no usable kept entry, so it falls back to its own (last)
    // position, where no message follows: the ordering anchor then comes from the
    // previous real message instead of the later compaction timestamp.
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "divider:c1",
    ]);
    const divider = snapshot.messages[2]!;
    expect(divider.createdAt).toBe(snapshot.messages[1]!.createdAt);
    expect(divider.content[0]).toMatchObject({
      type: "divider",
      at: Date.parse("2026-09-15T00:05:00.000Z"),
    });
  });

  it("puts the divider before the next rendered message when the kept entry has none", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "user", "a", "2026-09-15T00:00:00.000Z"),
      messageEntry("m2", "m1", "assistant", "b", "2026-09-15T00:00:10.000Z"),
      toolResultEntry("tr1", "m2", "2026-09-15T00:00:20.000Z", "bash", undefined),
      messageEntry("m3", "tr1", "assistant", "c", "2026-09-15T00:00:30.000Z"),
      {
        type: "compaction",
        id: "c1",
        parentId: "m3",
        timestamp: "2026-09-15T00:01:00.000Z",
        summary: "kept a tool result",
        firstKeptEntryId: "tr1",
      },
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    // The kept entry is a tool result, which never becomes a chat message, so the
    // semantic boundary cannot be shown exactly: the marker shifts to just before
    // the next message that is rendered. This is a recorded degradation, pinned
    // here so that a change of behaviour is noticed.
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "divider:c1",
      "m3",
    ]);
  });
});

describe("PiSessionReader todo snapshots", () => {
  it("keeps the last todo result as a projected snapshot", async () => {
    const sessionPath = await writeSession([
      todoEntry("t1", null, "2026-09-15T00:00:00.000Z", {
        action: "create",
        nextId: 2,
        tasks: [{ id: 1, subject: "第一个任务", status: "in_progress", activeForm: "正在做第一个" }],
      }),
      todoEntry("t2", "t1", "2026-09-15T00:00:30.000Z", {
        action: "update",
        nextId: 4,
        tasks: [
          {
            id: 1,
            subject: "第一个任务",
            status: "completed",
            activeForm: "正在做第一个",
            description: "细节",
            owner: "unverified-field",
            metadata: { nested: true },
          },
          { id: 2, subject: "第二个任务", status: "pending", blockedBy: [1] },
          { id: 3, subject: "已删除", status: "deleted" },
        ],
      }),
      messageEntry("m1", "t2", "assistant", "done", "2026-09-15T00:01:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    // Only `create`/`update` results exist here: no `list` call is needed
    // because every successful call returns the full snapshot.
    expect(snapshot.todos).toEqual({
      nextId: 4,
      updatedAt: Date.parse("2026-09-15T00:00:30.000Z"),
      tasks: [
        {
          id: 1,
          subject: "第一个任务",
          status: "completed",
          activeForm: "正在做第一个",
          description: "细节",
        },
        { id: 2, subject: "第二个任务", status: "pending", blockedBy: [1] },
        { id: 3, subject: "已删除", status: "deleted" },
      ],
    });
    // Unverified task fields are dropped, never re-serialized.
    const first = snapshot.todos?.tasks[0];
    expect(first && Object.keys(first).sort()).toEqual([
      "activeForm",
      "description",
      "id",
      "status",
      "subject",
    ]);
  });

  it("takes the last matching result and skips malformed ones", async () => {
    const sessionPath = await writeSession([
      todoEntry("t1", null, "2026-09-15T00:00:00.000Z", {
        action: "create",
        nextId: 1,
        tasks: [{ id: 1, subject: "first", status: "pending" }],
      }),
      todoEntry("t2", "t1", "2026-09-15T00:00:10.000Z", { action: "list", tasks: "nope", nextId: 1 }),
      toolResultEntry("t3", "t2", "2026-09-15T00:00:20.000Z", "todo", undefined),
      todoEntry("t4", "t3", "2026-09-15T00:00:30.000Z", {
        action: "update",
        nextId: 9,
        tasks: [{ id: 5, subject: "last", status: "pending" }],
      }),
      toolResultEntry("t5", "t4", "2026-09-15T00:00:40.000Z", "bash", {
        tasks: [],
        nextId: 1,
      }),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    expect(snapshot.todos?.nextId).toBe(9);
    expect(snapshot.todos?.tasks).toEqual([
      { id: 5, subject: "last", status: "pending" },
    ]);
    expect(snapshot.todos?.truncated).toBeUndefined();
  });

  it("drops malformed task entries instead of inventing a task", async () => {
    const sessionPath = await writeSession([
      todoEntry("t1", null, "2026-09-15T00:00:00.000Z", {
        action: "update",
        nextId: 3,
        tasks: [
          "not a task",
          { id: 1, status: "pending" },
          { id: "2", subject: "string id", status: "pending" },
          { id: 2, subject: "real", status: 7 },
          { id: 3, subject: "ok", status: "pending", blockedBy: [1, "x"] },
        ],
      }),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    expect(snapshot.todos?.tasks).toEqual([
      { id: 3, subject: "ok", status: "pending", blockedBy: [1] },
    ]);
  });

  it("has no todo snapshot when the tool was never used", async () => {
    const sessionPath = await writeSession([
      messageEntry("m1", null, "assistant", "no todos here", "2026-09-15T00:00:00.000Z"),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);
    expect(snapshot.todos).toBeUndefined();
  });

  it("degrades to counts only when the snapshot exceeds its size budget", async () => {
    const sessionPath = await writeSession([
      todoEntry("t1", null, "2026-09-15T00:00:00.000Z", {
        action: "list",
        nextId: 4001,
        tasks: Array.from({ length: 4_000 }, (_, index) => ({
          id: index + 1,
          subject: `任务 ${index + 1}`,
          status: "pending",
          description: "描述".repeat(60),
        })),
      }),
    ]);

    const snapshot = await new PiSessionReader().read("pane-1", sessionPath, false);

    expect(snapshot.todos).toEqual({
      nextId: 4001,
      updatedAt: Date.parse("2026-09-15T00:00:00.000Z"),
      tasks: [],
      truncated: true,
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

function messageEntry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
  timestamp: string | number,
) {
  const at = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(at).toISOString(),
    message: { role, timestamp: at, content: text, stopReason: "stop" },
  };
}

function timestampMs(at: number): string {
  return new Date(at).toISOString();
}

function toolResultEntry(
  id: string,
  parentId: string | null,
  timestamp: string,
  toolName: string,
  details: unknown,
) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "toolResult",
      toolCallId: `call-${id}`,
      toolName,
      isError: false,
      content: "ok",
      ...(details === undefined ? {} : { details }),
    },
  };
}

function todoEntry(
  id: string,
  parentId: string | null,
  timestamp: string,
  details: Record<string, unknown>,
) {
  return toolResultEntry(id, parentId, timestamp, "todo", details);
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
