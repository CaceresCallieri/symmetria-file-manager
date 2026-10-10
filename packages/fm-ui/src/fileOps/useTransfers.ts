import { isFailure } from "@symmetria/fm-core/contract";
import { isAncestorPath } from "@symmetria/fm-core/overview/model";
import { useRef, useState } from "react";
import { cancelTransfer, onTransferProgress, transferEntries } from "../bridge.ts";
import { type Clipboard, mutationPaths, type OperationTarget } from "./targets.ts";
import type { useOperationDialogs } from "./useOperationDialogs.ts";

interface TransferProgressState {
  readonly done: number;
  readonly total: number;
  readonly transferId: string;
}
let nextTransfer = 0;

function clipboardAfterMove(source: Clipboard, moved: readonly string[]): Clipboard | null {
  if (moved.length === 0) return source;
  const paths = source.paths.filter((path) => !moved.some((root) => isAncestorPath(root, path)));
  return paths.length === 0 ? null : { ...source, paths };
}

/** One transfer implementation serves every view and preserves captured destinations. */
export function useTransfers(
  dialogs: ReturnType<typeof useOperationDialogs>,
  setMessage: (message: string) => void,
) {
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [progress, setProgress] = useState<TransferProgressState | null>(null);
  const currentTransfer = useRef<string | null>(null);

  const run = (source: Clipboard, target: OperationTarget, overwrite: boolean) => {
    const owner = dialogs.current();
    if (owner === null) return;
    const transferId = `t${nextTransfer++}`;
    currentTransfer.current = transferId;
    const sources = mutationPaths(source.paths);
    const completeDestination = target.captureCompletion();
    const completeSource = source.source.captureCompletion();
    setProgress({ done: 0, total: sources.length, transferId });
    const stopFollowing = onTransferProgress(transferId, (done, total) => {
      if (currentTransfer.current === transferId) setProgress({ done, total, transferId });
    });
    const finishSuccess = (moved: number) => {
      const movedSources = sources.slice(0, moved);
      // A completed cut consumes only the clipboard object that started it.
      // Cancellation can move only a prefix; retain the unmoved cut paths.
      if (source.mode === "move")
        setClipboard((current) =>
          current === source ? clipboardAfterMove(source, movedSources) : current,
        );
      if (target.isCurrent()) {
        completeDestination({});
        setMessage(`${moved} ${source.mode === "copy" ? "copied" : "moved"}`);
      }
      if (source.mode === "move" && movedSources.length > 0 && source.source.isCurrent())
        completeSource({ removed: movedSources });
      if (dialogs.owns(owner)) dialogs.replace({ kind: "none" });
    };
    void transferEntries({
      sources,
      destination: target.directory,
      mode: source.mode,
      overwrite,
      transferId,
    }).then((reply) => {
      stopFollowing();
      if (currentTransfer.current === transferId) {
        currentTransfer.current = null;
        setProgress(null);
      }
      if (isFailure(reply)) {
        if (target.isCurrent()) setMessage(reply.error.message);
        return;
      }
      if (reply.value.conflicts.length > 0) {
        if (!target.isCurrent()) return;
        if (dialogs.current()?.kind === "none" || dialogs.owns(owner))
          dialogs.replace({
            kind: "conflict",
            conflicts: reply.value.conflicts,
            clipboard: source,
            destination: target.directory,
            target,
          });
        else
          setMessage(
            `Paste conflict: ${reply.value.conflicts.join(", ")}. Close the dialog and paste again.`,
          );
        return;
      }
      finishSuccess(reply.value.moved);
    });
  };
  return {
    clipboard,
    progress,
    take: (source: Clipboard) => setClipboard(source),
    paste: (target: OperationTarget) => {
      if (clipboard === null) setMessage("nothing to paste");
      else run(clipboard, target, false);
    },
    confirmOverwrite: () => {
      if (dialogs.modal.kind !== "conflict") return;
      run(dialogs.modal.clipboard, dialogs.modal.target, true);
    },
    cancelRunningTransfer: () => {
      if (progress !== null) cancelTransfer(progress.transferId);
    },
  };
}
