import { open } from "node:fs/promises";

import {
  type Decoder,
  decodeCancelRequest,
  decodeListRequest,
  decodeReadTextRequest,
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
import type { FsEntry } from "@symmetria/fm-core/entry";
import { filterEntries } from "@symmetria/fm-core/filter";
import { sortEntries } from "@symmetria/fm-core/sort";
import { scanDirectory } from "../fs/scan.ts";
import { type ChangedEntry, type StopWatching, watchDirectory } from "../fs/watch.ts";
import { CHANNELS, REQUEST_CHANNELS } from "./channels.ts";

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
        return success({ text: buffer.subarray(0, bytesRead).toString("utf8"), bytesRead });
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
