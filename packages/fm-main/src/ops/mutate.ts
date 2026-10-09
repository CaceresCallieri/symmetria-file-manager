import { cp, lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import type { TransferMode } from "@symmetria/fm-core/contract";
import { isAncestorPath } from "@symmetria/fm-core/overview/model";

/**
 * Copying, moving, creating and renaming — in this process, not through a shell.
 *
 * The Qt build shelled out for all of it: `cp -r`, `mv`, `touch`, `mkdir -p`,
 * each through a `QProcess` wrapper, with the result inferred from an exit code.
 * Doing it here is what makes real progress and real cancellation possible at
 * all, and it makes a conflict something to ask about rather than something
 * `cp` silently resolves.
 *
 * **What a hand-rolled copy gives up, recorded rather than discovered.**
 * `cp -a` preserves hard links between copied files and keeps sparse files
 * sparse. `fs.cp` does neither. For a file manager's copy that is an acceptable
 * trade for progress and cancellation; if it ever bites, the fallback is
 * delegating large copies back to the system tool.
 */

/** How a transfer reports what it has done so far. */
type OnProgress = (done: number, total: number) => void;

export interface TransferOptions {
  readonly sources: readonly string[];
  readonly destination: string;
  readonly mode: TransferMode;
  readonly overwrite: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: OnProgress;
}

export interface TransferOutcome {
  readonly moved: number;
  readonly conflicts: readonly string[];
}

/** Does anything exist at this path? A broken symlink counts: it is in the way. */
async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Would this transfer put a directory inside itself?
 *
 * `cp -r a a/b` is an infinite tree, and `mv` refuses it outright. Checking the
 * resolved prefix catches the whole family — including a destination several
 * levels down inside the source.
 */
function wouldRecurse(source: string, destination: string): boolean {
  const from = resolve(source);
  const into = resolve(destination);
  return isAncestorPath(from, into);
}

/** Resolve existing directory aliases without requiring copy destinations to exist. */
async function physicalDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    // Copy historically creates missing destination directories. Resolve their
    // nearest existing parent and preserve the missing suffix for the same behavior.
    return join(await physicalDirectory(parent), basename(absolute));
  }
}

async function validateTransfer(
  sources: readonly string[],
  destination: string,
  mode: TransferMode,
): Promise<void> {
  const names = new Set<string>();
  const physicalDestination = await physicalDirectory(destination);
  for (const source of sources) {
    const name = basename(source);
    // Cross-folder marks can share a basename. POSIX rename would replace the
    // first moved entry with the second, so refuse the entire batch up front.
    if (names.has(name))
      throw new Error(`cannot ${mode} two entries named ${name} into one folder`);
    names.add(name);
    // A same-parent overwrite targets the source itself. Validate every final
    // target before the batch starts; moveEntry removes overwrite targets.
    const target = join(destination, basename(source));
    if (resolve(source) === resolve(target) || wouldRecurse(source, destination)) {
      throw new Error(`cannot ${mode} ${basename(source)} into itself`);
    }
    // Resolving only final inode equality missed aliased descendants and allowed
    // overwrite to remove nested data before rename failed. Resolve the source
    // parent, not its final symlink entry, to keep symlink transfers as entries.
    const physicalSource = join(await physicalDirectory(dirname(source)), name);
    if (wouldRecurse(physicalSource, physicalDestination))
      throw new Error(`cannot ${mode} ${name} into itself`);
    const from = await lstat(source);
    const into = await lstat(target).catch(() => null);
    // Lexical equality missed directory symlink aliases. lstat preserves entry
    // semantics while detecting the same inode through an aliased parent path.
    if (into && from.dev === into.dev && from.ino === into.ino)
      throw new Error(`cannot ${mode} ${name} into itself`);
  }
}

/** Every source whose name is already taken at the destination. */
async function collisions(sources: readonly string[], destination: string): Promise<string[]> {
  const taken: string[] = [];
  for (const source of sources) {
    if (await exists(join(destination, basename(source)))) taken.push(basename(source));
  }
  return taken;
}

/**
 * Copy or move entries into a directory.
 *
 * **Conflicts stop the whole operation before it starts.** Transferring three
 * files and asking about the fourth leaves the user reasoning about a partial
 * result; naming every collision up front lets them answer once.
 */
export async function transfer(options: TransferOptions): Promise<TransferOutcome> {
  const { sources, destination, mode, overwrite, signal, onProgress } = options;

  await validateTransfer(sources, destination, mode);

  if (!overwrite) {
    const conflicts = await collisions(sources, destination);
    if (conflicts.length > 0) return { moved: 0, conflicts };
  }

  let moved = 0;
  onProgress?.(0, sources.length);

  for (const source of sources) {
    // Checked between entries rather than mid-copy: a cancelled transfer leaves
    // whole entries behind, never a half-written file.
    if (signal?.aborted === true) break;

    const target = join(destination, basename(source));
    if (mode === "copy") {
      await cp(source, target, { recursive: true, force: overwrite, errorOnExist: !overwrite });
    } else {
      await moveEntry(source, target, overwrite);
    }

    moved += 1;
    onProgress?.(moved, sources.length);
  }

  return { moved, conflicts: [] };
}

/**
 * Move one entry, across filesystems if it has to.
 *
 * `rename` is atomic and instant, and it fails with `EXDEV` when the two paths
 * are on different mounts — which is the ordinary case for a move from a home
 * directory to a USB stick. Copy-then-delete is the documented fallback, and it
 * must not run for any other error: a failed rename for permission reasons
 * would otherwise turn into a copy that succeeds and a delete that does not.
 */
async function moveEntry(source: string, target: string, overwrite: boolean): Promise<void> {
  try {
    if (overwrite) await rm(target, { recursive: true, force: true });
    await rename(source, target);
  } catch (error) {
    // SAFETY: `rename` rejects with an `ErrnoException`, on which `code` is
    // optional — so a rejection of any other shape reads as `undefined`, fails
    // this test and is rethrown, which is the conservative direction.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;

    await cp(source, target, { recursive: true, force: overwrite });
    await rm(source, { recursive: true, force: true });
  }
}

/**
 * Create an empty file or a directory.
 *
 * Parents are created too, which is what `mkdir -p` gave the Qt build and what
 * makes typing `notes/2026/august.md` into the create dialog do what it looks
 * like it does.
 */
export async function createEntry(path: string, kind: "file" | "directory"): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (kind === "directory") {
    // Recursive mkdir on the final target accepted existing folders, so create
    // closed its dialog without an error. Only parents are idempotent; plain
    // mkdir rejects an existing final target with the original EEXIST error.
    await mkdir(path);
    return;
  }

  // `wx` fails when the file is already there rather than truncating it. An
  // accidental second Enter on the create dialog must not empty a file.
  await writeFile(path, "", { flag: "wx" });
}

/**
 * Rename an entry in place, refusing a name that is already taken.
 *
 * `rename` would silently replace the other entry, and the other entry may be
 * the only copy of something. Checking first is a race — the name could appear
 * between the check and the rename — but it is the race every file manager
 * accepts, and losing the check loses the file.
 */
export async function renameEntry(path: string, name: string): Promise<string> {
  const target = join(dirname(path), name);
  if (target === path) return path;

  if (await exists(target)) throw new Error(`${name} already exists`);

  await rename(path, target);
  return target;
}
