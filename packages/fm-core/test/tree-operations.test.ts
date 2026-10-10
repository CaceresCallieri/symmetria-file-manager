import { describe, expect, it } from "vitest";
import { resolveChord } from "../src/keys/chords.ts";
import { dispatch } from "../src/keys/dispatch.ts";
import { bindingsFor } from "../src/keys/registry.ts";
import type { Mods } from "../src/keys/types.ts";
import { contextWith, press } from "./support/keys.ts";

describe("tree operations registry fence", () => {
  it.each([
    ["d", "", "trash"],
    ["r", "", "rename(false)"],
    ["R", "Shift", "rename(true)"],
    ["r", "Ctrl", "treeRefresh"],
    ["y", "", "yank"],
    ["x", "", "cut"],
    ["p", "", "paste"],
    ["v", "Ctrl", "paste"],
    [" ", "", "toggleSelection"],
    ["Escape", "", "clearSelection"],
    ["c", "", "setChordPrefix(c)"],
  ] satisfies readonly [string, Mods, string][])(
    "tree-operations AC6 registry: %s with %s routes to %s",
    (key, mods, action) => {
      const context = contextWith({ selectedCount: 2 }, "tree");
      expect(dispatch(press(key, mods), context)).toBe(true);
      expect(context.calls).toEqual([action]);
    },
  );

  it.each([
    ["c", "path"],
    ["f", "filename"],
    ["n", "nameWithoutExtension"],
    ["d", "directory"],
  ])("tree-operations AC5 chords: c-%s dispatches the shared %s action", (key, target) => {
    const context = contextWith({}, "tree");
    resolveChord("c", press(key), context);
    expect(context.calls).toEqual(["setChordPrefix()", `copyToClipboard(${target})`]);
  });

  it("tree-operations AC6 registry: every supported operation carries shared help metadata", () => {
    const ids = [
      "op.delete",
      "op.rename",
      "miller.renameExt",
      "clip.yank",
      "clip.cut",
      "clip.paste",
      "clip.pasteCtrl",
      "sel.toggle",
      "sel.clear",
      "chord.copy",
    ];
    const tree = bindingsFor("tree");
    for (const id of ids) {
      const row = tree.find((binding) => binding.id === id);
      expect(row, id).toBeDefined();
      expect(row?.label, id).not.toBe("");
      expect(row?.keycap, id).not.toBe("");
    }
  });
});

describe("tree operations core preservation guards", () => {
  it.each(["d", "n", "x", "q"])(
    "tree-operations guard: g-%s remains navigation-only and cannot edit bookmarks",
    (key) => {
      const context = contextWith({}, "tree");
      resolveChord("g", press(key), context);
      expect(context.calls).toEqual(["setChordPrefix()"]);
    },
  );
  it("tree-operations guard: g-g still jumps to the tree root", () => {
    const context = contextWith({}, "tree");
    resolveChord("g", press("g"), context);
    expect(context.calls).toEqual(["setChordPrefix()", "jumpToTop"]);
  });
  it("tree-operations guard: tree image metadata cannot send an image-byte action", () => {
    const context = contextWith(
      {
        cursorEntry: {
          name: "shot.png",
          path: "/tmp/shot.png",
          isDirectory: false,
          isImage: false,
          mimeType: "",
        },
      },
      "tree",
    );
    resolveChord("c", press("i"), context);
    expect(context.calls.some((call) => call === "copyToClipboard(imageBytes)")).toBe(false);
  });
  it("tree-operations guard: tree never offers Miller history, reader, audio, or sort commands", () => {
    const ids = bindingsFor("tree").map((binding) => binding.id);
    for (const id of [
      "hist.back",
      "hist.forward",
      "preview.expand",
      "audio.toggle",
      "chord.sort",
      "miller.renderToggle",
    ])
      expect(ids).not.toContain(id);
  });
});
