import { clipboardText } from "@symmetria/fm-core/clipboard";
import { isFailure, type Result, type TransferMode } from "@symmetria/fm-core/contract";
import type { CopyTarget } from "@symmetria/fm-core/keys/types";
import { entryAt, joinPath } from "@symmetria/fm-core/pane";
import { useCallback, useState } from "react";
import { openPath, copyToClipboard as sendToClipboard } from "./bridge.ts";
import type { CreateTarget, OpsModal } from "./fileOps/modal.ts";
import type { Clipboard, OperationTarget } from "./fileOps/targets.ts";
import { refuseProtectedRoot, useOperationDialogs } from "./fileOps/useOperationDialogs.ts";
import { usePaneTarget } from "./fileOps/usePaneTarget.ts";
import { useTransfers } from "./fileOps/useTransfers.ts";
import type { Tabs } from "./useTabs.ts";

export type { CreateTarget, OpsModal } from "./fileOps/modal.ts";

/** All views use the same filesystem, clipboard, and confirmation implementations. */
export interface FileOps {
  readonly modal: OpsModal;
  readonly clipboard: Clipboard | null;
  readonly progress: ReturnType<typeof useTransfers>["progress"];
  readonly message: string | null;
  closeModal(): void;
  clearMessage(): void;
  yank(target?: OperationTarget): void;
  cut(target?: OperationTarget): void;
  paste(target?: OperationTarget): void;
  requestDelete(target?: OperationTarget): void;
  requestRename(withExtension: boolean, target?: OperationTarget): void;
  requestCreate(target?: CreateTarget): void;
  open(): void;
  openAt(index: number): void;
  openAbsolute(path: string): void;
  copyToClipboard(target: CopyTarget, source?: OperationTarget): void;
  confirmDelete(): void;
  confirmRename(name: string): void;
  confirmCreate(name: string): void;
  confirmOverwrite(): void;
  cancelRunningTransfer(): void;
}

/**
 * All views share one resident renderer clipboard. The Qt build spawned a
 * Wayland clipboard helper that had to stay alive to serve the selection.
 * That lifetime bug does not exist here. Do NOT port its workaround.
 *
 * Undo is deliberately absent. It requires a larger design than this cycle;
 * a partial undo implementation would misrepresent what can be recovered.
 */
export function useFileOps(tabs: Tabs, viewKey = "miller"): FileOps {
  const [message, setMessage] = useState<string | null>(null);
  const target = usePaneTarget(tabs, viewKey);
  const dialogs = useOperationDialogs(setMessage);
  const transfers = useTransfers(dialogs, setMessage);
  const report = useCallback(async (work: Promise<Result<unknown>>) => {
    const reply = await work;
    if (isFailure(reply)) setMessage(reply.error.message);
  }, []);
  const openOne = (path: string) => {
    void report(openPath(path));
  };
  const take = (mode: TransferMode, source: OperationTarget) => {
    if (source.paths.length === 0) return;
    if (mode === "move" && refuseProtectedRoot(source, source.paths, setMessage)) return;
    transfers.take({ paths: source.paths, mode, source });
    setMessage(`${source.paths.length} ${mode === "copy" ? "yanked" : "cut"}`);
    source.clearMarks();
  };
  return {
    modal: dialogs.modal,
    clipboard: transfers.clipboard,
    progress: transfers.progress,
    message,
    closeModal: dialogs.close,
    clearMessage: () => setMessage(null),
    yank: (source = target) => take("copy", source),
    cut: (source = target) => take("move", source),
    paste: (destination = target) => transfers.paste(destination),
    requestDelete: (source = target) => dialogs.requestDelete(source),
    requestRename: (withExtension, source = target) => dialogs.requestRename(withExtension, source),
    requestCreate: (destination = { directory: tabs.pane.path }) =>
      dialogs.requestCreate(destination),
    openAbsolute: openOne,
    open: () => {
      const path = target.paths[0];
      if (path !== undefined) openOne(path);
    },
    openAt: (index) => {
      // A double click names its own row. Routing through marked targets would
      // open marked entries instead of the unmarked row that the user clicked.
      const entry = entryAt(tabs.pane, index);
      if (entry !== null) openOne(joinPath(tabs.pane.path, entry.name));
    },
    copyToClipboard: (kind, source = target) => {
      if (kind !== "imageBytes") {
        void report(
          sendToClipboard({
            kind: "text",
            text: clipboardText(kind, source.paths, source.directory),
          }),
        );
        return;
      }
      // An image always comes from the cursor, never the selection: the clipboard
      // holds one image, and choosing one of several marked files would be a guess.
      // The active key context validates Miller preview metadata before this call.
      if (!source.supportsImageBytes || source.cursor === null) return;
      void report(sendToClipboard({ kind: "image", path: source.cursor.path }));
    },
    confirmDelete: dialogs.confirmDelete,
    confirmRename: dialogs.confirmRename,
    confirmCreate: dialogs.confirmCreate,
    confirmOverwrite: transfers.confirmOverwrite,
    cancelRunningTransfer: transfers.cancelRunningTransfer,
  };
}
