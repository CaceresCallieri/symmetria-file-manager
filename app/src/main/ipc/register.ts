import type { Dirent } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  type Decoder,
  decodeCancelRequest,
  decodeCancelTransferRequest,
  decodeCreateRequest,
  decodeDescribeRequest,
  decodeListRequest,
  decodeOpenRequest,
  decodePreviewUrlRequest,
  decodeReadTextRequest,
  decodeRenameRequest,
  decodeTransferRequest,
  decodeTrashRequest,
  decodeUnwatchRequest,
  decodeWatchRequest,
  type FailureCode,
  failure,
  type IpcReply,
  isFailure,
  type ListBatch,
  type ListReply,
  type Result,
  success,
} from "@symmetria/fm-core/contract";
import type { EntrySummary, FsEntry } from "@symmetria/fm-core/entry";
import { filterEntries } from "@symmetria/fm-core/filter";
import { resolveMimeType } from "@symmetria/fm-core/mime";
import { sortEntries } from "@symmetria/fm-core/sort";
import { mimeTables } from "../fs/mimeTables.ts";
import { kindOf, scanDirectory } from "../fs/scan.ts";
import { type ChangedEntry, type StopWatching, watchDirectory } from "../fs/watch.ts";
import { operations } from "../ops/index.ts";
import { authorisePreview } from "../previewTokens.ts";
import { previewUrlFor } from "../protocol.ts";
import { CHANNELS, REQUEST_CHANNELS } from "./channels.ts";

/**
 * How much of a file's head the content sniff needs.
 *
 * The same figure `fm-core`'s sniff inspects. Reading more would cost a page
 * fault per preview for evidence nothing reads.
 */
const SNIFF_BYTES = 8192;

/**
 * How many names a directory's describe reply carries.
 *
 * The cap is here rather than in the renderer because this is the side that can
 * stop the work: a directory of ten thousand entries would otherwise serialise
 * ten thousand names across the boundary every time the cursor settled on it,
 * which the 150 ms preview debounce spaces out but does not bound. The true
 * count travels beside the listing, so the column can still say how many it is
 * not showing.
 *
 * 500 is far more than fits on any screen and small enough that the reply stays
 * a few tens of kilobytes.
 */
export const MAX_DIRECTORY_PREVIEW_ENTRIES = 500;

/**
 * One `readdir` result reduced to what a listing row draws.
 *
 * **A symlink's own dirent type is `DT_LNK`**, so `isDirectory()` and
 * `isFile()` are both false for one — classifying straight from the dirent
 * would make every link `other`, and a symlinked directory would draw the wrong
 * icon here while drawing the right one two columns to the left. What a person
 * means by "what is this" is the target, which is what `scanDirectory` already
 * reports in the two navigable columns.
 *
 * `kindOf` is shared with that scan rather than reimplemented, so the two can
 * never come to disagree. The stat strategy is NOT shared: the scan needs a
 * size and an mtime for every entry, and a listing row needs neither, so this
 * pays a `stat` only for the links.
 */
async function direntSummary(directory: string, dirent: Dirent): Promise<EntrySummary> {
  if (!dirent.isSymbolicLink()) return { name: dirent.name, kind: kindOf(dirent) };

  // A broken link resolves to `other` and stays listed, exactly as in the scan:
  // dropping it would make it invisible.
  const target = await stat(join(directory, dirent.name)).catch(() => null);
  return { name: dirent.name, kind: kindOf(target) };
}

async function readHead(path: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * The transport, as a shape rather than an import.
 *
 * Handed in rather than reached for, so routing, decoding and error handling
 * are testable in plain Node. Same reasoning as `buildWindowOptions` and
 * `resolveWithinRoot`: the parts worth testing must not drag Electron with them.
 */
/**
 * A handler takes the untrusted payload and answers with a named reply.
 *
 * `unknown` going IN is the honest description of a boundary: the payload has
 * not been parsed yet, and pretending otherwise is how unvalidated input gets
 * treated as a domain type. `unknown` coming OUT is a different matter — it
 * hands the caller the parsing problem this function exists to solve — so the
 * reply is `IpcReply`, the closed union of everything a channel may answer.
 */
export type IpcHandler = (payload: unknown) => Promise<IpcReply>;

export interface IpcSurface {
  handle(channel: string, handler: IpcHandler): void;
  removeHandler(channel: string): void;
}

/** What `createRegistry` hands back. Named, so the contract has somewhere to live. */
export interface Registry {
  /** Unregister every handler, abort every stream, release every watch. */
  dispose(): void;
}

/** How the main process pushes to the renderer. */
export interface Sender {
  send(channel: string, payload: unknown): void;
}

/** Injected so a test can prove a handler was never entered. */
export interface Dependencies {
  scanDirectory?: typeof scanDirectory;
  watchDirectory?: typeof watchDirectory;
}

/**
 * How many entries travel in one push.
 *
 * Transfer lists are NOT zero-copy in Electron — transfer and clone measured
 * identical at about 400 MB/s, and a 256 MB payload took 607 ms either way — so
 * the entire cost of a large reply is copying it. One giant message blocks the
 * renderer until all of it lands; batches let the first rows paint immediately.
 */
const BATCH = 500;

/**
 * Register every handler on one transport.
 *
 * **One registry per process.** Electron's `ipcMain.handle` throws when a
 * channel already has a handler, so a second call on the same transport is a
 * crash rather than a second registry. That is fine while there is one window —
 * decision D3 chose tabs over multiple windows — but multi-window work must
 * either share this registry or route by sender first. `cancel: "all"` is the
 * other half of that constraint: it abandons every stream the registry knows,
 * which is correct for one window and wrong for two.
 */
export function createRegistry(ipc: IpcSurface, sender: Sender, deps: Dependencies = {}): Registry {
  const scan = deps.scanDirectory ?? scanDirectory;
  const watch = deps.watchDirectory ?? watchDirectory;

  const streams = new Map<string, AbortController>();
  const watches = new Map<string, StopWatching>();
  let nextStream = 0;

  /**
   * Decode, then run. The handler never sees a payload that failed to decode —
   * it is not merely given bad input to cope with, it is never called at all.
   */
  function guard<T>(
    decode: Decoder<T>,
    onError: FailureCode,
    run: (request: T) => Promise<IpcReply>,
  ): IpcHandler {
    return async (payload) => {
      const decoded = decode(payload);
      if (isFailure(decoded)) return decoded;
      try {
        return await run(decoded.value);
      } catch (cause) {
        // Nothing throws across the boundary. A thrown error arrives as an
        // opaque string with no code, and the renderer cannot branch on it.
        //
        // The code is per channel, not a blanket `scan_failed`. Reporting a
        // read error or a watch error as a scan failure is a value that lies,
        // which defeats the reason failures are values at all.
        return failure(onError, cause instanceof Error ? cause.message : String(cause));
      }
    };
  }

  /**
   * Serialise work per subscription id.
   *
   * Two concurrent `watch` calls with the same id both read an empty map before
   * either writes, so both opened a real filesystem watch and the later one
   * silently overwrote the earlier — leaking a watcher that nothing could ever
   * stop, and delivering duplicate events under one id.
   */
  const watchQueue = new Map<string, Promise<unknown>>();

  function serialise<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (watchQueue.get(id) ?? Promise.resolve()).then(work, work);
    watchQueue.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }

  ipc.handle(
    CHANNELS.list,
    guard(decodeListRequest, "scan_failed", async (request): Promise<Result<ListReply>> => {
      const controller = new AbortController();
      // The caller names the stream when it wants to be able to cancel it.
      const streamId = request.streamId ?? `s${nextStream++}`;
      streams.set(streamId, controller);

      try {
        const raw = await scan(request.path, { signal: controller.signal });
        const shown = sortEntries(
          filterEntries(raw, { showHidden: request.showHidden }),
          request.sort,
        );

        if (!request.stream) {
          return success({ entries: shown, total: shown.length, streamId: null });
        }

        await pushBatches(sender, streamId, shown);
        return success({ entries: [], total: shown.length, streamId });
      } catch (cause) {
        if (controller.signal.aborted) return failure("cancelled", "the scan was cancelled");
        return failure("scan_failed", cause instanceof Error ? cause.message : String(cause));
      } finally {
        streams.delete(streamId);
      }
    }),
  );

  ipc.handle(
    CHANNELS.cancel,
    guard(decodeCancelRequest, "cancelled", async (request) => {
      // `all` is the tab-closed case: abandon everything this window started.
      const targets =
        request.streamId === "all" ? [...streams.values()] : [streams.get(request.streamId)];
      for (const controller of targets) controller?.abort();
      return success(null);
    }),
  );

  ipc.handle(
    CHANNELS.watch,
    guard(decodeWatchRequest, "watch_failed", async (request) =>
      serialise(request.subscriptionId, async () => {
        await watches.get(request.subscriptionId)?.();
        const stop = await watch(request.path, (changed: ChangedEntry[]) => {
          sender.send(CHANNELS.changed, { subscriptionId: request.subscriptionId, changed });
        });
        watches.set(request.subscriptionId, stop);
        return success(null);
      }),
    ),
  );

  ipc.handle(
    CHANNELS.unwatch,
    guard(decodeUnwatchRequest, "watch_failed", async (request) =>
      serialise(request.subscriptionId, async () => {
        await watches.get(request.subscriptionId)?.();
        watches.delete(request.subscriptionId);
        return success(null);
      }),
    ),
  );

  ipc.handle(
    CHANNELS.describe,
    guard(decodeDescribeRequest, "read_failed", async (request) => {
      const stats = await stat(request.path);

      if (stats.isDirectory()) {
        // `readdir` rather than the full scan, still: the listing needs a name
        // and a kind, and `withFileTypes` returns the kind inline — on Linux it
        // comes back in the same `getdents64` the names do, so it costs nothing
        // extra. The full scan would `stat` every entry for a size and an mtime
        // that no row in the preview column draws.
        const found = await readdir(request.path, { withFileTypes: true });
        return success({
          name: basename(request.path),
          path: request.path,
          isDirectory: true,
          entryCount: found.length,
          entries: await Promise.all(
            found
              .slice(0, MAX_DIRECTORY_PREVIEW_ENTRIES)
              .map((dirent) => direntSummary(request.path, dirent)),
          ),
          size: stats.size,
          mime: "inode/directory",
          head: new Uint8Array(),
        });
      }

      const tables = await mimeTables();
      return success({
        name: basename(request.path),
        path: request.path,
        isDirectory: false,
        entryCount: 0,
        entries: [],
        size: stats.size,
        mime: resolveMimeType(tables, basename(request.path)),
        head: await readHead(request.path, SNIFF_BYTES),
      });
    }),
  );

  ipc.handle(
    CHANNELS.previewUrl,
    guard(decodePreviewUrlRequest, "read_failed", async (request) => {
      // Stat first, so a path that cannot be read fails here rather than as a
      // broken image the renderer has no way to explain.
      await stat(request.path);
      return success({ url: previewUrlFor(authorisePreview(request.path)) });
    }),
  );

  ipc.handle(
    CHANNELS.transfer,
    guard(decodeTransferRequest, "write_failed", async (request) => {
      const outcome = await operations.transfer(request, (done, total) => {
        sender.send(CHANNELS.transferProgress, { transferId: request.transferId, done, total });
      });
      return success(outcome);
    }),
  );

  ipc.handle(
    CHANNELS.cancelTransfer,
    guard(decodeCancelTransferRequest, "write_failed", (request) => {
      operations.cancelTransfer(request.transferId);
      return Promise.resolve(success(null));
    }),
  );

  ipc.handle(
    CHANNELS.create,
    guard(decodeCreateRequest, "write_failed", async (request) => {
      await operations.create(request.path, request.kind);
      return success(null);
    }),
  );

  ipc.handle(
    CHANNELS.rename,
    guard(decodeRenameRequest, "write_failed", async (request) => {
      return success({ path: await operations.rename(request.path, request.name) });
    }),
  );

  ipc.handle(
    CHANNELS.trash,
    guard(decodeTrashRequest, "write_failed", async (request) => {
      await operations.trash(request.paths);
      return success(null);
    }),
  );

  ipc.handle(
    CHANNELS.open,
    guard(decodeOpenRequest, "read_failed", async (request) => {
      await operations.open(request.path);
      return success(null);
    }),
  );

  ipc.handle(
    CHANNELS.readText,
    guard(decodeReadTextRequest, "read_failed", async (request) => {
      const handle = await open(request.path, "r");
      try {
        // Allocate what the file HOLDS, not what the caller asked for. The
        // first draft did `Buffer.alloc(request.maxBytes)` before reading, so a
        // renderer could force a 64 MB zero-filled allocation per call, with no
        // limit on how many calls were in flight, for a file of twelve bytes.
        const { size } = await handle.stat();
        const wanted = Math.min(request.maxBytes, size);
        const buffer = Buffer.alloc(wanted);
        const { bytesRead } = await handle.read(buffer, 0, wanted, 0);
        return success({
          text: buffer.subarray(0, bytesRead).toString("utf8"),
          bytesRead,
          truncated: bytesRead < size,
        });
      } finally {
        await handle.close();
      }
    }),
  );

  return {
    dispose() {
      for (const channel of Object.values(REQUEST_CHANNELS)) ipc.removeHandler(channel);
      for (const controller of streams.values()) controller.abort();
      for (const stop of watches.values()) void stop();
      streams.clear();
      watches.clear();
    },
  };
}

/**
 * Send the batches, yielding between them.
 *
 * A synchronous loop changes the wire granularity and nothing else: the main
 * process still serialises every batch before returning, so the first rows do
 * not paint any sooner. Yielding is what lets the renderer process batch one
 * while the main process is still building batch two.
 */
async function pushBatches(
  sender: Sender,
  streamId: string,
  entries: readonly FsEntry[],
): Promise<void> {
  for (let offset = 0; offset < entries.length; offset += BATCH) {
    const slice = entries.slice(offset, offset + BATCH);
    const batch: ListBatch = {
      streamId,
      entries: slice,
      done: offset + BATCH >= entries.length,
    };
    sender.send(CHANNELS.listBatch, batch);
    await new Promise((resolve) => setImmediate(resolve));
  }
}
