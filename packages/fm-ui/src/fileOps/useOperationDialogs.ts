import { isFailure, type Result } from "@symmetria/fm-core/contract";
import { joinPath } from "@symmetria/fm-core/pane";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPath, renamePath, trashPaths } from "../bridge.ts";
import type { CreateTarget, OpsModal } from "./modal.ts";
import { mutationPaths, type OperationTarget } from "./targets.ts";

function stemLength(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

function sourceIsCurrent(modal: OpsModal) {
  if (modal.kind === "delete" || modal.kind === "rename") return modal.source.isCurrent();
  return true;
}

/** All modal writes update ownership synchronously, before a fast bridge reply. */
export function useOperationDialogs(setMessage: (message: string) => void) {
  const [modal, setModal] = useState<OpsModal>({ kind: "none" });
  const active = useRef<OpsModal>(modal);
  const mounted = useRef(false);
  const pending = useRef(new Set<OpsModal>());
  useLayoutEffect(() => {
    // StrictMode replays setup after cleanup. A cleanup-only ownership ref
    // left the first paste disabled until a dialog happened to replace it.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const replace = useCallback((next: OpsModal) => {
    active.current = next;
    setModal(next);
  }, []);
  const close = () => replace({ kind: "none" });
  const owns = (request: OpsModal) => mounted.current && active.current === request;

  function run<T>(
    request: OpsModal,
    work: () => Promise<Result<T>>,
    success: (value: T) => void,
    preserveFailure = true,
    reconcileWithoutModal = false,
  ) {
    if (pending.current.has(request)) return;
    pending.current.add(request);
    const reportFailure = (message: string) => {
      if (!owns(request) && !reconcileWithoutModal) return;
      if (!preserveFailure && owns(request)) replace({ kind: "none" });
      if (sourceIsCurrent(request)) setMessage(message);
    };
    void work().then((reply) => {
      pending.current.delete(request);
      if (!mounted.current) return;
      if (isFailure(reply)) {
        reportFailure(reply.error.message);
        return;
      }
      // Modal identity protects modal writes. Original-view reconciliation
      // remains valid after another dialog opens; its target checks view ownership.
      if (owns(request) || reconcileWithoutModal) success(reply.value);
    });
  }

  const requestDelete = (source: OperationTarget) => {
    if (source.paths.length === 0) return;
    if (refuseProtectedRoot(source, source.paths, setMessage)) return;
    replace({ kind: "delete", paths: mutationPaths(source.paths), source });
  };
  const requestRename = (withExtension: boolean, source: OperationTarget) => {
    const entry = source.cursor;
    if (entry === null || refuseProtectedRoot(source, [entry.path], setMessage)) return;
    replace({
      kind: "rename",
      path: entry.path,
      name: entry.name,
      selectTo: withExtension ? entry.name.length : stemLength(entry.name),
      source,
    });
  };
  const confirmDelete = () => {
    if (modal.kind !== "delete") return;
    const complete = modal.source.captureCompletion();
    run(
      modal,
      () => trashPaths(modal.paths),
      () => {
        if (modal.source.isCurrent()) {
          complete({ removed: modal.paths });
          setMessage(`${modal.paths.length} trashed`);
        }
        if (owns(modal)) replace({ kind: "none" });
      },
      false,
      true,
    );
  };
  const confirmRename = (name: string) => {
    if (modal.kind !== "rename" || name === "") return;
    const complete = modal.source.captureCompletion();
    run(
      modal,
      () => renamePath(modal.path, name),
      (reply) => {
        if (modal.source.isCurrent()) complete({ removed: [modal.path], reveal: reply.path });
        if (owns(modal)) replace({ kind: "none" });
      },
      true,
      true,
    );
  };
  const confirmCreate = (name: string) => {
    if (modal.kind !== "create") return;
    const trimmed = name.replace(/\/+$/, "");
    if (trimmed === "") return;
    const path = joinPath(modal.target.directory, trimmed);
    run(
      modal,
      () => createPath({ path, kind: name.endsWith("/") ? "directory" : "file" }),
      () => {
        replace({ kind: "none" });
        modal.target.onCreated?.(path);
      },
    );
  };
  return {
    modal,
    replace,
    close,
    owns,
    current: () => (mounted.current ? active.current : null),
    requestDelete,
    requestRename,
    requestCreate: (target: CreateTarget) => replace({ kind: "create", target }),
    confirmDelete,
    confirmRename,
    confirmCreate,
  };
}

export function refuseProtectedRoot(
  source: OperationTarget,
  paths: readonly string[],
  message: (text: string) => void,
): boolean {
  if (source.protectedPath === undefined || !paths.includes(source.protectedPath)) return false;
  message("Cannot mutate the tree root");
  return true;
}
