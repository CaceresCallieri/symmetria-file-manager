import type { FsEntry } from "@symmetria/fm-core/entry";
import {
  computeMatches,
  matchAfterReload,
  nextMatch,
  previousMatch,
} from "@symmetria/fm-core/search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The host's half of search.
 *
 * `fm-core/search` decides which rows match and how to step between them; this
 * owns the things that only exist in a window — the query the user is typing,
 * whether the field is open, and the cursor position to restore if they give
 * up.
 *
 * ── Focus is the mechanism, not a cascade step ──────────────────────────────
 * Nothing here tells the dispatcher to stand down. The field is an `<input>`,
 * `useKeyDispatch` already reports a focused input as `textInputFocused`, and
 * the cascade returns `notOurs` for it. That is why `j` typed into the field is
 * the letter j rather than a cursor move, and it is why this hook needs no
 * key handling of its own beyond Enter and Escape on the field itself.
 */

export interface Search {
  /** True while the field is open and taking keys. */
  readonly active: boolean;
  readonly query: string;
  /** Indices into the current listing, for the rows to mark. */
  readonly matches: ReadonlySet<number>;
  readonly matchCount: number;

  open(): void;
  setQuery(query: string): void;
  /** Close, keeping the cursor and the marks. */
  confirm(): void;
  /** Close, putting the cursor back where the search started. */
  cancel(): void;
  /** Step to the next match. Does nothing when there are none. */
  goNext(): void;
  goPrevious(): void;
}

export interface SearchHost {
  readonly entries: readonly FsEntry[];
  readonly cursorIndex: number;
  /** Where the pane is. Changing it clears the search. */
  readonly path: string;
  moveTo(index: number): void;
}

/**
 * Where the search should sit after its matches changed.
 *
 * A module-level function rather than a branch inside the hook: it is a pure
 * decision about two numbers, and reading it here is easier than reading it
 * nested inside an effect that also moves a cursor.
 *
 * `typed` is what separates the two cases. A new query jumps to the first
 * match; a listing rebuilt under an unchanged query keeps its place.
 */
function positionAfterChange(
  typed: boolean,
  matches: readonly number[],
  cursorIndex: number,
): number {
  if (!typed) return matchAfterReload(matches, cursorIndex);
  return matches.length === 0 ? -1 : 0;
}

export function useSearch(host: SearchHost): Search {
  const [active, setActive] = useState(false);
  const [query, setQueryState] = useState("");
  /** Which match the cursor is on, as a position in the match list. */
  const [position, setPosition] = useState(-1);
  const [restoreTo, setRestoreTo] = useState(0);

  const matchList = useMemo(() => computeMatches(host.entries, query), [host.entries, query]);
  const matches = useMemo(() => new Set(matchList), [matchList]);

  // `moveTo` through a ref, not a dependency.
  //
  // The host rebuilds its callbacks whenever the pane changes, so depending on
  // `moveTo` directly would re-run the query effect below on every cursor move —
  // which is every keystroke, and each run moves the cursor again.
  const move = useRef(host.moveTo);
  move.current = host.moveTo;

  /** Where the cursor is now, readable without making it a dependency. */
  const cursor = useRef(host.cursorIndex);
  cursor.current = host.cursorIndex;

  /**
   * Recompute where the search sits, whenever the matches change.
   *
   * Two things can change them and they need OPPOSITE answers, which is why
   * the last query is tracked rather than the effect simply jumping to the
   * first match every time:
   *
   * - **The user typed.** Jump to the first match: that is what makes search
   *   feel incremental, and the previous position described a query nobody is
   *   running any more.
   * - **The listing was rebuilt underneath a query that did not change** — a
   *   watcher refresh, or a re-sort. Keep the position, so a background event
   *   does not move the user off the file they were reading. `matchAfterReload`
   *   is that rule, ported from the Qt handler's `preservePosition` flag.
   */
  const lastQuery = useRef(query);
  useEffect(() => {
    const typed = lastQuery.current !== query;
    lastQuery.current = query;

    // `cursor.current`, not a dependency. The cursor index is an INPUT to the
    // reload rule, and depending on it would re-run this effect every time the
    // effect itself moves the cursor.
    const next = positionAfterChange(typed, matchList, cursor.current);
    setPosition(next);

    // ── The position is tracked always; the cursor is moved only while open ──
    // This ran only while the field was open, and a confirmed search then went
    // stale: `n` and `N` step from `position`, so a watcher refresh that
    // reordered the listing left it pointing past the end of the new match list
    // and both keys silently did nothing until the field was reopened.
    //
    // Moving the cursor stays gated, and that is the other half of the same
    // point: once a search is confirmed the user is navigating with `n`, and a
    // background refresh must not drag them somewhere they did not ask to go.
    if (!active) return;
    const index = matchList[next];
    if (index !== undefined) move.current(index);
  }, [active, matchList, query]);

  /**
   * Navigating away clears everything.
   *
   * An index is meaningless in another directory: the same number names a
   * different file. The Qt `WindowState` drops its transient search state on
   * navigation for exactly this reason.
   */
  const lastPath = useRef(host.path);
  const moved = lastPath.current !== host.path;
  lastPath.current = host.path;

  // Adjusted during render rather than in an effect: an effect would let one
  // frame paint with the old directory's matches marked on the new directory's
  // rows, which is a wrong answer shown to the user rather than a missing one.
  if (moved && (active || query !== "")) {
    setActive(false);
    setQueryState("");
    setPosition(-1);
  }

  const step = useCallback(
    (to: (list: readonly number[], from: number) => number) => {
      const next = to(matchList, position);
      const index = matchList[next];
      if (index === undefined) return;

      setPosition(next);
      move.current(index);
    },
    [matchList, position],
  );

  return {
    active,
    query,
    matches,
    matchCount: matchList.length,

    open: () => {
      setRestoreTo(cursor.current);
      setQueryState("");
      setPosition(-1);
      setActive(true);
    },
    setQuery: setQueryState,
    confirm: () => setActive(false),
    cancel: () => {
      setActive(false);
      setQueryState("");
      setPosition(-1);
      move.current(restoreTo);
    },
    goNext: () => step(nextMatch),
    goPrevious: () => step(previousMatch),
  };
}
