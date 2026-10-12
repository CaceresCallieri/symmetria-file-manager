import { homedir } from "node:os";
import { join } from "node:path";

import {
  type BookmarkMap,
  decodeBookmarks,
  resolveBookmarks,
  type StoredBookmarks,
  seedBookmarks,
} from "@symmetria/fm-core/bookmarks";

import { readJsonObject, writeJsonObject } from "./jsonStore.ts";

/**
 * The bookmark file, on disk.
 *
 * `fm-core/bookmarks` decides what a store means; this owns where it lives and
 * what happens when the disk disagrees.
 *
 * ── The path is a parameter, and that is not a testing convenience ──────────
 * A module that derived it at import time would make every test either read or
 * write the operator's real `~/.config/symmetria-fm/bookmarks.json`. A caller
 * supplies a path so tests use isolated stores and users can relocate the store.
 */

export interface BookmarkLocation {
  readonly home: string;
  /** An explicit path, from `SYMMETRIA_FM_BOOKMARKS` or from a test. */
  readonly override?: string | undefined;
}

/**
 * Where the file lives.
 *
 * Keep the existing configuration path so an installation retains its bookmarks.
 */
export function bookmarksFilePath({ home, override }: BookmarkLocation): string {
  if (override !== undefined && override !== "") return override;
  return join(home, ".config", "symmetria-fm", "bookmarks.json");
}

/**
 * Read the store.
 *
 * Three answers, and the difference between the first two decides whether the
 * seed gets written:
 *
 * - `null` — no file. A first run.
 * - `"unreadable"` — a file that exists and could not be parsed. The user's
 *   data, mid-edit. It is neither trusted nor overwritten.
 * - a map — whatever the file legitimately said, which may be empty.
 */
export async function loadBookmarks(path: string): Promise<StoredBookmarks> {
  const read = await readJsonObject(path);
  if (read.kind === "absent") return null;
  if (read.kind === "unreadable") return "unreadable";

  return decodeBookmarks(read.value);
}

/**
 * Write the store, atomically.
 *
 * The rename is `jsonStore.ts`'s; what is here is the shape a bookmark file
 * takes.
 */
export async function saveBookmarks(path: string, bookmarks: BookmarkMap): Promise<void> {
  const asObject: Record<string, { path: string; label: string }> = {};
  for (const [letter, mark] of bookmarks) {
    asObject[letter] = { path: mark.path, label: mark.label };
  }

  await writeJsonObject(path, asObject);
}

/**
 * The environment variable that relocates the store.
 *
 * A test must never touch the operator's real configuration. A user may
 * also want the file somewhere else.
 */
const BOOKMARKS_PATH_ENV = "SYMMETRIA_FM_BOOKMARKS";

/** Where this process reads and writes, unless something says otherwise. */
export function defaultBookmarksPath(): string {
  return bookmarksFilePath({ home: homedir(), override: process.env[BOOKMARKS_PATH_ENV] });
}

/**
 * The store this process should use, seeding the file on a first run.
 *
 * The whole read-decide-write sequence in one place, so the IPC handler reads
 * as one call rather than as a policy. A failed seed write is swallowed
 * deliberately: the jumps work for this session either way, and a dialog on
 * startup about a file nobody asked for is worse than a silent retry next time.
 */
export async function readOrSeedBookmarks(
  path: string = defaultBookmarksPath(),
  home: string = homedir(),
): Promise<BookmarkMap> {
  const resolved = resolveBookmarks(seedBookmarks(home), await loadBookmarks(path));
  if (resolved.shouldWrite) await saveBookmarks(path, resolved.bookmarks).catch(() => undefined);
  return resolved.bookmarks;
}
