/**
 * @vitest-environment happy-dom
 * UI entry point: App. Tree create must reach the existing file-operation bridge.
 */
import type { CursorEntry } from "@symmetria/fm-core/keys/types";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TreeRow } from "../../src/tree/model.ts";
import { useTreeController } from "../../src/tree/useTreeController.ts";
import type { TreePort } from "../../src/tree/useTreeMode.ts";
import { deferred } from "./deferred.ts";
import { openCreateTree, openTree, treeEntry, treeKey, treeRow } from "./tree-support.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function createField() {
  treeKey("a");
  const dialog = await screen.findByRole("dialog", { name: "New file or folder" });
  const input = within(dialog).getByRole("textbox");
  expect(document.activeElement).toBe(input);
  return input;
}

function submit(input: HTMLElement, name: string) {
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function activateTab(index: number) {
  const tab = screen.getAllByTestId("tab")[index];
  if (!tab) throw new Error(`Missing tab ${index}`);
  fireEvent.click(within(tab).getByRole("button", { name: "jc" }));
}

/** A lifecycle guard, beside the App specs, observes publication before passive effects. */
function CursorPublicationProbe({
  current,
  port,
  observe,
}: {
  current: TreeRow;
  port: TreePort;
  observe(): void;
}) {
  useTreeController(
    port,
    { command: () => {}, reveal: () => {}, cancel: () => {} },
    current,
    false,
    0,
    null,
  );
  useLayoutEffect(observe);
  return null;
}

const ROOT_PUBLICATION_ROW: TreeRow = {
  ...treeEntry("jc", "directory"),
  path: "/home/jc",
  parent: null,
  depth: 0,
  position: 1,
  siblings: 1,
  status: "Loaded",
  expanded: true,
};

it("tree-create regression: publishes a newly committed deep-file cursor before passive effects", () => {
  let published: CursorEntry | null = null;
  const observed: (CursorEntry | null)[] = [];
  const port: TreePort = {
    connect: () => () => {},
    select: (entry) => {
      published = entry;
    },
  };
  const observe = () => {
    observed.push(published);
  };
  const initial = ROOT_PUBLICATION_ROW;
  const selected: TreeRow = {
    ...initial,
    ...treeEntry("seed.md"),
    path: "/home/jc/src/nested/seed.md",
    parent: "/home/jc/src/nested",
    depth: 3,
    expanded: false,
  };
  const { rerender } = render(
    <CursorPublicationProbe current={initial} port={port} observe={observe} />,
  );
  observed.length = 0;
  // act flushes passive effects after the commit. This observation is already
  // captured by the later layout effect, so that flush cannot mask a stale cursor.
  rerender(<CursorPublicationProbe current={selected} port={port} observe={observe} />);
  expect(observed).toEqual([
    {
      name: "seed.md",
      path: "/home/jc/src/nested/seed.md",
      isDirectory: false,
      isImage: false,
      mimeType: "",
    },
  ]);
});

it("tree-create P3-1: skips identical cursor publications across unrelated directory batches", () => {
  const select = vi.fn();
  const port: TreePort = { connect: () => () => {}, select };
  const observe = () => {};
  const { rerender } = render(
    <CursorPublicationProbe current={ROOT_PUBLICATION_ROW} port={port} observe={observe} />,
  );
  expect(select).toHaveBeenCalledTimes(1);
  rerender(
    <CursorPublicationProbe
      current={{ ...ROOT_PUBLICATION_ROW, siblings: 20 }}
      port={port}
      observe={observe}
    />,
  );
  expect(select).toHaveBeenCalledTimes(1);
});

it.each([
  ["name", { name: "renamed" }, { name: "renamed" }],
  ["path", { path: "/home/other" }, { path: "/home/other" }],
  ["kind", { kind: "file" }, { isDirectory: false }],
  ["symlink", { isSymlink: true }, { isDirectory: false }],
] satisfies readonly [string, Partial<TreeRow>, Partial<CursorEntry>][])(
  "tree-create P3-1: publishes a changed cursor %s during layout even when other fields stay the same",
  (_field, change, expected) => {
    const select = vi.fn();
    const layoutCounts: number[] = [];
    const port: TreePort = { connect: () => () => {}, select };
    const observe = () => {
      layoutCounts.push(select.mock.calls.length);
    };
    const { rerender } = render(
      <CursorPublicationProbe current={ROOT_PUBLICATION_ROW} port={port} observe={observe} />,
    );
    layoutCounts.length = 0;
    rerender(
      <CursorPublicationProbe
        current={{ ...ROOT_PUBLICATION_ROW, ...change }}
        port={port}
        observe={observe}
      />,
    );
    expect(layoutCounts).toEqual([2]);
    expect(select).toHaveBeenLastCalledWith(expect.objectContaining(expected));
  },
);

it("tree-create P3-1: publishes the same cursor to a replacement host callback", () => {
  const original = vi.fn();
  const replacement = vi.fn();
  const port: TreePort = { connect: () => () => {}, select: original };
  const observe = () => {};
  const { rerender } = render(
    <CursorPublicationProbe current={ROOT_PUBLICATION_ROW} port={port} observe={observe} />,
  );
  rerender(
    <CursorPublicationProbe
      current={ROOT_PUBLICATION_ROW}
      port={{ ...port, select: replacement }}
      observe={observe}
    />,
  );
  expect(original).toHaveBeenCalledTimes(1);
  expect(replacement).toHaveBeenCalledExactlyOnceWith(original.mock.calls[0]?.[0]);
});

describe("tree create acceptance", () => {
  it("tree-create P2-1: an existing trailing-slash folder reports the bridge failure and preserves dialog input", async () => {
    const log = await openCreateTree();
    fireEvent.click(treeRow("/home/jc"));
    const before = [...log.entries];
    const reads = log.overview.mock.calls.length;
    const input = await createField();
    submit(input, "src/");
    await waitFor(() =>
      expect(screen.getByTestId("pane-message").textContent).toBe(
        "EEXIST: file already exists, mkdir '/home/jc/src'",
      ),
    );
    expect(log.create).toHaveBeenCalledExactlyOnceWith({ path: "/home/jc/src", kind: "directory" });
    expect([...log.entries]).toEqual(before);
    expect(log.overview.mock.calls.length).toBe(reads);
    expect(screen.getByTestId("modal-create")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveProperty("value", "src/");
    expect(document.activeElement).toBe(input);
  });
  it.each([
    ["tree root", "/home/jc", "/home/jc", "/home/jc/created.txt"],
    ["filesystem root", "/", "/", "/created.txt"],
    ["selected directory", "/home/jc", "/home/jc/src", "/home/jc/src/created.txt"],
    ["selected nested file", "/home/jc", "/home/jc/src/beta.ts", "/home/jc/src/created.txt"],
  ])(
    "tree-create AC1: creates a file at the %s destination through App",
    async (_label, root, selected, path) => {
      const log = await openCreateTree(root);
      await waitFor(() => treeRow(selected));
      fireEvent.click(treeRow(selected));
      submit(await createField(), "created.txt");
      await waitFor(() =>
        expect(log.create).toHaveBeenCalledExactlyOnceWith({ path, kind: "file" }),
      );
      await waitFor(() => expect(screen.queryByTestId("modal-create")).toBeNull());
      expect(screen.getByRole("tree")).toBeTruthy();
    },
  );

  it("tree-create AC1: creates a folder from a trailing slash inside the selected directory", async () => {
    const log = await openCreateTree();
    fireEvent.click(treeRow("/home/jc/src"));
    submit(await createField(), "new-folder/");
    await waitFor(() =>
      expect(log.create).toHaveBeenCalledExactlyOnceWith({
        path: "/home/jc/src/new-folder",
        kind: "directory",
      }),
    );
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("tree-create AC2: refreshes and reveals the created entry inside a collapsed destination", async () => {
    const log = await openCreateTree();
    fireEvent.click(treeRow("/home/jc/src"));
    treeKey("h");
    expect(treeRow("/home/jc/src").getAttribute("aria-expanded")).toBe("false");
    const reads = log.overview.mock.calls.length;
    submit(await createField(), "revealed.txt");
    await waitFor(() =>
      expect(treeRow("/home/jc/src/revealed.txt").getAttribute("aria-selected")).toBe("true"),
    );
    expect(treeRow("/home/jc/src").getAttribute("aria-expanded")).toBe("true");
    expect(log.overview.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("tree-create AC3: freezes the destination when the dialog opens", async () => {
    const log = await openCreateTree();
    fireEvent.click(treeRow("/home/jc/src"));
    const input = await createField();
    // A pointer selection can change the cursor while the dialog owns keyboard input.
    fireEvent.click(treeRow("/home/jc/notes.txt"));
    expect(treeRow("/home/jc/notes.txt").getAttribute("aria-selected")).toBe("true");
    submit(input, "frozen.txt");
    await waitFor(() =>
      expect(log.create).toHaveBeenCalledExactlyOnceWith({
        path: "/home/jc/src/frozen.txt",
        kind: "file",
      }),
    );
  });

  it("tree-create AC3: Escape cancels without sending a create request or leaving tree mode", async () => {
    const log = await openCreateTree();
    const input = await createField();
    fireEvent.change(input, { target: { value: "cancelled.txt" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("modal-create")).toBeNull());
    expect(log.create).not.toHaveBeenCalled();
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it("tree-create AC3: empty input sends no create request and keeps the dialog open", async () => {
    const log = await openCreateTree();
    submit(await createField(), "");
    expect(log.create).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal-create")).toBeTruthy();
    expect(screen.getByRole("tree")).toBeTruthy();
  });

  it.each([
    ["existing path", "/home/jc", "notes.txt", "already exists"],
    ["permission denial", "/home/jc/locked", "denied.txt", "permission denied"],
  ])(
    "tree-create AC3: preserves entries and keeps the dialog open after %s",
    async (_label, selected, name, message) => {
      const log = await openCreateTree();
      fireEvent.click(treeRow(selected));
      const before = [...log.entries];
      submit(await createField(), name);
      await waitFor(() =>
        expect(screen.getByTestId("pane-message").textContent).toContain(message),
      );
      expect(log.create).toHaveBeenCalledTimes(1);
      expect([...log.entries]).toEqual(before);
      expect(screen.getByTestId("modal-create")).toBeTruthy();
      expect(screen.getByRole("tree")).toBeTruthy();
    },
  );
});

describe("tree create async ownership", () => {
  it.each(["before confirmation", "while creation is pending"])(
    "tree-create ownership: retains the original destination and leaves another tab unchanged after switching %s",
    async (timing) => {
      const log = await openCreateTree();
      treeKey("t");
      treeKey("e", true);
      await waitFor(() => treeRow("/home/jc/src/beta.ts"));
      activateTab(0);
      await waitFor(() => treeRow("/home/jc/src/beta.ts"));
      fireEvent.click(treeRow("/home/jc/src"));
      const input = await createField();
      const held = deferred();
      log.create.mockImplementationOnce(async () => {
        await held.promise;
        return { ok: true, value: null };
      });
      if (timing === "while creation is pending") submit(input, "owned.txt");
      activateTab(1);
      await waitFor(() => treeRow("/home/jc/src/beta.ts"));
      fireEvent.click(treeRow("/home/jc/notes.txt"));
      if (timing === "before confirmation") submit(input, "owned.txt");
      await waitFor(() =>
        expect(log.create).toHaveBeenCalledExactlyOnceWith({
          path: "/home/jc/src/owned.txt",
          kind: "file",
        }),
      );
      const reads = log.overview.mock.calls.length;
      await act(async () => held.resolve());
      expect(screen.queryByTestId("modal-create")).toBeNull();
      expect(treeRow("/home/jc/notes.txt").getAttribute("aria-selected")).toBe("true");
      expect(log.overview.mock.calls.length).toBe(reads);
    },
  );

  it.each(["success", "failure"])(
    "tree-create ownership: ignores a cancelled dialog's %s reply after a replacement opens",
    async (outcome) => {
      const log = await openCreateTree();
      fireEvent.click(treeRow("/home/jc"));
      const held = deferred();
      log.create.mockImplementationOnce(async () => {
        await held.promise;
        return outcome === "success"
          ? { ok: true, value: null }
          : { ok: false, error: { code: "write_failed", message: "cancelled operation failed" } };
      });
      submit(await createField(), "first.txt");
      await waitFor(() => expect(log.create).toHaveBeenCalledTimes(1));
      treeKey("Escape");
      const replacement = await createField();
      fireEvent.change(replacement, { target: { value: "replacement.txt" } });
      const reads = log.overview.mock.calls.length;
      await act(async () => held.resolve());
      expect(screen.getByTestId("modal-create")).toBeTruthy();
      expect(screen.getByRole("textbox")).toBe(replacement);
      expect(screen.queryByTestId("pane-message")?.textContent ?? "").not.toContain(
        "cancelled operation failed",
      );
      expect(log.overview.mock.calls.length).toBe(reads);
      fireEvent.keyDown(replacement, { key: "Enter" });
      await waitFor(() =>
        expect(log.create).toHaveBeenLastCalledWith({
          path: "/home/jc/replacement.txt",
          kind: "file",
        }),
      );
      await waitFor(() => expect(screen.queryByTestId("modal-create")).toBeNull());
    },
  );
});

describe("tree create preservation guards", () => {
  it("tree-create guard: Miller creates beside its cursor directory instead of entering that directory", async () => {
    const log = await openCreateTree();
    treeKey("Escape");
    expect(screen.queryByRole("tree")).toBeNull();
    submit(await createField(), "miller.txt");
    await waitFor(() =>
      expect(log.create).toHaveBeenCalledExactlyOnceWith({
        path: "/home/jc/miller.txt",
        kind: "file",
      }),
    );
  });

  it("tree-create guard: tree navigation keeps structural movement and file activation", async () => {
    const log = await openTree();
    fireEvent.click(treeRow("/home/jc/src"));
    treeKey("h");
    expect(treeRow("/home/jc/src").getAttribute("aria-expanded")).toBe("false");
    treeKey("l");
    expect(treeRow("/home/jc/src").getAttribute("aria-expanded")).toBe("true");
    treeKey("Home");
    expect(treeRow("/home/jc").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(treeRow("/home/jc/src/beta.ts"));
    treeKey("Enter");
    await waitFor(() =>
      expect(log.open).toHaveBeenCalledExactlyOnceWith({ path: "/home/jc/src/beta.ts" }),
    );
  });

  it("tree-create guard: a stays native while the tree search input owns the keyboard", async () => {
    const log = await openTree();
    treeKey("/");
    const input = await screen.findByRole("textbox", { name: "Search loaded paths" });
    expect(fireEvent.keyDown(input, { key: "a" })).toBe(true);
    fireEvent.change(input, { target: { value: "beta" } });
    await waitFor(() =>
      expect(treeRow("/home/jc/src/beta.ts").getAttribute("aria-selected")).toBe("true"),
    );
    expect(screen.queryByTestId("modal-create")).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search loaded paths" })).toBeNull();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(log.ops).toEqual([]);
  });

  it("tree-create guard: a belongs to flash before the create binding", async () => {
    const log = await openTree();
    treeKey("s");
    await screen.findByRole("status", { name: "Flash navigation" });
    treeKey("a");
    expect(screen.getByRole("status", { name: "Flash navigation" }).textContent).toContain("a");
    expect(screen.queryByTestId("modal-create")).toBeNull();
    expect(log.ops).toEqual([]);
    treeKey("Escape");
    expect(screen.queryByRole("status", { name: "Flash navigation" })).toBeNull();
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});
