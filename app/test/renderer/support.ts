import { seedBookmarks } from "@symmetria/fm-core/bookmarks";
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

/**
 * How many names a directory's describe reply carries.
 *
 * Mirrors `MAX_DIRECTORY_PREVIEW_ENTRIES` in the main process. Declared again
 * rather than imported, because importing it would pull a main-process module —
 * which compiles against Node and no DOM — into a renderer test.
 */
const PREVIEW_CAP = 500;

/**
 * More entries than the preview listing sends, so the cap is observable.
 *
 * Zero-padded so the order a reader expects is the order they get.
 */
const MANY = Array.from({ length: PREVIEW_CAP + 37 }, (_, i) =>
  entry(`f${String(i).padStart(4, "0")}.txt`),
);

/**
 * A filesystem, as a map from path to listing.
 *
 * The three directories at the end of the home listing are appended rather than
 * inserted: every test that navigates by key counts from the top, so a new
 * entry before `notes.txt` would move the cursor under all of them.
 *
 * `locked` is deliberately absent from this map while appearing in the home
 * listing — that is how a directory the process cannot read is expressed here.
 */
const TREE = new Map([
  ["/home", [entry("jc", "directory"), entry("other", "directory")]],
  [
    "/home/jc",
    [
      entry("projects", "directory"),
      entry("notes.txt"),
      entry("todo.txt"),
      entry("empty", "directory"),
      entry("locked", "directory"),
      entry("many", "directory"),
    ],
  ],
  ["/home/jc/projects", [entry("alpha", "directory"), entry("beta.md")]],
  ["/home/jc/empty", []],
  ["/home/jc/many", MANY],
]);

/**
 * Facts about the fixture home that tests assert against.
 *
 * Derived rather than written down, because they are incidental: a phase that
 * needs a new fixture directory should not have to hunt down four assertions in
 * two other suites that happened to hardcode "3 entries" and "todo.txt". It
 * already happened once.
 */
const HOME = TREE.get("/home/jc") ?? [];
export const HOME_ENTRY_COUNT = HOME.length;
export const HOME_LAST_ENTRY = HOME[HOME.length - 1]?.name ?? "";

/**
 * What each fixture file contains, and what type it claims to be.
 *
 * The real answers come from the main process — a `stat`, the XDG database, a
 * head read. Here they are declared, so a renderer test can drive every preview
 * branch without a filesystem.
 */
const FILES = new Map<string, { readonly mime: string | null; readonly text: string }>([
  ["/home/jc/notes.txt", { mime: "text/plain", text: "plain notes\nsecond line\n" }],
  ["/home/jc/todo.txt", { mime: "text/plain", text: "todo\n" }],
  ["/home/jc/projects/beta.md", { mime: "text/markdown", text: "# beta\n\ntext\n" }],
]);

/** What a capped read of a fixture file returned. */
interface Head {
  readonly text: string;
  readonly truncated: boolean;
}

/** A read request, as both read channels shape it. */
interface CappedRead {
  readonly path: string;
  readonly maxBytes: number;
}

function head(request: unknown): Head {
  // SAFETY: the request came from this renderer's own `bridge.ts`, which builds
  // it from typed arguments. A real preload receives it across a process
  // boundary and cannot make that assumption; this fixture stands in for the
  // main process, not for the preload.
  const { path, maxBytes } = request as CappedRead;
  const whole = FILES.get(path)?.text ?? "";
  const text = whole.slice(0, maxBytes);
  return { text, truncated: text.length < whole.length };
}

/**
 * A bridge that answers nothing, for the methods a test does not care about.
 *
 * Shared so a channel added to the surface is a one-line change here rather
 * than a compile error in every fixture that happened to build its own.
 */
export function inertBridge(): Bridge {
  const ok = () => Promise.resolve({ ok: true as const, value: null });
  return {
    version: "inert",
    list: ok,
    watch: ok,
    unwatch: ok,
    readText: ok,
    cancel: ok,
    describe: ok,
    previewUrl: ok,
    transfer: ok,
    create: ok,
    rename: ok,
    trash: ok,
    open: ok,
    cancelTransfer: ok,
    bookmarksRead: ok,
    bookmarksWrite: ok,
    onListBatch: () => () => undefined,
    onChanged: () => () => undefined,
    onTransferProgress: () => () => undefined,
  };
}

export interface BridgeLog {
  readonly listed: string[];
  readonly unwatched: string[];
  readonly watched: string[];
  /** Every operation the renderer asked the main process to perform. */
  readonly ops: string[];
  /** Which paths the preview asked about, in order. Used to assert the debounce. */
  readonly described: string[];
  /** How many listeners the renderer attached to the change channel. */
  listenerCount(): number;
  /** Push a change for one subscription, as the main process would. */
  emitChange(subscriptionId: string): void;
  /** Add an entry to a directory, so a change has something to report. */
  addEntry(path: string, name: string): void;
  /**
   * Add an entry at the FRONT of a directory.
   *
   * Distinct from `addEntry` because it shifts every index after it, which is
   * what a real re-sort or an alphabetically-early new file does — and index
   * shifts are what stale index-keyed state gets wrong.
   */
  addEntryFirst(path: string, name: string): void;
  /** Make the next transfer report these names as already present. */
  conflictNext(names: readonly string[]): void;
  /** Leave the next transfer unresolved, so a test can watch it running. */
  holdNextTransfer(): void;
  /** Push a progress tick, as the main process would. */
  emitProgress(transferId: string, done: number, total: number): void;
  /**
   * The ids of the transfers that have been asked for.
   *
   * The renderer numbers them from a module-level counter, so it carries across
   * tests in one file — a test that assumed `t0` would pass alone and fail in
   * company.
   */
  readonly transferIds: string[];
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
  const described: string[] = [];
  const ops: string[] = [];
  let conflictOnce: readonly string[] = [];
  let holdOnce = false;
  const transferIds: string[] = [];
  const progressListeners = new Set<(payload: unknown) => void>();
  const listeners = new Set<(payload: unknown) => void>();
  const tree = new Map([...TREE].map(([path, entries]) => [path, [...entries]]));

  const bridge: Bridge = {
    ...inertBridge(),
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
    readText: (request) => {
      const { text, truncated } = head(request);
      return Promise.resolve({
        ok: true as const,
        value: { text, bytesRead: text.length, truncated },
      });
    },
    cancel: () => Promise.resolve({ ok: true as const, value: null }),
    describe: (request) => {
      const path = (request as { path: string }).path;
      described.push(path);

      if (tree.has(path)) {
        const listing = tree.get(path) ?? [];
        return Promise.resolve({
          ok: true as const,
          value: {
            name: path.split("/").pop() ?? "/",
            path,
            isDirectory: true,
            entryCount: listing.length,
            // Capped like the main process: the count stays true, the payload
            // stays bounded.
            entries: listing.slice(0, PREVIEW_CAP).map((e) => ({ name: e.name, kind: e.kind })),
            size: 4096,
            mime: "inode/directory",
            head: new Uint8Array(),
          },
        });
      }

      const file = FILES.get(path);
      if (file === undefined) {
        return Promise.resolve({
          ok: false as const,
          error: { code: "read_failed" as const, message: `no ${path}` },
        });
      }
      return Promise.resolve({
        ok: true as const,
        value: {
          name: path.split("/").pop() ?? "",
          path,
          isDirectory: false,
          entryCount: 0,
          entries: [],
          size: file.text.length,
          mime: file.mime,
          head: Uint8Array.from(file.text.slice(0, 64), (c) => c.charCodeAt(0)),
        },
      });
    },
    previewUrl: (request) => {
      const { path } = request as { path: string };
      return Promise.resolve({
        ok: true as const,
        value: { url: `symmetria-fm://app/__preview/${encodeURIComponent(path)}` },
      });
    },
    transfer: (request) => {
      const { sources, destination, mode, overwrite, transferId } = request as {
        sources: string[];
        destination: string;
        mode: string;
        overwrite: boolean;
        transferId: string;
      };
      transferIds.push(transferId);
      ops.push(`${mode} ${sources.join(",")} -> ${destination}${overwrite ? " !" : ""}`);

      // Reported once, so a test can drive the conflict prompt and then watch
      // the confirmed retry go through.
      const conflicts = overwrite ? [] : conflictOnce;
      conflictOnce = [];

      if (holdOnce) {
        holdOnce = false;
        // Never settles: a transfer the test can observe mid-flight.
        return new Promise(() => undefined);
      }

      return Promise.resolve({
        ok: true as const,
        value: { moved: conflicts.length > 0 ? 0 : sources.length, conflicts },
      });
    },
    create: (request) => {
      const { path, kind } = request as { path: string; kind: string };
      ops.push(`create ${kind} ${path}`);
      return Promise.resolve({ ok: true as const, value: null });
    },
    rename: (request) => {
      const { path, name } = request as { path: string; name: string };
      ops.push(`rename ${path} -> ${name}`);
      if (name === "taken.txt") {
        return Promise.resolve({
          ok: false as const,
          error: { code: "write_failed" as const, message: `${name} already exists` },
        });
      }
      return Promise.resolve({ ok: true as const, value: { path: name } });
    },
    trash: (request) => {
      const { paths } = request as { paths: string[] };
      ops.push(`trash ${paths.join(",")}`);
      return Promise.resolve({ ok: true as const, value: null });
    },
    open: (request) => {
      ops.push(`open ${(request as { path: string }).path}`);
      return Promise.resolve({ ok: true as const, value: null });
    },
    // The seed, as the main process would answer it on a fresh machine: the
    // fixture home is `/home/jc`, and `readOrSeedBookmarks` would have written
    // this file before the first reply.
    bookmarksRead: () =>
      Promise.resolve({
        ok: true as const,
        value: {
          bookmarks: [...seedBookmarks("/home/jc")].map(([letter, bookmark]) => ({
            letter,
            bookmark,
          })),
        },
      }),
    bookmarksWrite: (request) => {
      const { bookmarks } = request as {
        bookmarks: { letter: string; bookmark: { path: string } }[];
      };
      ops.push(
        `bookmarks ${bookmarks
          .map((b) => b.letter)
          .sort()
          .join("")}`,
      );
      return Promise.resolve({ ok: true as const, value: null });
    },
    cancelTransfer: (request) => {
      ops.push(`cancel ${(request as { transferId: string }).transferId}`);
      return Promise.resolve({ ok: true as const, value: null });
    },
    onTransferProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
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
    described,
    ops,
    conflictNext: (names) => {
      conflictOnce = names;
    },
    transferIds,
    holdNextTransfer: () => {
      holdOnce = true;
    },
    emitProgress: (transferId, done, total) => {
      for (const listener of progressListeners) listener({ transferId, done, total });
    },
    listenerCount: () => listeners.size,
    emitChange: (subscriptionId) => {
      for (const listener of listeners) listener({ subscriptionId, changed: [] });
    },
    addEntry: (path, name) => {
      tree.get(path)?.push(entry(name));
    },
    addEntryFirst: (path, name) => {
      tree.get(path)?.unshift(entry(name));
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
