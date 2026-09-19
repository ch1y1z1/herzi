/**
 * `edit` — line-level diff.
 *
 * The lines come from the server projection (`display.diff.lines`), which parses
 * Pi's display-oriented diff format. Nothing is computed here: when the
 * projection is missing or empty, the generic `Arguments`/`Result` fallback is
 * rendered instead of a locally guessed diff.
 *
 * R5 of the Rev.2 spec adds the visuals: the whole row of an added/removed line
 * carries a background band, and a 3px solid bar marks its left edge (drawn with
 * an inset box-shadow, so the gutter stays aligned across kinds). The gutter uses
 * the old file's numbers for `remove` and the new file's for `add`/`context`.
 *
 * Syntax colors are best-effort per line: a diff is not one contiguous file, so
 * the line contents are tokenized as a block and any line whose tokens do not
 * reproduce it is shown as plain text (`HighlightedText`). Lines are never
 * dropped: the `ScrollBox` only limits what is visible.
 *
 * The folded-away context lines carry no count in Pi's format (only the `...`
 * placeholder), so the view shows `⋯ 略过的上下文` without a number rather than
 * deriving one from line-number gaps, which is only correct when no change
 * block sits next to the gap.
 */

import type { ChatDiffLine } from "../../shared/protocol";
import type { HighlightedLine } from "../highlight";
import { HighlightedText, useHighlightedLines } from "../highlightReact";
import { ScrollBox } from "./ScrollBox";
import {
  CopyButton,
  ViewMeta,
  ViewNote,
  languageForItem,
  lineCountNote,
  type ToolViewProps,
} from "./common";

export function DiffView({ item, fallback }: ToolViewProps) {
  const diff = item.display?.diff;
  const lines = Array.isArray(diff?.lines) ? diff.lines : [];
  // The `skip` placeholder is not code: it gets an empty string so it can never
  // contribute a stray token, and its own row renders the placeholder instead.
  const contents = lines.map((line) => (line.kind === "skip" ? "" : line.text));
  const highlighted = useHighlightedLines(contents, languageForItem(item), "light");
  if (!lines.length) return <>{fallback}</>;

  return (
    <div className="tool-view diff-view">
      <ViewMeta>
        {diff?.firstChangedLine !== undefined && (
          <ViewNote>首个改动在第 {diff.firstChangedLine} 行</ViewNote>
        )}
        {diff?.truncated && <ViewNote>diff 过长，仅显示前 {lines.length} 行</ViewNote>}
        <ViewNote>{lineCountNote(lines.length)}</ViewNote>
        <CopyButton text={lines.map(diffLineText).join("\n")} label="复制 diff" />
      </ViewMeta>
      <ScrollBox>
        <div className="diff-body">
          {lines.map((line, index) => (
            <DiffLineRow key={index} line={line} highlighted={highlighted?.[index]} />
          ))}
        </div>
      </ScrollBox>
    </div>
  );
}

function DiffLineRow({
  line,
  highlighted,
}: {
  line: ChatDiffLine;
  highlighted: HighlightedLine | undefined;
}) {
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
      <span className="diff-line-text">
        <HighlightedText text={line.text} line={highlighted} />
      </span>
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
