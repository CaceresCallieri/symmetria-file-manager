import type { Bookmark } from "@symmetria/fm-core/bookmarks";
import {
  type ClipboardRequest,
  type CreateRequest,
  type DescribeReply,
  decodeBookmarksReply,
  decodeChangedEvent,
  decodeDescribeReply,
  decodeListReply,
  decodePreviewUrlReply,
  decodeReadTextReply,
  decodeRenameReply,
  decodeTransferProgress,
  decodeTransferReply,
  failure,
  isFailure,
  type ListReply,
  type ReadTextReply,
  type RenameReply,
  type Result,
  success,
  type TransferReply,
  type TransferRequest,
} from "@symmetria/fm-core/contract";
import type { SortMode } from "@symmetria/fm-core/sort";

import { BRIDGE_KEY, type Bridge, type Unsubscribe } from "../preload/bridge.ts";

/**
 * The renderer's side of the bridge: untyped in, typed out.
 *
 * The preload deliberately declares its parameters as `unknown` — page code is
 * untrusted from the preload's point of view, so the preload promises nothing
 * about shapes. This module is where the renderer takes that raw surface and
 * turns it into values the interface can render, by parsing rather than by
 * asserting. Every component above this line sees domain types only.
 */

declare global {
  interface Window {
    readonly [BRIDGE_KEY]?: Bridge;
  }
}

/**
 * The bridge, or nothing. Deliberately NOT exported.
 *
 * Absent means the preload did not run — a packaging fault, not a user error.
 * Returning `null` rather than throwing lets the interface say so on screen
 * instead of showing a blank window with an error only in a console nobody has
 * open. Keeping it module-private means the untyped surface has exactly the
 * consumers in this file, so no component can reach past the decoding.
 */
function getBridge(): Bridge | null {
  return window[BRIDGE_KEY] ?? null;
}

export interface ListOptions {
  readonly showHidden: boolean;
  readonly sort: SortMode;
  readonly reverse: boolean;
}

const MISSING_BRIDGE = "the preload bridge is not present; this build is incomplete";

/**
 * List one directory, whole.
 *
 * Not streamed. Streaming exists in the main process and is exercised by its
 * own tests, but a pane that repaints per batch flickers on every navigation,
 * and the measured scan of a large directory finishes in tens of milliseconds —
 * below the threshold where progressive display buys anything. The streaming
 * path stays for the directories where it will not.
 */
export async function listDirectory(
  path: string,
  options: ListOptions,
): Promise<Result<ListReply>> {
  const bridge = getBridge();
  if (bridge === null) return failure("scan_failed", MISSING_BRIDGE);

  const reply = await bridge.list({
    path,
    showHidden: options.showHidden,
    sort: options.sort,
    reverse: options.reverse,
    stream: false,
    streamId: null,
  });

  return isFailure(reply) ? reply : decodeListReply(reply.value);
}

/**
 * Every live watch in this renderer, by subscription id.
 *
 * ONE bridge listener serves all of them, and it delivers each event only to
 * the subscription it names.
 *
 * Both halves of that were defects. A listener per watch meant a change in any
 * directory woke every open tab — O(tabs) re-listings per filesystem event —
 * and eleven tabs was enough for Electron to print
 * `MaxListenersExceededWarning: 11 symmetria-fm:changed listeners added`. And
 * the callback ignored the event payload entirely, so there was nothing to
 * filter ON: `decodeChangedEvent` existed and had no consumer, which is usually
 * the sign that a message is being taken on faith.
 */
const subscribers = new Map<string, () => void>();
let listening: Unsubscribe | null = null;

function deliver(raw: unknown): void {
  const event = decodeChangedEvent(raw);
  // A malformed push is dropped rather than broadcast. Waking every tab on an
  // event nobody can attribute is how the fan-out came back.
  if (isFailure(event)) return;

  subscribers.get(event.value.subscriptionId)?.();
}

/**
 * Everything the preview router needs about one entry, in one round trip.
 *
 * One call rather than three: a `stat`, a MIME resolution and a head read on
 * separate channels would each pay the boundary crossing, and every cursor
 * movement would pay all three.
 */
export async function describeEntry(path: string): Promise<Result<DescribeReply>> {
  const bridge = getBridge();
  if (bridge === null) return failure("read_failed", MISSING_BRIDGE);

  const reply = await bridge.describe({ path });
  return isFailure(reply) ? reply : decodeDescribeReply(reply.value);
}

/**
 * A URL the renderer may load this file from.
 *
 * Not a blob URL built from bytes sent over the bridge: Chromium's PDF viewer
 * refuses a blob whose origin is a custom scheme, and the embed silently
 * resolves to an error page. A URL under the application's own scheme is one
 * the viewer accepts — and it saves copying the file across the boundary.
 */
export async function previewUrl(path: string): Promise<Result<string>> {
  const bridge = getBridge();
  if (bridge === null) return failure("read_failed", MISSING_BRIDGE);

  const reply = await bridge.previewUrl({ path });
  if (isFailure(reply)) return reply;

  const decoded = decodePreviewUrlReply(reply.value);
  return isFailure(decoded) ? decoded : { ok: true, value: decoded.value.url };
}

/**
 * Put text or an image on the system clipboard.
 *
 * The image travels as a PATH for the main process to read, not as bytes. The
 * renderer is sandboxed and has no way to open a file, which is the whole
 * reason this crosses the bridge rather than reaching the platform clipboard
 * directly.
 */
export async function copyToClipboard(request: ClipboardRequest): Promise<Result<null>> {
  const bridge = getBridge();
  if (bridge === null) return failure("write_failed", MISSING_BRIDGE);

  const reply = await bridge.clipboard(request);
  return isFailure(reply) ? reply : success(null);
}

/** Read the head of a file as text. */
export async function readFileText(path: string, maxBytes: number): Promise<Result<ReadTextReply>> {
  const bridge = getBridge();
  if (bridge === null) return failure("read_failed", MISSING_BRIDGE);

  const reply = await bridge.readText({ path, maxBytes });
  return isFailure(reply) ? reply : decodeReadTextReply(reply.value);
}

/** Watch a directory, and stop watching when the returned function is called. */
export async function watchDirectory(
  path: string,
  subscriptionId: string,
  onChanged: () => void,
): Promise<Unsubscribe> {
  const bridge = getBridge();
  if (bridge === null) return () => undefined;

  subscribers.set(subscriptionId, onChanged);
  listening ??= bridge.onChanged(deliver);

  const release = () => {
    subscribers.delete(subscriptionId);
    if (subscribers.size === 0) {
      listening?.();
      listening = null;
    }
  };

  const started = await bridge.watch({ path, subscriptionId });

  // A watch that failed to start still left a subscriber registered, so the
  // teardown runs either way. Half-cleaning up is how a callback outlives the
  // tab that owns it.
  if (isFailure(started)) {
    release();
    return () => undefined;
  }

  return () => {
    release();
    void bridge.unwatch({ subscriptionId });
  };
}

/** Copy or move entries into a directory. */
export async function transferEntries(request: TransferRequest): Promise<Result<TransferReply>> {
  const bridge = getBridge();
  if (bridge === null) return failure("write_failed", MISSING_BRIDGE);

  const reply = await bridge.transfer(request);
  return isFailure(reply) ? reply : decodeTransferReply(reply.value);
}

/** Abandon a running transfer. */
export function cancelTransfer(transferId: string): void {
  void getBridge()?.cancelTransfer({ transferId });
}

/** Create an empty file or a directory, with its parents. */
export async function createPath(request: CreateRequest): Promise<Result<null>> {
  const bridge = getBridge();
  if (bridge === null) return failure("write_failed", MISSING_BRIDGE);

  const reply = await bridge.create(request);
  return isFailure(reply) ? reply : { ok: true, value: null };
}

/** Rename an entry in place. */
export async function renamePath(path: string, name: string): Promise<Result<RenameReply>> {
  const bridge = getBridge();
  if (bridge === null) return failure("write_failed", MISSING_BRIDGE);

  const reply = await bridge.rename({ path, name });
  return isFailure(reply) ? reply : decodeRenameReply(reply.value);
}

/** Send entries to the desktop trash. */
export async function trashPaths(paths: readonly string[]): Promise<Result<null>> {
  const bridge = getBridge();
  if (bridge === null) return failure("write_failed", MISSING_BRIDGE);

  const reply = await bridge.trash({ paths });
  return isFailure(reply) ? reply : { ok: true, value: null };
}

/** Hand an entry to whatever the desktop says opens it. */
export async function openPath(path: string): Promise<Result<null>> {
  const bridge = getBridge();
  if (bridge === null) return failure("read_failed", MISSING_BRIDGE);

  const reply = await bridge.open({ path });
  return isFailure(reply) ? reply : { ok: true, value: null };
}

/**
 * Follow a running transfer.
 *
 * One listener for the channel, dispatched to the transfer it names — the same
 * shape the change events use, and for the same reason: a listener per transfer
 * would wake every one of them on each tick.
 */
export function onTransferProgress(
  transferId: string,
  onTick: (done: number, total: number) => void,
): Unsubscribe {
  const bridge = getBridge();
  if (bridge === null) return () => undefined;

  return bridge.onTransferProgress((raw) => {
    const event = decodeTransferProgress(raw);
    if (isFailure(event) || event.value.transferId !== transferId) return;
    onTick(event.value.done, event.value.total);
  });
}

/**
 * The bookmark store, as a map.
 *
 * Converted from the wire's list of pairs at this edge, so nothing above here
 * has to remember that the boundary carries plain data. A failure is returned
 * rather than thrown, like every other call in this file.
 */
export async function readBookmarks(): Promise<Result<Map<string, Bookmark>>> {
  const bridge = getBridge();
  if (bridge === null) return failure("read_failed", "the bridge is missing");

  // The Result first, then its value. Handing the whole envelope to the decoder
  // is the shape mistake this boundary invites, and it fails as "reply must be
  // an object" — which reads like a main-process fault rather than a caller's.
  const reply = await bridge.bookmarksRead({});
  if (isFailure(reply)) return reply;

  const decoded = decodeBookmarksReply(reply.value);
  if (isFailure(decoded)) return decoded;

  return success(
    new Map(decoded.value.bookmarks.map(({ letter, bookmark }) => [letter, bookmark])),
  );
}

/** Replace the stored bookmarks. */
export async function writeBookmarks(
  bookmarks: ReadonlyMap<string, Bookmark>,
): Promise<Result<null>> {
  const bridge = getBridge();
  if (bridge === null) return failure("write_failed", "the bridge is missing");

  const reply = await bridge.bookmarksWrite({
    bookmarks: [...bookmarks].map(([letter, bookmark]) => ({ letter, bookmark })),
  });
  return isFailure(reply) ? reply : success(null);
}
