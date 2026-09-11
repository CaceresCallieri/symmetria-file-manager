import type { CursorEntry, KeyContext } from "@symmetria/fm-core/keys/types";
import { useCallback, useRef, useState } from "react";

export type TreeCommand = "down" | "up" | "left" | "right" | "activate" | "toggle";
export interface TreePort {
  connect(handler: (command: TreeCommand) => void): () => void;
  select(entry: CursorEntry): void;
}

export function useTreeMode() {
  const [root, setRoot] = useState<string | null>(null);
  const [entry, setEntry] = useState<CursorEntry | null>(null);
  const handler = useRef<(command: TreeCommand) => void>(() => undefined);
  const connect = useCallback((next: (command: TreeCommand) => void) => {
    handler.current = next;
    return () => {
      if (handler.current === next) handler.current = () => undefined;
    };
  }, []);
  const port: TreePort = { connect, select: setEntry };
  return {
    root,
    entry,
    port,
    close: () => setRoot(null),
    toggle: (path: string) => setRoot((current) => (current === null ? path : null)),
    command: (command: TreeCommand) => handler.current(command),
  };
}

export function treeKeyContext(
  context: KeyContext,
  tree: ReturnType<typeof useTreeMode>,
): KeyContext {
  if (tree.root === null || context.view === "overview") return context;
  return {
    ...context,
    view: "tree",
    state: {
      ...context.state,
      cursorEntry: tree.entry,
      selectedCount: 0,
      searchActive: false,
      matchCount: 0,
    },
    actions: {
      ...context.actions,
      moveDown: () => tree.command("down"),
      moveUp: () => tree.command("up"),
      activate: () => tree.command("activate"),
      treeCollapseOrParent: () => tree.command("left"),
      treeExpandOrActivate: () => tree.command("right"),
      treeToggleExpand: () => tree.command("toggle"),
    },
  };
}
