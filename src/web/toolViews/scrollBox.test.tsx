// @vitest-environment jsdom

/**
 * The shared window component: one wrapper per body, and the tail-follow
 * behaviour that `bash` output depends on (the conclusion of a command is at the
 * end, so its window opens at the end).
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SCROLL_BOX_LINES, ScrollBox } from "./ScrollBox";

/** Minimal stand-in for the platform observer, which jsdom does not implement. */
class FakeResizeObserver {
  static created: FakeResizeObserver[] = [];
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.created.push(this);
  }
  observe(): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeResizeObserver.created = [];
  cleanup();
});

describe("ScrollBox", () => {
  it("renders one window around its content, with no nested scroll box", () => {
    const { container } = render(
      <ScrollBox>
        <div className="code-body">
          <div className="code-line">a</div>
        </div>
      </ScrollBox>,
    );

    const boxes = container.querySelectorAll(".tool-view-scroll");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.getAttribute("data-scroll-lines")).toBe(
      String(SCROLL_BOX_LINES),
    );
    expect(container.querySelector(".tool-view-scroll .tool-view-scroll")).toBeNull();
  });

  it("opens at the end of a tail-following body and follows new output", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container } = render(
      <ScrollBox followTail>
        <pre>one\ntwo</pre>
      </ScrollBox>,
    );
    const box = container.querySelector(".tool-view-scroll") as HTMLElement;
    // jsdom has no layout engine, so the numbers the logic reads are provided.
    Object.defineProperty(box, "scrollHeight", { value: 520, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 260, configurable: true });

    const observer = FakeResizeObserver.created.at(-1);
    observer?.trigger();
    expect(box.scrollTop).toBe(520);

    // A reader who scrolled up keeps their position when more output arrives…
    box.scrollTop = 100;
    fireEvent.scroll(box);
    observer?.trigger();
    expect(box.scrollTop).toBe(100);

    // …and scrolling back to the bottom resumes following.
    box.scrollTop = 260;
    fireEvent.scroll(box);
    Object.defineProperty(box, "scrollHeight", { value: 700, configurable: true });
    observer?.trigger();
    expect(box.scrollTop).toBe(700);
  });

  it("does not touch a body that is not tail-following", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { container } = render(
      <ScrollBox>
        <div className="code-line">a</div>
      </ScrollBox>,
    );
    const box = container.querySelector(".tool-view-scroll") as HTMLElement;
    Object.defineProperty(box, "scrollHeight", { value: 520, configurable: true });

    expect(FakeResizeObserver.created).toHaveLength(0);
    expect(box.scrollTop).toBe(0);
  });
});
