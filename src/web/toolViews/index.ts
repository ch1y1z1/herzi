/**
 * Tool detail view registry.
 *
 * `toolViewFor` maps a tool name to its dedicated expansion view. A tool that is
 * not registered renders the generic `Arguments`/`Result` detail, which is also
 * what every registered view falls back to when it cannot build its structure,
 * so an unknown or unparseable call can never render blank.
 *
 * The collapsed row, the grouping rules and the `Worked for` hierarchy are not
 * touched by any of this: the registry only decides what the expansion shows.
 */

import type { ComponentType } from "react";

import { CodeView } from "./CodeView";
import { DiffView } from "./DiffView";
import { MatchListView } from "./MatchListView";
import { OutputView } from "./OutputView";
import { WebFetchView } from "./WebFetchView";
import { WebSearchView } from "./WebSearchView";
import type { ToolViewProps } from "./common";

const TOOL_VIEWS: Record<string, ComponentType<ToolViewProps>> = {
  edit: DiffView,
  write: CodeView,
  read: CodeView,
  bash: OutputView,
  ffgrep: MatchListView,
  fffind: MatchListView,
  web_search: WebSearchView,
  web_fetch: WebFetchView,
};

export function toolViewFor(
  toolName: string,
): ComponentType<ToolViewProps> | undefined {
  return TOOL_VIEWS[toolName];
}

export type { ToolDetailItem, ToolViewProps } from "./common";
export { CodeView, DiffView, MatchListView, OutputView, WebFetchView, WebSearchView };
