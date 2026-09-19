/**
 * `read` / `write` — code view with generated line numbers and syntax colors.
 *
 * The result text of a `read` carries no line-number prefixes (measured hit
 * rate 1%), so the numbers are generated from `args.offset` — the line the call
 * asked for — with the server's `readRange` as the fallback source. When the
 * start line cannot be established, no numbers are shown at all.
 *
 * Every line is rendered: the shared `ScrollBox` limits how much is *visible*,
 * it does not remove anything from the DOM. Syntax colors come from the same
 * shiki kernel as the chat body (highlight.ts) and fall back to plain text
 * whenever the language or the highlighter is not available — the rows and their
 * heights are identical in both cases, so nothing moves when the colors arrive.
 */

import { HighlightedText, useHighlightedLines } from "../highlightReact";
import { ScrollBox } from "./ScrollBox";
import {
  CopyButton,
  ViewMeta,
  ViewNote,
  languageForItem,
  lineCountNote,
  type ToolDetailItem,
  type ToolViewProps,
} from "./common";
import {
  readStartLine,
  resultLines,
  splitReadResult,
  toolResultText,
  truncationSummary,
} from "./toolText";

interface CodeSource {
  text: string;
  /** First line number, or `undefined` when no number can be established. */
  start?: number;
  /** Trailing marker line of a truncated read, shown verbatim. */
  marker?: string;
}

export function CodeView({ item, fallback }: ToolViewProps) {
  const source = codeSource(item);
  const lines = source ? resultLines(source.text) : [];
  const highlighted = useHighlightedLines(lines, languageForItem(item), "light");
  if (!source || !lines.length) return <>{fallback}</>;

  const range = item.display?.readRange;
  const truncation = truncationSummary(item.display?.truncation);

  return (
    <div className="tool-view code-view">
      <ViewMeta>
        <ViewNote>
          {item.toolName === "write" ? "新建内容" : "读取内容"}
          {` · ${lineCountNote(lines.length)}`}
        </ViewNote>
        <CopyButton text={source.text} label="复制内容" />
      </ViewMeta>
      <ScrollBox>
        <div className="code-body">
          {lines.map((line, index) => (
            <div className="code-line" key={index}>
              {source.start !== undefined && (
                <span className="code-line-number">{source.start + index}</span>
              )}
              <span className="code-line-text">
                <HighlightedText text={line} line={highlighted?.[index]} />
              </span>
            </div>
          ))}
        </div>
      </ScrollBox>
      {range ? (
        <ViewNote>
          {`已显示 ${range.from}–${range.to}`}
          {range.total !== undefined ? ` / 共 ${range.total} 行` : ""}
          {range.nextOffset !== undefined
            ? ` · 继续读取 offset=${range.nextOffset}`
            : ""}
        </ViewNote>
      ) : null}
      {!range && source.marker ? <ViewNote>{source.marker}</ViewNote> : null}
      {truncation ? <ViewNote>{truncation}</ViewNote> : null}
    </div>
  );
}

function codeSource(item: ToolDetailItem): CodeSource | undefined {
  if (item.toolName === "write") {
    const content = item.args.content;
    if (typeof content !== "string" || !content) return undefined;
    return { text: content, start: 1 };
  }

  const raw = toolResultText(item.result);
  if (raw === undefined) return undefined;
  const { body, marker } = splitReadResult(raw);
  if (!body.trim()) return undefined;
  return {
    text: body,
    start: readStartLine(item.args, item.display),
    ...(marker === undefined ? {} : { marker }),
  };
}
