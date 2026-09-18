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

import { SCROLL_WINDOW_LINES } from "./toolViews/ScrollBox";

const STYLES = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8",
);

/**
 * Every rule of the stylesheet as `{ selectors, body }`.
 *
 * Comments are stripped from the selector text (a comment directly above a rule
 * is not part of its selector), so a rule can be looked up by its exact selector
 * list and an absent rule can be asserted as absent even when a comment next to
 * it mentions the selector.
 */
function rulesOf(): Array<{ selectors: string; body: string }> {
  return Array.from(STYLES.matchAll(/([^{}]*)\{([^{}]*)\}/gu)).map((rule) => ({
    selectors: (rule[1] ?? "").replace(/\/\*[\s\S]*?\*\//gu, "").trim(),
    body: rule[2] ?? "",
  }));
}

/**
 * Body of the one rule whose selector list is exactly `selector`.
 *
 * The whole selector list has to match: `.code-line {` also appears as the tail
 * of the combined `.diff-line,\n.code-line {` rule, which is a different rule.
 */
function cssRule(selector: string): string {
  const rule = rulesOf().find((candidate) => candidate.selectors === selector);
  if (!rule) throw new Error(`stylesheet has no rule for ${selector}`);
  return rule.body;
}

/** Whether any rule's selector list is exactly `selector`. */
function hasRule(selector: string): boolean {
  return rulesOf().some((rule) => rule.selectors === selector);
}

/** Whether any rule's selector list mentions `fragment` at all. */
function anySelectorIncludes(fragment: string): boolean {
  return rulesOf().some((rule) => rule.selectors.includes(fragment));
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
    expect(Number(cap?.[1])).toBe(SCROLL_WINDOW_LINES);
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
    expect(anySelectorIncludes("tool-view-expand")).toBe(false);
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
    expect(anySelectorIncludes(".diff-line-context")).toBe(false);
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
    // `.output-body` gives this rule one more class than `.tool-detail pre`
    // (which sets the gray for every `<pre>` in the panel), so the red wins
    // whatever the source order is.
    expect(cssRule(".output-body pre.output-error")).toContain("color: #c2635d");
  });

  it("keys the error red on the failing result, not on an ancestor (F1)", () => {
    expect(cssRule(".tool-result-error pre")).toContain("color: #c2635d");
    // An activity group carries `tool-error` when *any* of its calls failed, so
    // these ancestor-keyed rules painted the successful siblings' results red.
    expect(hasRule(".tool-error .tool-detail pre")).toBe(false);
    expect(anySelectorIncludes(".tool-error .tool-result")).toBe(false);
    // The group's own red state icon stays as it was.
    expect(cssRule(".tool-error .tool-state")).toContain("color: #c2635d");
  });
});

describe("the generic Arguments/Result detail (F4)", () => {
  it("is bounded by the shared window, not by a scrolling `<pre>`", () => {
    const pre = cssRule(".tool-detail pre");
    expect(pre).not.toContain("max-height");
    expect(pre).not.toContain("overflow");
  });

  it("needs no `.tool-view` ancestor for that window", () => {
    // The variable is defined on the window itself, which is why the generic
    // detail (a failed, unknown or unparseable call) gets the same 16-line
    // window as the registered views do.
    expect(cssRule(".tool-view-scroll")).toContain("--tool-view-line-height:");
    expect(anySelectorIncludes(".tool-view .tool-view-scroll")).toBe(false);
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
