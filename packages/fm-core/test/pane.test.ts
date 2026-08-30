import { describe, expect, it } from "vitest";

import type { FsEntry } from "../src/entry.ts";
import {
  breadcrumbs,
  createPane,
  cursorEntry,
  enterDirectory,
  leaveDirectory,
  moveCursor,
  setEntries,
} from "../src/pane.ts";

function entry(name: string, kind: FsEntry["kind"] = "file"): FsEntry {
  return { name, kind, size: 0, modifiedMs: 0, isSymlink: false, isHidden: false };
}

const listing = [entry("src", "directory"), entry("a.txt"), entry("b.txt"), entry("c.txt")];

describe("the cursor", () => {
  it("starts on the first entry", () => {
    const pane = setEntries(createPane("/home/jc"), listing);
    expect(cursorEntry(pane)?.name).toBe("src");
  });

  it("moves down and up", () => {
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, 1);
    expect(cursorEntry(pane)?.name).toBe("a.txt");
    pane = moveCursor(pane, -1);
    expect(cursorEntry(pane)?.name).toBe("src");
  });

  it("does NOT wrap past the last entry", () => {
    // Wrapping is disorienting in a list you navigate by feel: you hold `j`,
    // the cursor silently teleports to the top, and you act on the wrong file.
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, 99);
    expect(cursorEntry(pane)?.name).toBe("c.txt");
    pane = moveCursor(pane, 1);
    expect(cursorEntry(pane)?.name).toBe("c.txt");
  });

  it("does NOT wrap past the first entry", () => {
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, -99);
    expect(cursorEntry(pane)?.name).toBe("src");
  });

  it("survives an empty directory without a cursor to move", () => {
    const pane = moveCursor(setEntries(createPane("/tmp"), []), 1);
    expect(cursorEntry(pane)).toBeNull();
  });

  it("clamps the cursor when the listing shrinks under it", () => {
    // A file watched away while the cursor sat on it. The cursor must land
    // somewhere real rather than off the end.
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, 3);
    pane = setEntries(pane, listing.slice(0, 2));
    expect(cursorEntry(pane)?.name).toBe("a.txt");
  });

  it("keeps the cursor on the same NAME when the listing is re-sorted", () => {
    // A re-sort is not navigation. The user's attention is on a file, not on
    // an index, and moving it under them is how the wrong file gets deleted.
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, 2);
    expect(cursorEntry(pane)?.name).toBe("b.txt");

    pane = setEntries(pane, [...listing].reverse());
    expect(cursorEntry(pane)?.name).toBe("b.txt");
  });
});

describe("entering and leaving", () => {
  it("enters a directory and makes it current", () => {
    const pane = setEntries(createPane("/home/jc"), listing);
    const entered = enterDirectory(pane);

    expect(entered.path).toBe("/home/jc/src");
    expect(entered.entries).toEqual([]);
  });

  it("refuses to enter a file", () => {
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, 1);

    expect(enterDirectory(pane)).toBe(pane);
  });

  it("leaves to the parent", () => {
    const pane = createPane("/home/jc/projects");
    expect(leaveDirectory(pane).path).toBe("/home/jc");
  });

  it("stops at the root rather than climbing past it", () => {
    expect(leaveDirectory(createPane("/")).path).toBe("/");
  });

  it("restores the cursor to the entry that was entered", () => {
    // The behaviour that makes Miller columns navigable: go in, come back out,
    // and the cursor is where you left it — not reset to the top.
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, 0);
    const inside = setEntries(enterDirectory(pane), [entry("deep.txt")]);
    const back = setEntries(leaveDirectory(inside), listing);

    expect(back.path).toBe("/home/jc");
    expect(cursorEntry(back)?.name).toBe("src");
  });

  it("remembers a cursor per directory, not one globally", () => {
    let pane = setEntries(createPane("/home/jc"), listing);
    pane = moveCursor(pane, 2); // b.txt
    const inside = setEntries(enterDirectory(moveCursor(pane, -2)), [entry("x")]);
    const back = setEntries(leaveDirectory(inside), listing);

    expect(cursorEntry(back)?.name).toBe("src");
  });
});

describe("breadcrumbs", () => {
  it("splits a path into segments with their absolute paths", () => {
    expect(breadcrumbs("/home/jc/projects")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "jc", path: "/home/jc" },
      { label: "projects", path: "/home/jc/projects" },
    ]);
  });

  it("gives the root a single segment", () => {
    expect(breadcrumbs("/")).toEqual([{ label: "/", path: "/" }]);
  });

  it("ignores a trailing slash", () => {
    expect(breadcrumbs("/home/jc/")).toEqual(breadcrumbs("/home/jc"));
  });
});
