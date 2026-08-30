import { isFailure } from "@symmetria/fm-core/contract";
import type { FsEntry } from "@symmetria/fm-core/entry";
import {
  createPane,
  enterDirectory,
  leaveDirectory,
  moveCursor,
  type PaneState,
  parentOf,
  setEntries,
} from "@symmetria/fm-core/pane";
import type { SortMode } from "@symmetria/fm-core/sort";
import { useCallback, useEffect, useRef, useState } from "react";

import { listDirectory, watchDirectory } from "./bridge.ts";

export interface Pane {
  readonly state: PaneState;
  readonly parentEntries: readonly FsEntry[];
  /** Which entry the parent column sits on — the directory we are inside. */
  readonly parentCursorName: string;
  readonly sort: SortMode;
  readonly showHidden: boolean;
  /** Why the listing is empty, when it is empty for a reason. */
  readonly error: string | null;
  readonly loading: boolean;
  moveBy(delta: number): void;
  enter(): void;
  leave(): void;
}

/**
 * Sorting and hidden files are fixed for now.
 *
 * Both are keyboard operations in the original — registry rows, ported in phase
 * 6 with the rest of the cascade. Holding them as constants rather than as
 * state with no control bound to it keeps this phase honest: the status bar
 * reports what is actually in force, and nothing here pretends to be
 * adjustable.
 */
const SORT: SortMode = "natural";
const SHOW_HIDDEN = false;

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
 * One pane, connected to a real filesystem.
 *
 * Every navigation rule lives in `pane.ts` as a pure transition; this hook only
 * decides WHEN to read the disk and hands the result back to those functions.
 * Keeping the rules out of the hook is what makes them testable without a
 * window — and it is why a bug in navigation is a unit-test failure rather than
 * something reproducible only by clicking.
 */
export function usePane(initialPath: string): Pane {
  const [state, setState] = useState<PaneState>(() => createPane(initialPath));
  const [parentEntries, setParentEntries] = useState<readonly FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const path = state.path;

  // Which read is the current one.
  //
  // Navigating faster than the disk answers is normal with a held key, and
  // without this counter a slow read of a directory already left behind would
  // land on top of a fast read of the directory the user is now in. The Qt
  // version solved the same race with a generation counter, for the same reason.
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);

    const options = { showHidden: SHOW_HIDDEN, sort: SORT };
    const parentPath = parentOf(path);

    void Promise.all([
      listDirectory(path, options),
      // The root is its own parent, so asking again would list it twice. An
      // empty parent column is the truthful rendering of "there is nothing
      // above this".
      parentPath === path ? null : listDirectory(parentPath, options),
    ]).then(([current, parent]) => {
      if (generation.current !== mine) return;

      setLoading(false);
      if (isFailure(current)) {
        setError(current.error.message);
        setState((previous) => setEntries(previous, []));
        setParentEntries([]);
        return;
      }

      setError(null);
      setState((previous) => setEntries(previous, current.value.entries));
      setParentEntries(parent !== null && !isFailure(parent) ? parent.value.entries : []);
    });
  }, [path]);

  useEffect(load, [load]);

  // Re-read when the directory changes underneath us. The watch is per path, so
  // it is torn down and rebuilt on every navigation rather than accumulating.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let released = false;

    void watchDirectory(path, `pane:${path}`, load).then((unsubscribe) => {
      // The effect can be torn down before the watch finishes starting —
      // routine under StrictMode's double mount, and under fast navigation.
      // Without this the watch would outlive the pane that opened it.
      if (released) unsubscribe();
      else stop = unsubscribe;
    });

    return () => {
      released = true;
      stop?.();
    };
  }, [path, load]);

  const moveBy = useCallback((delta: number) => {
    setState((previous) => moveCursor(previous, delta));
  }, []);

  const enter = useCallback(() => {
    setState((previous) => enterDirectory(previous));
  }, []);

  const leave = useCallback(() => {
    setState((previous) => leaveDirectory(previous));
  }, []);

  return {
    state,
    parentEntries,
    parentCursorName: nameOf(path),
    sort: SORT,
    showHidden: SHOW_HIDDEN,
    error,
    loading,
    moveBy,
    enter,
    leave,
  };
}
