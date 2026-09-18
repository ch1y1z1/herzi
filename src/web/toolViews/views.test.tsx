// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { ChatJsonObject } from "../../shared/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeView } from "./CodeView";
import { DiffView } from "./DiffView";
import { MatchListView } from "./MatchListView";
import { OutputView } from "./OutputView";
import { QuestionView } from "./QuestionView";
import { TodoView } from "./TodoView";
import { WebFetchView } from "./WebFetchView";
import { WebSearchView } from "./WebSearchView";
import { toolViewFor } from "./index";
import type { ToolDetailItem, ToolViewProps } from "./common";

afterEach(() => {
  // Global stubs must never survive a failing assertion: the next test would
  // then render against a half-replaced jsdom environment.
  vi.unstubAllGlobals();
  cleanup();
});

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

/**
 * `展开全部` / `收起` controls left in the rendered views. R3 removed all of them,
 * so every view test can assert this is empty instead of trusting one label.
 */
function expandControls(container: Element): Element[] {
  return Array.from(container.querySelectorAll("button")).filter((button) =>
    /展开全部|收起/u.test(button.textContent ?? ""),
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
    renderView(DiffView, item);

    fireEvent.click(screen.getByRole("button", { name: "复制 diff" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toBe(
      "+92 const added = true;\n-88 const added = false;\n 91 context line\n...",
    );
    await waitFor(() => expect(screen.getByText("已复制")).toBeTruthy());
  });

  it("falls back without a projected diff", () => {
    const container = renderView(DiffView, { toolName: "edit", args: {} });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });

  it("maps every line kind to the row class that carries its band and bar", () => {
    const container = renderView(DiffView, {
      ...item,
      args: { path: "src/a.ts" },
    });

    // The row class is the whole hook the stylesheet hangs the band and the 3px
    // left bar on (see styles.test.ts for those rules).
    expect(
      Array.from(container.querySelectorAll(".diff-line")).map(
        (row) => row.className,
      ),
    ).toEqual([
      "diff-line diff-line-add",
      "diff-line diff-line-remove",
      "diff-line diff-line-context",
      "diff-line diff-line-skip",
    ]);
    expect(expandControls(container)).toEqual([]);
  });

  it("keeps a gutter cell on every row, including the skipped one", () => {
    const container = renderView(DiffView, item);
    // The bar is painted inside the row, so the gutter column of a changed row
    // stays aligned with the context rows.
    expect(container.querySelectorAll(".diff-line-number")).toHaveLength(3);
    expect(container.querySelector(".diff-line-skip .diff-line-number")).toBeNull();
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

  it("keeps every line in the DOM and puts them behind a scroll window", () => {
    const lines = Array.from({ length: 250 }, (_value, index) => `line ${index + 1}`);
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "src/big.ts" },
      result: lines.join("\n"),
    });

    // R1/R2: nothing is folded and nothing is virtualized — all 250 rows exist.
    expect(container.querySelectorAll(".code-line")).toHaveLength(250);
    expect(container.querySelectorAll(".tool-view-scroll")).toHaveLength(1);
    expect(screen.getByText("读取内容 · 共 250 行 · 可滚动查看")).toBeTruthy();
    // R3: the expand/collapse controls are gone, not merely hidden.
    expect(expandControls(container)).toEqual([]);
  });

  it("counts the lines without claiming a scroll window for short content", () => {
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "src/a.ts" },
      result: "one\ntwo",
    });

    expect(screen.getByText("读取内容 · 共 2 行")).toBeTruthy();
    expect(container.textContent).not.toContain("可滚动查看");
  });

  it("renders plain text until the highlighter is ready, then token colors", async () => {
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "src/a.ts" },
      result: "const value = 1;\nconst other = 2;",
    });

    // The first paint is the plain text that is already available: the row count
    // and the text are the same as the highlighted version would be, so nothing
    // jumps when the colors arrive (and there is no spinner).
    expect(texts(container, ".code-line-text")).toEqual([
      "const value = 1;",
      "const other = 2;",
    ]);
    expect(container.querySelector('.code-line-text span[style*="color"]')).toBeNull();

    await waitFor(() =>
      expect(
        container.querySelector('.code-line-text span[style*="color"]'),
      ).toBeTruthy(),
    );
    expect(container.querySelectorAll(".code-line")).toHaveLength(2);
    expect(texts(container, ".code-line-text")).toEqual([
      "const value = 1;",
      "const other = 2;",
    ]);
  });

  it("stays plain text for a language outside the supported set", () => {
    const container = renderView(CodeView, {
      toolName: "read",
      args: { path: "notes.txt" },
      result: "plain words only",
    });

    expect(texts(container, ".code-line-text")).toEqual(["plain words only"]);
    expect(container.querySelector('.code-line-text span[style*="color"]')).toBeNull();
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
  it("shows the command with a `$` prompt and all output, never an exit code", () => {
    const lines = Array.from({ length: 25 }, (_value, index) => `output line ${index + 1}`);
    const container = renderView(OutputView, {
      toolName: "bash",
      args: { command: "npm test" },
      result: lines.join("\n"),
    });

    // R5: the prompt is a separate, muted element, the command itself unchanged.
    expect(container.querySelector(".output-prompt")?.textContent).toBe("$ ");
    expect(container.querySelector(".output-command-text")?.textContent).toBe("npm test");
    // R1/R2: the whole output is in the DOM and scrolls in the window.
    const output = container.querySelector(".output-body pre")?.textContent ?? "";
    expect(output).toContain("output line 1");
    expect(output).toContain("output line 25");
    expect(container.querySelectorAll(".tool-view-scroll")).toHaveLength(2);
    expect(screen.getByText("输出 · 共 25 行 · 可滚动查看")).toBeTruthy();
    expect(expandControls(container)).toEqual([]);
    // The result text has no exit status, so none is claimed.
    expect(container.textContent).not.toMatch(/退出码|exit code/iu);
  });

  it("leaves the `$` prompt out of the text selection", () => {
    const container = renderView(OutputView, {
      toolName: "bash",
      args: { command: "npm test" },
      result: "ok",
    });

    // The prompt is its own element, styled muted and non-selectable in
    // styles.test.ts; the command text next to it is untouched.
    expect(container.querySelector(".output-prompt")?.textContent).toBe("$ ");
    expect(container.querySelector(".output-command-text")?.textContent).toBe(
      "npm test",
    );
  });

  it("marks a failed call red instead of the usual gray", () => {
    const container = renderView(OutputView, {
      toolName: "bash",
      args: { command: "npm test" },
      result: "Error: command failed",
      isError: true,
    });

    // The class the red rule hangs on (see styles.test.ts for the color and for
    // the generic error detail, which real failed calls take instead).
    expect(container.querySelectorAll(".output-body pre.output-error")).toHaveLength(1);
  });

  it("keeps an unfailed call gray", () => {
    const container = renderView(OutputView, {
      toolName: "bash",
      args: { command: "npm test" },
      result: "ok",
    });

    expect(container.querySelector(".output-error")).toBeNull();
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
    // The list keeps the results' own numbers.
    expect(
      Array.from(container.querySelectorAll(".result-item")).map((item) =>
        item.getAttribute("value"),
      ),
    ).toEqual(["1", "2"]);
    const link = await screen.findByRole("link", { name: "Herdr docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/herdr");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("keeps the original number and says so when only part of the list split", async () => {
    const container = renderView(WebSearchView, {
      toolName: "web_search",
      args: { query: "herdr" },
      result: "1. plain entry\n2. **Second result**\n   other.example",
    });

    // The unsplit line stays in the preamble, so the header must not claim the
    // list has one result, and the surviving entry keeps number 2.
    expect(
      screen.getByText("切分出 1 条结果（其余文字保留在原文中）"),
    ).toBeTruthy();
    expect(
      container.querySelector(".result-item")?.getAttribute("value"),
    ).toBe("2");
    // The preamble is Markdown, so its own `1. ` becomes a list marker; the
    // text itself is still shown.
    expect(await screen.findByText("plain entry")).toBeTruthy();
  });

  it("keeps the keys unique and omits value 0 when the source repeats a number", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const container = renderView(WebSearchView, {
        toolName: "web_search",
        args: { query: "herdr" },
        result: "1. **First**\n1. **Second**\n0. **Zero**",
      });

      // The original numbering is kept as-is, including the repeat and the 0;
      // `0` is not emitted because HTML discards `value="0"`.
      expect(
        Array.from(container.querySelectorAll(".result-item")).map((item) =>
          item.getAttribute("value"),
        ),
      ).toEqual(["1", "1", null]);
      // A repeated number must not produce a duplicate-key warning.
      expect(error).not.toHaveBeenCalled();
      expect(await screen.findByText("First")).toBeTruthy();
    } finally {
      error.mockRestore();
    }
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

  it("scrolls a long body in the shared window instead of folding it", () => {
    const body = Array.from({ length: 60 }, (_value, index) => `Body ${index + 1}`).join("\n\n");
    const container = renderView(WebFetchView, {
      toolName: "web_fetch",
      args: { url: "https://example.com" },
      result: body,
    });

    expect(container.querySelectorAll(".tool-view-scroll")).toHaveLength(1);
    // 60 paragraphs joined by blank lines: 60 text lines plus 59 empty ones.
    expect(screen.getByText("共 119 行 · 可滚动查看")).toBeTruthy();
    expect(expandControls(container)).toEqual([]);
  });
});

describe("TodoView", () => {
  it("shows only what this call changed", () => {
    const container = renderView(TodoView, {
      toolName: "todo",
      args: { action: "update", id: 3 },
      display: {
        todo: {
          action: "update",
          taskId: 3,
          subject: "第三个任务",
          status: "in_progress",
          activeForm: "正在做第三个",
        },
      },
    });

    expect(screen.getByText("更新计划")).toBeTruthy();
    expect(texts(container, ".change-key")).toEqual(["任务", "标题", "状态"]);
    expect(texts(container, ".change-value")).toEqual([
      "#3",
      "第三个任务",
      "进行中（正在做第三个）",
    ]);
    expect(container.querySelector(".test-fallback")).toBeNull();
  });

  it("falls back to the arguments when nothing was projected", () => {
    const container = renderView(TodoView, {
      toolName: "todo",
      args: { action: "create", subject: "新任务", status: "pending" },
    });

    expect(screen.getByText("新增计划")).toBeTruthy();
    expect(texts(container, ".change-value")).toEqual(["新任务", "待办"]);
  });

  it("falls back when the call carries neither action nor fields", () => {
    const container = renderView(TodoView, { toolName: "todo", args: {} });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });
});

describe("QuestionView", () => {
  const args: ChatJsonObject = {
    questions: [
      {
        header: "Approach",
        question: "Which one?",
        options: [{ label: "A", description: "first" }, { label: "B" }],
      },
      { header: "Second", question: "And this?", options: [{ label: "C" }] },
    ],
  };

  it("shows the questions, marks the chosen option and the cancelled state", () => {
    const container = renderView(QuestionView, {
      toolName: "ask_user_question",
      args,
      display: {
        question: {
          answers: [
            { questionIndex: 0, question: "Which one?", kind: "option", answer: "A" },
            { questionIndex: 1, question: "And this?", kind: "custom", answer: "typed" },
          ],
          cancelled: false,
          globalNote: "note",
        },
      },
    });

    expect(screen.getByText("2 个问题")).toBeTruthy();
    expect(container.querySelectorAll(".question-item")).toHaveLength(2);
    expect(container.querySelectorAll(".question-option")).toHaveLength(3);
    expect(container.querySelectorAll(".question-option-chosen")).toHaveLength(1);
    expect(texts(container, ".answer-value")).toEqual(["A", "typed"]);
    expect(texts(container, ".answer-kind")).toEqual(["已选择", "自定义回答"]);
    expect(screen.getByText("note")).toBeTruthy();
    expect(container.textContent).not.toContain("没有回答");
  });

  it("reports a cancelled questionnaire without inventing answers", () => {
    const container = renderView(QuestionView, {
      toolName: "ask_user_question",
      args,
      display: { question: { answers: [], cancelled: true } },
    });

    expect(screen.getByText("用户取消了这次询问")).toBeTruthy();
    expect(container.querySelectorAll(".question-item")).toHaveLength(2);
    expect(texts(container, ".answer-value")).toEqual([]);
    expect(container.querySelector(".test-fallback")).toBeNull();
  });

  it("still shows the questions when no answers were projected", () => {
    const container = renderView(QuestionView, {
      toolName: "ask_user_question",
      args,
    });

    expect(screen.getByText("2 个问题")).toBeTruthy();
    expect(texts(container, ".question-text")).toEqual([
      "Which one?",
      "And this?",
    ]);
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("lists an answer that matches no question instead of attaching it", () => {
    const container = renderView(QuestionView, {
      toolName: "ask_user_question",
      args,
      display: {
        question: {
          answers: [{ kind: "custom", answer: "orphan" }],
          cancelled: false,
        },
      },
    });

    expect(screen.getByText("其他回答")).toBeTruthy();
    expect(screen.getByText("orphan")).toBeTruthy();
    expect(texts(container, ".answer-value")).toEqual(["orphan"]);
  });

  it("falls back when there is neither a question nor an answer", () => {
    const container = renderView(QuestionView, {
      toolName: "ask_user_question",
      args: {},
    });
    expect(container.querySelector(".test-fallback")).toBeTruthy();
  });
});

describe("toolViewFor", () => {
  it("maps the registered tools and leaves unknown ones to the fallback", () => {
    expect(toolViewFor("edit")).toBe(DiffView);
    expect(toolViewFor("read")).toBe(CodeView);
    expect(toolViewFor("ffgrep")).toBe(MatchListView);
    expect(toolViewFor("web_fetch")).toBe(WebFetchView);
    expect(toolViewFor("todo")).toBe(TodoView);
    expect(toolViewFor("ask_user_question")).toBe(QuestionView);
    expect(toolViewFor("mcp__unknown_tool")).toBeUndefined();
    expect(toolViewFor("")).toBeUndefined();
  });

  it("does not return inherited members for a tool named after one", () => {
    // A plain index lookup would return `Object` / `Object.prototype` /
    // `toString` here, and React would then fail to render the ChatView.
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(toolViewFor(name), name).toBeUndefined();
    }
  });
});

describe("todo action word", () => {
  it("shows an unknown action verbatim instead of an inherited member", () => {
    const container = renderView(TodoView, {
      toolName: "todo",
      args: { action: "constructor", id: 1 },
    });

    // `Object.prototype.constructor` is a function; as a React child it throws.
    expect(container.querySelector(".tool-view-note")?.textContent).toBe(
      "constructor",
    );
    expect(container.textContent).toContain("#1");
  });
});
