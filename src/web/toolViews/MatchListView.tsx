/**
 * `ffgrep` / `fffind` — match list and file list.
 *
 * `ffgrep` results are grouped by file header, with `行号: 内容` match lines and
 * `行号- 内容` context lines (a distinction that was verified against real
 * output). `fffind` results are a plain path list. Both fall back to the raw
 * result text as soon as a line does not fit the expected shape.
 *
 * The counters come from the server projection (`details.totalMatched` /
 * `totalFiles`, available for every real call) and are only derived from the
 * parsed lines when the projection is absent.
 */

import type { ReactNode } from "react";

import type { ChatToolDisplay } from "../../shared/protocol";
import {
  parseGrepText,
  parsePathList,
  toolResultText,
} from "./toolText";
import {
  CopyButton,
  ViewMeta,
  ViewNote,
  type ToolViewProps,
} from "./common";

export function MatchListView({ item, fallback }: ToolViewProps) {
  const text = toolResultText(item.result);
  if (text === undefined) return <>{fallback}</>;

  return item.toolName === "fffind" ? (
    <FilePathView text={text} display={item.display} fallback={fallback} />
  ) : (
    <GrepMatchView text={text} display={item.display} fallback={fallback} />
  );
}

function GrepMatchView({
  text,
  display,
  fallback,
}: {
  text: string;
  display: ChatToolDisplay | undefined;
  fallback: ReactNode;
}) {
  const parsed = parseGrepText(text);
  if (!parsed) return <>{fallback}</>;

  const counted = countLabel(display?.matchCount, parsed.matched, parsed.files.length);

  return (
    <div className="tool-view match-view">
      <ViewMeta>
        <ViewNote>{counted}</ViewNote>
        {display?.matchCount?.hasMore && <ViewNote>还有更多结果未显示</ViewNote>}
        <CopyButton text={text} label="复制匹配" />
      </ViewMeta>
      <div className="match-body">
        {parsed.files.map((file, index) => (
          <div className="match-file" key={index}>
            {file.path && <div className="match-file-path">{file.path}</div>}
            {file.matches.map((match, matchIndex) => (
              <div
                className={`match-line ${match.isMatch ? "match-line-hit" : "match-line-context"}`}
                key={matchIndex}
              >
                <span className="match-line-number">{match.line}</span>
                <span className="match-line-text">{match.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {parsed.notes.map((note, index) => (
        <ViewNote key={index}>{note}</ViewNote>
      ))}
    </div>
  );
}

function FilePathView({
  text,
  display,
  fallback,
}: {
  text: string;
  display: ChatToolDisplay | undefined;
  fallback: ReactNode;
}) {
  const parsed = parsePathList(text);
  if (!parsed) return <>{fallback}</>;

  const counted = countLabel(
    display?.matchCount,
    parsed.paths.length,
    undefined,
  );

  return (
    <div className="tool-view match-view">
      <ViewMeta>
        <ViewNote>{counted}</ViewNote>
        {display?.matchCount?.hasMore && <ViewNote>还有更多结果未显示</ViewNote>}
        <CopyButton text={parsed.paths.join("\n")} label="复制路径" />
      </ViewMeta>
      <div className="path-list">
        {parsed.paths.map((path, index) => (
          <div className="path-line" key={index}>
            {path}
          </div>
        ))}
      </div>
      {parsed.notes.map((note, index) => (
        <ViewNote key={index}>{note}</ViewNote>
      ))}
    </div>
  );
}

/**
 * `N 处命中 · M 个文件` from the projection when it is there, otherwise from the
 * parsed lines. `fileCount` is omitted when it is not known; nothing is shown
 * when there is no count at all.
 */
function countLabel(
  matchCount: ChatToolDisplay["matchCount"] | undefined,
  matched: number,
  fileCount: number | undefined,
): string {
  const total = matchCount?.matched ?? matched;
  const files = matchCount?.files ?? fileCount;
  if (files === undefined) return `${total} 处命中`;
  return `${total} 处命中 · ${files} 个文件`;
}
