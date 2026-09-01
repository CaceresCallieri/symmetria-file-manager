import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  type BookmarkMap,
  decodeBookmarks,
  resolveBookmarks,
  type StoredBookmarks,
  seedBookmarks,
} from "@symmetria/fm-core/bookmarks";

/**
 * The bookmark file, on disk.
 *
 * `fm-core/bookmarks` decides what a store means; this owns where it lives and
 * what happens when the disk disagrees.
 *
 * ── The path is a parameter, and that is not a testing convenience ──────────
 * A module that derived it at import time would make every test either read or
 * write the operator's real `~/.config/symmetria-fm/bookmarks.json`. The Qt
 * build reached the same conclusion from the other direction: its frecency
 * database honours `SYMMETRIA_FM_FRECENCY_DIR` so its tests can isolate
 * themselves, and so a user can relocate it.
 */

export interface BookmarkLocation {
  readonly home: string;
  /** An explicit path, from `SYMMETRIA_FM_BOOKMARKS` or from a test. */
  readonly override?: string | undefined;
}

/**
 * Where the file lives.
 *
 * The same path the Qt build uses, deliberately: on a machine running both
 * while the rewrite is compared against the original, they share one file
 * rather than drifting into two sets of jumps.
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
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    // Only a genuinely absent file is a first run. A directory in its place, a
    // permission error or anything else is a file we could not read, and
    // seeding over it would destroy something.
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? null : "unreadable";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Invalid JSON, and an empty file is a special case of it: `JSON.parse("")`
    // throws. Both mean the same thing here — do not touch it.
    return "unreadable";
  }

  // A file holding `[]` or `"h=/home"` parsed, but it is not a store. It is
  // treated as unreadable rather than as an empty one, which is the difference
  // between "seed me, in memory, and leave my file alone to fix" and "the user
  // deliberately deleted every bookmark". An earlier draft conflated the two.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "unreadable";

  return decodeBookmarks(parsed);
}

/**
 * Write the store, atomically.
 *
 * Write-then-rename, because `rename` is the only step that is atomic and a
 * half-written bookmarks file is a start with no jumps at all. The project's
 * own documentation records this as the pattern here, learned from a watcher
 * that dropped its subscription on exactly this sequence.
 *
 * The temporary file sits beside the target rather than in `/tmp`: a rename
 * across filesystems fails with `EXDEV`, and the two are guaranteed to be on
 * the same one only when they share a directory.
 */
export async function saveBookmarks(path: string, bookmarks: BookmarkMap): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const asObject: Record<string, { path: string; label: string }> = {};
  for (const [letter, mark] of bookmarks) {
    asObject[letter] = { path: mark.path, label: mark.label };
  }

  // Indented and newline-terminated: this is a file a person edits by hand, and
  // the Qt build's version of it is readable too.
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(asObject, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

/**
 * The environment variable that relocates the store.
 *
 * Exists for the same two reasons the Qt build's `SYMMETRIA_FM_FRECENCY_DIR`
 * does: a test must never touch the operator's real configuration, and a user
 * may want the file somewhere else.
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
