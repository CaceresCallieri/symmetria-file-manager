/**
 * @vitest-environment happy-dom
 * UI entry point: App. All operation specs use the standalone application wiring.
 * The bridge fixture mutates tree listings but sends no automatic watcher event.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { deferred } from "./deferred.ts";
import {
  activateTreeTab,
  addSecondTreeTab,
  confirmTreeDialog,
  openOperationsTree,
  renameTreeInput,
  selectTreePath,
  submitTreeName,
} from "./tree-operations-support.ts";
import { installTreeBridge, treeEntry, treeKey, treeRow } from "./tree-support.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROOT = "/home/jc";
const DEEP_FILE = `${ROOT}/src/nested/İinteresting long filename.md`;
const DEEP_FOLDER = `${ROOT}/src/nested`;

function marked(path: string) {
  return treeRow(path).hasAttribute("data-marked");
}

function selectedPath() {
  return within(screen.getByRole("tree"))
    .getAllByRole("treeitem")
    .find((row) => row.getAttribute("aria-selected") === "true")?.dataset.path;
}

async function mark(path: string) {
  await selectTreePath(path);
  treeKey(" ");
}

type OperationsLog = Awaited<ReturnType<typeof openOperationsTree>>;
const OWNERSHIP_CASES = [
  ["trash", "success"],
  ["trash", "failure"],
  ["rename", "success"],
  ["rename", "failure"],
  ["paste", "success"],
  ["paste", "failure"],
  ["paste", "conflict"],
] as const;

async function startHeldOperation(
  log: OperationsLog,
  operation: string,
  outcome: string,
  held: ReturnType<typeof deferred>,
) {
  const failure = {
    ok: false,
    error: { code: "write_failed", message: "old operation failed" },
  } as const;
  if (operation === "trash") {
    log.trash.mockImplementationOnce(async () => {
      await held.promise;
      return outcome === "success" ? { ok: true, value: null } : failure;
    });
    treeKey("d");
    expect(screen.getByTestId("modal-delete")).toBeTruthy();
    await confirmTreeDialog("delete");
  } else if (operation === "rename") {
    log.rename.mockImplementationOnce(async () => {
      await held.promise;
      return outcome === "success"
        ? { ok: true, value: { path: `${DEEP_FOLDER}/new.md` } }
        : failure;
    });
    submitTreeName(await renameTreeInput(), "new.md");
  } else {
    log.transfer.mockImplementationOnce(async () => {
      await held.promise;
      return outcome === "failure"
        ? failure
        : {
            ok: true,
            value: {
              moved: outcome === "success" ? 1 : 0,
              conflicts: outcome === "conflict" ? ["beta.ts"] : [],
            },
          };
    });
    treeKey("y");
    await selectTreePath(`${ROOT}/empty`);
    treeKey("p");
    await waitFor(() => expect(log.transfer).toHaveBeenCalledTimes(1));
  }
}

describe("tree operations trash fence", () => {
  it.each([DEEP_FILE, DEEP_FOLDER])(
    "tree-operations AC1 trash: confirms and refreshes the exact deep target %s with a valid tree cursor",
    async (path) => {
      const log = await openOperationsTree();
      await selectTreePath(path);
      treeKey("d");
      const dialog = screen.getByTestId("modal-delete");
      expect(within(dialog).getByTestId("delete-list").textContent).toContain(
        path.split("/").pop(),
      );
      expect(dialog.textContent).toMatch(/recoverable/i);
      expect(log.trash).not.toHaveBeenCalled();
      await confirmTreeDialog("delete");
      await waitFor(() => expect(log.trash).toHaveBeenCalledExactlyOnceWith({ paths: [path] }));
      await waitFor(() => expect(screen.queryByTestId("modal-delete")).toBeNull());
      await waitFor(() =>
        expect(screen.getByRole("tree").querySelector(`[data-path="${path}"]`)).toBeNull(),
      );
      expect(selectedPath()).toBeTruthy();
      expect(log.entries.get(ROOT)?.some((entry) => entry.name === "src")).toBe(true);
    },
  );

  it("tree-operations AC1 trash: Escape cancels the existing confirmation without mutation or leaving tree", async () => {
    const log = await openOperationsTree();
    treeKey("d");
    expect(screen.getByTestId("modal-delete")).toBeTruthy();
    treeKey("Escape");
    expect(screen.queryByTestId("modal-delete")).toBeNull();
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(log.trash).not.toHaveBeenCalled();
  });

  it.each(["d", "x"])(
    "tree-operations AC1 root: %s reports a refusal and sends no mutation",
    async (key) => {
      const log = await openOperationsTree();
      await selectTreePath(ROOT);
      treeKey(key);
      expect(screen.getByTestId("pane-message").textContent).toMatch(/root/i);
      expect(screen.queryByTestId("modal-delete")).toBeNull();
      expect(log.trash).not.toHaveBeenCalled();
      await selectTreePath(`${ROOT}/empty`);
      treeKey("p");
      expect(log.transfer).not.toHaveBeenCalled();
    },
  );

  it("tree-operations AC1 trash: trashes a symlink entry without following its directory target", async () => {
    const log = await openOperationsTree([
      { ...treeEntry("linked", "directory"), isSymlink: true },
    ]);
    await selectTreePath(`${ROOT}/linked`);
    treeKey("d");
    expect(screen.getByTestId("modal-delete")).toBeTruthy();
    await confirmTreeDialog("delete");
    await waitFor(() =>
      expect(log.trash).toHaveBeenCalledExactlyOnceWith({ paths: [`${ROOT}/linked`] }),
    );
    expect(log.overview.mock.calls.some(([request]) => request.path === `${ROOT}/linked`)).toBe(
      false,
    );
    expect(log.entries.has(`${ROOT}/src`)).toBe(true);
  });

  it("tree-operations AC1 trash: failure reports the bridge error and preserves the original entries", async () => {
    const log = await openOperationsTree();
    const before = [...log.entries];
    log.trash.mockResolvedValueOnce({
      ok: false,
      error: { code: "write_failed", message: "trash refused" },
    });
    treeKey("d");
    expect(screen.getByTestId("modal-delete")).toBeTruthy();
    await confirmTreeDialog("delete");
    await waitFor(() =>
      expect(screen.getByTestId("pane-message").textContent).toContain("trash refused"),
    );
    expect([...log.entries]).toEqual(before);
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});

describe("tree operations rename fence", () => {
  it.each([false, true])(
    "tree-operations AC2 rename: full-name=%s selects the original deep entry name",
    async (fullName) => {
      await openOperationsTree();
      await selectTreePath(DEEP_FILE);
      const input = await renameTreeInput(fullName);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("İinteresting long filename.md");
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(fullName ? input.value.length : input.value.length - 3);
    },
  );

  it.each([DEEP_FILE, DEEP_FOLDER])(
    "tree-operations AC2 rename: captures, refreshes, and reveals renamed target %s",
    async (path) => {
      const log = await openOperationsTree();
      await selectTreePath(path);
      const input = await renameTreeInput();
      await selectTreePath(`${ROOT}/notes.txt`);
      submitTreeName(input, "renamed");
      await waitFor(() =>
        expect(log.rename).toHaveBeenCalledExactlyOnceWith({ path, name: "renamed" }),
      );
      const result = `${path.slice(0, path.lastIndexOf("/"))}/renamed`;
      await waitFor(() => expect(treeRow(result).getAttribute("aria-selected")).toBe("true"));
      expect(screen.queryByTestId("modal-rename")).toBeNull();
      expect(screen.getByRole("tree")).toBeTruthy();
    },
  );

  it("tree-operations AC2 rename: failure preserves the dialog, typed name, and filesystem data", async () => {
    const log = await openOperationsTree();
    const before = [...log.entries];
    log.rename.mockResolvedValueOnce({
      ok: false,
      error: { code: "write_failed", message: "rename denied" },
    });
    const input = await renameTreeInput();
    submitTreeName(input, "still-wanted.ts");
    await waitFor(() =>
      expect(screen.getByTestId("pane-message").textContent).toContain("rename denied"),
    );
    expect(screen.getByTestId("modal-rename")).toBeTruthy();
    expect(screen.getByTestId("dialog-name")).toBe(input);
    expect(input.value).toBe("still-wanted.ts");
    expect([...log.entries]).toEqual(before);
  });

  it("tree-operations AC2 root: rename refuses the configured root without opening a dialog", async () => {
    const log = await openOperationsTree();
    await selectTreePath(ROOT);
    treeKey("r");
    expect(screen.getByTestId("pane-message").textContent).toMatch(/root/i);
    expect(screen.queryByTestId("modal-rename")).toBeNull();
    expect(log.rename).not.toHaveBeenCalled();
  });
});

describe("tree operations clipboard fence", () => {
  it("tree-operations AC3 symlink: paste beside a directory symlink without using it as a directory destination", async () => {
    const log = await openOperationsTree([
      { ...treeEntry("linked", "directory"), isSymlink: true },
    ]);
    treeKey("y");
    await selectTreePath(`${ROOT}/linked`);
    treeKey("p");
    await waitFor(() =>
      expect(log.transfer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ sources: [`${ROOT}/src/beta.ts`], destination: ROOT }),
      ),
    );
    expect(log.overview.mock.calls.some(([request]) => request.path === `${ROOT}/linked`)).toBe(
      false,
    );
  });

  it.each([
    ["y", "copy", "Yanked"],
    ["x", "move", "Cut"],
  ])(
    "tree-operations AC3 clipboard: %s uses the deep cursor, shared %s state, and %s source indicator",
    async (key, mode, indicator) => {
      const log = await openOperationsTree();
      await selectTreePath(DEEP_FILE);
      treeKey(key);
      expect(within(treeRow(DEEP_FILE)).getByRole("img", { name: indicator })).toBeTruthy();
      await selectTreePath(`${ROOT}/empty`);
      treeKey("p");
      await waitFor(() =>
        expect(log.transfer).toHaveBeenCalledWith(
          expect.objectContaining({
            sources: [DEEP_FILE],
            destination: `${ROOT}/empty`,
            mode,
            overwrite: false,
          }),
        ),
      );
      await waitFor(() =>
        expect(treeRow(`${ROOT}/empty/İinteresting long filename.md`)).toBeTruthy(),
      );
      if (key === "y") {
        expect(within(treeRow(DEEP_FILE)).getByRole("img", { name: indicator })).toBeTruthy();
        treeKey("p");
        await waitFor(() => expect(log.transfer).toHaveBeenCalledTimes(2));
      } else {
        await waitFor(() => expect(screen.queryAllByRole("img", { name: "Cut" })).toHaveLength(0));
        treeKey("p");
        expect(screen.getByTestId("pane-message").textContent).toBe("nothing to paste");
        expect(log.transfer).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each([
    [ROOT, ROOT, "p", false],
    [`${ROOT}/src/nested`, `${ROOT}/src/nested`, "v", true],
    [DEEP_FILE, `${ROOT}/src/nested`, "p", false],
  ] as const)(
    "tree-operations AC3 paste: %s captures destination %s with %s ctrl=%s",
    async (selected, destination, key, control) => {
      const log = await openOperationsTree();
      await selectTreePath(`${ROOT}/notes.txt`);
      treeKey("y");
      await selectTreePath(selected);
      treeKey(key, control);
      await waitFor(() =>
        expect(log.transfer).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            sources: [`${ROOT}/notes.txt`],
            destination,
            mode: "copy",
            overwrite: false,
          }),
        ),
      );
    },
  );

  it("tree-operations AC3 paste: conflict confirmation preserves the captured destination after selection and tab changes", async () => {
    const log = await openOperationsTree();
    await addSecondTreeTab();
    await selectTreePath(DEEP_FILE);
    treeKey("y");
    await selectTreePath(`${ROOT}/empty`);
    log.conflictNext(["İinteresting long filename.md"]);
    treeKey("p");
    const dialog = await screen.findByTestId("modal-conflict");
    expect(within(dialog).getByTestId("conflict-list").textContent).toContain(
      "İinteresting long filename.md",
    );
    activateTreeTab(1);
    await selectTreePath(`${ROOT}/notes.txt`);
    const reads = log.overview.mock.calls.length;
    await confirmTreeDialog("conflict");
    await waitFor(() =>
      expect(log.transfer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sources: [DEEP_FILE],
          destination: `${ROOT}/empty`,
          overwrite: true,
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId("modal-conflict")).toBeNull());
    expect(selectedPath()).toBe(`${ROOT}/notes.txt`);
    expect(log.overview.mock.calls.length).toBe(reads);
  });

  it("tree-operations AC3 paste: Escape cancels conflict without overwrite and keeps the copy reusable", async () => {
    const log = await openOperationsTree();
    treeKey("y");
    await selectTreePath(`${ROOT}/empty`);
    log.conflictNext(["beta.ts"]);
    treeKey("p");
    await screen.findByTestId("modal-conflict");
    treeKey("Escape");
    expect(screen.queryByTestId("modal-conflict")).toBeNull();
    expect(log.transfer).toHaveBeenCalledTimes(1);
    expect(log.transfer.mock.calls[0]?.[0].overwrite).toBe(false);
    treeKey("p");
    await waitFor(() => expect(log.transfer).toHaveBeenCalledTimes(2));
  });

  it("tree-operations AC3 paste: transfer failure preserves the cut clipboard and its source indicator", async () => {
    const log = await openOperationsTree();
    treeKey("x");
    await selectTreePath(`${ROOT}/empty`);
    log.transfer.mockResolvedValueOnce({
      ok: false,
      error: { code: "write_failed", message: "copy denied" },
    });
    treeKey("p");
    await waitFor(() =>
      expect(screen.getByTestId("pane-message").textContent).toContain("copy denied"),
    );
    expect(within(treeRow(`${ROOT}/src/beta.ts`)).getByRole("img", { name: "Cut" })).toBeTruthy();
    treeKey("p");
    await waitFor(() => expect(log.transfer).toHaveBeenCalledTimes(2));
  });

  it("tree-operations AC3 paste: shared progress and cancellation remain reachable from tree", async () => {
    const log = await openOperationsTree();
    treeKey("y");
    await selectTreePath(`${ROOT}/empty`);
    log.holdNextTransfer();
    treeKey("p");
    const progress = await screen.findByTestId("transfer-progress");
    act(() => log.emitProgress(log.transferIds.at(-1) ?? "", 3, 7));
    expect(progress.textContent).toContain("3 of 7");
    fireEvent.click(within(progress).getByTestId("cancel-transfer"));
    await waitFor(() => expect(log.ops).toContain(`cancel ${log.transferIds.at(-1)}`));
  });

  it.each(["Miller to tree", "tree to Miller", "tree to another tab"])(
    "tree-operations AC3 clipboard: shared clipboard crosses %s",
    async (direction) => {
      const log = await openOperationsTree();
      if (direction === "Miller to tree") {
        treeKey("Escape");
        const row = within(screen.getByTestId("column-current"))
          .getByText("notes.txt")
          .closest('[data-testid="row"]');
        if (!row) throw new Error("Missing Miller fixture row");
        fireEvent.click(row);
        treeKey("y");
        treeKey("e", true);
        await selectTreePath(`${ROOT}/empty`);
      } else {
        await selectTreePath(DEEP_FILE);
        treeKey("y");
        if (direction === "tree to Miller") treeKey("Escape");
        else {
          treeKey("t");
          treeKey("e", true);
          await selectTreePath(`${ROOT}/empty`);
        }
      }
      treeKey("p");
      await waitFor(() =>
        expect(log.transfer).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            sources: [direction === "Miller to tree" ? `${ROOT}/notes.txt` : DEEP_FILE],
            destination: direction === "tree to Miller" ? ROOT : `${ROOT}/empty`,
          }),
        ),
      );
    },
  );
});

describe("tree operations marking fence", () => {
  it("tree-operations AC4 marks: real rows in different folders keep visible marks and the correct status count", async () => {
    await openOperationsTree();
    await mark(DEEP_FILE);
    await mark(`${ROOT}/notes.txt`);
    expect(marked(DEEP_FILE)).toBe(true);
    expect(marked(`${ROOT}/notes.txt`)).toBe(true);
    expect(screen.getByTestId("status-bar").textContent).toContain("2 selected");
    await selectTreePath(DEEP_FILE);
    treeKey(" ");
    expect(marked(DEEP_FILE)).toBe(false);
    expect(screen.getByTestId("status-bar").textContent).toContain("1 selected");
  });

  it("tree-operations AC4 marks: collapse retains hidden marks and delete uses the cross-folder marked paths", async () => {
    const log = await openOperationsTree();
    await mark(DEEP_FILE);
    await mark(`${ROOT}/notes.txt`);
    await selectTreePath(`${ROOT}/src`);
    treeKey("h");
    treeKey("d");
    const dialog = screen.getByTestId("modal-delete");
    expect(dialog.textContent).toContain("İinteresting long filename.md");
    expect(dialog.textContent).toContain("notes.txt");
    await confirmTreeDialog("delete");
    await waitFor(() =>
      expect(log.trash).toHaveBeenCalledExactlyOnceWith({
        paths: [DEEP_FILE, `${ROOT}/notes.txt`],
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("modal-delete")).toBeNull());
    expect(screen.getByTestId("status-bar").textContent).not.toContain("selected");
    expect(selectedPath()).toBeTruthy();
  });

  it.each(["d", "y", "x"])(
    "tree-operations AC3 marks: %s normalizes parent and child marks to one mutation",
    async (key) => {
      const log = await openOperationsTree();
      await mark(DEEP_FILE);
      await mark(`${ROOT}/src`);
      expect(marked(DEEP_FILE)).toBe(true);
      expect(marked(`${ROOT}/src`)).toBe(true);
      expect(screen.getByTestId("status-bar").textContent).toContain("2 selected");
      treeKey(key);
      if (key === "d") {
        expect(screen.getByTestId("modal-delete")).toBeTruthy();
        await confirmTreeDialog("delete");
        await waitFor(() =>
          expect(log.trash).toHaveBeenCalledExactlyOnceWith({ paths: [`${ROOT}/src`] }),
        );
      } else {
        await selectTreePath(`${ROOT}/empty`);
        treeKey("p");
        await waitFor(() =>
          expect(log.transfer).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ sources: [`${ROOT}/src`] }),
          ),
        );
      }
    },
  );

  it("tree-operations AC4 marks: Escape clears marks before a second Escape exits tree", async () => {
    await openOperationsTree();
    await mark(DEEP_FILE);
    treeKey("Escape");
    expect(screen.getByRole("tree")).toBeTruthy();
    expect(marked(DEEP_FILE)).toBe(false);
    treeKey("Escape");
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("tree-operations AC4 marks: the configured root cannot become a marked mutation target", async () => {
    await openOperationsTree();
    await mark(ROOT);
    expect(marked(ROOT)).toBe(false);
    expect(screen.getByTestId("status-bar").textContent).not.toContain("1 selected");
    await mark(DEEP_FILE);
    expect(marked(DEEP_FILE)).toBe(true);
  });

  it("tree-operations AC4 marks: tab and mode switches keep each tree selection separate from Miller", async () => {
    await openOperationsTree();
    await mark(DEEP_FILE);
    fireEvent.click(screen.getByRole("button", { name: "Miller · Esc" }));
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByTestId("column-current").querySelector("[data-marked]")).toBeNull();
    treeKey("e", true);
    await waitFor(() => expect(marked(DEEP_FILE)).toBe(true));
    treeKey("t");
    treeKey("e", true);
    await selectTreePath(DEEP_FILE);
    expect(marked(DEEP_FILE)).toBe(false);
    expect(screen.getByTestId("status-bar").textContent).not.toContain("1 selected");
    activateTreeTab(0);
    await waitFor(() => expect(marked(DEEP_FILE)).toBe(true));
    expect(screen.getByTestId("status-bar").textContent).toContain("1 selected");
  });
});

describe("tree operations text clipboard fence", () => {
  it.each([
    ["c", DEEP_FILE, DEEP_FILE],
    ["f", DEEP_FILE, "İinteresting long filename.md"],
    ["n", DEEP_FILE, "İinteresting long filename"],
    ["d", DEEP_FILE, DEEP_FOLDER],
    ["d", DEEP_FOLDER, DEEP_FOLDER],
    ["d", ROOT, ROOT],
  ])(
    "tree-operations AC5 text: c-%s on %s copies %s without reading Miller",
    async (key, path, text) => {
      const log = await openOperationsTree();
      await selectTreePath(path);
      treeKey("c");
      treeKey(key);
      await waitFor(() =>
        expect(log.clipboard).toHaveBeenCalledExactlyOnceWith({ kind: "text", text }),
      );
    },
  );

  it.each([
    ["c", `${DEEP_FILE}\n${ROOT}/notes.txt`],
    ["f", "İinteresting long filename.md\nnotes.txt"],
    ["n", "İinteresting long filename\nnotes"],
  ])(
    "tree-operations AC5 text: c-%s formats cross-folder marked paths with the shared newline rule",
    async (key, text) => {
      const log = await openOperationsTree();
      await mark(DEEP_FILE);
      await mark(`${ROOT}/notes.txt`);
      treeKey("c");
      treeKey(key);
      await waitFor(() =>
        expect(log.clipboard).toHaveBeenCalledExactlyOnceWith({ kind: "text", text }),
      );
    },
  );

  it("tree-operations AC5 image: the tree copy menu omits image bytes even when inactive Miller previews an image", async () => {
    const log = installTreeBridge();
    log.entries.set(`${ROOT}/pictures`, [treeEntry("shot.png")]);
    render(<App startPath={`${ROOT}/pictures`} />);
    await waitFor(() => expect(log.described).toContain(`${ROOT}/pictures/shot.png`));
    await act(async () => undefined);
    treeKey("e", true);
    await screen.findByRole("tree");
    treeKey("c");
    const menu = screen.getByTestId("which-key");
    expect(menu.textContent).toContain("File path");
    expect(menu.textContent).not.toContain("Image to clipboard");
    treeKey("i");
    expect(log.clipboard).not.toHaveBeenCalled();
  });
});

describe("tree operations async ownership fence", () => {
  it("tree-operations AC3 ownership: a completed old cut cannot consume a newer yank clipboard", async () => {
    const log = await openOperationsTree();
    treeKey("x");
    await selectTreePath(`${ROOT}/empty`);
    const held = deferred();
    log.transfer.mockImplementationOnce(async () => {
      await held.promise;
      return { ok: true, value: { moved: 1, conflicts: [] } };
    });
    treeKey("p");
    await waitFor(() => expect(log.transfer).toHaveBeenCalledTimes(1));
    await selectTreePath(`${ROOT}/notes.txt`);
    treeKey("y");
    await act(async () => held.resolve());
    expect(within(treeRow(`${ROOT}/notes.txt`)).getByRole("img", { name: "Yanked" })).toBeTruthy();
    await selectTreePath(`${ROOT}/empty`);
    treeKey("p");
    await waitFor(() =>
      expect(log.transfer).toHaveBeenLastCalledWith(
        expect.objectContaining({ sources: [`${ROOT}/notes.txt`], mode: "copy" }),
      ),
    );
  });

  it.each(OWNERSHIP_CASES)(
    "tree-operations AC6 ownership: a pending %s %s reply preserves a replacement create dialog",
    async (operation, outcome) => {
      const log = await openOperationsTree();
      const held = deferred();
      await startHeldOperation(log, operation, outcome, held);
      // Preserve the original controller while another dialog opens and closes.
      if (operation === "paste") await renameTreeInput();
      treeKey("Escape");
      await selectTreePath(`${ROOT}/notes.txt`);
      treeKey(" ");
      treeKey("a");
      const replacement = screen.getByTestId("dialog-name");
      fireEvent.change(replacement, { target: { value: "keep-me.txt" } });
      const reads = log.overview.mock.calls.length;
      await act(async () => held.resolve());
      expect(screen.getByTestId("modal-create")).toBeTruthy();
      expect(screen.getByTestId("dialog-name")).toBe(replacement);
      expect(replacement).toHaveProperty("value", "keep-me.txt");
      expect(selectedPath()).toBe(`${ROOT}/notes.txt`);
      expect(marked(`${ROOT}/notes.txt`)).toBe(true);
      if (outcome === "success")
        await waitFor(() => expect(log.overview.mock.calls.length).toBeGreaterThan(reads));
      else expect(log.overview.mock.calls.length).toBe(reads);
      if (outcome === "failure")
        expect(screen.getByTestId("pane-message").textContent).toContain("old operation failed");
      if (outcome === "conflict")
        expect(screen.getByTestId("pane-message").textContent).toContain("beta.ts");
    },
  );

  it.each(OWNERSHIP_CASES)(
    "tree-operations AC6 ownership: a pending %s %s reply cannot refresh or select another tree tab",
    async (operation, outcome) => {
      const log = await openOperationsTree();
      await addSecondTreeTab();
      await selectTreePath(DEEP_FILE);
      const held = deferred();
      await startHeldOperation(log, operation, outcome, held);
      activateTreeTab(1);
      await selectTreePath(`${ROOT}/notes.txt`);
      const reads = log.overview.mock.calls.length;
      await act(async () => held.resolve());
      expect(selectedPath()).toBe(`${ROOT}/notes.txt`);
      expect(log.overview.mock.calls.length).toBe(reads);
      expect(screen.getByRole("tree")).toBeTruthy();
    },
  );

  it("tree-operations AC4 ownership: trash reconciles its old marks without erasing newly changed marks or cursor", async () => {
    const log = await openOperationsTree();
    await mark(DEEP_FILE);
    const held = deferred();
    const originalTrash = log.trash.getMockImplementation();
    if (!originalTrash) throw new Error("Missing trash fixture");
    log.trash.mockImplementationOnce(async (request) => {
      await held.promise;
      return originalTrash(request);
    });
    treeKey("d");
    expect(screen.getByTestId("modal-delete")).toBeTruthy();
    await confirmTreeDialog("delete");
    treeKey("Escape");
    await mark(`${ROOT}/notes.txt`);
    await selectTreePath(`${ROOT}/empty`);
    await act(async () => held.resolve());
    await waitFor(() =>
      expect(screen.getByRole("tree").querySelector(`[data-path="${DEEP_FILE}"]`)).toBeNull(),
    );
    expect(marked(`${ROOT}/notes.txt`)).toBe(true);
    expect(selectedPath()).toBe(`${ROOT}/empty`);
  });
});

describe("tree operations help fence", () => {
  it("tree-operations AC6 help: exposes supported file operations and four text copy chords from App", async () => {
    await openOperationsTree();
    treeKey("?");
    const help = screen.getByRole("dialog", { name: "Keyboard help" });
    for (const label of ["Trash", "Rename", "Yank (copy)", "Cut", "Paste", "Select / mark"])
      expect(help.textContent).toContain(label);
    for (const chord of ["cc", "cf", "cn", "cd"])
      expect(within(help).getByText(chord)).toBeTruthy();
    expect(help.textContent).not.toContain("Image to clipboard");
    expect(help.textContent).not.toContain("Expand preview");
  });
});

describe("tree operations new preservation guards", () => {
  it("tree-operations guard: search inputs own operation letters and Space", async () => {
    const log = await openOperationsTree();
    treeKey("/");
    const input = screen.getByRole("textbox", { name: "Search loaded paths" });
    for (const key of ["d", "r", "y", "x", "p", " ", "c"])
      expect(fireEvent.keyDown(input, { key })).toBe(true);
    expect(screen.queryByTestId("modal-delete")).toBeNull();
    expect(screen.queryByTestId("modal-rename")).toBeNull();
    expect(log.trash).not.toHaveBeenCalled();
    expect(log.rename).not.toHaveBeenCalled();
    expect(log.transfer).not.toHaveBeenCalled();
    expect(log.clipboard).not.toHaveBeenCalled();
  });

  it("tree-operations guard: flash captures operation letters before the shared registry", async () => {
    const log = await openOperationsTree();
    treeKey("s");
    expect(screen.getByRole("status", { name: "Flash navigation" })).toBeTruthy();
    treeKey("d");
    expect(screen.queryByTestId("modal-delete")).toBeNull();
    expect(log.trash).not.toHaveBeenCalled();
    expect(screen.getByRole("tree")).toBeTruthy();
  });
});
