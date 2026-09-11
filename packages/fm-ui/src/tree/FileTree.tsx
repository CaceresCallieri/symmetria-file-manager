import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PathBar } from "../components/PathBar.tsx";
import { INITIAL_RECT, observeWithFallback } from "../components/virtualize.ts";
import { DirectoryScope, snapshotStatus } from "../directory/DirectoryScope.tsx";
import type { OverviewModel } from "../overview/useOverview.ts";
import { isTreeDirectory, projectTree, treeItemId } from "./model.ts";
import { runTreeCommand } from "./navigation.ts";
import { TreeRow } from "./TreeRow.tsx";
import type { TreeCommand, TreePort } from "./useTreeMode.ts";
import { useTreeWidth } from "./useTreeWidth.ts";
import "./tree.css";

const ROW_HEIGHT = 24;

export function FileTree({
  root,
  model,
  port,
  onOpen,
  onMiller,
}: {
  root: string;
  model: OverviewModel;
  port: TreePort;
  onOpen(path: string): void;
  onMiller(): void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState(root);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const labelId = useId();
  const rows = useMemo(
    () => projectTree(root, model.folders, collapsed),
    [root, model.folders, collapsed],
  );
  const cursor = Math.max(
    0,
    rows.findIndex((row) => row.path === selected),
  );
  const current = rows[cursor];
  const rangeExtractor = useCallback(
    (range: Range) => {
      const shown = defaultRangeExtractor(range);
      return shown.includes(cursor) ? shown : [...shown, cursor].sort((a, b) => a - b);
    },
    [cursor],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: INITIAL_RECT,
    observeElementRect: observeWithFallback,
    rangeExtractor,
    getItemKey: (index) => rows[index]?.path ?? index,
  });
  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const activate = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setSelected(row.path);
    if (isTreeDirectory(row)) toggle(row.path);
    else onOpen(row.path);
  };
  const command = (name: TreeCommand) =>
    runTreeCommand(name, rows, cursor, { select: setSelected, toggle, activate });
  const latest = useRef(command);
  latest.current = command;
  useEffect(() => port.connect((name) => latest.current(name)), [port.connect]);
  useEffect(() => {
    if (current)
      port.select({
        name: current.name,
        path: current.path,
        isDirectory: isTreeDirectory(current),
        isImage: false,
        mimeType: "",
      });
  }, [current, port.select]);
  useTreeFocus(viewport, current?.path);
  const width = useTreeWidth(rows, viewport);
  return (
    <section className="file-tree" aria-label="Project file tree">
      <header className="tree-toolbar">
        <strong id={labelId}>File tree</strong>
        <span className="tree-scope" role="status">
          {snapshotStatus(model)}
          {model.coverage?.size ? " · Live updates unavailable" : ""}
        </span>
        <DirectoryScope model={model} />
        <button type="button" onClick={onMiller}>
          Miller · Ctrl+E
        </button>
        <button type="button" onClick={model.refresh}>
          Refresh
        </button>
      </header>
      <div className="tree-breadcrumb" title={selected}>
        <PathBar path={selected} />
      </div>
      <div
        ref={setViewport}
        className="tree-viewport"
        role="tree"
        aria-labelledby={labelId}
        tabIndex={0}
        aria-activedescendant={current ? treeItemId(current.path) : undefined}
        data-root={root}
        data-row-count={rows.length}
      >
        <div
          className="tree-canvas"
          style={{ height: virtualizer.getTotalSize(), minWidth: width }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return row ? (
              <TreeRow
                key={row.path}
                row={row}
                selected={row.path === current?.path}
                top={item.start}
                select={() => {
                  setSelected(row.path);
                  viewport?.focus({ preventScroll: true });
                }}
                activate={() => activate(item.index)}
                toggle={() => toggle(row.path)}
                include={() => model.include(row.path)}
              />
            ) : null;
          })}
        </div>
      </div>
    </section>
  );
}

function useTreeFocus(viewport: HTMLDivElement | null, currentPath: string | undefined) {
  useEffect(() => {
    viewport?.focus({ preventScroll: true });
  }, [viewport]);
  useEffect(() => {
    if (!viewport || !currentPath) return;
    // Native scrolling keeps the virtualizer's observed range in sync with the cursor.
    document
      .getElementById(treeItemId(currentPath))
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentPath, viewport]);
}
