/**
 * @vitest-environment happy-dom
 *
 * The wiring, not the components.
 *
 * `columns.test.tsx` proves each component renders when something mounts it.
 * That is exactly the assurance that failed: every component was correct and
 * NOTHING mounted them, so the real window showed a placeholder while 76 tests
 * passed. These tests drive the composed `App` through the bridge and the
 * keyboard, so an orphaned component fails here.
 */
import type { FsEntry } from "@symmetria/fm-core/entry";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRIDGE_KEY, type Bridge } from "../../src/preload/bridge.ts";
import { App } from "../../src/renderer/App.tsx";

function entry(name: string, kind: FsEntry["kind"] = "file"): FsEntry {
  return { name, kind, size: 3, modifiedMs: 0, isSymlink: false, isHidden: false };
}

/**
 * A filesystem, as a map from path to listing.
 *
 * A `Map`, not a `Record<string, FsEntry[]>`. The open dictionary type claims
 * every string is a key and hands back a value the caller must then re-check,
 * which is the type evidence the project's lint policy asks us not to discard.
 * `Map.get` returns `FsEntry[] | undefined` and says so.
 */
const TREE = new Map([
  ["/home", [entry("jc", "directory"), entry("other", "directory")]],
  ["/home/jc", [entry("projects", "directory"), entry("notes.txt"), entry("todo.txt")]],
  ["/home/jc/projects", [entry("alpha", "directory"), entry("beta.md")]],
]);

let listedPaths: string[] = [];
let unwatched: string[] = [];

/**
 * A bridge that answers from `TREE`.
 *
 * Stubbed at the `window` global rather than by mocking the module, so the
 * renderer's own `bridge.ts` — its request shape, its reply decoding, its
 * missing-bridge handling — is exercised rather than replaced.
 */
function installBridge(): void {
  const bridge: Bridge = {
    version: "test",
    list: (request) => {
      const path = (request as { path: string }).path;
      listedPaths.push(path);
      const entries = TREE.get(path);
      return Promise.resolve(
        entries === undefined
          ? { ok: false as const, error: { code: "scan_failed" as const, message: `no ${path}` } }
          : { ok: true as const, value: { entries, total: entries.length, streamId: null } },
      );
    },
    watch: () => Promise.resolve({ ok: true as const, value: null }),
    unwatch: (request) => {
      unwatched.push((request as { subscriptionId: string }).subscriptionId);
      return Promise.resolve({ ok: true as const, value: null });
    },
    readText: () => Promise.resolve({ ok: true as const, value: null }),
    cancel: () => Promise.resolve({ ok: true as const, value: null }),
    onListBatch: () => () => undefined,
    onChanged: () => () => undefined,
  };

  Object.defineProperty(window, BRIDGE_KEY, { value: bridge, configurable: true, writable: true });
}

/** The names visible in one column, in order. */
function namesIn(testId: string): string[] {
  return [...within(screen.getByTestId(testId)).queryAllByTestId("row")].map(
    (row) => row.textContent ?? "",
  );
}

function cursorIn(testId: string): string {
  return screen.getByTestId(testId).querySelector('[data-cursor="true"]')?.textContent ?? "";
}

beforeEach(() => {
  listedPaths = [];
  unwatched = [];
  installBridge();
});

afterEach(cleanup);

describe("App, wired to a bridge", () => {
  it("lists the starting directory and its parent through the bridge", async () => {
    render(<App startPath="/home/jc" />);

    await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));
    expect(namesIn("column-parent")).toContain("jc");
    expect(listedPaths).toContain("/home/jc");
    expect(listedPaths).toContain("/home");
  });

  it("shows the location as breadcrumbs and the count in the status bar", async () => {
    render(<App startPath="/home/jc" />);

    await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));
    expect(within(screen.getByTestId("path-bar")).getByText("jc")).toBeDefined();
    expect(screen.getByTestId("status-bar").textContent).toContain("3 entries");
  });

  it("moves the cursor down without wrapping past the last entry", async () => {
    render(<App startPath="/home/jc" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));

    for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { key: "j" });

    await waitFor(() => expect(cursorIn("column-current")).toContain("todo.txt"));
  });

  it("moves the cursor up without wrapping past the first entry", async () => {
    render(<App startPath="/home/jc" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));

    for (let i = 0; i < 10; i++) fireEvent.keyDown(window, { key: "k" });

    await waitFor(() => expect(cursorIn("column-current")).toContain("projects"));
  });

  it("enters a directory, promoting it to the current column", async () => {
    render(<App startPath="/home/jc" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("projects"));

    fireEvent.keyDown(window, { key: "l" });

    await waitFor(() => expect(namesIn("column-current")).toContain("beta.md"));
    // The column that was current is now the parent, sitting on where we came
    // from. This is the criterion a component test cannot reach: it is about
    // two columns agreeing after a navigation.
    await waitFor(() => expect(cursorIn("column-parent")).toContain("projects"));
    expect(screen.getByTestId("path-bar").textContent).toContain("projects");
  });

  it("restores the cursor to the entry that was entered, on the way back out", async () => {
    render(<App startPath="/home/jc" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("projects"));

    // Down to `todo.txt`, up to `projects`, in — so the remembered cursor is
    // not simply index zero, which would pass by accident.
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(cursorIn("column-current")).toContain("todo.txt"));

    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "l" });
    await waitFor(() => expect(namesIn("column-current")).toContain("beta.md"));

    fireEvent.keyDown(window, { key: "h" });

    await waitFor(() => expect(cursorIn("column-current")).toContain("projects"));
  });

  it("stops at the root rather than climbing past it", async () => {
    render(<App startPath="/home" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("jc"));

    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: "h" });

    // `/` is not in the fake tree, so the listing fails and the pane says why
    // instead of rendering a blank column with no explanation.
    await waitFor(() => expect(screen.getByTestId("path-bar").textContent).toBe("/"));
    expect(screen.getByTestId("pane-error")).toBeDefined();
  });

  it("releases the watch on the directory it left", async () => {
    render(<App startPath="/home/jc" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("projects"));

    fireEvent.keyDown(window, { key: "l" });
    await waitFor(() => expect(namesIn("column-current")).toContain("beta.md"));

    // A watch per navigation that is never released is how the inotify budget
    // disappears during ordinary use — the same failure that removed the
    // recursive watcher, arriving by a slower route.
    await waitFor(() => expect(unwatched).toContain("pane:/home/jc"));
  });
});

describe("App, with no bridge", () => {
  it("says the build is incomplete instead of rendering an empty window", async () => {
    Reflect.deleteProperty(window, BRIDGE_KEY);

    render(<App startPath="/home/jc" />);

    await waitFor(() => expect(screen.getByTestId("pane-error").textContent).toMatch(/preload/i));
  });
});
