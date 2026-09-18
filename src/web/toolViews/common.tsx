/**
 * Shared pieces of the tool detail views.
 *
 * A view receives the tool call and the generic `Arguments`/`Result` rendering
 * as `fallback`. It must render `fallback` whenever it cannot build its
 * structured view — the fallback path is part of every view's contract, not an
 * error path: real sessions have `details` for only a few percent of `read` and
 * `bash` calls.
 */

import { TextMessagePartProvider } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { useState, type ReactNode } from "react";

import type { ChatJsonObject, ChatToolDisplay } from "../../shared/protocol";
import { TEXT_LANGUAGE, languageForPath } from "../highlight";
import { markdownShared } from "../markdownPlugins";
import { SCROLL_BOX_LINES } from "./ScrollBox";

/**
 * One tool call as the detail views see it. Structurally compatible with the
 * assistant-ui tool-call part and with `ChatView`'s tool activity item, so both
 * call sites can pass their object through unchanged.
 */
export interface ToolDetailItem {
  toolCallId?: string;
  toolName: string;
  args: ChatJsonObject;
  result?: unknown;
  isError?: boolean;
  display?: ChatToolDisplay;
}

export interface ToolViewProps {
  item: ToolDetailItem;
  /** Generic `Arguments`/`Result` detail; rendered when parsing is impossible. */
  fallback: ReactNode;
}

/** Meta row above a view body: notes on the left, actions on the right. */
export function ViewMeta({ children }: { children: ReactNode }) {
  return <div className="tool-view-meta">{children}</div>;
}

export function ViewNote({ children }: { children: ReactNode }) {
  return <span className="tool-view-note">{children}</span>;
}

/** Markdown rendering that reuses the chat body's plugins and link policy. */
export function MarkdownText({ text }: { text: string }) {
  return (
    <TextMessagePartProvider text={text}>
      <MarkdownTextPrimitive
        className="markdown-body"
        smooth={false}
        {...markdownShared}
      />
    </TextMessagePartProvider>
  );
}

/**
 * Copy button for one piece of real content (diff text, command, output,
 * paths). Clipboard failures are reported in place instead of being swallowed.
 */
export function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="tool-view-action"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
          window.setTimeout(() => setState("idle"), 1_500);
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "copied" ? "已复制" : state === "failed" ? "复制失败" : label}
    </button>
  );
}

// There is intentionally no expand/collapse control here any more: R3 of the
// Rev.2 spec removed all of them, and long content now scrolls in the shared
// window (`ScrollBox`) instead of being folded and unfolded in place.

/**
 * Language of the file this call touched, from `args.path`.
 *
 * A call without a usable path (or with an extension outside the supported set)
 * is `text`: the view shows plain code rather than guessing a grammar.
 */
export function languageForItem(item: ToolDetailItem): string {
  const path = item.args.path;
  return typeof path === "string" ? languageForPath(path) : TEXT_LANGUAGE;
}

/**
 * `共 N 行`, with a scroll hint once N no longer fits the window.
 *
 * Replaces the old `还有 N 行未显示 · 展开全部`: the line count is still real
 * (it is the number of lines actually in the DOM), but nothing is hidden behind
 * a button — the window scrolls.
 */
export function lineCountNote(lineCount: number): string {
  return lineCount > SCROLL_BOX_LINES
    ? `共 ${lineCount} 行 · 可滚动查看`
    : `共 ${lineCount} 行`;
}
