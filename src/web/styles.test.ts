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
 * Every rule of the stylesheet as `{ selectors, body, order }`.
 *
 * Comments are stripped from the selector text (a comment directly above a rule
 * is not part of its selector), so a rule can be looked up by its exact selector
 * list and an absent rule can be asserted as absent even when a comment next to
 * it mentions the selector. `order` is the position in the file, which is CSS's
 * tie-breaker once two matching declarations have the same specificity.
 */
interface StylesheetRule {
  selectors: string[];
  body: string;
  order: number;
}

function rulesOf(): StylesheetRule[] {
  return Array.from(STYLES.matchAll(/([^{}]*)\{([^{}]*)\}/gu)).map(
    (rule, order) => ({
      selectors: normalize(rule[1] ?? "")
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean),
      body: rule[2] ?? "",
      order,
    }),
  );
}

/** Whitespace- and comment-insensitive form, so `a,\nb` equals `a, b`. */
function normalize(selectors: string): string {
  return selectors
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Body of the one rule whose selector list is exactly `selector`.
 *
 * The whole selector list has to match: `.code-line {` also appears as the tail
 * of the combined `.diff-line,\n.code-line {` rule, which is a different rule.
 */
function cssRule(selector: string): string {
  const wanted = normalize(selector);
  const rule = rulesOf().find(
    (candidate) => candidate.selectors.join(", ") === wanted,
  );
  if (!rule) throw new Error(`stylesheet has no rule for ${selector}`);
  return rule.body;
}

/** Whether any rule's selector list is exactly `selector`. */
function hasRule(selector: string): boolean {
  const wanted = normalize(selector);
  return rulesOf().some((rule) => rule.selectors.join(", ") === wanted);
}

/** Whether any rule's selector list mentions `fragment` at all. */
function anySelectorIncludes(fragment: string): boolean {
  return rulesOf().some((rule) =>
    rule.selectors.some((selector) => selector.includes(fragment)),
  );
}

/** The rightmost compound of a selector, i.e. the element it targets. */
function lastCompound(selector: string): string {
  return selector.split(/[\s>+~]/u).pop() ?? "";
}

/*
 * A miniature cascade resolver.
 *
 * The second review found that "the rule exists in the source" is not the same
 * as "the rule wins" (N1: two equally specific rules, the later one gray, so the
 * error red never rendered). jsdom cannot answer it either, so the questions
 * that need a winner are answered here from the real stylesheet: match the
 * selectors against a described ancestor chain, then pick the winner the way CSS
 * does — specificity first, source order second.
 *
 * Only the subset this file needs is modelled: element names, `.class`es and the
 * descendant / child combinators. `styles.test.ts` guards that every rule able to
 * color a `<pre>` stays inside that subset, so the resolver cannot silently
 * ignore a rule.
 */

/** `[ids, classes, elements]`, per CSS Selectors §17. */
function specificity(selector: string): [number, number, number] {
  const counts: [number, number, number] = [0, 0, 0];
  const tokens = selector.matchAll(
    /::[a-z-]+|\([a-z-]+\)|#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[a-z-]+|[a-zA-Z][\w-]*|\*/gu,
  );
  for (const [token] of tokens) {
    if (token.startsWith("#")) counts[0] += 1;
    else if (token.startsWith(".") || token.startsWith("[")) counts[1] += 1;
    else if (token.startsWith(":")) counts[1] += 1;
    else if (token === "*") continue;
    else counts[2] += 1;
  }
  return counts;
}

function compareSpecificity(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** `"div.a.b"` → element `div` plus the classes `a`, `b`. */
function parseCompound(compound: string): { element: string; classes: string[] } {
  const [element = "", ...classes] = compound.split(".");
  return { element, classes };
}

function compoundMatches(compound: string, entry: string): boolean {
  const wanted = parseCompound(compound);
  const actual = parseCompound(entry);
  // An element-less compound (`.foo`) matches any element.
  if (wanted.element && wanted.element !== actual.element) return false;
  return wanted.classes.every((name) => actual.classes.includes(name));
}

/** Splits a selector into compounds and the combinators between them. */
function tokenizeSelector(selector: string): {
  compounds: string[];
  combinators: string[];
} {
  const tokens = selector.replace(/([>+~])/gu, " $1 ").trim().split(/\s+/u);
  const compounds: string[] = [];
  const combinators: string[] = [];
  let pending = " ";
  for (const token of tokens) {
    if (token === ">" || token === "+" || token === "~") {
      pending = token;
      continue;
    }
    if (compounds.length) combinators.push(pending);
    compounds.push(token);
    pending = " ";
  }
  return { compounds, combinators };
}

/**
 * Whether `selector` matches `path`, an ancestor→target chain of compound
 * descriptors like `"div.tool-detail"` or `"section.tool-result.tool-result-error"`.
 */
function matchesPath(selector: string, path: string[]): boolean {
  const { compounds, combinators } = tokenizeSelector(selector);
  const last = compounds.length - 1;
  const target = path[path.length - 1] ?? "";
  if (last < 0 || !compoundMatches(compounds[last] as string, target)) return false;

  const walk = (compoundIndex: number, pathIndex: number): boolean => {
    if (compoundIndex === 0) return true;
    const combinator = combinators[compoundIndex - 1] ?? " ";
    const previous = compounds[compoundIndex - 1] as string;
    if (combinator === ">") {
      return (
        pathIndex > 0 &&
        compoundMatches(previous, path[pathIndex - 1] as string) &&
        walk(compoundIndex - 1, pathIndex - 1)
      );
    }
    if (combinator !== " ") return false; // sibling combinators are not modelled
    for (let index = pathIndex - 1; index >= 0; index -= 1) {
      if (compoundMatches(previous, path[index] as string) && walk(compoundIndex - 1, index)) {
        return true;
      }
    }
    return false;
  };

  return walk(last, path.length - 1);
}

/** The declarations of a rule body, keyed by property name. */
function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}

/**
 * The `color` CSS would compute for `path` from this stylesheet alone, or
 * `undefined` when nothing declares one.
 */
function resolvedColor(path: string[]): string | undefined {
  const candidates: Array<{ color: string; specificity: [number, number, number]; order: number }> = [];
  for (const rule of rulesOf()) {
    const color = declarations(rule.body).get("color");
    if (!color) continue;
    for (const selector of rule.selectors) {
      if (matchesPath(selector, path)) {
        candidates.push({ color, specificity: specificity(selector), order: rule.order });
        break;
      }
    }
  }
  candidates.sort(
    (a, b) =>
      compareSpecificity(b.specificity, a.specificity) || b.order - a.order,
  );
  return candidates[0]?.color;
}

/* The `<pre>`s of a tool detail, as the class chains `ChatView.tsx` renders. */
const FAILED_RESULT_PRE = [
  "details.activity-item.tool-item.tool-error",
  "div.tool-detail",
  "section.tool-result.tool-result-error",
  "div.tool-view-scroll",
  "pre",
];
/** A successful call inside the same activity group, which is itself marked. */
const SIBLING_RESULT_PRE = [
  "details.activity-item.activity-tool-group.tool-error",
  "details.activity-item.tool-item",
  "div.tool-detail",
  "section.tool-result",
  "div.tool-view-scroll",
  "pre",
];
/** The Arguments section of that same failed call. */
const ARGUMENTS_PRE = [
  "details.activity-item.tool-item.tool-error",
  "div.tool-detail",
  "section.tool-data",
  "div.tool-view-scroll",
  "pre",
];
/** A failed `bash` output, which renders inside the registered view. */
const FAILED_OUTPUT_PRE = [
  "details.activity-item.tool-item.tool-error",
  "div.tool-detail",
  "div.tool-view.output-view",
  "div.output-body",
  "div.tool-view-scroll",
  "pre.output-text.output-error",
];

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
    // of the window's 16 code lines.
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
    expect(cssRule(".tool-detail .tool-result-error pre")).toContain("color: #c2635d");
    // An activity group carries `tool-error` when *any* of its calls failed, so
    // these ancestor-keyed rules painted the successful siblings' results red.
    expect(hasRule(".tool-error .tool-detail pre")).toBe(false);
    expect(anySelectorIncludes(".tool-error .tool-result")).toBe(false);
    // The group's own red state icon stays as it was.
    expect(cssRule(".tool-error .tool-state")).toContain("color: #c2635d");
  });
});

describe("the error red actually wins the cascade (N1)", () => {
  it("models every rule that can color a `<pre>` (guard for the resolver)", () => {
    const preSelectors = rulesOf()
      .flatMap((rule) => rule.selectors)
      .filter((selector) => /^pre(\.[\w-]+)*$/u.test(lastCompound(selector)));
    // A new rule targeting a `<pre>` must show up here, so it cannot be added
    // outside the resolver's reach without someone updating this list.
    expect(new Set(preSelectors)).toEqual(
      new Set([
        ".markdown-body pre",
        ".tool-detail .tool-result-error pre",
        ".tool-detail pre",
        ".output-body pre.output-error",
      ]),
    );
    // …and the resolver only handles element names and classes, so every one of
    // them has to be expressible in that subset.
    for (const selector of preSelectors) {
      for (const compound of selector.split(/[\s>+~]/u)) {
        expect(compound, selector).toMatch(/^[a-zA-Z]*(\.[\w-]+)*$/u);
      }
    }
  });

  it("renders the failing result red", () => {
    expect(resolvedColor(FAILED_RESULT_PRE)).toBe("#c2635d");
  });

  it("renders a failed call's view output red too", () => {
    expect(resolvedColor(FAILED_OUTPUT_PRE)).toBe("#c2635d");
  });

  it("leaves a successful sibling in a failed group gray", () => {
    // The group is marked `tool-error` here and the sibling is not: this is the
    // exact shape of the leak the first review found (F1).
    expect(resolvedColor(SIBLING_RESULT_PRE)).toBe("#5e635a");
  });

  it("leaves the Arguments section gray", () => {
    expect(resolvedColor(ARGUMENTS_PRE)).toBe("#5e635a");
  });

  it("resolves colors with CSS's own precedence (specificity, then order)", () => {
    // The resolver is only usable as evidence if it implements what a browser
    // does. These are the two rules that compete for the failing result's
    // `<pre>`; the red one has to out-specify the gray one, because equal
    // specificity (what N1 shipped) lets the later gray rule win.
    expect(specificity(".tool-detail pre")).toEqual([0, 1, 1]);
    expect(specificity(".tool-detail .tool-result-error pre")).toEqual([0, 2, 1]);
    expect(
      compareSpecificity(
        specificity(".tool-detail .tool-result-error pre"),
        specificity(".tool-detail pre"),
      ),
    ).toBeGreaterThan(0);
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
