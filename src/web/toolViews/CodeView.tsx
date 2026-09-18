/**
 * `read` / `write` — code view with generated line numbers.
 *
 * The result text of a `read` carries no line-number prefixes (measured hit
 * rate 1%), so the numbers are generated from `args.offset` — the line the call
 * asked for — with the server's `readRange` as the fallback source. When the
 * start line cannot be established, no numbers are shown at all.
 *
 * `write` has no diff to show (`details` is an empty object in real sessions),
 * so it shows the new content from `args.content` and never pretends to be a
 * diff.
 */

import { useState } from "react";

import {
  readStartLine,
  resultLines,
  splitReadResult,
  toolResultText,
  truncationSummary,
} from "./toolText";
import {
  CopyButton,
  ViewMeta,
  ViewNote,
  type ToolDetailItem,
  type ToolViewProps,
} from "./common";

/** Lines shown before the rest is folded behind an explicit count. */
const CODE_FOLD_LINES = 200;

interface CodeSource {
  text: string;
  /** First line number, or `undefined` when no number can be established. */
  start?: number;
  /** Trailing marker line of a truncated read, shown verbatim. */
  marker?: string;
}

export function CodeView({ item, fallback }: ToolViewProps) {
  const [expanded, setExpanded] = useState(false);
  const source = codeSource(item);
  if (!source) return <>{fallback}</>;

  const lines = resultLines(source.text);
  if (!lines.length) return <>{fallback}</>;

  const shown = expanded ? lines : lines.slice(0, CODE_FOLD_LINES);
  const hidden = lines.length - shown.length;
  const range = item.display?.readRange;
  const truncation = truncationSummary(item.display?.truncation);

  return (
    <div className="tool-view code-view">
      <ViewMeta>
        <ViewNote>
          {item.toolName === "write" ? "新建内容" : "读取内容"}
          {" · "}
          {lines.length} 行
        </ViewNote>
        <CopyButton text={source.text} label="复制内容" />
      </ViewMeta>
      <div className="code-body">
        {shown.map((line, index) => (
          <div className="code-line" key={index}>
            {source.start !== undefined && (
              <span className="code-line-number">{source.start + index}</span>
            )}
            <span className="code-line-text">{line}</span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          className="tool-view-action"
          onClick={() => setExpanded(true)}
        >
          还有 {hidden} 行未显示 · 展开全部
        </button>
      )}
      {expanded && lines.length > CODE_FOLD_LINES && (
        <button
          type="button"
          className="tool-view-action"
          onClick={() => setExpanded(false)}
        >
          收起
        </button>
      )}
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
