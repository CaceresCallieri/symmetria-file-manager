import { isAncestorPath, overviewPaths } from "@symmetria/fm-core/overview/model";
import { useLayoutEffect, useMemo, useState } from "react";
import type { OverviewModel } from "../overview/useOverview.ts";
import { projectTree } from "./model.ts";
import { pruneTreeShape } from "./prune.ts";
import { revealShape, type TreeRecord, type TreeShape } from "./state.ts";

export function useTreeState(root: string, model: OverviewModel, record: TreeRecord) {
  const [shape, setShape] = useState(record.shape);
  useLayoutEffect(() => {
    record.shape = shape;
  }, [record, shape]);
  const collapsed = useMemo(
    () => effectiveCollapsed(root, model.folders, shape.preset, shape.collapsed),
    [root, model.folders, shape.preset, shape.collapsed],
  );
  const rows = useMemo(
    () => projectTree(root, model.folders, collapsed),
    [root, model.folders, collapsed],
  );
  const select = (path: string) =>
    setShape((previous) =>
      previous.selected === path ? previous : { ...previous, selected: path },
    );
  const reveal = (path: string) => {
    record.pendingReveal = path;
    setShape((previous) =>
      rows.some((row) => row.path === path)
        ? { ...previous, selected: path }
        : revealShape({ ...previous, collapsed }, path),
    );
  };
  useLayoutEffect(() => {
    setShape((previous) => {
      const pruned = pruneTreeShape(previous, root, model.folders);
      const path = record.pendingReveal;
      if (!path || !overviewPaths(root, model.folders).has(path)) return pruned;
      if (rows.some((row) => row.path === path))
        return pruned.selected === path ? pruned : { ...pruned, selected: path };
      return revealShape({ ...pruned, collapsed }, path);
    });
  }, [root, model.folders, record, rows, collapsed]);
  const toggle = (path: string) =>
    setShape((previous) => {
      const next = new Set(collapsed);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      const selected =
        next.has(path) && isAncestorPath(path, previous.selected) ? path : previous.selected;
      return { ...previous, selected, collapsed: next, preset: null, checkpoint: null };
    });
  const preset = (next: "expanded" | "collapsed" | "restore") =>
    setShape((previous) => {
      if (next === "restore")
        return previous.checkpoint
          ? { ...previous, collapsed: previous.checkpoint, preset: null, checkpoint: null }
          : previous;
      return {
        ...previous,
        collapsed: new Set(),
        preset: next,
        checkpoint: previous.checkpoint ?? collapsed,
      };
    });
  return { shape, rows, select, reveal, toggle, preset };
}

function effectiveCollapsed(
  root: string,
  folders: OverviewModel["folders"],
  preset: TreeShape["preset"],
  collapsed: TreeShape["collapsed"],
): ReadonlySet<string> {
  if (preset !== "collapsed") return collapsed;
  return new Set([...folders.keys()].filter((path) => path !== root));
}
