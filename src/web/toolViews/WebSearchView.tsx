/**
 * `web_search` — result list.
 *
 * Results are split on `^\d+\.\s+\*\*`, the shape 98% of real results start
 * with. Each entry keeps its original Markdown (title, source line, links), so
 * links go through the chat's `MarkdownLink` policy instead of a second link
 * implementation. When no entry can be split out, the raw text is rendered as
 * Markdown — never as JSON, because the raw text is Markdown already.
 */

import { MarkdownText, ViewMeta, ViewNote, type ToolViewProps } from "./common";
import { ScrollBox } from "./ScrollBox";
import { parseWebSearchText, toolResultText } from "./toolText";

/**
 * Results are shown in the shared scroll window (R6): every entry is in the DOM,
 * the window only limits how much is visible at once.
 */
export function WebSearchView({ item, fallback }: ToolViewProps) {
  const text = toolResultText(item.result);
  if (text === undefined) return <>{fallback}</>;

  const parsed = parseWebSearchText(text);
  if (!parsed) {
    return (
      <div className="tool-view web-search-view">
        <ScrollBox>
          <MarkdownText text={text} />
        </ScrollBox>
      </div>
    );
  }

  return (
    <div className="tool-view web-search-view">
      <ViewMeta>
        <ViewNote>
          {parsed.partial
            ? `切分出 ${parsed.entries.length} 条结果（其余文字保留在原文中）`
            : `${parsed.entries.length} 条结果`}
        </ViewNote>
      </ViewMeta>
      {parsed.preamble && <MarkdownText text={parsed.preamble} />}
      <ScrollBox>
        <ol className="result-list">
          {parsed.entries.map((entry, index) => (
            // `value` keeps the result's own number: the list must not renumber
            // entries when only some of them were split out. HTML discards
            // `value="0"`, so it is only emitted for a positive number. The key
            // carries the index as well, because a source that repeats a number
            // (`1. **A**` twice) would otherwise produce duplicate React keys.
            <li
              className="result-item"
              key={`${entry.number}:${index}`}
              {...(entry.number > 0 ? { value: entry.number } : {})}
            >
              <MarkdownText text={entry.text} />
            </li>
          ))}
        </ol>
      </ScrollBox>
    </div>
  );
}
