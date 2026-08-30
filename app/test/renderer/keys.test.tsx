/**
 * @vitest-environment happy-dom
 *
 * The ported registry, driven through the real window listener.
 *
 * `dispatch.test.ts` proves the table routes correctly against a stub. This
 * proves the application is actually WIRED to it — the same class of gap that
 * left phase 5's components mounted by nothing.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../src/renderer/App.tsx";
import { cursorIn, HOME_LAST_ENTRY, installBridge, namesIn } from "./support.ts";

beforeEach(installBridge);
afterEach(cleanup);

async function openedAtHome(): Promise<void> {
  render(<App startPath="/home/jc" />);
  await waitFor(() => expect(namesIn("column-current")).toContain("projects"));
}

describe("navigation comes from the registry now", () => {
  it("moves with j and with the arrow key the same row declares", async () => {
    await openedAtHome();

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(cursorIn("column-current")).toContain("notes.txt"));

    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() => expect(cursorIn("column-current")).toContain("todo.txt"));
  });

  it("jumps to the bottom with Shift+G", async () => {
    await openedAtHome();

    fireEvent.keyDown(window, { key: "G", shiftKey: true });

    await waitFor(() => expect(cursorIn("column-current")).toContain(HOME_LAST_ENTRY));
  });

  it("jumps to the top with the gg chord, one key at a time", async () => {
    await openedAtHome();
    fireEvent.keyDown(window, { key: "G", shiftKey: true });
    await waitFor(() => expect(cursorIn("column-current")).toContain(HOME_LAST_ENTRY));

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "g" });

    await waitFor(() => expect(cursorIn("column-current")).toContain("projects"));
  });
});

describe("the which-key overlay", () => {
  it("appears the moment a prefix is pending, and lists what resolves it", async () => {
    await openedAtHome();

    fireEvent.keyDown(window, { key: "c" });

    const hud = await screen.findByTestId("which-key");
    expect(hud.textContent).toContain("copy to clipboard");
    expect(within(hud).getAllByTestId("which-key-row").length).toBeGreaterThan(0);
  });

  it("disappears when the chord resolves, because there is no timeout to wait out", async () => {
    // The documentation claims a 500 ms chord timer twice. There is none, and
    // there never was: a prefix persists until the next key resolves it.
    await openedAtHome();
    fireEvent.keyDown(window, { key: "c" });
    await screen.findByTestId("which-key");

    fireEvent.keyDown(window, { key: "f" });

    await waitFor(() => expect(screen.queryByTestId("which-key")).toBeNull());
  });

  it("disappears on Escape, without acting", async () => {
    await openedAtHome();
    fireEvent.keyDown(window, { key: "g" });
    await screen.findByTestId("which-key");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("which-key")).toBeNull());
    expect(screen.queryByTestId("pane-message")).toBeNull();
  });
});

describe("the help overlay", () => {
  it("opens on ? and lists rows read from the registry", async () => {
    // `?` is an ordinary registry row, not a special case, and the sheet reads
    // the same table the dispatcher does.
    await openedAtHome();

    fireEvent.keyDown(window, { key: "?", shiftKey: true });

    const help = await screen.findByTestId("help-overlay");
    expect(within(help).getAllByTestId("help-row").length).toBeGreaterThan(30);
    expect(help.textContent).toContain("Move down");
    expect(help.textContent).toContain("Fuzzy finder");
  });

  it("renders the chord groups as menus rather than as bare prefix rows", async () => {
    await openedAtHome();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });

    const help = await screen.findByTestId("help-overlay");
    expect(within(help).getByTestId("chord-group-,").textContent).toContain("sort by");
  });

  it("closes on Escape, which the modal handles itself", async () => {
    await openedAtHome();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    await screen.findByTestId("help-overlay");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("help-overlay")).toBeNull());
  });

  it("swallows other keys while it is open", async () => {
    await openedAtHome();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    await screen.findByTestId("help-overlay");

    fireEvent.keyDown(window, { key: "j" });

    expect(cursorIn("column-current")).toContain("projects");
  });
});

describe("operations that later phases build", () => {
  it("says so rather than doing nothing silently", async () => {
    // The registry is ported whole, so it names operations that do not exist
    // yet. A key that silently does nothing reads as a bug; one that says why
    // reads as a roadmap.
    //
    // `f` is the fuzzy finder, still unbuilt. `d` used to stand here and now
    // opens the trash dialog for real — an operation graduating out of this
    // test is the point of the test, not a break in it.
    await openedAtHome();

    fireEvent.keyDown(window, { key: "f" });

    const message = await screen.findByTestId("pane-message");
    expect(message.textContent).toMatch(/fuzzy finder/i);
  });

  it("opens the trash dialog for an operation that now exists", async () => {
    await openedAtHome();

    fireEvent.keyDown(window, { key: "d" });

    expect(await screen.findByTestId("modal-delete")).toBeDefined();
  });
});

describe("the Latin-American layout, through the real listener", () => {
  it("reaches a symbol binding that arrives with Shift held", async () => {
    await openedAtHome();

    fireEvent.keyDown(window, { key: "/", shiftKey: true });

    const message = await screen.findByTestId("pane-message");
    expect(message.textContent).toMatch(/search/i);
  });
});
