/**
 * React layer of the highlighting kernel (`src/web/highlight.ts`).
 *
 * Deliberately thin: it turns a resolved block into spans and gives callers a
 * hook that starts as "not highlighted yet". Every caller renders the plain text
 * it already has until the promise resolves, which is what keeps the row count,
 * the line height and the scroll position identical before and after
 * highlighting — no spinner, no reflow.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";

import {
  FONT_STYLE_BOLD,
  FONT_STYLE_ITALIC,
  FONT_STYLE_UNDERLINE,
  codeLineText,
  highlightLines,
  languageForFence,
  type HighlightThemeName,
  type HighlightToken,
  type HighlightedLine,
} from "./highlight";

/**
 * Tokenized lines for one block, or `undefined` while they are being computed
 * and whenever they cannot be computed. `lines` must be the caller's own split:
 * the same array is what makes the row count independent of highlighting.
 */
export function useHighlightedLines(
  lines: readonly string[],
  lang: string,
  theme: HighlightThemeName,
): HighlightedLine[] | undefined {
  const [highlighted, setHighlighted] = useState<HighlightedLine[] | undefined>(
    undefined,
  );
  const code = lines.join("\n");

  useEffect(() => {
    let cancelled = false;
    // Back to plain text when the content or the language changes: the previous
    // block's tokens must never be shown next to different text.
    setHighlighted(undefined);
    void highlightLines(code.split("\n"), lang, theme).then((result) => {
      if (!cancelled) setHighlighted(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang, theme]);

  return highlighted;
}

/**
 * One line of code: its tokens when they are available **and** they reproduce
 * the line's text, otherwise the plain text. The check is what stops a
 * tokenizer that split the line differently from quietly displaying text that is
 * not the content that was handed in.
 */
export function HighlightedText({
  text,
  line,
}: {
  text: string;
  line: HighlightedLine | undefined;
}): ReactNode {
  const expected = codeLineText(text);
  if (!line || joinedContent(line) !== expected) return <>{text}</>;
  return (
    <>
      {line.tokens.map((token, index) => (
        <span key={index} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </>
  );
}

function joinedContent(line: HighlightedLine): string {
  return line.tokens.map((token) => token.content).join("");
}

function tokenStyle(token: HighlightToken): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  const fontStyle = token.fontStyle ?? 0;
  if (fontStyle & FONT_STYLE_ITALIC) style.fontStyle = "italic";
  if (fontStyle & FONT_STYLE_BOLD) style.fontWeight = "bold";
  if (fontStyle & FONT_STYLE_UNDERLINE) style.textDecoration = "underline";
  return Object.keys(style).length ? style : undefined;
}

/**
 * The `SyntaxHighlighter` that `@assistant-ui/react-markdown` calls for every
 * fenced code block (`components.SyntaxHighlighter`). Inline code never reaches
 * it: the library only routes fenced blocks here.
 *
 * The theme is the dark one because the chat body's `pre` is dark (`.markdown-body
 * pre`, `#20231f`); the shiki background is ignored so that stays the case.
 */
export function ShikiCodeBlock({
  components: { Pre, Code },
  language,
  code,
}: SyntaxHighlighterProps) {
  const lines = fenceLines(code);
  const highlighted = useHighlightedLines(lines, languageForFence(language), "dark");
  return (
    <Pre>
      <Code>
        {lines.map((line, index) => (
          <span className="code-block-line" key={index}>
            <HighlightedText text={line} line={highlighted?.[index]} />
          </span>
        ))}
      </Code>
    </Pre>
  );
}

/**
 * A fence's text as lines: react-markdown hands over the block including its
 * final newline, which is a terminator rather than an extra empty last line
 * (the same rule as `resultLines` for tool results).
 */
function fenceLines(code: string): string[] {
  const lines = code.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}
