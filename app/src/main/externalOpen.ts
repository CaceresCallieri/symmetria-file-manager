import { realpath, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { ExternalOpen } from "@symmetria/fm-core/bridge";
import type { OpenCommand } from "@symmetria/fm-core/command";

/**
 * What the window shows for an `open` or a `reveal` from another program.
 *
 * Decided here, in the main process, because the answer depends on whether the
 * path is a directory and the renderer has no filesystem to ask.
 */

/** Is this path a directory? Null when it cannot be stat'd at all. */
export type IsDirectory = (path: string) => Promise<boolean | null>;

export const isDirectoryOnDisk: IsDirectory = async (path) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return null;
  }
};

/**
 * The path with repeated and trailing slashes removed: `/a//b/` names the item
 * `b` in `/a`. Both are spelling, not location — the kernel reads `//` as `/` —
 * and the renderer drops a reveal whose parent, as IT computes the parent,
 * differs from the directory sent beside it. Review found `/usr//share`
 * opening `/usr/` with no cursor for exactly that reason. `..` is left alone:
 * that one IS location, through symlinks.
 */
function tidied(path: string): string {
  const trimmed = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * The item a path names, on disk.
 *
 * Only a path ending in `.` or `..` needs the disk: its parent is not the text
 * before the last slash. The disk resolves it, and NOT the text — `resolve()`
 * was used first and review found it wrong: it collapses `..` without
 * following symlinks, so `/bin/../share` became `/share` where the kernel
 * reads `/usr/share`. Everything else is passed through as written, so the
 * folder shown is the one the caller named.
 */
async function itemFor(path: string): Promise<string | null> {
  const name = basename(path);
  if (name !== "." && name !== "..") return path;
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/**
 * The directory to show and the entry to land on.
 *
 * - `open` of a directory shows it. `open` of a FILE shows its folder with the
 *   cursor on it, because a file cannot be listed.
 * - `reveal` always shows the item inside its parent, directories included:
 *   that is what "Show in folder" means.
 * - A path that cannot be stat'd is opened as given. The window's own listing
 *   then reports why it failed, exactly as it did before reveal existed.
 */
export async function externalOpenFor(
  command: OpenCommand,
  isDirectory: IsDirectory,
): Promise<ExternalOpen> {
  // A directory opens exactly as named, as it did before reveal existed.
  if (command.cmd === "open" && (await isDirectory(command.path)) !== false) {
    return { path: command.path, reveal: null };
  }

  const item = await itemFor(tidied(command.path));
  // The root has no parent to be revealed in, and an item the disk cannot
  // resolve has no parent anybody could name: show the path as given.
  if (item === null) return { path: command.path, reveal: null };
  if (item === "/") return { path: "/", reveal: null };
  return { path: dirname(item), reveal: item };
}
