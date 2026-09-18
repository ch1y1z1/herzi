/**
 * What the stylesheet promises the Rev.2 views.
 *
 * These are source assertions, not computed styles: the spec asks for the window
 * cap and the line height to come from one CSS variable, and jsdom does not
 * resolve custom properties or cascade. Reading the real `styles.css` keeps the
 * assertion about what ships, and pairing it with the DOM assertions in
 * `toolViews/views.test.tsx` (kind → class) covers both halves of the mapping.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SCROLL_BOX_LINES } from "./toolViews/ScrollBox";

const STYLES = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8",
);

/**
 * Body of the one rule whose selector list is exactly `selector`.
 *
 * The whole selector list has to match: `.code-line {` also appears as the tail
 * of the combined `.diff-line,\n.code-line {` rule, which is a different rule.
 */
function cssRule(selector: string): string {
  for (const rule of STYLES.matchAll(/([^{}]*)\{([^{}]*)\}/gu)) {
    const selectors = (rule[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .trim();
    if (selectors === selector) return rule[2] ?? "";
  }
  throw new Error(`stylesheet has no rule for ${selector}`);
}

describe("the shared scroll window", () => {
  it("caps the height and sets the row height from one variable", () => {
    const box = cssRule(".tool-view-scroll");

    expect(box).toContain("--tool-view-line-height: calc(10.5px * 1.55)");
    const cap =
      /max-height:\s*calc\((\d+)\s*\*\s*var\(--tool-view-line-height\)\)/u.exec(box);
    expect(cap).not.toBeNull();
    // The stylesheet and the component have to agree on how many lines that is,
    // or a view would say 可滚动查看 for content that fits.
    expect(Number(cap?.[1])).toBe(SCROLL_BOX_LINES);
    expect(box).toContain("overflow-y: auto");
    // `box-sizing: border-box` is global, so padding or a border would come out
    // of the 16 visible lines.
    expect(box).not.toMatch(/padding|border/u);
    // Scrolling is the affordance the spec asked for; it is not hidden.
    expect(box).not.toContain("scrollbar-width: none");
  });

  it("derives every tool-content row height from the same variable", () => {
    const rows: Array<[string, string]> = [
      [".diff-body,\n.code-body", "line-height: var(--tool-view-line-height)"],
      [".code-line", "min-height: var(--tool-view-line-height)"],
      [
        ".match-line-number,\n.match-line-text",
        "line-height: var(--tool-view-line-height)",
      ],
      [".path-list", "line-height: var(--tool-view-line-height)"],
    ];
    for (const [selector, declaration] of rows) {
      expect(cssRule(selector), selector).toContain(declaration);
    }
  });

  it("has no expand/collapse styling left to render (R3)", () => {
    expect(STYLES).not.toContain("tool-view-expand");
  });
});

describe("diff rows (R5)", () => {
  it("gives added and removed rows a band plus a 3px left bar", () => {
    const added = cssRule(".diff-line-add");
    expect(added).toContain("background:");
    // An inset shadow, not a border: a border would shift that row's gutter
    // column 3px to the right of the context rows.
    expect(added).toContain("box-shadow: inset 3px 0 0");
    expect(added).not.toContain("border-left");

    const removed = cssRule(".diff-line-remove");
    expect(removed).toContain("background:");
    expect(removed).toContain("box-shadow: inset 3px 0 0");
  });

  it("leaves context rows without a band", () => {
    // No rule of its own: the context row keeps the panel background.
    expect(STYLES).not.toContain(".diff-line-context");
  });

  it("keeps the gutter fixed, right-aligned and out of the selection", () => {
    const gutter = cssRule(".diff-line-number,\n.code-line-number,\n.match-line-number");
    expect(gutter).toContain("flex: 0 0 3.4em");
    expect(gutter).toContain("text-align: right");
    expect(gutter).toContain("user-select: none");
  });
});

describe("commands and errors (R5)", () => {
  it("marks the `$` prompt muted and non-selectable", () => {
    const prompt = cssRule(".output-prompt");
    expect(prompt).toContain("color: #a2a79c");
    expect(prompt).toContain("user-select: none");
  });

  it("colors a failed result red, over the panel's gray", () => {
    // `.tool-detail pre` sets the gray for every `<pre>` in the panel, so the
    // error rules have to be at least as specific as it.
    const viewRule = cssRule(".output-body pre.output-error");
    expect(viewRule).toContain("color: #c2635d");
    const fallbackRule = cssRule(".tool-error .tool-detail pre");
    expect(fallbackRule).toContain("color: #c2635d");
  });
});

describe("chat body code blocks (R7)", () => {
  it("lays the highlighted block out one line per span", () => {
    expect(cssRule(".code-block-line")).toContain("display: block");
    // The surrounding dark `pre` is untouched: R7 only routes the block through
    // the highlighting kernel.
    expect(cssRule(".markdown-body pre")).toContain("background: #20231f");
  });
});
