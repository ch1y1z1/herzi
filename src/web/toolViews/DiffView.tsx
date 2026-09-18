/**
 * `edit` — line-level diff.
 *
 * The lines come from the server projection (`display.diff.lines`), which parses
 * Pi's display-oriented diff format. Nothing is computed here: when the
 * projection is missing or empty, the generic `Arguments`/`Result` fallback is
 * rendered instead of a locally guessed diff.
 *
 * The folded-away context lines carry no count in Pi's format (only the `...`
 * placeholder), so the view shows `⋯ 略过的上下文` without a number rather than
 * deriving one from line-number gaps, which is only correct when no change
 * block sits next to the gap.
 */

import { useState } from "react";

import type { ChatDiffLine } from "../../shared/protocol";
import { CopyButton, ViewMeta, ViewNote, type ToolViewProps } from "./common";

/** Diff lines shown before the rest is folded behind an explicit count. */
const DIFF_FOLD_LINES = 400;

export function DiffView({ item, fallback }: ToolViewProps) {
  const [expanded, setExpanded] = useState(false);
  const diff = item.display?.diff;
  const lines = Array.isArray(diff?.lines) ? diff.lines : [];
  if (!lines.length) return <>{fallback}</>;

  const shown = expanded ? lines : lines.slice(0, DIFF_FOLD_LINES);
  const hidden = lines.length - shown.length;

  return (
    <div className="tool-view diff-view">
      <ViewMeta>
        {diff?.firstChangedLine !== undefined && (
          <ViewNote>首个改动在第 {diff.firstChangedLine} 行</ViewNote>
        )}
        {diff?.truncated && <ViewNote>diff 过长，仅显示前 {lines.length} 行</ViewNote>}
        {hidden > 0 && <ViewNote>还有 {hidden} 行未显示</ViewNote>}
        <CopyButton text={lines.map(diffLineText).join("\n")} label="复制 diff" />
      </ViewMeta>
      <div className="diff-body">
        {shown.map((line, index) => (
          <DiffLineRow key={index} line={line} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          className="tool-view-action"
          onClick={() => setExpanded(true)}
        >
          展开全部 {lines.length} 行
        </button>
      )}
    </div>
  );
}

function DiffLineRow({ line }: { line: ChatDiffLine }) {
  if (line.kind === "skip") {
    return (
      <div className="diff-line diff-line-skip">
        <span className="diff-line-text">⋯ 略过的上下文</span>
      </div>
    );
  }
  return (
    <div className={`diff-line diff-line-${line.kind}`}>
      <span className="diff-line-number">{line.lineNumber ?? ""}</span>
      <span className="diff-line-marker">{diffMarker(line.kind)}</span>
      <span className="diff-line-text">{line.text}</span>
    </div>
  );
}

function diffMarker(kind: ChatDiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

/** One diff line as text; the copy action and the display stay identical. */
function diffLineText(line: ChatDiffLine): string {
  if (line.kind === "skip") return "...";
  return `${diffMarker(line.kind)}${line.lineNumber ?? ""} ${line.text}`;
}
