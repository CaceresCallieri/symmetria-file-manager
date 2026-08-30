import {
  decodeListReply,
  failure,
  isFailure,
  type ListReply,
  type Result,
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
    stream: false,
    streamId: null,
  });

  return isFailure(reply) ? reply : decodeListReply(reply.value);
}

/** Watch a directory, and stop watching when the returned function is called. */
export async function watchDirectory(
  path: string,
  subscriptionId: string,
  onChanged: () => void,
): Promise<Unsubscribe> {
  const bridge = getBridge();
  if (bridge === null) return () => undefined;

  const stopListening = bridge.onChanged(() => onChanged());
  const started = await bridge.watch({ path, subscriptionId });

  // A watch that failed to start still leaves a listener attached, so the
  // teardown runs either way. Half-cleaning up is how a listener outlives the
  // pane that owns it and fires against a component that is gone.
  if (isFailure(started)) {
    stopListening();
    return () => undefined;
  }

  return () => {
    stopListening();
    void bridge.unwatch({ subscriptionId });
  };
}
