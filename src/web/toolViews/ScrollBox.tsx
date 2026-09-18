/**
 * The bounded scroll window every content view shows its body in.
 *
 * R1/R2 of the Rev.2 spec: **the window is 16 tool-content lines tall, with
 * native scrolling and no virtualization** — the DOM still holds every line, so
 * copy, find-in-page and selection keep working on the real text, and a short
 * body (an `edit` diff is four lines in the median real case) is not padded out
 * to the full height.
 *
 * "16 lines" is the height of the window in **code lines**, not a promise that
 * every view shows 16 content rows: a view spends part of that height on its own
 * row heights and spacing, so `edit` (skipped-context placeholders), `ffgrep`
 * (file headers and gaps) and the Markdown bodies show fewer. The per-view
 * numbers are recorded in `.agents/tasks/20260918-tool-views-rev2.md`.
 *
 * The cap and the code row height both read `--tool-view-line-height`
 * (styles.css), so the window cannot drift to 15 or 17 code lines. The container
 * carries no padding or border, because the global `box-sizing: border-box`
 * would otherwise eat into that height.
 *
 * There is deliberately no second scroll container inside, and no expand
 * control: a view whose content is longer than the window says how many lines
 * there are and lets the window scroll.
 *
 * The generic Arguments/Result detail (a failed, unknown or unparseable call)
 * uses the same window, so it is not limited to the six registered views.
 */

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Height of the window in tool-content lines. Mirrors the `16` in styles.css;
 * `styles.test.ts` asserts the two values agree.
 */
export const SCROLL_WINDOW_LINES = 16;

export function ScrollBox({
  children,
  className,
  followTail = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Keep the window at the end of its content, the way a terminal does.
   *
   * `bash` output is read from its tail (the conclusion is at the end), so its
   * box opens scrolled to the bottom and stays there while output is still
   * arriving — unless the reader scrolled up, which pins it to that position
   * instead of yanking the text away.
   */
  followTail?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFollowTail(ref, followTail);

  return (
    <div
      className={className ? `tool-view-scroll ${className}` : "tool-view-scroll"}
      data-scroll-lines={SCROLL_WINDOW_LINES}
      ref={ref}
    >
      {children}
    </div>
  );
}

function useFollowTail(
  ref: React.RefObject<HTMLDivElement | null>,
  followTail: boolean,
): void {
  useEffect(() => {
    const node = ref.current;
    if (!node || !followTail) return;

    let pinned = true;
    const toBottom = () => {
      if (pinned) node.scrollTop = node.scrollHeight;
    };
    const onScroll = () => {
      pinned = node.scrollHeight - node.scrollTop - node.clientHeight <= 2;
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    toBottom();

    // The box mounts inside the (closed) tool `<details>`: while it has no layout
    // its scrollHeight is 0, so the first attempt above can be a no-op. The
    // observer re-runs it once the browser gives the element a real box (opening
    // the detail) and while new output grows the content.
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(toBottom);
    observer?.observe(node);

    return () => {
      observer?.disconnect();
      node.removeEventListener("scroll", onScroll);
    };
  }, [ref, followTail]);
}
