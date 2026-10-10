/**
 * @vitest-environment happy-dom
 * UI entry point: App. These regressions exercise the review triggers through App.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { deferred } from "./deferred.ts";
import {
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
const SOURCE = `${ROOT}/src/beta.ts`;
const DESTINATION = `${ROOT}/empty`;

async function startCancelledCut(
  log: Awaited<ReturnType<typeof openOperationsTree>>,
  moved: number,
  parentMarked = false,
) {
  treeKey(" ");
  if (parentMarked) {
    await selectTreePath(`${ROOT}/src`);
    treeKey(" ");
  }
  await selectTreePath(`${ROOT}/notes.txt`);
  treeKey(" ");
  treeKey("x");
  await selectTreePath(DESTINATION);
  const held = deferred();
  const original = log.transfer.getMockImplementation();
  if (!original) throw new Error("Missing transfer fixture");
  log.transfer.mockImplementationOnce(async (request) => {
    await held.promise;
    if (moved === 0) return { ok: true, value: { moved: 0, conflicts: [] } };
    return original({ ...request, sources: request.sources.slice(0, moved) });
  });
  treeKey("p");
  await waitFor(() => expect(log.transfer).toHaveBeenCalledTimes(1));
  fireEvent.click(within(screen.getByTestId("transfer-progress")).getByTestId("cancel-transfer"));
  return held;
}

describe("tree operation review regressions", () => {
  it.each([0, 1])(
    "tree-operations regression P1-2 clipboard: a cancelled cut with %s moved preserves a newer yank and newer unmoved marks",
    async (moved) => {
      const log = await openOperationsTree();
      const held = await startCancelledCut(log, moved);
      const newerSource = `${ROOT}/src/nested/İinteresting long filename.md`;
      await selectTreePath(newerSource);
      treeKey("y");
      await selectTreePath(`${ROOT}/notes.txt`);
      treeKey(" ");
      await act(async () => held.resolve());
      await waitFor(() => expect(screen.queryByTestId("transfer-progress")).toBeNull());
      expect(treeRow(`${ROOT}/notes.txt`).hasAttribute("data-marked")).toBe(true);
      expect(within(treeRow(newerSource)).getByRole("img", { name: "Yanked" })).toBeTruthy();
      expect(within(treeRow(`${ROOT}/notes.txt`)).queryByRole("img", { name: "Cut" })).toBeNull();
      await selectTreePath(DESTINATION);
      treeKey("p");
      await waitFor(() =>
        expect(log.transfer).toHaveBeenLastCalledWith(
          expect.objectContaining({ sources: [newerSource], mode: "copy" }),
        ),
      );
    },
  );

  it("tree-operations review P3-2 guard: Miller image capability copies the cursor image when another entry is marked", async () => {
    const log = installTreeBridge();
    const directory = `${ROOT}/pictures`;
    log.entries.set(directory, [treeEntry("shot.png"), treeEntry("notes.txt")]);
    render(<App startPath={directory} />);
    await waitFor(() => expect(screen.getAllByTestId("row").length).toBeGreaterThan(0));
    const column = within(screen.getByTestId("column-current"));
    fireEvent.click(column.getByText("notes.txt"));
    treeKey(" ");
    fireEvent.click(column.getByText("shot.png"));
    await waitFor(() => expect(log.described).toContain(`${directory}/shot.png`));
    await act(async () => undefined);
    treeKey("c");
    treeKey("i");
    await waitFor(() =>
      expect(log.clipboard).toHaveBeenLastCalledWith({
        kind: "image",
        path: `${directory}/shot.png`,
      }),
    );
    expect(screen.getByTestId("column-current").querySelectorAll("[data-marked]")).toHaveLength(1);
  });

  it("tree-operations review P3-3 guard: Miller double click opens an unmarked row while another entry is marked", async () => {
    const log = installTreeBridge();
    render(<App startPath={ROOT} />);
    await waitFor(() => expect(screen.getAllByTestId("row").length).toBeGreaterThan(0));
    const column = within(screen.getByTestId("column-current"));
    fireEvent.click(column.getByText("src"));
    treeKey(" ");
    fireEvent.doubleClick(column.getByText("notes.txt"));
    await waitFor(() =>
      expect(log.open).toHaveBeenCalledExactlyOnceWith({ path: `${ROOT}/notes.txt` }),
    );
    expect(screen.getByTestId("column-current").querySelectorAll("[data-marked]")).toHaveLength(1);
  });

  it.each([
    [0, false],
    [1, false],
    [1, true],
  ] as const)(
    "tree-operations review P1-2 cancellation: a cut with %s moved and parent marks=%s retains unmoved clipboard paths and newer unmoved marks",
    async (moved, parentMarked) => {
      const log = await openOperationsTree();
      const held = await startCancelledCut(log, moved, parentMarked);
      await selectTreePath(`${ROOT}/notes.txt`);
      treeKey(" ");
      await act(async () => held.resolve());
      await waitFor(() => expect(screen.queryByTestId("transfer-progress")).toBeNull());
      expect(treeRow(`${ROOT}/notes.txt`).hasAttribute("data-marked")).toBe(true);
      expect(within(treeRow(`${ROOT}/notes.txt`)).getByRole("img", { name: "Cut" })).toBeTruthy();
      if (moved === 0)
        expect(within(treeRow(SOURCE)).getByRole("img", { name: "Cut" })).toBeTruthy();
      await selectTreePath(DESTINATION);
      treeKey("p");
      await waitFor(() =>
        expect(log.transfer).toHaveBeenLastCalledWith(
          expect.objectContaining({
            sources: moved === 0 ? [SOURCE, `${ROOT}/notes.txt`] : [`${ROOT}/notes.txt`],
            mode: "move",
          }),
        ),
      );
    },
  );

  it("tree-operations review P2-1: StrictMode first paste works before any dialog opens", async () => {
    const log = installTreeBridge();
    render(
      <StrictMode>
        <App startPath={ROOT} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getAllByTestId("row").length).toBeGreaterThan(0));
    treeKey("e", true);
    await selectTreePath(SOURCE);
    treeKey("y");
    await selectTreePath(DESTINATION);
    treeKey("p");
    await waitFor(() => expect(log.ops).toContain(`copy ${SOURCE} -> ${DESTINATION}`));
    await waitFor(() => expect(screen.getByTestId("pane-message").textContent).toContain("copied"));
  });

  it("tree-operations review P2-2: tree help omits stored bookmarks that Miller still advertises", async () => {
    installTreeBridge();
    Object.assign(window.symmetriaFm ?? {}, {
      bookmarksRead: async () => ({
        ok: true,
        value: {
          bookmarks: [{ letter: "d", bookmark: { path: `${ROOT}/Downloads`, label: "Downloads" } }],
        },
      }),
    });
    render(<App startPath={ROOT} />);
    await waitFor(() => expect(screen.getAllByTestId("row").length).toBeGreaterThan(0));
    treeKey("?");
    const miller = screen.getByRole("dialog", { name: "Keyboard help" });
    await waitFor(() => expect(within(miller).getByText("gd")).toBeTruthy());
    treeKey("Escape");
    treeKey("e", true);
    await screen.findByRole("tree");
    treeKey("?");
    const tree = screen.getByRole("dialog", { name: "Keyboard help" });
    expect(within(tree).queryByText("gd")).toBeNull();
    expect(within(tree).queryByText("Downloads")).toBeNull();
    expect(within(tree).getByText("gg")).toBeTruthy();
  });

  it.each(["success", "failure", "conflict"] as const)(
    "tree-operations review P1-2: paste %s survives opening then cancelling rename",
    async (outcome) => {
      const log = await openOperationsTree();
      const held = deferred();
      const original = log.transfer.getMockImplementation();
      if (!original) throw new Error("Missing transfer fixture");
      log.transfer.mockImplementationOnce(async (request) => {
        await held.promise;
        if (outcome === "failure")
          return { ok: false, error: { code: "write_failed", message: "pending paste failed" } };
        if (outcome === "conflict")
          return { ok: true, value: { moved: 0, conflicts: ["beta.ts"] } };
        return original(request);
      });
      treeKey("y");
      await selectTreePath(DESTINATION);
      treeKey("p");
      await waitFor(() => expect(log.transfer).toHaveBeenCalledTimes(1));
      await renameTreeInput();
      treeKey("Escape");
      await act(async () => held.resolve());
      if (outcome === "success") {
        await waitFor(() => treeRow(`${DESTINATION}/beta.ts`));
        expect(screen.getByTestId("pane-message").textContent).toContain("copied");
      } else if (outcome === "failure") {
        expect(screen.getByTestId("pane-message").textContent).toContain("pending paste failed");
      } else {
        const conflict = await screen.findByTestId("modal-conflict");
        expect(conflict.textContent).toContain("beta.ts");
        await selectTreePath(`${ROOT}/notes.txt`);
        await confirmTreeDialog("conflict");
        await waitFor(() =>
          expect(log.transfer).toHaveBeenLastCalledWith(
            expect.objectContaining({ destination: DESTINATION, overwrite: true }),
          ),
        );
      }
    },
  );

  it("tree-operations review P1-2: a cancelled pending trash still reports its failure in the original tree", async () => {
    const log = await openOperationsTree();
    const held = deferred();
    log.trash.mockImplementationOnce(async () => {
      await held.promise;
      return { ok: false, error: { code: "write_failed", message: "pending trash failed" } };
    });
    treeKey("d");
    await confirmTreeDialog("delete");
    treeKey("Escape");
    await renameTreeInput();
    treeKey("Escape");
    await act(async () => held.resolve());
    expect(screen.getByTestId("pane-message").textContent).toContain("pending trash failed");
    expect(screen.queryByTestId("modal-delete")).toBeNull();
    expect(treeRow(SOURCE)).toBeTruthy();
  });

  it.each(["trash", "rename"] as const)(
    "tree-operations review P1-2: %s reconciles real entries and marks while replacement create remains open",
    async (operation) => {
      const log = await openOperationsTree();
      treeKey(" ");
      const held = deferred();
      if (operation === "trash") {
        const original = log.trash.getMockImplementation();
        if (!original) throw new Error("Missing trash fixture");
        log.trash.mockImplementationOnce(async (request) => {
          await held.promise;
          return original(request);
        });
        treeKey("d");
        await confirmTreeDialog("delete");
      } else {
        const original = log.rename.getMockImplementation();
        if (!original) throw new Error("Missing rename fixture");
        log.rename.mockImplementationOnce(async (request) => {
          await held.promise;
          return original(request);
        });
        submitTreeName(await renameTreeInput(), "renamed.ts");
      }
      treeKey("Escape");
      await selectTreePath(`${ROOT}/notes.txt`);
      treeKey(" ");
      treeKey("a");
      const replacement = screen.getByTestId("dialog-name");
      fireEvent.change(replacement, { target: { value: "replacement.txt" } });
      await act(async () => held.resolve());
      await waitFor(() =>
        expect(screen.getByRole("tree").querySelector(`[data-path="${SOURCE}"]`)).toBeNull(),
      );
      expect(screen.getByTestId("dialog-name")).toBe(replacement);
      expect(replacement).toHaveProperty("value", "replacement.txt");
      expect(treeRow(`${ROOT}/notes.txt`).hasAttribute("data-marked")).toBe(true);
      expect(treeRow(`${ROOT}/notes.txt`).getAttribute("aria-selected")).toBe("true");
      if (operation === "rename") expect(treeRow(`${ROOT}/src/renamed.ts`)).toBeTruthy();
      treeKey("Escape");
      treeKey("c");
      treeKey("c");
      await waitFor(() =>
        expect(log.clipboard).toHaveBeenLastCalledWith({ kind: "text", text: `${ROOT}/notes.txt` }),
      );
    },
  );

  it("tree-operations review P3-1: Space during removal refresh marks the published row rather than the removed cursor", async () => {
    const log = await openOperationsTree();
    const held = deferred();
    const original = log.overview.getMockImplementation();
    if (!original) throw new Error("Missing overview fixture");
    log.overview.mockImplementation(async (request) => {
      if (request.path === DESTINATION) await held.promise;
      return original(request);
    });
    treeKey("d");
    await confirmTreeDialog("delete");
    await waitFor(() =>
      expect(
        screen.getByRole("tree").querySelector('[aria-selected="true"]')?.getAttribute("data-path"),
      ).toBe(ROOT),
    );
    treeKey(" ");
    expect(screen.getByRole("tree").querySelector("[data-marked]")).toBeNull();
    expect(screen.getByTestId("status-bar").textContent).not.toContain("1 selected");
    treeKey("c");
    treeKey("c");
    await waitFor(() =>
      expect(log.clipboard).toHaveBeenLastCalledWith({ kind: "text", text: ROOT }),
    );
    await act(async () => held.resolve());
  });
});
