import type { FsEntry } from "./entry.ts";

/**
 * One pane's navigation state.
 *
 * Pure data with pure transitions, so every navigation rule is testable without
 * a window. The renderer holds one of these per tab and renders it; it never
 * decides where the cursor goes.
 */
export interface PaneState {
  /**
   * An absolute, normalised path.
   *
   * Every function here assumes `entries` holds ONE DIRECTORY's listing, where
   * the filesystem guarantees names are unique. Cursor memory and React list
   * keys both look entries up by name, so a flattened cross-directory listing —
   * search results, say — would silently pick the wrong entry.
   */
  readonly path: string;
  readonly entries: readonly FsEntry[];
  readonly cursorIndex: number;
  /**
   * Where the cursor sat in each directory already visited.
   *
   * Per directory, not one global value. Going in and coming back out must land
   * the cursor where it was left — that is what makes Miller columns navigable
   * rather than a list that resets under you.
   */
  readonly cursorMemory: ReadonlyMap<string, string>;
  /**
   * The marked entries, by name.
   *
   * Per pane, so it is per tab the moment tabs exist — a selection that
   * followed the window would let a file operation act on entries the user
   * marked somewhere else entirely.
   *
   * Names rather than paths: an entry belongs to one directory, so the pane's
   * own path completes it. What the selection is FOR arrives with the file
   * operations; what it must be is per pane, and that is decided here.
   */
  readonly selection: ReadonlySet<string>;
}

/**
 * How many directories' cursors are remembered.
 *
 * Unbounded, this grows one entry per unique directory visited for the lifetime
 * of the renderer — days, in a resident application. Bounded, the copy that
 * `moveCursor` makes on every keystroke is also bounded: a held `j` copies at
 * most this many entries per repeat, which at 128 is noise beside a React
 * render.
 */
const MEMORY_LIMIT = 128;

export interface Breadcrumb {
  readonly label: string;
  readonly path: string;
}

export function createPane(path: string): PaneState {
  return { path, entries: [], cursorIndex: 0, cursorMemory: new Map(), selection: new Set() };
}

export function cursorEntry(pane: PaneState): FsEntry | null {
  return pane.entries[pane.cursorIndex] ?? null;
}

/**
 * Replace the listing, keeping the cursor on the same NAME where possible.
 *
 * A re-sort or a watcher refresh is not navigation. The user's attention is on
 * a file, not on an index, so moving the cursor under them is how the wrong
 * file gets deleted. When the name is gone, the index is clamped into range.
 */
export function setEntries(pane: PaneState, entries: readonly FsEntry[]): PaneState {
  // Memory is the only source of truth once populated. An earlier draft also
  // fell back to the current cursor entry, which could only ever fire on a
  // pane whose entries were still empty — dead in practice, and it obscured
  // that memory was doing all the work.
  const remembered = pane.cursorMemory.get(pane.path);
  const byName = remembered === undefined ? -1 : entries.findIndex((e) => e.name === remembered);

  const cursorIndex =
    byName >= 0 ? byName : Math.min(pane.cursorIndex, Math.max(entries.length - 1, 0));

  // Drop marks for entries that are gone.
  //
  // A selection is a set of NAMES, so a file deleted underfoot would leave its
  // name marked — and a later operation would act on whatever is recreated with
  // that name. Pruning on every refresh keeps the mark and the entry together.
  const present = new Set(entries.map((e) => e.name));
  const kept = [...pane.selection].filter((name) => present.has(name));
  const selection = kept.length === pane.selection.size ? pane.selection : new Set(kept);

  const next = { ...pane, entries, cursorIndex, selection };

  // A miss means the remembered entry is gone. Leaving the old name in memory
  // means that if a file with that name is ever recreated here, the cursor
  // teleports back to it on the next refresh — somewhere the user never
  // navigated and has not been for some time.
  return byName >= 0 ? next : { ...next, cursorMemory: remember(next, cursorIndex) };
}

/**
 * Move the cursor, without wrapping.
 *
 * Wrapping is disorienting in a list navigated by feel: hold `j`, the cursor
 * silently teleports to the top, and the next keystroke acts on the wrong file.
 */
export function moveCursor(pane: PaneState, delta: number): PaneState {
  if (pane.entries.length === 0) return { ...pane, cursorIndex: 0 };

  const cursorIndex = Math.max(0, Math.min(pane.entries.length - 1, pane.cursorIndex + delta));
  return { ...pane, cursorIndex, cursorMemory: remember(pane, cursorIndex) };
}

function remember(pane: PaneState, index: number): ReadonlyMap<string, string> {
  const name = pane.entries[index]?.name;
  if (name === undefined) return pane.cursorMemory;

  const next = new Map(pane.cursorMemory);
  // Re-inserting moves the key to the end, so the iteration order is
  // least-recently-used first and the eviction below drops the right one.
  next.delete(pane.path);
  next.set(pane.path, name);

  while (next.size > MEMORY_LIMIT) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

/**
 * Enter the directory under the cursor.
 *
 * Returns the pane unchanged when the cursor is not on a directory, so a caller
 * can bind this to a key without asking first. A symlink to a directory reports
 * `kind: "directory"`, which is what makes a symlinked directory enterable.
 */
export function enterDirectory(pane: PaneState): PaneState {
  const target = cursorEntry(pane);
  if (target === null || target.kind !== "directory") return pane;

  return {
    path: joinPath(pane.path, target.name),
    entries: [],
    cursorIndex: 0,
    cursorMemory: remember(pane, pane.cursorIndex),
    // A selection does not survive leaving the directory it was made in. The
    // names would still match in the new one, and a file operation would then
    // act on entries that merely share a name with what was marked.
    selection: new Set(),
  };
}

/** Go to the parent, stopping at the root rather than climbing past it. */
export function leaveDirectory(pane: PaneState): PaneState {
  const parent = parentOf(pane.path);
  if (parent === pane.path) return pane;

  return {
    path: parent,
    entries: [],
    cursorIndex: 0,
    cursorMemory: pane.cursorMemory,
    selection: new Set(),
  };
}

/**
 * Mark or unmark the entry under the cursor, and step past it.
 *
 * Advancing is what makes marking a run of files a repeated single keystroke
 * rather than an alternation of two. It stops at the last entry rather than
 * wrapping, for the same reason cursor movement does.
 */
export function toggleSelection(pane: PaneState): PaneState {
  const target = cursorEntry(pane);
  if (target === null) return pane;

  const selection = new Set(pane.selection);
  if (!selection.delete(target.name)) selection.add(target.name);

  const cursorIndex = Math.min(pane.cursorIndex + 1, pane.entries.length - 1);
  return { ...pane, selection, cursorIndex, cursorMemory: remember(pane, cursorIndex) };
}

/** Unmark everything. Returns the pane unchanged when nothing was marked. */
export function clearSelection(pane: PaneState): PaneState {
  return pane.selection.size === 0 ? pane : { ...pane, selection: new Set() };
}

/**
 * The path's segments, with every empty one dropped.
 *
 * One splitter for every path function here. `parentOf` used to strip only
 * TRAILING slashes while `breadcrumbs` collapsed internal ones, so the two
 * disagreed on `/home//jc` — `parentOf` answered `/home/` and `breadcrumbs`
 * answered `/home`. Two path parsers with different opinions is one too many.
 */
function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

export function joinPath(base: string, name: string): string {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

export function parentOf(path: string): string {
  const segments = segmentsOf(path);
  segments.pop();
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** The path as clickable segments, root first. */
export function breadcrumbs(path: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: "/", path: "/" }];

  let accumulated = "";
  for (const segment of segmentsOf(path)) {
    accumulated += `/${segment}`;
    crumbs.push({ label: segment, path: accumulated });
  }
  return crumbs;
}

/**
 * Did a navigation actually happen?
 *
 * `enterDirectory` and `leaveDirectory` return the pane BY REFERENCE when there
 * is nowhere to go, so a caller can bind them to a key without asking first.
 * This names that convention rather than leaving each call site to know it.
 */
export function didNavigate(before: PaneState, after: PaneState): boolean {
  return before !== after;
}
