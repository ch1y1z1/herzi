// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PanelOpenScopeContext,
  createPanelOpenStore,
  groupPanelKey,
  panelOpenStore,
  reasoningPanelKey,
  resetPanelOpenStores,
  toolPanelKey,
  usePanelOpenState,
} from "./panelOpenState";

afterEach(() => {
  cleanup();
  resetPanelOpenStores();
});

describe("createPanelOpenStore", () => {
  it("defaults to collapsed and remembers what was expanded", () => {
    const store = createPanelOpenStore();
    expect(store.get("a")).toBe(false);
    store.set("a", true);
    expect(store.get("a")).toBe(true);
    store.set("a", false);
    expect(store.get("a")).toBe(false);
    expect(store.size).toBe(1);
  });

  it("notifies subscribers only when the value changes", () => {
    const store = createPanelOpenStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set("a", true);
    store.set("a", true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set("b", true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently written key past the bound", () => {
    const store = createPanelOpenStore(2);
    store.set("a", true);
    store.set("b", true);
    // Rewriting `a` makes `b` the least recently written key.
    store.set("a", false);
    store.set("c", true);

    expect(store.size).toBe(2);
    expect(store.get("a")).toBe(false);
    expect(store.get("c")).toBe(true);
    expect(store.get("b")).toBe(false);
  });
});

describe("panelOpenStore registry", () => {
  it("keeps one store per pane so panes cannot leak state", () => {
    panelOpenStore("pane-1").set(toolPanelKey("call-1"), true);
    expect(panelOpenStore("pane-1").get("tool:call-1")).toBe(true);
    expect(panelOpenStore("pane-2").get("tool:call-1")).toBe(false);
    expect(panelOpenStore("pane-1")).toBe(panelOpenStore("pane-1"));
  });

  it("forgets everything when reset", () => {
    panelOpenStore("pane-1").set("tool:call-1", true);
    resetPanelOpenStores();
    expect(panelOpenStore("pane-1").get("tool:call-1")).toBe(false);
  });
});

describe("panel keys", () => {
  it("namespaces ids per row kind", () => {
    expect(toolPanelKey("abc")).toBe("tool:abc");
    expect(groupPanelKey("abc")).toBe("group:abc");
    expect(toolPanelKey("abc")).not.toBe(groupPanelKey("abc"));
  });

  it("keeps a reasoning key stable while the block keeps streaming", () => {
    const streamed = "x".repeat(80);
    expect(reasoningPanelKey(streamed)).toBe(reasoningPanelKey(`${streamed} more text`));
    expect(reasoningPanelKey("  a\n\n b ")).toBe(reasoningPanelKey("a b"));
    expect(reasoningPanelKey("first block")).not.toBe(reasoningPanelKey("second block"));
  });
});

function Toggle({ id }: { id: string }) {
  const [open, setOpen] = usePanelOpenState(id);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>row</summary>
      <div>detail</div>
    </details>
  );
}

describe("usePanelOpenState", () => {
  const details = () => document.querySelector("details") as HTMLDetailsElement;
  const mount = (scope: string) =>
    render(
      <PanelOpenScopeContext.Provider value={scope}>
        <Toggle id={toolPanelKey("call-1")} />
      </PanelOpenScopeContext.Provider>,
    );

  it("survives a remount of the component that owns the row", () => {
    const first = mount("pane-1");
    expect(details().open).toBe(false);

    // jsdom does not implement the details activation behaviour, so drive the
    // same handler the browser fires after the element opened.
    details().open = true;
    fireEvent(details(), new Event("toggle"));
    expect(details().open).toBe(true);

    first.unmount();
    mount("pane-1");
    expect(details().open).toBe(true);
  });

  it("does not share state between panes", () => {
    render(
      <>
        <PanelOpenScopeContext.Provider value="pane-1">
          <Toggle id={toolPanelKey("call-1")} />
        </PanelOpenScopeContext.Provider>
        <PanelOpenScopeContext.Provider value="pane-2">
          <Toggle id={toolPanelKey("call-1")} />
        </PanelOpenScopeContext.Provider>
      </>,
    );

    act(() => panelOpenStore("pane-1").set(toolPanelKey("call-1"), true));

    const rendered = document.querySelectorAll("details");
    expect((rendered[0] as HTMLDetailsElement).open).toBe(true);
    expect((rendered[1] as HTMLDetailsElement).open).toBe(false);
  });
});
