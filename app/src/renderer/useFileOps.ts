import type { TransferMode } from "@symmetria/fm-core/contract";
import { isFailure } from "@symmetria/fm-core/contract";
import { entryAt, joinPath } from "@symmetria/fm-core/pane";
import { useCallback, useMemo, useState } from "react";

import {
  cancelTransfer,
  createPath,
  onTransferProgress,
  openPath,
  renamePath,
  transferEntries,
  trashPaths,
} from "./bridge.ts";
import type { Tabs } from "./useTabs.ts";

/**
 * The file operations, and the dialogs that gate them.
 *
 * ── Three things the Qt build did not have ──────────────────────────────────
 * A conflict prompt, progress for a large copy, and cancellation. All three
 * were out of reach there because every operation shelled out to `cp`, `mv` or
 * `gio trash` and the result was inferred from an exit code. In-process, they
 * are nearly free — and a paste that silently overwrote was the sharpest edge
 * the original had.
 *
 * ── The clipboard bug that does not exist here ──────────────────────────────
 * The Qt build copies by spawning a helper that must stay alive to serve the
 * Wayland selection, and it dies when the window closes — the documented
 * "copies but paste fails" defect. This clipboard is plain state in a resident
 * renderer. Do NOT port the workaround.
 *
 * Undo is deliberately absent. It is a larger design than this cycle, and a
 * half-undo is worse than none.
 */

/** What was taken, and what a paste will do with it. */
interface Clipboard {
  readonly paths: readonly string[];
  readonly mode: TransferMode;
}

export type OpsModal =
  | { readonly kind: "none" }
  | { readonly kind: "delete"; readonly paths: readonly string[] }
  | {
      readonly kind: "rename";
      readonly path: string;
      readonly name: string;
      /**
       * How much of the name to preselect.
       *
       * The stem, for a plain rename: the extension is almost never what
       * changes, and having to skip past it every time is what `⇧R` exists to
       * opt out of.
       */
      readonly selectTo: number;
    }
  | { readonly kind: "create" }
  | {
      readonly kind: "conflict";
      readonly conflicts: readonly string[];
      readonly clipboard: Clipboard;
      readonly destination: string;
    };

interface TransferProgressState {
  readonly done: number;
  readonly total: number;
  readonly transferId: string;
}

export interface FileOps {
  readonly modal: OpsModal;
  readonly clipboard: Clipboard | null;
  readonly progress: TransferProgressState | null;
  readonly message: string | null;

  closeModal(): void;
  clearMessage(): void;

  yank(): void;
  cut(): void;
  paste(): void;
  requestDelete(): void;
  requestRename(withExtension: boolean): void;
  requestCreate(): void;
  open(): void;
  /** Hand the entry at this index to the desktop, whatever is marked. */
  openAt(index: number): void;

  confirmDelete(): void;
  confirmRename(name: string): void;
  confirmCreate(name: string): void;
  confirmOverwrite(): void;
  cancelRunningTransfer(): void;
}

/** Where the extension starts, or the whole length when there is none. */
function stemLength(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

let nextTransfer = 0;

export function useFileOps(tabs: Tabs): FileOps {
  const [modal, setModal] = useState<OpsModal>({ kind: "none" });
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [progress, setProgress] = useState<TransferProgressState | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pane = tabs.pane;

  /**
   * What an operation acts on.
   *
   * The marked entries when there are any, otherwise the entry under the
   * cursor. That precedence is what makes marking worth doing, and it is the
   * rule the Qt build used for every clipboard and delete operation.
   */
  const targets = useMemo(() => {
    const marked = [...pane.selection];
    if (marked.length > 0) return marked.map((name) => `${pane.path}/${name}`);

    const cursor = pane.entries[pane.cursorIndex];
    return cursor === undefined ? [] : [`${pane.path}/${cursor.name}`];
  }, [pane]);

  /** Hand one path to the desktop, reporting a refusal in the status strip. */
  const openOne = useCallback((path: string) => {
    void openPath(path).then((reply) => {
      if (isFailure(reply)) setMessage(reply.error.message);
    });
  }, []);

  const take = useCallback(
    (mode: TransferMode) => {
      if (targets.length === 0) return;

      setClipboard({ paths: targets, mode });
      setMessage(`${targets.length} ${mode === "copy" ? "yanked" : "cut"}`);
      tabs.clearMarks();
    },
    [targets, tabs],
  );

  const runTransfer = useCallback((source: Clipboard, destination: string, overwrite: boolean) => {
    const transferId = `t${nextTransfer++}`;
    setProgress({ done: 0, total: source.paths.length, transferId });

    // Followed, not guessed. The main process ticks per entry, so a transfer of
    // one large directory reports honestly instead of jumping from nothing to
    // done — and the subscription is released whatever the outcome.
    const stopFollowing = onTransferProgress(transferId, (done, total) => {
      setProgress({ done, total, transferId });
    });

    void transferEntries({
      sources: source.paths,
      destination,
      mode: source.mode,
      overwrite,
      transferId,
    }).then((reply) => {
      stopFollowing();
      setProgress(null);

      if (isFailure(reply)) {
        setMessage(reply.error.message);
        return;
      }

      if (reply.value.conflicts.length > 0) {
        setModal({
          kind: "conflict",
          conflicts: reply.value.conflicts,
          clipboard: source,
          destination,
        });
        return;
      }

      setModal({ kind: "none" });
      // A move consumes what it took; a copy does not, so the same yank can
      // be pasted into several directories.
      if (source.mode === "move") setClipboard(null);
      setMessage(`${reply.value.moved} ${source.mode === "copy" ? "copied" : "moved"}`);
    });
  }, []);

  const paste = useCallback(() => {
    if (clipboard === null) {
      setMessage("nothing to paste");
      return;
    }
    runTransfer(clipboard, pane.path, false);
  }, [clipboard, pane.path, runTransfer]);

  const confirmOverwrite = useCallback(() => {
    if (modal.kind !== "conflict") return;
    runTransfer(modal.clipboard, modal.destination, true);
  }, [modal, runTransfer]);

  const requestRename = useCallback(
    (withExtension: boolean) => {
      const cursor = pane.entries[pane.cursorIndex];
      if (cursor === undefined) return;

      setModal({
        kind: "rename",
        path: `${pane.path}/${cursor.name}`,
        name: cursor.name,
        selectTo: withExtension ? cursor.name.length : stemLength(cursor.name),
      });
    },
    [pane],
  );

  const confirmRename = useCallback(
    (name: string) => {
      if (modal.kind !== "rename") return;

      void renamePath(modal.path, name).then((reply) => {
        if (isFailure(reply)) {
          setMessage(reply.error.message);
          return;
        }
        setModal({ kind: "none" });
      });
    },
    [modal],
  );

  const confirmCreate = useCallback(
    (name: string) => {
      // A trailing separator is how the create dialog says "a directory" —
      // the same convention a shell uses, and it needs no second control.
      const kind = name.endsWith("/") ? "directory" : "file";
      const trimmed = name.replace(/\/+$/, "");
      if (trimmed === "") return;

      void createPath({ path: `${pane.path}/${trimmed}`, kind }).then((reply) => {
        if (isFailure(reply)) {
          setMessage(reply.error.message);
          return;
        }
        setModal({ kind: "none" });
      });
    },
    [pane.path],
  );

  const confirmDelete = useCallback(() => {
    if (modal.kind !== "delete") return;
    const paths = modal.paths;

    void trashPaths(paths).then((reply) => {
      setModal({ kind: "none" });
      setMessage(isFailure(reply) ? reply.error.message : `${paths.length} trashed`);
      tabs.clearMarks();
    });
  }, [modal, tabs]);

  return {
    modal,
    clipboard,
    progress,
    message,

    closeModal: () => setModal({ kind: "none" }),
    clearMessage: () => setMessage(null),

    yank: () => take("copy"),
    cut: () => take("move"),
    paste,
    requestDelete: () => {
      if (targets.length > 0) setModal({ kind: "delete", paths: targets });
    },
    requestRename,
    requestCreate: () => setModal({ kind: "create" }),
    open: () => {
      const target = targets[0];
      if (target !== undefined) openOne(target);
    },
    // A click names its own target, so it cannot go through `targets` — that
    // resolves to the marked entries or the cursor, and a double click on an
    // unmarked row while three others are marked must open the row, not the
    // three.
    openAt: (index) => {
      const entry = entryAt(pane, index);
      if (entry !== null) openOne(joinPath(pane.path, entry.name));
    },

    confirmDelete,
    confirmRename,
    confirmCreate,
    confirmOverwrite,
    cancelRunningTransfer: () => {
      if (progress !== null) cancelTransfer(progress.transferId);
    },
  };
}
