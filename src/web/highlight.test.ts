/**
 * Highlighting kernel.
 *
 * These run against the real shiki highlighter (no mock): the point of the
 * kernel is that real grammars load on demand and real token colors come out, and
 * that everything which cannot be highlighted comes back as `undefined` so the
 * caller keeps its plain text.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  codeLineText,
  highlightLines,
  languageForFence,
  languageForPath,
  resetHighlightCache,
  resetHighlighter,
} from "./highlight";

beforeEach(() => {
  resetHighlightCache();
});

describe("languageForPath", () => {
  it("maps every configured extension to its canonical shiki language", () => {
    const cases: Array<[string, string]> = [
      ["src/a.ts", "typescript"],
      ["src/a.mts", "typescript"],
      ["src/B.tsx", "tsx"],
      ["src/a.js", "javascript"],
      ["src/a.cjs", "javascript"],
      ["src/a.jsx", "jsx"],
      ["package.json", "json"],
      ["README.md", "markdown"],
      ["tools/x.py", "python"],
      ["run.sh", "shellscript"],
      ["run.bash", "shellscript"],
      ["styles.css", "css"],
      ["index.html", "html"],
      ["page.htm", "html"],
      ["ci.yml", "yaml"],
      ["main.go", "go"],
      ["lib.rs", "rust"],
    ];
    for (const [path, language] of cases) {
      expect(languageForPath(path), path).toBe(language);
    }
  });

  it("ignores the directory, a query string and the case of the extension", () => {
    expect(languageForPath("/Users/someone/src/App.TSX")).toBe("tsx");
    expect(languageForPath("src/a.ts?v=2")).toBe("typescript");
    expect(languageForPath("C:\\repo\\main.go")).toBe("go");
  });

  it("falls back to text instead of guessing", () => {
    for (const path of [
      "notes.txt",
      "Makefile",
      ".env",
      "src/.eslintrc",
      "archive.tar.gz",
      "",
      "src/noextension",
    ]) {
      expect(languageForPath(path), path).toBe("text");
    }
  });

  it("does not resolve names through Object.prototype", () => {
    for (const name of ["a.constructor", "a.__proto__", "a.toString"]) {
      expect(languageForPath(name), name).toBe("text");
    }
  });
});

describe("languageForFence", () => {
  it("accepts the short and long forms of a fence info string", () => {
    const cases: Array<[string, string]> = [
      ["ts", "typescript"],
      ["typescript", "typescript"],
      ["tsx", "tsx"],
      ["js", "javascript"],
      ["bash", "shellscript"],
      ["sh", "shellscript"],
      ["shell", "shellscript"],
      ["py", "python"],
      ["md", "markdown"],
      ["yml", "yaml"],
      ["rs", "rust"],
    ];
    for (const [info, language] of cases) {
      expect(languageForFence(info), info).toBe(language);
    }
  });

  it("keeps only the language of a longer info string", () => {
    expect(languageForFence("ts title=src/a.ts")).toBe("typescript");
    expect(languageForFence("tsx{1,3}")).toBe("tsx");
    expect(languageForFence("TS")).toBe("typescript");
    expect(languageForFence("  bash  ")).toBe("shellscript");
  });

  it("falls back to text for an empty or unknown fence", () => {
    expect(languageForFence("")).toBe("text");
    expect(languageForFence("   ")).toBe("text");
    expect(languageForFence("elixir")).toBe("text");
    expect(languageForFence("constructor")).toBe("text");
  });
});

describe("highlightLines", () => {
  it("returns one tokenized line per input line, in order", async () => {
    const lines = ["const a = 1;", "function f() {", '  return "hi";', "}"];
    const highlighted = await highlightLines(lines, "typescript", "light");

    expect(highlighted).toHaveLength(lines.length);
    expect(highlighted?.map((line) => tokenText(line))).toEqual(lines);
    // A real grammar produced real colors, and it left the tokens whose color is
    // only the theme foreground uncolored so the stylesheet keeps its own text
    // color (R8).
    const tokens = highlighted?.flatMap((line) => line.tokens) ?? [];
    expect(tokens.some((token) => token.color)).toBe(true);
    expect(tokens.some((token) => !token.color)).toBe(true);
  });

  it("uses a different palette for each surface", async () => {
    const code = ['const greeting = "hi";'];
    const light = await highlightLines(code, "typescript", "light");
    const dark = await highlightLines(code, "typescript", "dark");

    expect(colors(light)).not.toEqual(colors(dark));
    // The same content on both surfaces, so the row count cannot differ.
    expect(light?.map(tokenText)).toEqual(dark?.map(tokenText));
  });

  it("degrades to undefined for text, unknown languages and empty input", async () => {
    expect(await highlightLines(["plain"], "text", "light")).toBeUndefined();
    expect(await highlightLines(["plain"], "elixir", "light")).toBeUndefined();
    expect(await highlightLines([], "typescript", "light")).toBeUndefined();
  });

  it("memoizes on code, language and theme", async () => {
    const first = await highlightLines(["const a = 1;"], "typescript", "light");
    const same = await highlightLines(["const a = 1;"], "typescript", "light");
    // Identity, not just equality: a second request must not re-tokenize.
    expect(same).toBe(first);
    const otherTheme = await highlightLines(["const a = 1;"], "typescript", "dark");
    expect(otherTheme).not.toBe(first);
  });

  it("bounds the cache so a long session cannot grow it forever", async () => {
    const first = await highlightLines(["const a = 1;"], "typescript", "light");
    for (let index = 0; index < 64; index += 1) {
      await highlightLines([`const v${index} = ${index};`], "typescript", "light");
    }
    const again = await highlightLines(["const a = 1;"], "typescript", "light");
    expect(again).not.toBe(first);
    expect(again?.map(tokenText)).toEqual(first?.map(tokenText));
  });

  it("keeps working after the highlighter itself is dropped", async () => {
    const before = await highlightLines(["const a = 1;"], "typescript", "light");
    resetHighlighter();
    const after = await highlightLines(["const a = 1;"], "typescript", "light");
    expect(after?.map(tokenText)).toEqual(before?.map(tokenText));
  });
});

describe("codeLineText", () => {
  it("treats a trailing CR as a line terminator, as the tokenizer does", () => {
    expect(codeLineText("a\r")).toBe("a");
    expect(codeLineText("a")).toBe("a");
    expect(codeLineText("")).toBe("");
  });

  it("keeps a CRLF block aligned line for line", async () => {
    const lines = ["const a = 1;\r", "const b = 2;\r"];
    const highlighted = await highlightLines(lines, "typescript", "light");
    expect(highlighted).toHaveLength(2);
    expect(highlighted?.map(tokenText)).toEqual(["const a = 1;", "const b = 2;"]);
  });
});

function tokenText(line: { tokens: Array<{ content: string }> }): string {
  return line.tokens.map((token) => token.content).join("");
}

function colors(
  lines: Array<{ tokens: Array<{ content: string; color?: string }> }> | undefined,
): string[] {
  return (lines ?? []).flatMap((line) =>
    line.tokens.map((token) => `${token.content}#${token.color ?? ""}`),
  );
}
