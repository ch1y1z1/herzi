/**
 * Syntax highlighting kernel (shiki, loaded on demand).
 *
 * One kernel serves both surfaces that show code: the tool detail views
 * (`read` / `write` / `edit`, on the light panel) and the Markdown fenced code
 * blocks (on the dark `.markdown-body pre`). They use the same languages, the
 * same tokenizer and the same "highlight later, plain text now" contract, and
 * differ only in the theme, which is part of the cache key.
 *
 * Rules that every caller depends on:
 *
 * - **Nothing loads until something is actually highlighted.** The highlighter,
 *   the theme and each language are `import()`ed on first use, so a session that
 *   never opens a code view pays nothing.
 * - **Failure is not an error path.** An unsupported language, a tokenizer that
 *   throws or a language that fails to load all return `undefined`, and the
 *   caller renders the plain text it already has. The number of lines never
 *   changes: `highlightLines` is given the caller's own line array and returns
 *   at most that many entries, so nothing can jump or duplicate.
 * - **No new palette.** Token colors equal to the theme's own foreground are
 *   dropped, so uncolored code keeps the color the surrounding stylesheet
 *   already gives it (`#5e635a` in the views, `#e7e8e2` in the chat body) and
 *   only syntax accents are added.
 */

import type { createHighlighterCore } from "shiki/core";

/** Language id used for everything that cannot or must not be highlighted. */
export const TEXT_LANGUAGE = "text";

/**
 * The two surfaces. `light` is the tool detail panel (`#f1f2ed` behind code);
 * `dark` is the chat body's fenced code block (`#20231f`).
 */
export type HighlightThemeName = "light" | "dark";

/**
 * Built-in shiki themes, one per surface: `github-light`'s accents stay legible
 * on the light panel and on the diff bands, `github-dark-default`'s match the
 * chat body's existing dark code block. The theme's own background is never
 * used — the stylesheet keeps the current one.
 */
const THEME_NAMES: Record<HighlightThemeName, string> = {
  light: "github-light",
  dark: "github-dark-default",
};

const THEME_LOADERS: Record<HighlightThemeName, () => Promise<unknown>> = {
  light: () => import("shiki/themes/github-light.mjs"),
  dark: () => import("shiki/themes/github-dark-default.mjs"),
};

/**
 * Languages `languageForPath` / `languageForFence` may return. Everything else
 * is `text`. The set is deliberately small: 13 grammars instead of shiki's ~200,
 * because each one is a separate lazily-loaded chunk.
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
};

/** File extensions and fence aliases → canonical shiki language id. */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  python: "python",
  sh: "shellscript",
  bash: "shellscript",
  shell: "shellscript",
  zsh: "shellscript",
  shellscript: "shellscript",
  css: "css",
  html: "html",
  htm: "html",
  yml: "yaml",
  yaml: "yaml",
  go: "go",
  rs: "rust",
  rust: "rust",
};

/**
 * Language of a file path, from its extension: `src/a.tsx` → `tsx`. A path with
 * no extension, a dotfile, or an extension outside the list is `text` — the
 * views show it as plain code rather than guessing.
 */
export function languageForPath(path: string): string {
  const withoutQuery = path.split(/[?#]/u)[0] ?? "";
  const name = withoutQuery.split(/[\\/]/u).pop() ?? "";
  const dot = name.lastIndexOf(".");
  // `dot <= 0` covers both "no extension" and ".env"-style dotfiles, whose name
  // is not an extension.
  if (dot <= 0) return TEXT_LANGUAGE;
  return languageForAlias(name.slice(dot + 1));
}

/**
 * Language of a fenced code block, from the markdown info string: `ts`,
 * ```` ```bash ````, ````` ```tsx{1,3} ````` (the trailing brace hint is not part
 * of the language). Anything unknown is `text`.
 */
export function languageForFence(info: string): string {
  const first = info.trim().split(/\s/u)[0] ?? "";
  const name = first.split("{")[0] ?? "";
  return languageForAlias(name);
}

/**
 * The text one line contributes to a highlighted block.
 *
 * A trailing `\r` is a line terminator, not code: shiki drops it while splitting,
 * so the same rule is applied on both sides of the tokenizer and a CRLF file is
 * still highlighted (and still compared correctly) instead of silently losing
 * its colors. `\r` is invisible either way.
 */
export function codeLineText(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function languageForAlias(name: string): string {
  const key = name.trim().toLowerCase();
  // `hasOwn` (not a plain lookup) so a fence like ```constructor cannot reach
  // `Object.prototype` and come back as a language.
  return Object.hasOwn(LANGUAGE_ALIASES, key)
    ? (LANGUAGE_ALIASES[key] as string)
    : TEXT_LANGUAGE;
}

/**
 * `FontStyle` bits of a shiki token. Kept as the plain number shiki produces so
 * this module stays free of rendering concerns; `highlightReact.tsx` turns them
 * into CSS.
 */
export const FONT_STYLE_ITALIC = 1;
export const FONT_STYLE_BOLD = 2;
export const FONT_STYLE_UNDERLINE = 4;

export interface HighlightToken {
  content: string;
  /** Absent when the token has no color beyond the theme foreground. */
  color?: string;
  /** `FONT_STYLE_*` bits, absent when the token is upright. */
  fontStyle?: number;
}

/** One code line, tokenized. `tokens` always concatenates to that line's text. */
export interface HighlightedLine {
  tokens: HighlightToken[];
}

/** The part of a shiki token this module reads. */
interface TokenLike {
  content: string;
  color?: string | undefined;
  fontStyle?: number | undefined;
}

/**
 * Result of tokenizing one block. `null` is a **cached failure**: the language or
 * theme could not be loaded, so every later request for the same block skips the
 * work instead of retrying it on each render.
 */
type CacheEntry = HighlightedLine[] | null;

/**
 * Blocks kept tokenized. A long session can open many files, and a tokenized
 * file is roughly the size of its text; 64 blocks bounds that without evicting
 * the block the user is looking at.
 */
const MAX_CACHE_ENTRIES = 64;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

type Highlighter = Awaited<ReturnType<typeof createHighlighterCore>>;

let highlighterPromise: Promise<Highlighter> | undefined;
const loadedLanguages = new Set<string>();

/**
 * Tokenize `lines` for `lang` and `theme`, or `undefined` when they cannot be
 * highlighted (unsupported language, failed import, tokenizer error).
 *
 * `lines` is the caller's own line split, never re-split here, so the caller can
 * render one row per line whether or not highlighting succeeded.
 */
export async function highlightLines(
  lines: readonly string[],
  lang: string,
  theme: HighlightThemeName,
): Promise<HighlightedLine[] | undefined> {
  if (!lines.length) return undefined;
  // An unsupported language is not an error: the caller has plain text and the
  // answer "cannot highlight" lets it use that immediately.
  if (!Object.hasOwn(LANGUAGE_LOADERS, lang)) return undefined;

  const code = lines.map(codeLineText).join("\n");
  const key = `${theme}\u0000${lang}\u0000${code}`;

  if (cache.has(key)) {
    const hit = cache.get(key) as CacheEntry;
    // Refresh the insertion order: `Map` iterates oldest-first, which is what
    // the eviction below relies on.
    cache.delete(key);
    cache.set(key, hit);
    return hit ?? undefined;
  }

  const pending = inFlight.get(key);
  if (pending) return (await pending) ?? undefined;

  const request = tokenize(lines.length, code, lang, theme);
  inFlight.set(key, request);
  try {
    const entry = await request;
    store(key, entry);
    return entry ?? undefined;
  } finally {
    inFlight.delete(key);
  }
}

/** Test seam: forget every cached block (not the highlighter itself). */
export function resetHighlightCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Test seam: forget the cached highlighter, so the next call recreates it. */
export function resetHighlighter(): void {
  highlighterPromise = undefined;
  loadedLanguages.clear();
}

async function tokenize(
  lineCount: number,
  code: string,
  lang: string,
  theme: HighlightThemeName,
): Promise<CacheEntry> {
  try {
    const highlighter = await getHighlighter();
    await loadLanguage(highlighter, lang);
    const result = highlighter.codeToTokens(code, {
      lang,
      theme: THEME_NAMES[theme],
    });
    const foreground = normalizeColor(result.fg);
    const highlighted = result.tokens.map((tokens) => ({
      tokens: tokens.map((token) => toHighlightToken(token, foreground)),
    }));
    // The highlighter splits the block itself; if it ever disagreed with the
    // caller's lines, the tail would be rendered unhighlighted rather than
    // dropped, but the mismatch is not something to hide either.
    return highlighted.slice(0, lineCount);
  } catch {
    return null;
  }
}

function toHighlightToken(token: TokenLike, foreground: string): HighlightToken {
  const color =
    typeof token.color === "string" && normalizeColor(token.color) !== foreground
      ? token.color
      : undefined;
  const fontStyle =
    typeof token.fontStyle === "number" && token.fontStyle > 0
      ? token.fontStyle
      : undefined;
  return {
    content: token.content,
    ...(color === undefined ? {} : { color }),
    ...(fontStyle === undefined ? {} : { fontStyle }),
  };
}

function normalizeColor(color: string | undefined): string {
  return (color ?? "").trim().toUpperCase();
}

async function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createCore();
  return highlighterPromise;
}

/**
 * Create the highlighter itself.
 *
 * The core and the JS engine are imported here rather than at module scope: a
 * session that never shows highlighted code never downloads them at all, and
 * they land in their own chunk instead of the `ChatView` chunk.
 */
async function createCore(): Promise<Highlighter> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
    await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
  return createHighlighterCore({
    themes: [
      THEME_LOADERS.light() as never,
      THEME_LOADERS.dark() as never,
    ],
    langs: [],
    // The JS engine keeps the bundle free of a wasm asset; `forgiving` turns a
    // grammar pattern this engine cannot compile into a skipped pattern instead
    // of an exception, which would cost the whole block its highlighting.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
}

async function loadLanguage(highlighter: Highlighter, lang: string): Promise<void> {
  if (loadedLanguages.has(lang)) return;
  const loader = LANGUAGE_LOADERS[lang];
  if (!loader) throw new Error(`unsupported language: ${lang}`);
  await highlighter.loadLanguage((await loader()) as never);
  loadedLanguages.add(lang);
}

function store(key: string, entry: CacheEntry): void {
  cache.set(key, entry);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}
