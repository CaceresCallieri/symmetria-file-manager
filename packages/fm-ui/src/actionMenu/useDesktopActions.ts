import type {
  ActionInspection,
  ActionRequest,
  ArchiveFormat,
  LaunchKind,
} from "@symmetria/fm-core/fileActions";
import { basename, parentOf } from "@symmetria/fm-core/pane";
import { useEffect, useRef, useState } from "react";
import type { OperationTarget } from "../fileOps/targets.ts";
import { useFileManagerIo } from "../IoContext.tsx";
import type { DesktopActionId } from "./model.ts";

export interface DesktopDialog {
  readonly action: DesktopActionId;
  readonly target: OperationTarget;
  readonly inspection: ActionInspection;
  readonly id: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly message: string | null;
}
interface DesktopOptions {
  readonly choice: string;
  readonly runner: LaunchKind;
  readonly destination: string;
  readonly format: ArchiveFormat;
  readonly makeExecutable: boolean;
  readonly prefix: string;
}
function requestFor(dialog: DesktopDialog, options: DesktopOptions): ActionRequest | null {
  const actions = {
    "open-with": "application",
    run: "run",
    "run-terminal": "run-terminal",
    terminal: "terminal",
    "extract-here": "extract",
    "extract-to": "extract",
    compress: "compress",
  } satisfies Record<Exclude<DesktopActionId, "properties" | "run-with">, ActionRequest["action"]>;
  if (dialog.action === "properties") return null;
  const action = dialog.action === "run-with" ? options.runner : actions[dialog.action];
  return { id: dialog.id, paths: dialog.target.paths, action, ...options };
}
function revealOutput(outputs: readonly string[], complete: (change: { reveal: string }) => void) {
  const path = outputs[0];
  if (path) complete({ reveal: path });
}
export function useDesktopActions() {
  const io = useFileManagerIo();
  const [dialog, setDialog] = useState<DesktopDialog | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const current = useRef(dialog);
  current.current = dialog;
  const close = () => {
    const active = current.current;
    if (active?.busy) {
      void io.cancelFileAction(active.id);
      return;
    }
    current.current = null;
    setDialog(null);
    if (restoreFocus.current?.isConnected) restoreFocus.current.focus();
  };
  useEffect(
    () => () => {
      const active = current.current;
      if (active?.busy) void io.cancelFileAction(active.id);
    },
    [io],
  );
  return {
    dialog,
    close,
    open(action: DesktopActionId, target: OperationTarget, inspection: ActionInspection) {
      restoreFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const next: DesktopDialog = {
        action,
        target,
        inspection,
        id: crypto.randomUUID(),
        busy: false,
        error: null,
        message: null,
      };
      current.current = next;
      setDialog(next);
    },
    async confirm(options: DesktopOptions) {
      const active = current.current;
      if (!active || active.busy || active.message) return;
      if (!active.target.isCurrent()) {
        setDialog({
          ...active,
          error:
            "The original view is no longer active. Close this dialog and select the entry again.",
        });
        return;
      }
      current.current = { ...active, busy: true };
      setDialog(current.current);
      const request = requestFor(active, options);
      if (!request) {
        setDialog({ ...active, error: "This action cannot execute a program." });
        return;
      }
      const complete = active.target.captureCompletion();
      const reply = await io.executeFileAction(request);
      if (current.current?.id !== active.id) return;
      if (reply.ok) {
        revealOutput(reply.value.outputs, complete);
        setDialog({ ...active, message: reply.value.message });
      } else setDialog({ ...active, error: reply.error.message });
    },
  };
}
export function initialDestination(dialog: DesktopDialog): string {
  if (dialog.action !== "compress") return parentOf(dialog.target.paths[0] ?? "/");
  const path = dialog.target.paths[0] ?? "/archive";
  return `${parentOf(path)}/${dialog.target.paths.length === 1 ? basename(path) : "Archive"}.zip`;
}
