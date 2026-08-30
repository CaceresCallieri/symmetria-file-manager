import { lstat, realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";

import watcher from "@parcel/watcher";

/** What changed, and what it is now. */
export interface ChangedEntry {
  readonly name: string;
  readonly size: number;
  /**
   * Whether the entry still exists.
   *
   * Without this a deleted file and a genuinely empty one are the same event —
   * both report `size: 0` — and a consumer cannot tell "remove this row" from
   * "this row is empty".
   */
  readonly kind: "changed" | "deleted";
}

/** Call to release the watch. Safe to call more than once. */
export type StopWatching = () => Promise<void>;

/**
 * Watch one directory, non-recursively, and report what changed.
 *
 * **This replaces machinery rather than porting it.** Qt's directory watcher
 * omits `IN_MODIFY` from its inotify mask, so a file that grew on disk after it
 * was first listed emitted no event at all — a download streamed straight to its
 * final name sat at 0 bytes with no preview until the user navigated away and
 * back. The C++ worked around that with per-file watches, a `kMaxFileWatches`
 * cap to protect the inotify budget, and a debounced rescan. libuv's watches
 * include `IN_MODIFY`, so all of it is deleted. `watch.test.ts` is what proves
 * the deletion was safe.
 *
 * The size is re-read per event because an entry is an immutable snapshot: a
 * changed file becomes a new entry, never a mutated one.
 */
export async function watchDirectory(
  path: string,
  onChange: (changed: ChangedEntry[]) => void,
): Promise<StopWatching> {
  // Canonicalise once. The watcher reports realpath-resolved paths, so a
  // directory reached through a symlink — or named with a trailing slash —
  // would fail a raw string comparison and silently report nothing at all.
  const root = await realpath(path).catch(() => path);

  let released = false;
  const inFlight = new Set<Promise<void>>();

  const subscription = await watcher.subscribe(
    root,
    (error, events) => {
      if (error !== null || released) return;

      const here = events.filter((event) => dirname(event.path) === root);
      if (here.length === 0) return;

      const work = Promise.all(here.map(toChangedEntry))
        .then((changed) => {
          // The handler started before `stop()` and settled after it. Without
          // this check a closed tab still receives an update for a watcher its
          // owner believes is dead.
          if (!released) onChange(changed);
        })
        .catch(() => undefined);

      inFlight.add(work);
      void work.finally(() => inFlight.delete(work));
    },
    // Non-recursive: one directory, one watch. A recursive watch over a home
    // directory is how an inotify budget disappears.
    { ignore: [] },
  );

  return async () => {
    if (released) return;
    released = true;
    await subscription.unsubscribe();
    // Let anything already dispatched settle, so a caller that awaits `stop()`
    // knows no further callback can arrive.
    await Promise.allSettled([...inFlight]);
  };
}

async function toChangedEntry(event: { path: string }): Promise<ChangedEntry> {
  const stats = await lstat(event.path).catch(() => null);
  return {
    name: basename(event.path),
    size: stats?.size ?? 0,
    kind: stats === null ? "deleted" : "changed",
  };
}
