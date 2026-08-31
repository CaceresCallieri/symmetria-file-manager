/**
 * @vitest-environment happy-dom
 *
 * Choosing an order, and showing dotfiles.
 *
 * **What is proved here is the REQUEST, not the ordering.** Both are decided by
 * the main process, which sorts and filters before it answers — so the thing the
 * renderer can be held to is that it asks for what the user chose, on every
 * listing, for as long as the choice stands. The ordering itself is proved
 * against the real handler in `app/test/ipc.test.ts` and against the comparators
 * in the shared package's own suite.
 *
 * The fixture returns its stored order verbatim and deliberately does not sort.
 * Making it sort was tried and reverted: `/home/jc` puts files between
 * directories, which no real listing ever does, and forty existing tests count
 * `j` presses against that shape.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../src/renderer/App.tsx";
import { type BridgeLog, installBridge, type ListAsk, namesIn } from "./support.ts";

let log: BridgeLog;

beforeEach(() => {
  log = installBridge();
});
afterEach(cleanup);

async function opened(at = "/home/jc"): Promise<void> {
  render(<App startPath={at} />);
  await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
  await act(async () => undefined);
}

/** Two separate keys, as a person presses them. */
function press(...keys: string[]): void {
  for (const key of keys) fireEvent.keyDown(window, { key });
}

/** A capital, which is how a reversed order is asked for. */
function pressShift(key: string): void {
  fireEvent.keyDown(window, { key, shiftKey: true });
}

/** The most recent listing of a given path. */
function lastAskFor(path: string): ListAsk | undefined {
  return [...log.listAsks].reverse().find((ask) => ask.path === path);
}

describe("choosing an order with the comma chord", () => {
  it("asks for the size order, and says so in the status bar", async () => {
    await opened();

    press(",", "s");

    await waitFor(() => expect(lastAskFor("/home/jc")?.sort).toBe("size"));
    expect(lastAskFor("/home/jc")?.reverse).toBe(false);
    expect(screen.getByTestId("status-bar").textContent).toMatch(/size/i);
  });

  it("reverses the order when the letter is a capital", async () => {
    await opened();

    press(",");
    pressShift("S");

    await waitFor(() => expect(lastAskFor("/home/jc")?.reverse).toBe(true));
    expect(lastAskFor("/home/jc")?.sort).toBe("size");
  });

  it("offers all five orders, each on its own letter", async () => {
    await opened();

    for (const [key, mode] of [
      ["a", "alphabetical"],
      ["m", "modified"],
      ["e", "extension"],
      ["n", "natural"],
      ["s", "size"],
    ] as const) {
      press(",", key);
      await waitFor(() => expect(lastAskFor("/home/jc")?.sort).toBe(mode));
    }
  });
});

describe("showing hidden files with the full stop", () => {
  it("asks for them, and asks again to stop", async () => {
    await opened();

    press(".");
    await waitFor(() => expect(lastAskFor("/home/jc")?.showHidden).toBe(true));

    press(".");
    await waitFor(() => expect(lastAskFor("/home/jc")?.showHidden).toBe(false));
  });

  it("says which state it is in", async () => {
    await opened();
    const before = screen.getByTestId("status-bar").textContent ?? "";

    press(".");

    await waitFor(() => expect(screen.getByTestId("status-bar").textContent).not.toBe(before));
  });
});

describe("the choice belongs to the window, not to one tab", () => {
  it("lists a tab opened afterwards in the same order", async () => {
    await opened();
    press(",", "s");
    await waitFor(() => expect(lastAskFor("/home/jc")?.sort).toBe("size"));

    // `t` opens a second tab on the current directory.
    press("t");

    await waitFor(() =>
      expect(log.listAsks.filter((a) => a.sort === "size").length).toBeGreaterThan(1),
    );
  });

  it("re-lists a background tab in the new order before it is shown", async () => {
    // The order changed while this tab was not visible. Switching to it must
    // show the new order rather than whatever it was left holding — otherwise
    // one window has two orders in it, which is the thing the operator chose
    // against.
    await opened();
    press("t");
    await act(async () => undefined);
    // Move the new tab somewhere else, so the two tabs are distinguishable.
    press("l");
    await act(async () => undefined);

    press(",", "s");
    await waitFor(() => expect(log.listAsks.some((a) => a.sort === "size")).toBe(true));

    // Back to the first tab.
    press("[");

    await waitFor(() => {
      const ask = lastAskFor("/home/jc");
      expect(ask?.sort).toBe("size");
    });
  });
});

describe("a listing still in flight when the order changes", () => {
  it("does not let the older answer land", async () => {
    // Every other listing in this fixture resolves in the same tick, so no test
    // here has ever had two loads overlapping — which is the only window in
    // which a stale reply can arrive. Review traced the guard (a generation
    // counter, and `listedUnder` written before the await) as sound and noted
    // that nothing exercised it; a later edit moving either of those after the
    // await would reintroduce the race in silence.
    //
    // `STALE-ONLY.txt` exists in no fixture directory. It can only reach the
    // column by way of the held reply, so its absence is the assertion.
    await opened();
    // Named for the CURRENT column. A change of options re-lists the parent
    // column too, and its effect runs first — an unnamed hold took that one
    // instead, left this column loading normally, and passed with the guard
    // removed. Measured, not reasoned about.
    const release = log.holdNextList("/home/jc", ["STALE-ONLY.txt"]);

    // Something that re-lists: the order changes, and the load is captured.
    press(",", "s");
    await act(async () => undefined);

    // A second change, whose listing is not held and answers immediately.
    press(",", "a");
    await waitFor(() => expect(lastAskFor("/home/jc")?.sort).toBe("alphabetical"));

    release();
    await act(async () => undefined);

    expect(namesIn("column-current")).not.toContain("STALE-ONLY.txt");
  });
});
