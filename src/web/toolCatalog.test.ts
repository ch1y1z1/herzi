import { describe, expect, it } from "vitest";

import type { ChatJsonObject } from "../shared/protocol";
import {
  argsTarget,
  baseName,
  clipText,
  countLines,
  describeToolCall,
  editDiff,
  formatToolCounts,
  summarizeToolRun,
  toolRunDiff,
  toolRunVerb,
  type ToolRunItem,
} from "./toolCatalog";

function call(
  toolName: string,
  args: ChatJsonObject,
  result: unknown = "ok",
): ToolRunItem {
  return { toolName, args, result };
}

/** A row that is still executing has no result yet. */
function running(toolName: string, args: ChatJsonObject): ToolRunItem {
  return { toolName, args };
}

describe("describeToolCall row semantics", () => {
  it("reads out what was done and to what, for the tools seen in real sessions", () => {
    const cases: Array<{
      toolName: string;
      args: ChatJsonObject;
      action: string;
      target: string;
      bucket: string;
      fragment: string | null;
      diff?: { add: number; remove: number };
      variant?: string;
    }> = [
      {
        toolName: "bash",
        args: { command: "npm test -- src/web/components/ChatView.test.tsx", timeout: 120 },
        action: "运行命令",
        target: "npm test -- src/web/components/ChatView.test.tsx",
        bucket: "run",
        fragment: "commands",
      },
      {
        toolName: "read",
        args: { path: "src/web/components/ChatView.tsx" },
        action: "读取",
        target: "ChatView.tsx",
        bucket: "browse",
        fragment: "fileOperations",
      },
      {
        toolName: "edit",
        args: {
          path: "src/web/toolCatalog.ts",
          edits: [{ oldText: "a\nb", newText: "a\nb\nc" }],
        },
        action: "编辑",
        target: "toolCatalog.ts",
        bucket: "edit",
        fragment: "fileOperations",
        diff: { add: 3, remove: 2 },
      },
      {
        toolName: "write",
        args: { path: "src/web/panelOpenState.ts", content: "one\ntwo\n" },
        action: "新建",
        target: "panelOpenState.ts",
        bucket: "edit",
        fragment: "fileOperations",
        diff: { add: 2, remove: 0 },
      },
      {
        toolName: "web_search",
        args: { query: "herdr worktree api" },
        action: "网络搜索",
        target: '"herdr worktree api"',
        bucket: "browse",
        fragment: "searches",
      },
      {
        toolName: "web_fetch",
        args: { url: "https://herdr.dev/docs/panes" },
        action: "抓取网页",
        target: "herdr.dev",
        bucket: "browse",
        fragment: "searches",
      },
      {
        toolName: "ffgrep",
        args: { pattern: "toolPreview", path: "src/web" },
        action: "内容搜索",
        target: '"toolPreview" @ src/web',
        bucket: "browse",
        fragment: "searches",
      },
      {
        toolName: "fffind",
        args: { pattern: "profile.h" },
        action: "查找文件",
        target: '"profile.h"',
        bucket: "browse",
        fragment: "searches",
      },
      {
        toolName: "ask_user_question",
        args: { questions: [{ question: "Which library?", header: "Library" }] },
        action: "询问",
        target: "Library",
        bucket: "other",
        fragment: "steps",
      },
      {
        toolName: "todo",
        args: { action: "add", subject: "写单测" },
        action: "新增计划",
        target: "写单测",
        bucket: "other",
        // D2: rendered, never counted.
        fragment: null,
      },
    ];

    for (const testCase of cases) {
      const display = describeToolCall(testCase.toolName, testCase.args);
      expect(display, testCase.toolName).toMatchObject({
        action: testCase.action,
        target: testCase.target,
        bucket: testCase.bucket,
        fragment: testCase.fragment,
      });
      if (testCase.diff) expect(display.diff).toEqual(testCase.diff);
      if (testCase.variant) expect(display.variant).toBe(testCase.variant);
      expect(display.target.trim(), testCase.toolName).not.toBe("");
    }
  });

  it("labels read variants instead of showing a bare path", () => {
    expect(describeToolCall("read", { path: "/tmp/screen.webp" })).toMatchObject({
      action: "读取图片",
      target: "screen.webp",
      variant: "image",
    });
    expect(describeToolCall("read", { path: "docs/plan.pdf" })).toMatchObject({
      action: "读取文档",
      target: "plan.pdf",
      variant: "pdf",
    });
    expect(
      describeToolCall("read", { path: "ChatView.tsx", offset: 100, limit: 100 }),
    ).toMatchObject({
      action: "读取",
      target: "ChatView.tsx · 第 100–199 行",
      variant: "range",
      fullTarget: "ChatView.tsx",
    });
    expect(
      describeToolCall("read", { path: "ChatView.tsx", offset: 100 }),
    ).toMatchObject({ target: "ChatView.tsx · 从第 100 行", variant: "range" });
  });

  it("shows the first line of a command and keeps the full command for the tooltip", () => {
    const display = describeToolCall("bash", {
      command: "cd /tmp/x\nnpm run build",
    });
    expect(display.target).toBe("cd /tmp/x");
    expect(display.fullTarget).toBe("cd /tmp/x\nnpm run build");

    const long = `echo ${"x".repeat(200)}`;
    const clipped = describeToolCall("bash", { command: long });
    expect(clipped.target.endsWith("…")).toBe(true);
    expect(clipped.target.length).toBeLessThanOrEqual(81);
    expect(clipped.fullTarget).toBe(long);
  });

  it("keeps the full target available when the row target is shortened", () => {
    const longQuery = "q".repeat(200);
    const display = describeToolCall("web_search", { query: longQuery });
    expect(display.target).toBe(`"${"q".repeat(56)}…"`);
    expect(display.fullTarget).toBe(longQuery);
  });
});

describe("describeToolCall degradation", () => {
  const knownTools = [
    "bash",
    "read",
    "write",
    "edit",
    "ffgrep",
    "fffind",
    "web_search",
    "web_fetch",
    "ask_user_question",
    "todo",
  ];

  it("still renders a row when the expected arguments are missing", () => {
    for (const toolName of knownTools) {
      const display = describeToolCall(toolName, {});
      expect(display.action, toolName).not.toBe("");
      expect(display.target, toolName).not.toBe("");
      expect(display.target, toolName).not.toContain("undefined");
      expect(display.target, toolName).not.toContain("[object");
    }
  });

  it("falls back to the arguments preview for unknown and future tools", () => {
    expect(
      describeToolCall("mcp__linear__create_issue", { query: "fix build" }),
    ).toMatchObject({
      action: "mcp__linear__create_issue",
      target: "fix build",
      bucket: "other",
      fragment: "steps",
    });

    // A key outside the preview list degrades to the arguments JSON, which is
    // still a non-empty row.
    expect(
      describeToolCall("mcp__linear__create_issue", { title: "fix build" }).target,
    ).toBe('{"title":"fix build"}');

    // No preferred key at all: the JSON preview is still non-empty.
    const display = describeToolCall("mystery_tool", { nested: { a: 1 } });
    expect(display.target).toBe('{"nested":{"a":1}}');
    expect(describeToolCall("mystery_tool", {}).target).toBe("{}");
    expect(argsTarget({ path: "/a/b/c.txt" })).toBe("/a/b/c.txt");
  });

  it("does not invent a diff when the edit payload has none", () => {
    expect(describeToolCall("edit", { path: "a.ts", edits: [] }).diff).toBeUndefined();
    expect(describeToolCall("edit", { path: "a.ts" }).diff).toBeUndefined();
    expect(editDiff({ edits: [{ oldText: "a" }] })).toBeUndefined();
    expect(editDiff({})).toBeUndefined();
    expect(describeToolCall("write", { path: "a.ts" }).diff).toBeUndefined();
  });
});

describe("diff calculation", () => {
  it("sums every edit in one call and counts deletions", () => {
    expect(
      editDiff({
        edits: [
          { oldText: "a\nb", newText: "a" },
          { oldText: "c", newText: "c\nd\ne" },
        ],
      }),
    ).toEqual({ add: 4, remove: 3 });

    expect(editDiff({ edits: [{ oldText: "a\nb\nc", newText: "" }] })).toEqual({
      add: 0,
      remove: 3,
    });
  });

  it("counts lines the way a diff does", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
  });
});

describe("summarizeToolRun", () => {
  it("keeps a fixed counter order regardless of call order", () => {
    const summary = summarizeToolRun([
      call("bash", { command: "npm test" }),
      call("web_search", { query: "a" }),
      call("read", { path: "a.ts" }),
      call("edit", { path: "b.ts", edits: [{ oldText: "x", newText: "x\ny" }] }),
    ]);

    expect(summary.counts).toEqual([
      { fragment: "fileOperations", count: 2 },
      { fragment: "searches", count: 1 },
      { fragment: "commands", count: 1 },
    ]);
    // Two browsing calls outweigh one edit and one command.
    expect(summary.bucket).toBe("browse");
    expect(toolRunVerb(summary)).toBe("已探索");
    expect(formatToolCounts(summary.counts)).toBe("2 次文件操作、1 次搜索、1 条命令");
    expect(summary.diff).toEqual({ add: 2, remove: 1 });
    expect(toolRunDiff(summary)).toEqual({ add: 2, remove: 1 });
    expect(summary.running).toBe(false);
  });

  it("deduplicates edit/write by path but counts reads per call (D1)", () => {
    const summary = summarizeToolRun([
      call("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "x\ny" }] }),
      call("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "x\ny" }] }),
      call("write", { path: "a.ts", content: "one\n" }),
      call("write", { path: "b.ts", content: "one\n" }),
      call("read", { path: "a.ts" }),
      call("read", { path: "a.ts" }),
    ]);

    // a.ts (edit+write) + b.ts = 2 unique paths, plus 2 reads.
    expect(summary.counts).toEqual([{ fragment: "fileOperations", count: 4 }]);
    expect(summary.bucket).toBe("edit");
  });

  it("keeps todo rows out of the counters and out of the phase verb (D2)", () => {
    const summary = summarizeToolRun([
      call("todo", { action: "add", subject: "a" }),
      call("todo", { action: "update", id: 1, status: "completed" }),
      call("todo", { action: "list" }),
      call("bash", { command: "npm test" }),
      call("bash", { command: "npm run build" }),
    ]);

    expect(summary.counts).toEqual([{ fragment: "commands", count: 2 }]);
    expect(summary.bucket).toBe("run");
    expect(toolRunVerb(summary)).toBe("已运行");
  });

  it("falls back to the neutral verb when there is nothing countable", () => {
    const onlyTodo = summarizeToolRun([
      call("todo", { action: "update", id: 2, status: "completed" }),
    ]);
    expect(onlyTodo.counts).toEqual([]);
    expect(onlyTodo.bucket).toBe("other");
    expect(toolRunVerb(onlyTodo)).toBe("已处理");
    expect(formatToolCounts(onlyTodo.counts)).toBe("");

    const empty = summarizeToolRun([]);
    expect(empty).toMatchObject({
      bucket: "other",
      counts: [],
      diff: { add: 0, remove: 0 },
      running: false,
    });
  });

  it("votes on the phase verb with a deterministic tie order", () => {
    expect(
      summarizeToolRun([
        call("edit", { path: "a.ts" }),
        call("edit", { path: "b.ts" }),
        call("bash", { command: "ls" }),
      ]).bucket,
    ).toBe("edit");

    // 1 edit vs 1 command: the edit wins the tie.
    expect(
      summarizeToolRun([
        call("edit", { path: "a.ts" }),
        call("bash", { command: "ls" }),
      ]).bucket,
    ).toBe("edit");

    // Unknown tools are `other` and still participate.
    expect(
      summarizeToolRun([
        call("mystery", { a: 1 }),
        call("mystery", { a: 2 }),
        call("read", { path: "a.ts" }),
      ]).bucket,
    ).toBe("other");
  });

  it("reports a running group and hides the diff total until it finishes", () => {
    const pending = summarizeToolRun([
      running("bash", { command: "npm test" }),
      running("bash", { command: "npm run build" }),
      call("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "x\ny" }] }),
    ]);
    expect(pending.running).toBe(true);
    expect(toolRunVerb(pending)).toBe("运行中");
    expect(toolRunDiff(pending)).toBeUndefined();

    const failed = summarizeToolRun([
      { toolName: "bash", args: { command: "npm test" }, result: "boom" },
    ]);
    // A failed call still carries a result, so the group is not "running".
    expect(failed.running).toBe(false);
    expect(toolRunDiff(failed)).toBeUndefined();
  });

  it("totals the diff of every edit in the group", () => {
    const summary = summarizeToolRun([
      call("edit", {
        path: "a.ts",
        edits: [{ oldText: "a\nb\nc", newText: "a" }],
      }),
      call("write", { path: "b.ts", content: "x\ny\nz\n" }),
      call("read", { path: "c.ts" }),
    ]);
    expect(summary.diff).toEqual({ add: 4, remove: 3 });
    expect(toolRunDiff(summary)).toEqual({ add: 4, remove: 3 });
  });
});

describe("text helpers", () => {
  it("collapses whitespace and marks clipped text", () => {
    expect(clipText("  a\n\nb  ", 10)).toBe("a b");
    expect(clipText("abcdef", 3)).toBe("abc…");
    expect(baseName("/a/b/c.ts")).toBe("c.ts");
    expect(baseName("c.ts")).toBe("c.ts");
    expect(baseName("dir/")).toBe("dir");
  });
});
