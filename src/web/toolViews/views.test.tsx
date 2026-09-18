// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeView } from "./CodeView";
import { DiffView } from "./DiffView";
import { MatchListView } from "./MatchListView";
import { OutputView } from "./OutputView";
import { WebFetchView } from "./WebFetchView";
import { WebSearchView } from "./WebSearchView";
import { toolViewFor } from "./index";
import type { ToolDetailItem, ToolViewProps } from "./common";

afterEach(cleanup);

function fallback() {
  return <div className="test-fallback">raw arguments/result</div>;
}

function renderView(
  View: ComponentType<ToolViewProps>,
  item: ToolDetailItem,
) {
  const result = render(<View item={item} fallback={fallback()} />);
  return result.container;
}

function texts(container: Element, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector)).map(
    (element) => element.textContent ?? "",
  );
}

describe("DiffView", () => {
  const item: ToolDetailItem = {
    toolName: "edit",
    args: {},
    display: {
      diff: {
        firstChangedLine: 92,
        lines: [
          { kind: "add", lineNumber: 92, text: "const added = true;" },
          { kind: "remove", lineNumber: 88, text: "const added = false;" },
          { kind: "context", lineNumber: 91, text: "context line" },
          { kind: "skip", text: "..." },
        ],
      },
    },
  };

  it("renders one row per line with kinds and line numbers", () => {
    const container = renderView(DiffView, item);

    expect(container.querySelectorAll(".diff-line")).toHaveLength(4);
    expect(container.querySelectorAll(".diff-line-add")).toHaveLength(1);
    expect(container.querySelectorAll(".diff-line-remove")).toHaveLength(1);
    expect(container.querySelectorAll(".diff-line-skip")).toHaveLength(1);
    // Numbers are aligned to their own kind: new file for add/context, old for
    // remove, and none at all on the skipped-context row.
    expect(texts(container, ".diff-line-number")).toEqual(["92", "88", "91"]);
    expect(
      container.querySelector(".diff-line-skip .diff-line-number"),
    ).toBeNull();
    expect(screen.getByText("首个改动在第 92 行")).toBeTruthy();
  });

  it("copies the diff lines as text", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const container = renderView(DiffView, item);

    fireEvent.click(screen.getByRole("button", { name: "复制 diff" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toBe(
      "+92 const added = true;\n-88 const added = false;\n 91 context line\n...",
    );
    await waitFor(() => expect(screen.getByText("已复制")).toBeTruthy());
    expect(container).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("falls back without a projected diff", () => {
    const container = renderView(DiffView, { toolName: "edit", args: {} });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });
});

describe("CodeView", () => {
  const readText = [
    "const first = 1;",
    "const second = 2;",
    "",
    "[Showing lines 100-101 of 512. Use offset=102 to continue.]",
  ].join("\n");

  it("numbers the read content from the requested offset", () => {
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "src/a.ts", offset: 100 },
      result: readText,
      display: { readRange: { from: 100, to: 101, total: 512, nextOffset: 102 } },
    });

    // The marker line is not file content and is not rendered as code.
    expect(texts(container, ".code-line-text")).toEqual([
      "const first = 1;",
      "const second = 2;",
    ]);
    expect(texts(container, ".code-line-number")).toEqual(["100", "101"]);
    expect(
      screen.getByText("已显示 100–101 / 共 512 行 · 继续读取 offset=102"),
    ).toBeTruthy();
  });

  it("shows no line numbers when the offset is not usable", () => {
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "src/a.ts", offset: "100" },
      result: "one line",
    });

    expect(container.querySelectorAll(".code-line-number")).toHaveLength(0);
    expect(texts(container, ".code-line-text")).toEqual(["one line"]);
  });

  it("folds long content and expands it on request", () => {
    const lines = Array.from({ length: 250 }, (_value, index) => `line ${index + 1}`);
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "src/big.ts" },
      result: lines.join("\n"),
    });

    expect(container.querySelectorAll(".code-line")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: /还有 50 行未显示/ }));
    expect(container.querySelectorAll(".code-line")).toHaveLength(250);
    expect(screen.getByRole("button", { name: "收起" })).toBeTruthy();
  });

  it("shows the new content for write instead of a diff", () => {
    const container = renderView(CodeView, {
      toolName: "write",
      args: { path: "src/new.ts", content: "first\nsecond" },
    });

    expect(texts(container, ".code-line-number")).toEqual(["1", "2"]);
    expect(screen.getByText(/新建内容/)).toBeTruthy();
  });

  it("falls back when the result carries no text", () => {
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "shot.png" },
      result: {
        type: "herzi-tool-result",
        value: "",
        images: [{ image: "data:image/png;base64,AA" }],
      },
    });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });

  it("falls back for an empty read result", () => {
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "src/a.ts" },
      result: "",
    });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });
});

describe("OutputView", () => {
  it("shows the command and the last 20 output lines, never an exit code", () => {
    const lines = Array.from({ length: 25 }, (_value, index) => `output line ${index + 1}`);
    const container = renderView(OutputView, {
      toolName: "bash",
      args: { command: "npm test" },
      result: lines.join("\n"),
    });

    expect(screen.getByText("npm test")).toBeTruthy();
    const output = container.querySelector(".output-body pre")?.textContent ?? "";
    expect(output).toContain("output line 25");
    expect(output).not.toContain("output line 1\n");
    expect(screen.getByRole("button", { name: /还有前 5 行未显示/ })).toBeTruthy();
    // The result text has no exit status, so none is claimed.
    expect(container.textContent).not.toMatch(/退出码|exit code/iu);
  });

  it("expands to the full output on request", () => {
    const lines = Array.from({ length: 25 }, (_value, index) => `line ${index + 1}`);
    const container = renderView(OutputView, {
      toolName: "bash",
      args: { command: "npm test" },
      result: lines.join("\n"),
    });

    fireEvent.click(screen.getByRole("button", { name: /展开全部/ }));
    const output = container.querySelector(".output-body pre")?.textContent ?? "";
    expect(output).toContain("line 1\n");
  });

  it("renders the truncation metadata when the tool reported it", () => {
    render(
      <OutputView
        item={{
          toolName: "bash",
          args: { command: "npm test" },
          result: "tail",
          display: {
            truncation: {
              truncated: true,
              by: "bytes",
              outputLines: 1,
              totalLines: 900,
            },
          },
        }}
        fallback={fallback()}
      />,
    );

    expect(
      screen.getByText("输出被截断（达到字节上限），共 900 行，本次返回 1 行"),
    ).toBeTruthy();
  });

  it("falls back without a command and without a result", () => {
    const container = renderView(OutputView, { toolName: "bash", args: {} });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });
});

describe("MatchListView", () => {
  it("groups ffgrep matches by file header and dims context lines", () => {
    const container = renderView(MatchListView, {
      toolName: "ffgrep",
      args: { pattern: "needle" },
      result: [
        "src/a.ts",
        "12: const value = 1;",
        "13- const other = 2;",
        "src/b.ts",
        "42: match here",
        "[2 matches in 2 files]",
      ].join("\n"),
      display: { matchCount: { matched: 12, files: 4, hasMore: true } },
    });

    expect(texts(container, ".match-file-path")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(container.querySelectorAll(".match-line-hit")).toHaveLength(2);
    expect(container.querySelectorAll(".match-line-context")).toHaveLength(1);
    expect(texts(container, ".match-line-number")).toEqual(["12", "13", "42"]);
    expect(screen.getByText("12 处命中 · 4 个文件")).toBeTruthy();
    expect(screen.getByText("还有更多结果未显示")).toBeTruthy();
    expect(screen.getByText("[2 matches in 2 files]")).toBeTruthy();
  });

  it("derives the count from the parsed lines when nothing was projected", () => {
    const container = renderView(MatchListView, {
      toolName: "ffgrep",
      args: { pattern: "needle" },
      result: "src/a.ts\n3: needle",
    });

    expect(screen.getByText("1 处命中 · 1 个文件")).toBeTruthy();
    expect(container.querySelectorAll(".match-line-hit")).toHaveLength(1);
  });

  it("lists fffind paths and falls back on prose", () => {
    const container = renderView(MatchListView, {
      toolName: "fffind",
      args: { pattern: "*.ts" },
      result: "src/a.ts\nsrc/b/c.ts",
      display: { matchCount: { matched: 2, files: 2 } },
    });
    expect(texts(container, ".path-line")).toEqual(["src/a.ts", "src/b/c.ts"]);
    expect(screen.getByText("2 处命中 · 2 个文件")).toBeTruthy();

    const prose = renderView(MatchListView, {
      toolName: "fffind",
      args: { pattern: "*.ts" },
      result: "No files found",
    });
    expect(prose.querySelector(".test-fallback")).toBeTruthy();
  });

  it("falls back for an unparseable match result", () => {
    const container = renderView(MatchListView, {
      toolName: "ffgrep",
      args: { pattern: "needle" },
      result: "No matches found",
    });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });
});

describe("WebSearchView", () => {
  it("splits numbered results and keeps markdown links working", async () => {
    const container = renderView(WebSearchView, {
      toolName: "web_search",
      args: { query: "herdr" },
      result: [
        "1. **[Herdr docs](https://example.com/herdr)**",
        "   example.com · 2026-01-01",
        "2. **Second result**",
        "   other.example",
      ].join("\n"),
    });

    expect(screen.getByText("2 条结果")).toBeTruthy();
    expect(container.querySelectorAll(".result-item")).toHaveLength(2);
    const link = await screen.findByRole("link", { name: "Herdr docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/herdr");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders the raw markdown when no entry can be split out", async () => {
    const container = renderView(WebSearchView, {
      toolName: "web_search",
      args: { query: "herdr" },
      result: "A single paragraph without numbered results",
    });

    expect(container.querySelector(".test-fallback")).toBeNull();
    expect(container.querySelectorAll(".result-item")).toHaveLength(0);
    expect(
      await screen.findByText("A single paragraph without numbered results"),
    ).toBeTruthy();
  });

  it("falls back when the result carries no text", () => {
    const container = renderView(WebSearchView, {
      toolName: "web_search",
      args: { query: "herdr" },
      result: 42,
    });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });
});

describe("WebFetchView", () => {
  it("shows the title, host, character count and markdown body", async () => {
    const container = renderView(WebFetchView, {
      toolName: "web_fetch",
      args: { url: "https://example.com/docs/page" },
      result: "# Page title\n\nThe body line.\n\n[Content truncated at 20000 characters]",
    });

    expect(screen.getByText("Page title")).toBeTruthy();
    expect(screen.getByText(/example\.com/)).toBeTruthy();
    expect(screen.getByText(/字符/)).toBeTruthy();
    // The note is a spotlight on a line that also stays in the body text.
    expect(
      screen.getAllByText("[Content truncated at 20000 characters]").length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText("The body line.")).toBeTruthy();
    expect(container.querySelector(".test-fallback")).toBeNull();
  });

  it("folds a long body and expands it on request", () => {
    const body = Array.from({ length: 60 }, (_value, index) => `Body ${index + 1}`).join("\n\n");
    const container = renderView(WebFetchView, {
      toolName: "web_fetch",
      args: { url: "https://example.com" },
      result: body,
    });

    // 60 Markdown paragraphs fold to the first 40 of the 83 result lines.
    expect(screen.getByRole("button", { name: /展开全部/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /展开全部/ }));
    expect(screen.getByRole("button", { name: "收起" })).toBeTruthy();
    expect(container).toBeTruthy();
  });
});

describe("toolViewFor", () => {
  it("maps the registered tools and leaves unknown ones to the fallback", () => {
    expect(toolViewFor("edit")).toBe(DiffView);
    expect(toolViewFor("read")).toBe(CodeView);
    expect(toolViewFor("ffgrep")).toBe(MatchListView);
    expect(toolViewFor("web_fetch")).toBe(WebFetchView);
    expect(toolViewFor("mcp__unknown_tool")).toBeUndefined();
    expect(toolViewFor("")).toBeUndefined();
  });
});
