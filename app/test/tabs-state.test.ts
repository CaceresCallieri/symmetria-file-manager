import { describe, expect, it } from "vitest";

import {
  activateTab,
  activePane,
  closeTab,
  createTabs,
  nextTab,
  openTab,
  previousTab,
  showTabBar,
  type TabsState,
  updateActivePane,
  updatePaneById,
} from "../src/renderer/state/tabs.ts";

/**
 * The index arithmetic, on its own.
 *
 * No DOM: this file is pure collection logic, and it is where a subtly wrong
 * index hides best — closing a tab to the left of the active one, closing the
 * active one when it is last, wrapping at either end.
 */

function paths(state: TabsState): string[] {
  return state.tabs.map((tab) => tab.pane.path);
}

/** Four tabs at /a … /d, with the third one active. */
function four(): TabsState {
  let state = createTabs("/a");
  state = openTab(state, "/b");
  state = openTab(state, "/c");
  state = openTab(state, "/d");
  return activateTab(state, 2);
}

describe("opening", () => {
  it("starts with one tab, and no bar to show it", () => {
    const state = createTabs("/home");

    expect(paths(state)).toEqual(["/home"]);
    expect(showTabBar(state)).toBe(false);
  });

  it("inserts beside the active tab rather than at the end", () => {
    // A tab opened from here belongs beside here, which is what the original
    // did and what every browser does.
    const state = openTab(activateTab(four(), 0), "/new");

    expect(paths(state)).toEqual(["/a", "/new", "/b", "/c", "/d"]);
    expect(state.activeIndex).toBe(1);
  });

  it("never reuses an id, even after a close", () => {
    // The watcher reconciler keys on the id. A reused id would inherit the
    // closed tab's watch and never start its own.
    const opened = openTab(createTabs("/a"), "/b");
    const closed = closeTab(opened, 1);
    const again = openTab(closed as TabsState, "/c");

    expect(again.tabs.map((t) => t.id)).toEqual(["tab-0", "tab-2"]);
  });
});

describe("closing", () => {
  it("keeps the same tab active when one to its left closes", () => {
    const state = closeTab(four(), 0);

    expect(paths(state as TabsState)).toEqual(["/b", "/c", "/d"]);
    expect(activePane(state as TabsState)?.path).toBe("/c");
  });

  it("keeps the same tab active when one to its right closes", () => {
    const state = closeTab(four(), 3);

    expect(activePane(state as TabsState)?.path).toBe("/c");
  });

  it("moves to what took the closed tab's place", () => {
    const state = closeTab(four(), 2);

    expect(paths(state as TabsState)).toEqual(["/a", "/b", "/d"]);
    expect(activePane(state as TabsState)?.path).toBe("/d");
  });

  it("falls back to the new last tab when the active one was last", () => {
    const state = closeTab(activateTab(four(), 3), 3);

    expect(activePane(state as TabsState)?.path).toBe("/c");
  });

  it("reports that the window should close when the last tab goes", () => {
    expect(closeTab(createTabs("/a"), 0)).toBeNull();
  });

  it("ignores an index that is not a tab", () => {
    const state = four();
    expect(closeTab(state, 9)).toBe(state);
    expect(closeTab(state, -1)).toBe(state);
  });
});

describe("cycling", () => {
  it("wraps forward and backward", () => {
    // A tab strip is a ring and reads as one — unlike the cursor, which stops.
    const last = activateTab(four(), 3);
    expect(nextTab(last).activeIndex).toBe(0);
    expect(previousTab(activateTab(four(), 0)).activeIndex).toBe(3);
  });

  it("does nothing with a single tab", () => {
    const one = createTabs("/a");
    expect(nextTab(one)).toBe(one);
    expect(previousTab(one)).toBe(one);
  });

  it("ignores activating the tab that is already active", () => {
    const state = four();
    expect(activateTab(state, 2)).toBe(state);
  });
});

describe("updating one tab", () => {
  it("changes the active tab and leaves every other one alone", () => {
    const before = four();
    const after = updateActivePane(before, (pane) => ({ ...pane, cursorIndex: 7 }));

    expect(after.tabs[2]?.pane.cursorIndex).toBe(7);
    expect(after.tabs[0]?.pane).toBe(before.tabs[0]?.pane);
    expect(after.tabs[1]?.pane).toBe(before.tabs[1]?.pane);
  });

  it("returns the same state when the transition changed nothing", () => {
    // Reference equality is the convention `pane.ts` uses for "nowhere to go",
    // and it must survive the tab layer or a no-op key would re-render.
    const state = four();
    expect(updateActivePane(state, (pane) => pane)).toBe(state);
  });

  it("writes a background answer into the tab that asked, by id", () => {
    const before = four();
    const after = updatePaneById(before, "tab-1", (pane) => ({ ...pane, cursorIndex: 4 }));

    expect(after.tabs.find((t) => t.id === "tab-1")?.pane.cursorIndex).toBe(4);
    expect(after.activeIndex).toBe(2);
  });

  it("drops an answer for a tab that closed while its read was in flight", () => {
    // Otherwise a slow read of a closed tab writes into whatever now occupies
    // its index.
    const state = closeTab(four(), 1) as TabsState;

    expect(updatePaneById(state, "tab-1", (pane) => ({ ...pane, cursorIndex: 9 }))).toBe(state);
  });
});
