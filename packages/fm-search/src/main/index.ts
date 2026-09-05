/**
 * Creating a search index over a directory, and searching it.
 *
 * The privileged half of the finder. It runs in a Node process — a main
 * process, or the utility process the next phase gives it — and knows nothing
 * about Electron or React.
 *
 * **One index per process, and that is measured rather than chosen.** The
 * store refuses a second open inside one program, so N indices in N processes
 * works and N indices in one process does not. The Qt build works around this
 * with a single process-wide engine whose base path is swapped, which is a
 * last-acquire-wins race across windows; do not reproduce that here. Nothing in
 * this module enforces the rule — it cannot, from inside one process — so the
 * owner of the process boundary is the one that has to respect it.
 */
import { FileFinder } from "@ff-labs/fff-node";

import { type SearchRow, toRow } from "./rows.ts";
import { resolveStorePaths } from "./store.ts";

/** How long to wait for the first scan before searching. */
const SCAN_TIMEOUT_MS = 30_000;

export interface SearchIndex {
  /** Search this index. Synchronous: the engine answers from memory. */
  search(query: string): readonly SearchRow[];
  /** Release the native handle. The caller owns the process boundary. */
  close(): void;
}

/**
 * Build an index over `directory` and wait for its first scan.
 *
 * The wait is the reason this is async. A search issued before the scan
 * completes returns whatever has been indexed so far, which for a large tree is
 * a partial answer presented as a complete one.
 */
export async function createIndex(directory: string): Promise<SearchIndex> {
  const store = resolveStorePaths();
  const created = FileFinder.create({
    basePath: directory,
    frecencyDbPath: store.frecencyDbPath,
    historyDbPath: store.historyDbPath,
  });
  if (!created.ok) throw new Error(`Could not index ${directory}: ${String(created.error)}`);

  const finder = created.value;

  // The scan result is CHECKED, not discarded. This wait is the whole reason
  // `createIndex` is async — a search issued before the scan finishes returns a
  // partial answer presented as a complete one — so swallowing its outcome
  // would defeat the point of waiting at all. `createIndex` resolves only when
  // the index is genuinely ready; the caller owns the retry.
  const scanned = await finder.waitForScan(SCAN_TIMEOUT_MS);
  if (!scanned.ok) {
    finder.destroy();
    throw new Error(`Could not scan ${directory}: ${String(scanned.error)}`);
  }
  if (!scanned.value) {
    finder.destroy();
    throw new Error(`Scanning ${directory} did not finish within ${SCAN_TIMEOUT_MS} ms.`);
  }

  return {
    search(query: string): readonly SearchRow[] {
      if (query === "") return [];
      // `mixedSearch`, never `fileSearch`: the files-only call returns no
      // directories, and directory navigation in the overlay depends on them.
      const result = finder.mixedSearch(query);
      if (!result.ok) return [];
      return result.value.items.map((item, at) =>
        toRow(item, result.value.scores[at], directory, query),
      );
    },
    close(): void {
      // Guarded: a consumer may well close on window-close AND on process
      // exit, and the behaviour of a second destroy against a released native
      // handle is not something this package should be discovering.
      if (!finder.isDestroyed) finder.destroy();
    },
  };
}

// Deliberately NOT re-exported: `matchIndices` and `resolveStorePaths` are
// reachable at `./main/match` and `./main/store`. Every sibling package uses
// exactly one import path per symbol, and a second way in is a second thing to
// keep in step. `SearchRow` is re-exported only because it is this entry's own
// return type.
export type { SearchRow } from "./rows.ts";
