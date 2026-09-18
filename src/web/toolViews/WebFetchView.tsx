/**
 * `web_fetch` — page summary.
 *
 * Shows the title (only when the result's first line is a Markdown heading), the
 * host from `args.url`, the character count of the text Herzi actually holds,
 * and the Markdown body folded to 40 lines. The body is rendered as Markdown so
 * that links keep the chat's external-link behaviour.
 *
 * Nothing beyond the received text is loadable here: fetching more of the page
 * is explicitly out of scope for this batch, so an over-long result is only
 * folded, never "expanded" by a second request.
 */

import { useState } from "react";

import { webHost } from "../toolCatalog";
import { MarkdownText, CopyButton, ViewMeta, ViewNote, type ToolViewProps } from "./common";
import { parseWebFetchText, resultLines, toolResultText } from "./toolText";

/** Body lines shown before the rest is folded behind an explicit count. */
const BODY_FOLD_LINES = 40;

export function WebFetchView({ item, fallback }: ToolViewProps) {
  const [expanded, setExpanded] = useState(false);
  const text = toolResultText(item.result);
  if (text === undefined) return <>{fallback}</>;

  const parsed = parseWebFetchText(text);
  const host = typeof item.args.url === "string" ? webHost(item.args.url) : undefined;
  const lines = resultLines(parsed.body);
  const shown = expanded ? lines : lines.slice(0, BODY_FOLD_LINES);
  const hidden = lines.length - shown.length;

  return (
    <div className="tool-view web-fetch-view">
      <ViewMeta>
        {parsed.title && <ViewNote>{parsed.title}</ViewNote>}
        <ViewNote>
          {[host, `${text.length} 字符`].filter(Boolean).join(" · ")}
        </ViewNote>
        <CopyButton text={text} label="复制正文" />
      </ViewMeta>
      {parsed.truncationNote && <ViewNote>{parsed.truncationNote}</ViewNote>}
      {parsed.body ? (
        <MarkdownText text={shown.join("\n")} />
      ) : (
        <ViewNote>（没有正文）</ViewNote>
      )}
      {hidden > 0 && (
        <button
          type="button"
          className="tool-view-action"
          onClick={() => setExpanded(true)}
        >
          还有 {hidden} 行未显示 · 展开全部
        </button>
      )}
      {expanded && lines.length > BODY_FOLD_LINES && (
        <button
          type="button"
          className="tool-view-action"
          onClick={() => setExpanded(false)}
        >
          收起
        </button>
      )}
    </div>
  );
}
