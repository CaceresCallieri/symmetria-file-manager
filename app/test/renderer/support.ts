import type { FsEntry } from "@symmetria/fm-core/entry";
import { screen, within } from "@testing-library/react";

import { BRIDGE_KEY, type Bridge } from "../../src/preload/bridge.ts";

/**
 * The fixture both renderer suites drive the application through.
 *
 * Shared rather than copied: two divergent fake filesystems would eventually
 * disagree about what "the parent of /home/jc" contains, and the suite that
 * happened to be wrong would look like a product bug.
 */

function entry(name: string, kind: FsEntry["kind"] = "file"): FsEntry {
  return { name, kind, size: 3, modifiedMs: 0, isSymlink: false, isHidden: false };
}

/** A filesystem, as a map from path to listing. */
const TREE = new Map([
  ["/home", [entry("jc", "directory"), entry("other", "directory")]],
  ["/home/jc", [entry("projects", "directory"), entry("notes.txt"), entry("todo.txt")]],
  ["/home/jc/projects", [entry("alpha", "directory"), entry("beta.md")]],
]);

export interface BridgeLog {
  readonly listed: string[];
  readonly unwatched: string[];
  readonly watched: string[];
  /** How many listeners the renderer attached to the change channel. */
  listenerCount(): number;
  /** Push a change for one subscription, as the main process would. */
  emitChange(subscriptionId: string): void;
  /** Add an entry to a directory, so a change has something to report. */
  addEntry(path: string, name: string): void;
}

/**
 * Install a bridge that answers from `TREE`.
 *
 * Stubbed at the `window` global rather than by mocking the module, so the
 * renderer's own `bridge.ts` — its request shape, its reply decoding, its
 * missing-bridge handling — is exercised rather than replaced.
 */
export function installBridge(): BridgeLog {
  const listed: string[] = [];
  const unwatched: string[] = [];
  const watched: string[] = [];
  const listeners = new Set<(payload: unknown) => void>();
  const tree = new Map([...TREE].map(([path, entries]) => [path, [...entries]]));

  const bridge: Bridge = {
    version: "test",
    list: (request) => {
      const path = (request as { path: string }).path;
      listed.push(path);
      const entries = tree.get(path);
      return Promise.resolve(
        entries === undefined
          ? { ok: false as const, error: { code: "scan_failed" as const, message: `no ${path}` } }
          : { ok: true as const, value: { entries, total: entries.length, streamId: null } },
      );
    },
    watch: (request) => {
      watched.push((request as { subscriptionId: string }).subscriptionId);
      return Promise.resolve({ ok: true as const, value: null });
    },
    unwatch: (request) => {
      unwatched.push((request as { subscriptionId: string }).subscriptionId);
      return Promise.resolve({ ok: true as const, value: null });
    },
    readText: () => Promise.resolve({ ok: true as const, value: null }),
    cancel: () => Promise.resolve({ ok: true as const, value: null }),
    onListBatch: () => () => undefined,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  Object.defineProperty(window, BRIDGE_KEY, { value: bridge, configurable: true, writable: true });

  return {
    listed,
    unwatched,
    watched,
    listenerCount: () => listeners.size,
    emitChange: (subscriptionId) => {
      for (const listener of listeners) listener({ subscriptionId, changed: [] });
    },
    addEntry: (path, name) => {
      tree.get(path)?.push(entry(name));
    },
  };
}

/** The names visible in one column, in order. */
export function namesIn(testId: string): string[] {
  return within(screen.getByTestId(testId))
    .queryAllByTestId("row")
    .map((row) => row.textContent ?? "");
}

export function cursorIn(testId: string): string {
  return screen.getByTestId(testId).querySelector('[data-cursor="true"]')?.textContent ?? "";
}
