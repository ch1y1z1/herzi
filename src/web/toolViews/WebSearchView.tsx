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
import { parseWebSearchText, toolResultText } from "./toolText";

export function WebSearchView({ item, fallback }: ToolViewProps) {
  const text = toolResultText(item.result);
  if (text === undefined) return <>{fallback}</>;

  const parsed = parseWebSearchText(text);
  if (!parsed) {
    return (
      <div className="tool-view web-search-view">
        <MarkdownText text={text} />
      </div>
    );
  }

  return (
    <div className="tool-view web-search-view">
      <ViewMeta>
        <ViewNote>{parsed.entries.length} 条结果</ViewNote>
      </ViewMeta>
      {parsed.preamble && <MarkdownText text={parsed.preamble} />}
      <ol className="result-list">
        {parsed.entries.map((entry, index) => (
          <li className="result-item" key={index}>
            <MarkdownText text={entry} />
          </li>
        ))}
      </ol>
    </div>
  );
}
