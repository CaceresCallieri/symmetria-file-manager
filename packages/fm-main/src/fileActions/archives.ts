import {
  access,
  chmod,
  link,
  lstat,
  mkdtemp,
  readdir,
  readlink,
  realpath,
  rm,
  statfs,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type ActionRequest, archiveStem, mutationPaths } from "@symmetria/fm-core/fileActions";
import { isAncestorPath } from "@symmetria/fm-core/overview/model";
import { type ActionProcesses, requireTool } from "./process.ts";

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
async function requireAbsent(path: string): Promise<void> {
  if (
    await lstat(path).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`Destination already exists: ${path}`);
}
async function inspectTree(root: string, validate: boolean): Promise<void> {
  const totals = { entries: 0, bytes: 0 };
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    if (directory) directories.push(...(await inspectDirectory(directory, root, validate, totals)));
  }
}
async function inspectDirectory(
  directory: string,
  root: string,
  validate: boolean,
  totals: { entries: number; bytes: number },
): Promise<string[]> {
  const children: string[] = [];
  for (const name of await readdir(directory).catch(() => [])) {
    const path = join(directory, name);
    const info = await lstat(path).catch(() => null);
    if (!info) continue;
    totals.entries += 1;
    totals.bytes += info.size;
    if (totals.entries > MAX_ARCHIVE_ENTRIES || totals.bytes > MAX_ARCHIVE_BYTES)
      throw new Error("Archive exceeds the limit of 20,000 entries or 1 GiB.");
    if (info.isDirectory()) children.push(path);
    else await validateEntry(path, info, root, validate);
  }
  return children;
}
async function validateEntry(
  path: string,
  info: Awaited<ReturnType<typeof lstat>>,
  root: string,
  validate: boolean,
) {
  if (!info.isSymbolicLink()) {
    if (!info.isFile()) throw new Error("Archive contains a special file.");
    return;
  }
  if (!validate) return;
  await validateLink(path, root);
}

interface LinkWalk {
  location: string;
  remaining: string[];
  depth: number;
}
function requireWithin(root: string, target: string): void {
  const within = relative(root, target);
  if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
    throw new Error("Archive contains a link outside its destination.");
}
function followLink(root: string, target: string, walk: LinkWalk): void {
  if (++walk.depth > 40) throw new Error("Archive contains a cyclic or excessive symlink chain.");
  let components = target;
  if (isAbsolute(target)) {
    // Preserve the raw suffix: resolve() would collapse .. before following links.
    if (target !== root && !target.startsWith(`${root}${sep}`))
      throw new Error("Archive contains a link outside its destination.");
    walk.location = root;
    components = target.slice(root.length);
  }
  walk.remaining.unshift(...components.split(sep));
}
async function advanceLink(root: string, component: string, walk: LinkWalk): Promise<void> {
  if (component === "" || component === ".") return;
  const candidate = component === ".." ? dirname(walk.location) : join(walk.location, component);
  requireWithin(root, candidate);
  const info = await lstat(candidate).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (info?.isSymbolicLink()) followLink(root, await readlink(candidate), walk);
  else walk.location = candidate;
}
async function validateLink(path: string, root: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const walk: LinkWalk = { location: await realpath(dirname(path)), remaining: [], depth: 0 };
  followLink(canonicalRoot, await readlink(path), walk);
  // Kernel resolution applies .. after following the preceding symlink.
  // Text-only normalization accepted s -> . plus l -> s/../outside.
  while (walk.remaining.length) {
    const component = walk.remaining.shift();
    if (component !== undefined) await advanceLink(canonicalRoot, component, walk);
  }
}

async function boundedArchive(
  processes: ActionProcesses,
  args: readonly string[],
  workspace: string,
  signal: AbortSignal,
): Promise<void> {
  const quota = new AbortController();
  let violation: Error | null = null;
  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      await inspectTree(workspace, false);
      const disk = await statfs(workspace);
      if (disk.bavail * disk.bsize < 64 * 1024 * 1024)
        throw new Error("Insufficient free space for this archive.");
    } catch (cause) {
      violation = cause instanceof Error ? cause : new Error(String(cause));
      quota.abort();
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => {
    void check();
  }, 100);
  try {
    await processes.run(await requireTool(processes, "bsdtar"), args, {
      signal: AbortSignal.any([signal, quota.signal]),
    });
    if (violation) throw violation;
    signal.throwIfAborted();
    await inspectTree(workspace, true);
  } catch (cause) {
    if (violation) throw violation;
    throw cause;
  } finally {
    clearInterval(timer);
  }
}
async function publishDirectory(
  processes: ActionProcesses,
  stage: string,
  destination: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  // rename() replaces empty directories. GNU mv uses a no-clobber rename and
  // refuses cross-filesystem copies, so a collision cannot replace user data.
  await processes.run(
    await requireTool(processes, "mv"),
    ["--no-copy", "--no-clobber", "-T", "--", stage, destination],
    { signal },
  );
  if (
    await access(stage).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`Destination already exists: ${destination}`);
}
async function extractOne(
  processes: ActionProcesses,
  path: string,
  directory: string,
  signal: AbortSignal,
): Promise<string> {
  const destination = join(directory, archiveStem(path));
  await requireAbsent(destination);
  const workspace = await mkdtemp(join(directory, ".symmetria-extract-"));
  try {
    // Do not pass -P: libarchive's default rejects traversal and symlink escapes.
    await boundedArchive(
      processes,
      [
        "-x",
        "-f",
        path,
        "-C",
        workspace,
        "--no-same-owner",
        "--no-same-permissions",
        "--safe-writes",
      ],
      workspace,
      signal,
    );
    await chmod(workspace, 0o777 & ~process.umask());
    await publishDirectory(processes, workspace, destination, signal);
    return destination;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
function compressionOptions(format: ActionRequest["format"]): string[] {
  if (format === "zip") return ["--format=zip"];
  const filter =
    format === "tar.gz"
      ? "-z"
      : format === "tar.xz"
        ? "-J"
        : format === "tar.zst"
          ? "--zstd"
          : null;
  return ["--format=pax", ...(filter ? [filter] : [])];
}
async function compress(
  processes: ActionProcesses,
  request: ActionRequest,
  signal: AbortSignal,
): Promise<string> {
  if (!request.destination) throw new Error("Enter an archive destination.");
  const destination = resolve(request.destination);
  const parent = await realpath(dirname(destination));
  const realDestination = join(parent, basename(destination));
  await requireAbsent(realDestination);
  const paths = mutationPaths(request.paths.map((path) => resolve(path)));
  for (const path of paths) {
    const source = await realpath(path);
    if (source === realDestination || isAncestorPath(source, realDestination))
      throw new Error("The archive destination must be outside its source entries.");
  }
  const workspace = await mkdtemp(join(parent, ".symmetria-compress-"));
  const temporary = join(workspace, "archive");
  try {
    const sources = paths.flatMap((path) => ["-C", dirname(path), `./${basename(path)}`]);
    await boundedArchive(
      processes,
      ["-c", "-f", temporary, ...compressionOptions(request.format), ...sources],
      workspace,
      signal,
    );
    signal.throwIfAborted();
    // link() atomically refuses an existing destination, including dangling links.
    await link(temporary, realDestination);
    return realDestination;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
export async function archiveAction(
  processes: ActionProcesses,
  request: ActionRequest,
  signal: AbortSignal,
): Promise<string[]> {
  if (request.action === "compress") return [await compress(processes, request, signal)];
  const outputs: string[] = [];
  for (const path of request.paths) {
    signal.throwIfAborted();
    outputs.push(
      await extractOne(processes, resolve(path), request.destination || dirname(path), signal),
    );
  }
  return outputs;
}
