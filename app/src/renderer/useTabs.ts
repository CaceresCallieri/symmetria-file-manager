import { isFailure } from "@symmetria/fm-core/contract";
import type { FsEntry } from "@symmetria/fm-core/entry";
import {
  clearSelection,
  enterDirectory,
  leaveDirectory,
  moveCursor,
  type PaneState,
  parentOf,
  setEntries,
  toggleSelection,
} from "@symmetria/fm-core/pane";
import type { SortMode } from "@symmetria/fm-core/sort";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Unsubscribe } from "../preload/bridge.ts";
import { listDirectory, watchDirectory } from "./bridge.ts";
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
} from "./state/tabs.ts";

/**
 * Sorting and hidden files are fixed for now.
 *
 * Both are keyboard operations that need a place to live per tab; the sort
 * chord and the hidden-file toggle are wired when the operations they drive
 * exist. Holding them as constants rather than as state with no control bound
 * to it keeps the status bar reporting what is actually in force.
 */
const SORT: SortMode = "natural";
const SHOW_HIDDEN = false;

/** What the tab bar draws. */
export interface TabView {
  readonly id: string;
  readonly path: string;
  /** The directory's own name, which is what a tab is called. */
  readonly name: string;
}

export interface Tabs {
  readonly pane: PaneState;
  readonly parentEntries: readonly FsEntry[];
  readonly parentCursorName: string;
  readonly views: readonly TabView[];
  readonly activeIndex: number;
  readonly showBar: boolean;
  readonly sort: SortMode;
  readonly showHidden: boolean;
  readonly error: string | null;
  readonly loading: boolean;

  moveBy(delta: number): void;
  moveTo(index: number): void;
  enter(): void;
  leave(): void;
  navigate(path: string): void;
  toggleMark(): void;
  clearMarks(): void;

  open(): void;
  close(index?: number): void;
  goNext(): void;
  goPrevious(): void;
  activate(index: number): void;
}

/**
 * One running watch: where it points, and how to release it.
 *
 * `stop` is mutable because the slot is claimed BEFORE the watch finishes
 * starting — claiming late would let a second reconciler pass in the same frame
 * start a duplicate watch on the same directory.
 */
interface WatchSlot {
  readonly path: string;
  stop: Unsubscribe;
}

/**
 * The separators the tab topology is encoded with.
 *
 * Control characters, because a path may contain anything a filesystem allows —
 * including every printable character one might otherwise reach for.
 */
const FIELD = "\u0000";
const RECORD = "\u0001";

/** Read the tab topology back out of its encoded form. */
function parseTopology(topology: string): Map<string, string> {
  const pairs = topology.split(RECORD).map((record) => record.split(FIELD));
  return new Map(pairs.map(([id, path]) => [id ?? "", path ?? ""]));
}

/** The last segment of a path. */
function nameOf(path: string): string {
  return (
    path
      .split("/")
      .filter((segment) => segment !== "")
      .pop() ?? "/"
  );
}

/**
 * Several locations open at once, each keeping its own cursor and selection.
 *
 * Every tab reads and watches its own directory, including the ones in the
 * background — switching to a tab must show what is there now, not what was
 * there when it was last looked at.
 *
 * **Watcher lifetime is the leak this can introduce.** A tab that closes must
 * release its watch, and a tab that navigates must release the old one before
 * taking the new. Both are handled by one reconciler keyed on tab identity, so
 * neither depends on a caller remembering to clean up.
 */
export function useTabs(initialPath: string): Tabs {
  const [state, setState] = useState<TabsState>(() => createTabs(initialPath));
  const [parentEntries, setParentEntries] = useState<readonly FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const pane = activePane(state);
  if (pane === null) {
    // Unreachable by construction: `closeTab` reports the last close by
    // returning null rather than by emptying the list, so the collection is
    // never empty. Stated rather than papered over with a fallback pane, which
    // would render an empty directory and look like a filesystem problem.
    throw new Error("the tab collection is empty, which closeTab never produces");
  }
  const activePath = pane.path;

  // What the reconciler below actually cares about: which tabs exist and where
  // each one points. Every cursor move rebuilds `state.tabs`, so depending on
  // the array itself would re-run the reconciler on every keystroke. The
  // reconciler reads its tabs back OUT of this string rather than from a ref,
  // so what it depends on and what it uses are the same thing.
  const topology = state.tabs.map((tab) => `${tab.id}${FIELD}${tab.pane.path}`).join(RECORD);

  // Which read is the current one, per tab.
  //
  // Navigating faster than the disk answers is normal with a held key, and
  // without this a slow read of a directory already left behind would land on
  // top of a fast read of the directory the user is now in. The Qt version
  // solved the same race with a generation counter, for the same reason.
  const generation = useRef(new Map<string, number>());

  const loadTab = useCallback((id: string, path: string) => {
    const mine = (generation.current.get(id) ?? 0) + 1;
    generation.current.set(id, mine);

    void listDirectory(path, { showHidden: SHOW_HIDDEN, sort: SORT }).then((reply) => {
      if (generation.current.get(id) !== mine) return;

      if (isFailure(reply)) {
        setState((previous) => updatePaneById(previous, id, (p) => setEntries(p, [])));
        setError(reply.error.message);
        return;
      }
      setError(null);
      setState((previous) =>
        updatePaneById(previous, id, (p) => setEntries(p, reply.value.entries)),
      );
    });
  }, []);

  // One reconciler for reads and watches, over every tab.
  //
  // It compares what is running against what the tabs now are, so a closed tab
  // releases its watch and a navigated tab swaps its own — without any caller
  // knowing that watches exist. `live` outlives each run, which is what makes
  // "release what is gone" expressible at all.
  const live = useRef(new Map<string, WatchSlot>());

  useEffect(() => {
    const wanted = parseTopology(topology);

    for (const [id, running] of live.current) {
      if (wanted.get(id) === running.path) continue;
      running.stop();
      live.current.delete(id);
    }

    for (const [id, path] of wanted) {
      if (live.current.has(id)) continue;

      // Claim the slot before the watch resolves, so a second pass in the same
      // frame does not start a duplicate watch on the same directory.
      const slot: WatchSlot = { path, stop: () => undefined };
      live.current.set(id, slot);

      loadTab(id, path);
      void watchDirectory(path, `${id}:${path}`, () => loadTab(id, path)).then((unsubscribe) => {
        // The tab may have closed or navigated while the watch was starting.
        if (live.current.get(id) === slot) slot.stop = unsubscribe;
        else unsubscribe();
      });
    }
  }, [topology, loadTab]);

  // Release every watch when the window goes. Separate from the reconciler so
  // it does not run on each change of the tab list.
  useEffect(() => {
    const running = live.current;
    return () => {
      for (const { stop } of running.values()) stop();
      running.clear();
    };
  }, []);

  // The parent column belongs to the active tab only: no background tab shows
  // one, so reading it for all of them would be work nobody sees.
  useEffect(() => {
    const parentPath = parentOf(activePath);
    if (parentPath === activePath) {
      setParentEntries([]);
      return;
    }

    let current = true;
    setLoading(true);
    void listDirectory(parentPath, { showHidden: SHOW_HIDDEN, sort: SORT }).then((reply) => {
      if (!current) return;
      setLoading(false);
      setParentEntries(isFailure(reply) ? [] : reply.value.entries);
    });

    return () => {
      current = false;
    };
  }, [activePath]);

  const changeActive = useCallback((change: (p: PaneState) => PaneState) => {
    setState((previous) => updateActivePane(previous, change));
  }, []);

  const close = useCallback((index?: number) => {
    setState((previous) => {
      const next = closeTab(previous, index ?? previous.activeIndex);
      if (next !== null) return next;

      // The last tab is gone, so there is nothing left to be a window for. The
      // watches go with it through the unmount cleanup above.
      window.close();
      return previous;
    });
  }, []);

  return {
    pane,
    parentEntries,
    parentCursorName: nameOf(activePath),
    views: state.tabs.map((tab) => ({
      id: tab.id,
      path: tab.pane.path,
      name: nameOf(tab.pane.path),
    })),
    activeIndex: state.activeIndex,
    showBar: showTabBar(state),
    sort: SORT,
    showHidden: SHOW_HIDDEN,
    error,
    loading,

    moveBy: (delta) => changeActive((p) => moveCursor(p, delta)),
    moveTo: (index) => changeActive((p) => moveCursor(p, index - p.cursorIndex)),
    enter: () => changeActive(enterDirectory),
    leave: () => changeActive(leaveDirectory),
    navigate: (path) => changeActive((p) => ({ ...p, path, entries: [], cursorIndex: 0 })),
    toggleMark: () => changeActive(toggleSelection),
    clearMarks: () => changeActive(clearSelection),

    open: () => setState((previous) => openTab(previous, activePath)),
    close,
    goNext: () => setState(nextTab),
    goPrevious: () => setState(previousTab),
    activate: (index) => setState((previous) => activateTab(previous, index)),
  };
}
