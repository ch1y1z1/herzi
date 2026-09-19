/**
 * `bash` — command and output.
 *
 * The output is read from its **tail**: the conclusion of a command (failures,
 * test totals) is at the end, while the head is usually startup noise. R1/R2 of
 * the Rev.2 spec keep that intent without the old "last 20 lines + expand" fold:
 * every line is in the DOM inside the shared `ScrollBox`, which opens scrolled to
 * the bottom and follows new output until the reader scrolls away from it.
 *
 * Nothing about the exit status is shown, because the result text does not
 * contain it (measured: `exit code` appears in 0% of real results) and a status
 * Herzi cannot verify would be a claim about the command, not a reading of it.
 * A failed call is marked red instead — that flag comes from the tool result
 * itself, and stderr cannot be separated from stdout because the text carries no
 * marker for it.
 */

import { ScrollBox } from "./ScrollBox";
import {
  CopyButton,
  ViewMeta,
  ViewNote,
  lineCountNote,
  type ToolViewProps,
} from "./common";
import { resultLines, toolResultText, truncationSummary } from "./toolText";

export function OutputView({ item, fallback }: ToolViewProps) {
  const command =
    typeof item.args.command === "string"
      ? item.args.command
      : typeof item.args.cmd === "string"
        ? item.args.cmd
        : undefined;
  const text = toolResultText(item.result);
  if (command === undefined && text === undefined) return <>{fallback}</>;

  const lines = text === undefined ? [] : resultLines(text);
  const truncation = truncationSummary(item.display?.truncation);
  const isError = Boolean(item.isError);

  return (
    <div className="tool-view output-view">
      {command !== undefined && (
        <div className="output-command">
          <ViewMeta>
            <ViewNote>命令</ViewNote>
            <CopyButton text={command} label="复制命令" />
          </ViewMeta>
          <ScrollBox>
            <pre>
              <span className="output-prompt">$ </span>
              <span className="output-command-text">{command}</span>
            </pre>
          </ScrollBox>
        </div>
      )}
      {text !== undefined && (
        <div className="output-body">
          <ViewMeta>
            <ViewNote>{`输出 · ${lineCountNote(lines.length)}`}</ViewNote>
            <CopyButton text={text} label="复制输出" />
          </ViewMeta>
          {lines.length ? (
            <ScrollBox followTail>
              <pre className={isError ? "output-text output-error" : "output-text"}>
                {lines.join("\n")}
              </pre>
            </ScrollBox>
          ) : (
            <ViewNote>（没有输出）</ViewNote>
          )}
          {truncation ? <ViewNote>{truncation}</ViewNote> : null}
        </div>
      )}
    </div>
  );
}
