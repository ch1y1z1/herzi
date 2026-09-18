/**
 * `web_fetch` — page summary.
 *
 * Shows the title (only when the result's first line is a Markdown heading), the
 * host from `args.url`, the character count of the text Herzi actually holds,
 * and the Markdown body. The body is rendered as Markdown so that links keep the
 * chat's external-link behaviour.
 *
 * R6 of the Rev.2 spec: the body lives in the shared `ScrollBox` (16 lines
 * visible, native scroll) and the old "fold to 40 lines + 展开全部" button is
 * gone. Nothing beyond the received text is loadable here: fetching more of the
 * page is explicitly out of scope for this batch, so an over-long result is only
 * scrolled, never "expanded" by a second request.
 */

import { webHost } from "../toolCatalog";
import { ScrollBox } from "./ScrollBox";
import {
  MarkdownText,
  CopyButton,
  ViewMeta,
  ViewNote,
  lineCountNote,
  type ToolViewProps,
} from "./common";
import { parseWebFetchText, resultLines, toolResultText } from "./toolText";

export function WebFetchView({ item, fallback }: ToolViewProps) {
  const text = toolResultText(item.result);
  if (text === undefined) return <>{fallback}</>;

  const parsed = parseWebFetchText(text);
  const host = typeof item.args.url === "string" ? webHost(item.args.url) : undefined;
  const bodyLines = resultLines(parsed.body);

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
        <>
          <ViewNote>{lineCountNote(bodyLines.length)}</ViewNote>
          <ScrollBox>
            <MarkdownText text={parsed.body} />
          </ScrollBox>
        </>
      ) : (
        <ViewNote>（没有正文）</ViewNote>
      )}
    </div>
  );
}
