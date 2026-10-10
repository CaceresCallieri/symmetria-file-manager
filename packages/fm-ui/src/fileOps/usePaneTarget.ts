import type { CursorEntry } from "@symmetria/fm-core/keys/types";
import { cursorEntry, joinPath } from "@symmetria/fm-core/pane";
import { useLayoutEffect, useRef } from "react";
import type { Tabs } from "../useTabs.ts";
import type { OperationTarget } from "./targets.ts";

/** Miller is the default source; explicit tree targets never consult its cursor. */
export function usePaneTarget(tabs: Tabs, viewKey: string): OperationTarget {
  const id = tabs.views[tabs.activeIndex]?.id;
  const key = JSON.stringify([id, tabs.pane.path, tabs.navigationGeneration(), viewKey]);
  const latest = useRef({ key, pane: tabs.pane });
  useLayoutEffect(() => {
    latest.current = { key, pane: tabs.pane };
  }, [key, tabs.pane]);
  useLayoutEffect(
    () => () => {
      latest.current = { ...latest.current, key: "" };
    },
    [],
  );
  const cursor = cursorEntry(tabs.pane);
  const entry: CursorEntry | null =
    cursor === null
      ? null
      : {
          name: cursor.name,
          path: joinPath(tabs.pane.path, cursor.name),
          isDirectory: cursor.kind === "directory" && !cursor.isSymlink,
          isImage: false,
          mimeType: "",
        };
  const marks = tabs.pane.selection;
  const paths =
    marks.size > 0
      ? [...marks].map((name) => joinPath(tabs.pane.path, name))
      : entry === null
        ? []
        : [entry.path];
  const isCurrent = () => latest.current.key === key;
  const clearMarks = () => {
    if (isCurrent() && latest.current.pane.selection === marks) tabs.clearMarks();
  };
  return {
    cursor: entry,
    paths,
    directory: tabs.pane.path,
    supportsImageBytes: true,
    isCurrent,
    clearMarks,
    captureCompletion: () => (change) => {
      // Clearing on every completion erased destination marks after paste and
      // unrelated marks after cursor rename. Miller clears marks after removal only.
      if (change.removed && !change.reveal) clearMarks();
    },
  };
}
