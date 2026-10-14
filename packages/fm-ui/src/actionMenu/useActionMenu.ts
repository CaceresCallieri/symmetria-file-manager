import type { ActionInspection } from "@symmetria/fm-core/fileActions";
import { useEffect, useRef, useState } from "react";
import type { OperationTarget } from "../fileOps/targets.ts";
import { useFileManagerIo } from "../IoContext.tsx";
import type { FileOps } from "../useFileOps.ts";
import { actionsFor, desktopActionFor, type FileAction } from "./model.ts";
import { useDesktopActions } from "./useDesktopActions.ts";

interface MenuSnapshot {
  readonly target: OperationTarget;
  readonly inspection: ActionInspection | null;
  readonly actions: readonly FileAction[];
  readonly x: number;
  readonly y: number;
}
interface MenuSources {
  readonly enabled: boolean;
  readonly blocked: boolean;
  captureTarget(path?: string): OperationTarget | null;
  readonly ops: FileOps;
  openPath(target: OperationTarget): void;
}

/** The registry opens the menu; the panel's existing dispatcher routes its keys. */
export function useActionMenu(sources: MenuSources) {
  const io = useFileManagerIo();
  const desktop = useDesktopActions();
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(null);
  const [index, setIndex] = useState(0);
  const latest = useRef(sources);
  latest.current = sources;
  const current = useRef<MenuSnapshot | null>(null);
  const activeIndex = useRef(0);
  const focus = useRef<HTMLElement | null>(null);
  const close = (restoreFocus = true) => {
    current.current = null;
    setSnapshot(null);
    if (restoreFocus) focus.current?.focus();
  };
  const open = (target: OperationTarget, x: number, y: number) => {
    const host = latest.current;
    if (
      [!host.enabled, host.blocked, target.paths.length === 0, desktop.dialog !== null].some(
        Boolean,
      )
    )
      return;
    if (current.current === null)
      focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu: MenuSnapshot = {
      inspection: null,
      target,
      actions: actionsFor(target, host.ops.clipboard !== null),
      x,
      y,
    };
    current.current = menu;
    activeIndex.current = 0;
    setIndex(0);
    setSnapshot(menu);
    void io.inspectFileActions(target.paths).then((reply) => {
      if (current.current !== menu || !target.isCurrent()) return;
      const inspection = reply.ok ? reply.value : null;
      const next = {
        ...menu,
        inspection,
        actions: actionsFor(
          target,
          latest.current.ops.clipboard !== null,
          inspection,
          reply.ok ? null : reply.error.message,
        ),
      };
      current.current = next;
      setSnapshot(next);
    });
  };
  const choose = (item: FileAction) => {
    const menu = current.current;
    if (!menu || item.unavailable !== null) return;
    const host = latest.current;
    if (host.blocked || !menu.target.isCurrent()) {
      close();
      return;
    }
    close();
    const desktopAction = desktopActionFor(item.id);
    if (menu.inspection && desktopAction !== null)
      desktop.open(desktopAction, menu.target, menu.inspection);
    else performAction(item, menu.target, host);
  };
  const commands = useRef({ open, close, choose });
  commands.current = { open, close, choose };
  useMenuPointerEvents(sources.enabled, latest, current, commands);
  useEffect(() => {
    if (snapshot && (!sources.enabled || sources.blocked || !snapshot.target.isCurrent()))
      close(false);
  });
  return {
    desktop,
    snapshot,
    index,
    close,
    choose,
    highlight: (next: number) => {
      activeIndex.current = next;
      setIndex(next);
    },
    open: () => {
      const target = latest.current.captureTarget();
      if (!target) return;
      const bounds = document
        .querySelector(
          '.tree-row[aria-selected="true"], [data-testid="column-current"] [data-cursor="true"]',
        )
        ?.getBoundingClientRect();
      commands.current.open(target, (bounds?.left ?? 20) + 100, bounds?.bottom ?? 100);
    },
    onKey: (event: KeyboardEvent): boolean => {
      const menu = current.current;
      if (!menu) return false;
      handleMenuKey(event, menu, activeIndex, commands.current, setIndex);
      return true;
    },
  };
}

function performAction(item: FileAction, target: OperationTarget, host: MenuSources) {
  const path = target.paths[0];
  switch (item.id) {
    case "open":
      if (path) host.openPath(target);
      break;
    case "copy":
      host.ops.yank(target);
      break;
    case "cut":
      host.ops.cut(target);
      break;
    case "paste":
      host.ops.paste(target);
      break;
    case "rename":
      host.ops.requestRename(false, target);
      break;
    case "trash":
      host.ops.requestDelete(target);
      break;
  }
}

type MenuCommands = {
  open(target: OperationTarget, x: number, y: number): void;
  close(restoreFocus?: boolean): void;
  choose(item: FileAction): void;
};
function handleMenuKey(
  event: KeyboardEvent,
  menu: MenuSnapshot,
  index: React.RefObject<number>,
  commands: MenuCommands,
  highlight: (index: number) => void,
) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if ([event.ctrlKey, event.altKey, event.metaKey].some(Boolean)) return;
  const delta = menuDirection(event);
  if (delta !== 0) {
    index.current = (index.current + delta + menu.actions.length) % menu.actions.length;
    highlight(index.current);
  } else if (["Escape", ";"].includes(event.key)) commands.close();
  else {
    const item =
      event.key === "Enter"
        ? event.shiftKey
          ? menu.actions.find((action) => action.id === "open")
          : menu.actions[index.current]
        : menu.actions.find((action) => action.key === event.key);
    if (item) commands.choose(item);
  }
}
function menuDirection(event: KeyboardEvent): number {
  if (["k", "ArrowUp"].includes(event.key) || (event.key === "Tab" && event.shiftKey)) return -1;
  return ["j", "ArrowDown", "Tab"].includes(event.key) ? 1 : 0;
}

function useMenuPointerEvents(
  enabled: boolean,
  sources: React.RefObject<MenuSources>,
  snapshot: React.RefObject<MenuSnapshot | null>,
  commands: React.RefObject<MenuCommands>,
) {
  useEffect(() => {
    if (!enabled) return;
    const contextMenu = (event: MouseEvent) => {
      const host = sources.current;
      if (!host.enabled || host.blocked || !(event.target instanceof Element)) return;
      const row = event.target.closest<HTMLElement>(
        '.tree-row[data-path], [data-testid="column-current"] .row[data-path]',
      );
      if (!row) return;
      const target = host.captureTarget(row.dataset.path);
      if (!target) return;
      event.preventDefault();
      commands.current.open(target, event.clientX, event.clientY);
    };
    const outside = (event: PointerEvent) => {
      if (snapshot.current === null) return;
      if (event.target instanceof Element && event.target.closest(".file-actions")) return;
      commands.current.close(false);
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".file-actions")) return;
      if (snapshot.current !== null) commands.current.close(false);
    };
    window.addEventListener("contextmenu", contextMenu);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("wheel", dismiss, true);
    window.addEventListener("touchmove", dismiss, true);
    return () => {
      window.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("wheel", dismiss, true);
      window.removeEventListener("touchmove", dismiss, true);
      if (snapshot.current !== null) commands.current.close(false);
    };
  }, [enabled, sources, snapshot, commands]);
}
