import { describe, expect, it } from "vitest";

import {
  detectTruncationNote,
  parseAskedQuestions,
  parseGrepText,
  parsePathList,
  parseWebFetchText,
  parseWebSearchText,
  readStartLine,
  resultLines,
  splitReadResult,
  todoChange,
  todoStatusLabel,
  toolResultText,
  truncationSummary,
} from "./toolText";

describe("toolResultText", () => {
  it("returns a plain string result unchanged", () => {
    expect(toolResultText("hello")).toBe("hello");
  });

  it("reads the text out of a packaged tool result", () => {
    expect(
      toolResultText({ type: "herzi-tool-result", value: "text", images: [] }),
    ).toBe("text");
    expect(
      toolResultText({
        type: "herzi-tool-result",
        value: ["a", "b"],
        images: [],
      }),
    ).toBe("a\nb");
  });

  it("refuses results that are not text", () => {
    // An image result is rendered by the image preview, never as text.
    expect(
      toolResultText({
        type: "herzi-tool-result",
        value: "",
        images: [{ image: "data:image/png;base64,AA" }],
      }),
    ).toBeUndefined();
    expect(toolResultText(42)).toBeUndefined();
    expect(toolResultText({ type: "other", value: "x" })).toBeUndefined();
    expect(toolResultText(undefined)).toBeUndefined();
  });
});

describe("resultLines", () => {
  it("drops only the final-newline artifact", () => {
    expect(resultLines("a\nb\n")).toEqual(["a", "b"]);
    expect(resultLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(resultLines("")).toEqual([""]);
  });
});

describe("splitReadResult", () => {
  it("removes the trailing range marker and the blank separator", () => {
    const result = splitReadResult(
      "line 1\nline 2\n\n[Showing lines 1-2 of 40. Use offset=3 to continue.]",
    );
    expect(result.body).toBe("line 1\nline 2");
    expect(result.marker).toBe(
      "[Showing lines 1-2 of 40. Use offset=3 to continue.]",
    );
  });

  it("removes the byte-limited and the range-less marker shapes", () => {
    expect(
      splitReadResult("x\n\n[Showing lines 10-11 of 99 (50KB limit). Use offset=12 to continue.]")
        .body,
    ).toBe("x");
    expect(
      splitReadResult("x\n\n[4 more lines in file. Use offset=12 to continue.]").body,
    ).toBe("x");
  });

  it("keeps text whose last line is not a known marker", () => {
    const text = "content\n\n[some other note]";
    expect(splitReadResult(text)).toEqual({ body: text });
    expect(splitReadResult("")).toEqual({ body: "" });
  });
});

describe("readStartLine", () => {
  it("uses the requested offset", () => {
    expect(readStartLine({ offset: 100 }, undefined)).toBe(100);
  });

  it("falls back to the server range and then to line 1", () => {
    expect(readStartLine({}, { readRange: { from: 42, to: 50 } })).toBe(42);
    expect(readStartLine({}, undefined)).toBe(1);
  });

  it("shows no line numbers when a present offset is not a number", () => {
    expect(readStartLine({ offset: "100" }, undefined)).toBeUndefined();
    expect(readStartLine({ offset: 0 }, undefined)).toBeUndefined();
  });
});

describe("parseGrepText", () => {
  it("groups matches and context lines by file header", () => {
    const parsed = parseGrepText(
      [
        "src/a.ts",
        "12: const value = 1;",
        "13- const other = 2;",
        "src/b.ts",
        "42: match here",
        "[2 matches in 2 files]",
      ].join("\n"),
    );
    expect(parsed?.matched).toBe(2);
    expect(parsed?.files).toHaveLength(2);
    expect(parsed?.files[0]).toMatchObject({
      path: "src/a.ts",
      matches: [
        { line: 12, text: " const value = 1;", isMatch: true },
        { line: 13, text: " const other = 2;", isMatch: false },
      ],
    });
    expect(parsed?.notes).toEqual(["[2 matches in 2 files]"]);
  });

  it("keeps matches that appear before any file header", () => {
    const parsed = parseGrepText("7: bare match");
    expect(parsed?.files).toEqual([
      { matches: [{ line: 7, text: " bare match", isMatch: true }] },
    ]);
  });

  it("refuses prose, header-only and empty results", () => {
    expect(parseGrepText("No matches found")).toBeUndefined();
    expect(parseGrepText("src/a.ts\nsrc/b.ts")).toBeUndefined();
    expect(parseGrepText("")).toBeUndefined();
    expect(parseGrepText("   ")).toBeUndefined();
  });

  it("reads CRLF output instead of failing the whole parse", () => {
    // A matched line of a CRLF file ends with a carriage return; `.` and
    // `looksLikePath` both reject it, so the line terminator is stripped first.
    const parsed = parseGrepText("src/a.ts\r\n12: hit\r\n13- ctx\r\n");
    expect(parsed?.files).toEqual([
      {
        path: "src/a.ts",
        matches: [
          { line: 12, text: " hit", isMatch: true },
          { line: 13, text: " ctx", isMatch: false },
        ],
      },
    ]);
  });

  it("documents the one file name that is indistinguishable from a match", () => {
    // The tool prints a bare path as the header, so a file named `12:foo.ts`
    // produces a line that reads exactly like a match of line 12. Nothing in
    // the text can tell them apart; the line is read as a match.
    const parsed = parseGrepText("12:foo.ts\n1: hit");
    expect(parsed?.files).toEqual([
      {
        matches: [
          { line: 12, text: "foo.ts", isMatch: true },
          { line: 1, text: " hit", isMatch: true },
        ],
      },
    ]);
  });
});

describe("parsePathList", () => {
  it("reads one path per line", () => {
    expect(parsePathList("src/a.ts\nsrc/b/c.ts")).toEqual({
      paths: ["src/a.ts", "src/b/c.ts"],
      notes: [],
    });
  });

  it("refuses prose and empty results", () => {
    expect(parsePathList("No files found")).toBeUndefined();
    expect(parsePathList("two words.txt")).toBeUndefined();
    expect(parsePathList("")).toBeUndefined();
  });
});

describe("parseWebSearchText", () => {
  it("splits numbered results and keeps the preamble", () => {
    const parsed = parseWebSearchText(
      [
        "Some preamble",
        "1. **First**",
        "   example.com · 2026-01-01",
        "2. **Second**",
        "   other.example",
      ].join("\n"),
    );
    expect(parsed?.preamble).toBe("Some preamble");
    expect(parsed?.partial).toBe(false);
    expect(parsed?.entries).toEqual([
      { number: 1, text: "**First**\n   example.com · 2026-01-01" },
      { number: 2, text: "**Second**\n   other.example" },
    ]);
  });

  it("keeps the original numbers and flags a partial split", () => {
    const parsed = parseWebSearchText("1. plain\n2. **bold**");
    expect(parsed?.partial).toBe(true);
    expect(parsed?.entries).toEqual([{ number: 2, text: "**bold**" }]);
    expect(parsed?.preamble).toBe("1. plain");
  });

  it("refuses a result without numbered entries and an empty one", () => {
    expect(parseWebSearchText("just one paragraph")).toBeUndefined();
    expect(parseWebSearchText("1. no bold title")).toBeUndefined();
    expect(parseWebSearchText("")).toBeUndefined();
  });
});

describe("parseWebFetchText", () => {
  it("takes the first heading as the title and keeps the body", () => {
    expect(parseWebFetchText("# Title\n\nBody text")).toEqual({
      title: "Title",
      body: "Body text",
    });
  });

  it("tolerates a leading blank line and reports a truncation note", () => {
    const parsed = parseWebFetchText(
      "\n## Subtitle\n\nBody\n\n[Content truncated at 20000 characters]",
    );
    expect(parsed.title).toBe("Subtitle");
    expect(parsed.body).toContain("Body");
    expect(parsed.truncationNote).toBe("[Content truncated at 20000 characters]");
  });

  it("returns no title for a result that does not start with a heading", () => {
    const parsed = parseWebFetchText("plain body only");
    expect(parsed.title).toBeUndefined();
    expect(parsed.body).toBe("plain body only");
    expect(parsed.truncationNote).toBeUndefined();
  });
});

describe("detectTruncationNote", () => {
  it("returns the short line that mentions truncation", () => {
    expect(detectTruncationNote("a\n[truncated output]\nb")).toBe(
      "[truncated output]",
    );
  });

  it("ignores long paragraphs and text without a note", () => {
    expect(detectTruncationNote(`x${"y".repeat(300)} truncated`)).toBeUndefined();
    expect(detectTruncationNote("nothing to report")).toBeUndefined();
  });
});

describe("parseAskedQuestions", () => {
  it("reads the questions, their options and the multi-select flag", () => {
    expect(
      parseAskedQuestions({
        questions: [
          {
            header: "Approach",
            question: "Which one?",
            multiSelect: true,
            options: [
              { label: "A", description: "first" },
              { label: "B" },
              { nope: true },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        header: "Approach",
        question: "Which one?",
        multiSelect: true,
        options: [{ label: "A", description: "first" }, { label: "B" }],
      },
    ]);
  });

  it("refuses other shapes and empty input", () => {
    expect(parseAskedQuestions({ questions: "Which one?" })).toBeUndefined();
    expect(parseAskedQuestions({ questions: ["A?"] })).toBeUndefined();
    expect(parseAskedQuestions({ questions: [] })).toBeUndefined();
    expect(parseAskedQuestions({})).toBeUndefined();
  });
});

describe("todoChange", () => {
  it("prefers the projected values and falls back to the arguments", () => {
    expect(
      todoChange(
        { action: "update", taskId: 3, status: "completed" },
        { action: "update", id: 3, subject: "from args", blockedBy: [1] },
      ),
    ).toEqual({
      action: "update",
      taskId: 3,
      subject: "from args",
      status: "completed",
      blockedBy: [1],
    });
  });

  it("invents nothing when neither source has a field", () => {
    expect(todoChange(undefined, {})).toEqual({});
    expect(todoChange({ action: "list" }, { action: "list" })).toEqual({
      action: "list",
    });
  });
});

describe("todoStatusLabel", () => {
  it("maps the known statuses and keeps unknown ones readable", () => {
    expect(todoStatusLabel("in_progress")).toBe("进行中");
    expect(todoStatusLabel("completed")).toBe("已完成");
    expect(todoStatusLabel("something-new")).toBe("something-new");
  });
});

describe("truncationSummary", () => {
  it("names the limit that was hit and the reported counts", () => {
    expect(
      truncationSummary({
        truncated: true,
        by: "lines",
        outputLines: 20,
        totalLines: 90,
      }),
    ).toBe("输出被截断（达到行数上限），共 90 行，本次返回 20 行");
    expect(truncationSummary({ truncated: true })).toBe("输出被截断");
  });

  it("says nothing when nothing was truncated", () => {
    expect(truncationSummary(undefined)).toBeUndefined();
    expect(truncationSummary({ truncated: false })).toBeUndefined();
  });
});
