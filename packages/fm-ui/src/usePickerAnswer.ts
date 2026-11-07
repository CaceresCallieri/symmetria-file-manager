import { clipboardText } from "@symmetria/fm-core/clipboard";
import { isFailure, type Result, success } from "@symmetria/fm-core/contract";
import {
  type PickerSelectionContext,
  resolvePickerSelection,
} from "@symmetria/fm-core/pickerSelection";
import { useCallback, useEffect, useRef } from "react";
import { useFileManagerIo } from "./IoContext.tsx";

function resolveAnswer(
  fifo: string | null,
  context: PickerSelectionContext | null,
  editing: boolean,
) {
  if (fifo === null || context === null || editing) return null;
  const resolved = resolvePickerSelection(context);
  // A refusal is silent: the Accept button uses the same resolution.
  if (resolved.kind !== "paths") return null;
  return { fifo, paths: resolved.paths, directory: context.currentPath };
}

/** Copy and confirm one picker answer while its window remains alive. */
export function usePickerAnswer(
  fifo: string | null,
  context: PickerSelectionContext | null,
  editing: boolean,
) {
  const { pickerCancel, pickerConfirm, copyToClipboard } = useFileManagerIo();
  const answering = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const confirm = useCallback(
    async (copyPath: boolean, selection = context): Promise<Result<null>> => {
      const answer = resolveAnswer(fifo, selection, editing);
      if (answer === null || answering.current || cancelled.current) return success(null);
      answering.current = true;
      try {
        if (copyPath) {
          // Copying the browsing target here copied an unrelated highlighted
          // entry in save dialogs. Use the exact answer, including the edited
          // filename, and finish copying before confirmation closes the window.
          const copied = await copyToClipboard({
            kind: "text",
            text: clipboardText("path", answer.paths, answer.directory),
          });
          if (isFailure(copied)) return copied;
        }
        if (!cancelled.current) await pickerConfirm({ fifo: answer.fifo, paths: answer.paths });
        return success(null);
      } finally {
        answering.current = false;
      }
    },
    [fifo, context, editing, pickerConfirm, copyToClipboard],
  );

  const confirmIfActive = useCallback(() => void confirm(false), [confirm]);
  const confirmCopyingPath = useCallback(() => confirm(true), [confirm]);
  const confirmSelection = useCallback(
    (selection: PickerSelectionContext) => void confirm(false, selection),
    [confirm],
  );
  const cancelIfActive = useCallback(() => {
    if (fifo === null) return;
    cancelled.current = true;
    void pickerCancel({ fifo });
  }, [fifo, pickerCancel]);

  return { confirmIfActive, confirmCopyingPath, confirmSelection, cancelIfActive };
}
