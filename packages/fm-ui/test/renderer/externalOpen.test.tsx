/**
 * @vitest-environment happy-dom
 *
 * A directory another program asked this window to show.
 *
 * The daemon relays a path over its socket and the interface has to act on it.
 * Two things are guarded here. The SUBSCRIPTION, because that is where the cost
 * hides: the preload removes and re-adds a native IPC listener on every
 * subscribe, so a handler whose identity changes each render turns one
 * subscription into one per cursor move. And the REVEAL, which is what "Show in
 * folder" sends: the folder opens and the cursor lands on the named entry.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../src/App.tsx";
import { type BridgeLog, installBridge, namesIn } from "./support.ts";

/** The name of the row the cursor is on in the current column. */
function cursorName(): string {
  const row = screen.getByTestId("column-current").querySelector('[data-cursor="true"]');
  return row?.textContent ?? "";
}

let log: BridgeLog;

beforeEach(() => {
  log = installBridge();
});
afterEach(cleanup);

async function opened(): Promise<void> {
  render(<App startPath="/home/jc" homePath="/home/jc" />);
  await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
  await act(async () => undefined);
}

describe("subscribing to the daemon's open requests", () => {
  it("subscribes once, not once per render", async () => {
    await opened();
    const afterMount = log.openSubscriptions.length;

    // Twenty cursor moves. Each one re-renders the whole component tree, which
    // is exactly the situation that used to re-register the listener: the
    // handler was a fresh arrow every render and the effect depended on it.
    for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { key: "j" });
    await act(async () => undefined);

    expect(afterMount).toBe(1);
    expect(log.openSubscriptions).toHaveLength(1);
  });

  it("still routes a path that arrives after those renders", async () => {
    // The other half. Subscribing once is only correct if the ONE subscription
    // still calls the current handler — a stale closure would satisfy the count
    // above while quietly acting on a tab collection that no longer exists.
    await opened();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: "j" });
    await act(async () => undefined);

    await act(async () => {
      log.emitOpenPath("/home/jc/work");
    });

    await waitFor(() => expect(screen.getAllByTestId("tab")).toHaveLength(2));
    expect(log.listed).toContain("/home/jc/work");
  });
});

describe("revealing an entry, as Show in folder asks", () => {
  it("opens the folder in a new tab with the cursor on the file", async () => {
    await opened();

    await act(async () => {
      log.emitOpenPath("/home/jc/projects", "/home/jc/projects/beta.md");
    });

    await waitFor(() => expect(screen.getAllByTestId("tab")).toHaveLength(2));
    await waitFor(() => expect(cursorName()).toContain("beta.md"));
  });

  it("moves the cursor in the tab already on that folder, without a second tab", async () => {
    // The home tab is active and its cursor starts on `projects`, the first row.
    await opened();
    expect(cursorName()).toContain("projects");

    await act(async () => {
      log.emitOpenPath("/home/jc", "/home/jc/todo.txt");
    });

    await waitFor(() => expect(cursorName()).toContain("todo.txt"));
    expect(screen.queryAllByTestId("tab")).toHaveLength(0);
  });

  it("turns hidden files on to reveal a dotfile, which would otherwise be filtered out", async () => {
    await opened();
    expect(log.listAsks.at(-1)?.showHidden).toBe(false);

    await act(async () => {
      log.emitOpenPath("/home/jc/dotted", "/home/jc/dotted/.secret");
    });

    await waitFor(() => expect(cursorName()).toContain(".secret"));
    expect(log.listingWrites.at(-1)?.showHidden).toBe(true);
    const dotted = log.listAsks.filter((ask) => ask.path === "/home/jc/dotted");
    expect(dotted.at(-1)?.showHidden).toBe(true);
  });

  it("still opens the folder when the reveal is not inside it", async () => {
    // A reveal the decoder must drop: it names a file somewhere else. The
    // folder is the request; a bad refinement must not cost the whole of it.
    await opened();

    await act(async () => {
      log.emitOpenPath("/home/jc/projects", "/home/jc/notes.txt");
    });

    await waitFor(() => expect(screen.getAllByTestId("tab")).toHaveLength(2));
    await waitFor(() => expect(cursorName()).toContain("alpha"));
  });
});
