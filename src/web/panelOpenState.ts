/**
 * Expansion state for the activity groups and rows in Chat.
 *
 * `DisplayMessage.id` is `turn:<last message id>` and therefore changes while a
 * turn is still streaming; React then treats the message as new and a native
 * `<details>` would lose its `open` attribute. The state is kept outside React
 * instead, keyed by a stable identifier per pane, so a group that was expanded
 * while streaming stays expanded once the same items are re-rendered inside the
 * finished `Worked for` group.
 *
 * The store itself has no React dependency; `usePanelOpenState` binds it to a
 * component through `useSyncExternalStore`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

/** Bounded store of "this row/group is expanded" flags. */
export interface PanelOpenStore {
  get(key: string): boolean;
  set(key: string, open: boolean): void;
  subscribe(listener: () => void): () => void;
  readonly size: number;
  clear(): void;
}

export function createPanelOpenStore(limit = 300): PanelOpenStore {
  const entries = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  const max = Math.max(1, limit);

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    get(key) {
      return entries.get(key) ?? false;
    },
    set(key, open) {
      const previous = entries.get(key);
      // Refresh write-recency even when the value does not change, and evict the
      // least recently written key once the bound is exceeded.
      entries.delete(key);
      entries.set(key, open);
      while (entries.size > max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
      if (previous !== open) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
      notify();
    },
  };
}

const stores = new Map<string, PanelOpenStore>();

/**
 * One store per pane, so switching panes cannot leak expansion state and the
 * state survives a ChatView remount.
 */
export function panelOpenStore(scope: string): PanelOpenStore {
  const existing = stores.get(scope);
  if (existing) return existing;
  const created = createPanelOpenStore();
  stores.set(scope, created);
  return created;
}

/** Test helper: drops every pane's expansion state. */
export function resetPanelOpenStores(): void {
  stores.clear();
}

/** Pane id of the Chat view the activity rows belong to. */
export const PanelOpenScopeContext = createContext<string>("");

export function usePanelOpenState(
  key: string,
): [boolean, (open: boolean) => void] {
  const scope = useContext(PanelOpenScopeContext);
  const store = panelOpenStore(scope);

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const getSnapshot = useCallback(() => store.get(key), [key, store]);
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setOpen = useCallback(
    (next: boolean) => store.set(key, next),
    [key, store],
  );

  return [open, setOpen];
}

export function toolPanelKey(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

export function groupPanelKey(id: string): string {
  return `group:${id}`;
}

/**
 * Key for a reasoning row. The streaming part has no stable id available from
 * the runtime, so the (whitespace-normalized) beginning of the text is used:
 * it does not change while the rest of the block keeps streaming, which is what
 * makes an expanded reasoning row survive the end of the turn.
 */
export function reasoningPanelKey(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return `reasoning:${normalized.slice(0, 64)}`;
}
