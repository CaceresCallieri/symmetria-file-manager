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

export interface BridgeLog {
  readonly listed: string[];
  readonly unwatched: string[];
  readonly watched: string[];
  /** Which paths the preview asked about, in order. Used to assert the debounce. */
  readonly described: string[];
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
  const described: string[] = [];
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
        return Promise.resolve({
          ok: true as const,
          value: {
            name: path.split("/").pop() ?? "/",
            path,
            isDirectory: true,
            entryCount: tree.get(path)?.length ?? 0,
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
