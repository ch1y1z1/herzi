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
import { markdownShared } from "../markdownPlugins";

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

/** Toggle for content that is folded by default. */
export function ExpandButton({
  hidden,
  expanded,
  onToggle,
}: {
  hidden: number;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="tool-view-action tool-view-expand"
      onClick={() => onToggle(!expanded)}
    >
      {expanded ? "收起" : `还有 ${hidden} 行未显示 · 展开全部`}
    </button>
  );
}
