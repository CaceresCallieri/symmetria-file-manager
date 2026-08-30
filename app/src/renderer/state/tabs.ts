import { createPane, type PaneState } from "@symmetria/fm-core/pane";

/**
 * The tab collection, as pure transitions.
 *
 * Tabs are the primary navigation model rather than a per-window detail
 * (decision D3): a tool that makes it easy to scatter twenty windows
 * encourages scattering twenty windows. There is one window, and anything that
 * would spawn a second is out of scope.
 *
 * ── What is per tab and what is shared ──────────────────────────────────────
 * Per tab: everything navigational — location, cursor, cursor memory,
 * selection. All of it already lives in `PaneState`, so a tab IS a pane plus an
 * identity, and nothing has to be kept in step by hand.
 *
 * Shared: the clipboard, the theme, and anything the main process owns. The Qt
 * original drew the line in the same place, with the clipboard and picker mode
 * global and everything navigational per window.
 */

interface Tab {
  /**
   * Stable across reordering, unlike an index.
   *
   * The watcher reconciler keys on this. With an index, closing tab 0 would
   * renumber every tab after it and the reconciler would tear down and rebuild
   * watches for directories nobody left.
   */
  readonly id: string;
  readonly pane: PaneState;
}

export interface TabsState {
  readonly tabs: readonly Tab[];
  readonly activeIndex: number;
  /** Where the next id comes from. Monotonic, never reused. */
  readonly nextId: number;
}

export function createTabs(path: string): TabsState {
  return { tabs: [{ id: "tab-0", pane: createPane(path) }], activeIndex: 0, nextId: 1 };
}

function activeTab(state: TabsState): Tab | null {
  return state.tabs[state.activeIndex] ?? null;
}

export function activePane(state: TabsState): PaneState | null {
  return activeTab(state)?.pane ?? null;
}

/** True once there is more than one tab, which is when the bar earns its space. */
export function showTabBar(state: TabsState): boolean {
  return state.tabs.length > 1;
}

/**
 * Open a tab, and make it the active one.
 *
 * Inserted immediately after the active tab rather than at the end, which is
 * what the original did and what every browser does: a tab opened from here
 * belongs beside here.
 */
export function openTab(state: TabsState, path: string): TabsState {
  const at = state.activeIndex + 1;
  const tab: Tab = { id: `tab-${state.nextId}`, pane: createPane(path) };

  return {
    tabs: [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)],
    activeIndex: at,
    nextId: state.nextId + 1,
  };
}

/**
 * Close a tab, or report that the window should close.
 *
 * `null` means the last tab is gone. The window closing is the caller's to do —
 * this module knows about tabs, not about windows.
 */
export function closeTab(state: TabsState, index: number): TabsState | null {
  if (index < 0 || index >= state.tabs.length) return state;

  const tabs = [...state.tabs.slice(0, index), ...state.tabs.slice(index + 1)];
  if (tabs.length === 0) return null;

  // Closing a tab to the LEFT of the active one shifts the active one down, so
  // the same tab stays active. Closing the active one moves to what took its
  // place, or to the new last tab when it was the last.
  const activeIndex =
    index < state.activeIndex
      ? state.activeIndex - 1
      : Math.min(state.activeIndex, tabs.length - 1);

  return { ...state, tabs, activeIndex };
}

export function activateTab(state: TabsState, index: number): TabsState {
  if (index < 0 || index >= state.tabs.length || index === state.activeIndex) return state;
  return { ...state, activeIndex: index };
}

/** Wraps, unlike cursor movement: a tab strip is a ring and reads as one. */
export function nextTab(state: TabsState): TabsState {
  if (state.tabs.length <= 1) return state;
  return activateTab(state, (state.activeIndex + 1) % state.tabs.length);
}

export function previousTab(state: TabsState): TabsState {
  if (state.tabs.length <= 1) return state;
  const count = state.tabs.length;
  return activateTab(state, (state.activeIndex - 1 + count) % count);
}

/**
 * Apply a pane transition to one tab by id, whichever tab that is now.
 *
 * By id and not by index, because this is what a background listing and a
 * background watcher call back into: by the time a slow read of tab 3 lands,
 * tab 1 may have closed and the answer would be written into the wrong tab.
 */
export function updatePaneById(
  state: TabsState,
  id: string,
  change: (pane: PaneState) => PaneState,
): TabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  const current = state.tabs[index];
  // A tab that closed while its read was in flight. Dropping the answer is
  // right: there is nothing left to show it in.
  if (current === undefined) return state;

  const pane = change(current.pane);
  if (pane === current.pane) return state;

  const tabs = [...state.tabs];
  tabs[index] = { ...current, pane };
  return { ...state, tabs };
}

/**
 * Apply a pane transition to the active tab, leaving every other tab alone.
 *
 * The single way navigation reaches a pane, so "a key press changes exactly one
 * tab" is a property of this function rather than a rule every caller has to
 * remember.
 */
export function updateActivePane(
  state: TabsState,
  change: (pane: PaneState) => PaneState,
): TabsState {
  const current = state.tabs[state.activeIndex];
  if (current === undefined) return state;

  const pane = change(current.pane);
  if (pane === current.pane) return state;

  const tabs = [...state.tabs];
  tabs[state.activeIndex] = { ...current, pane };
  return { ...state, tabs };
}
