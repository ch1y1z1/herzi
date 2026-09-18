/**
 * `bash` — command and output.
 *
 * The output is shown from its **tail**: the conclusion of a command (failures,
 * test totals) is at the end, while the head is usually startup noise. Nothing
 * about the exit status is shown, because the result text does not contain it
 * (measured: `exit code` appears in 0% of real results) and a status Herzi
 * cannot verify would be a claim about the command, not a reading of it.
 */

import { useState } from "react";

import { resultLines, tailLines, toolResultText, truncationSummary } from "./toolText";
import {
  CopyButton,
  ViewMeta,
  ViewNote,
  type ToolViewProps,
} from "./common";

/** Output lines shown before the rest of the output is folded. */
const OUTPUT_TAIL_LINES = 20;

export function OutputView({ item, fallback }: ToolViewProps) {
  const [expanded, setExpanded] = useState(false);
  const command =
    typeof item.args.command === "string"
      ? item.args.command
      : typeof item.args.cmd === "string"
        ? item.args.cmd
        : undefined;
  const text = toolResultText(item.result);
  if (command === undefined && text === undefined) return <>{fallback}</>;

  const lines = text === undefined ? [] : resultLines(text);
  const tail = expanded ? { lines, hidden: 0 } : tailLines(text ?? "", OUTPUT_TAIL_LINES);
  const truncation = truncationSummary(item.display?.truncation);

  return (
    <div className="tool-view output-view">
      {command !== undefined && (
        <div className="output-command">
          <ViewMeta>
            <ViewNote>命令</ViewNote>
            <CopyButton text={command} label="复制命令" />
          </ViewMeta>
          <pre>{command}</pre>
        </div>
      )}
      {text !== undefined && (
        <div className="output-body">
          <ViewMeta>
            <ViewNote>输出 · {lines.length} 行</ViewNote>
            <CopyButton text={text} label="复制输出" />
          </ViewMeta>
          {lines.length ? (
            <pre>{tail.lines.join("\n")}</pre>
          ) : (
            <ViewNote>（没有输出）</ViewNote>
          )}
          {tail.hidden > 0 && (
            <button
              type="button"
              className="tool-view-action"
              onClick={() => setExpanded(true)}
            >
              还有前 {tail.hidden} 行未显示 · 展开全部
            </button>
          )}
          {expanded && lines.length > OUTPUT_TAIL_LINES && (
            <button
              type="button"
              className="tool-view-action"
              onClick={() => setExpanded(false)}
            >
              收起
            </button>
          )}
          {truncation ? <ViewNote>{truncation}</ViewNote> : null}
        </div>
      )}
    </div>
  );
}
