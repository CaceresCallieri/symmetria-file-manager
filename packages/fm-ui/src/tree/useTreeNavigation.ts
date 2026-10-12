import { useCallback, useLayoutEffect, useRef } from "react";
import { useCameraAnimation } from "../overview/useOverviewCamera.ts";
import type { TreeRow } from "./model.ts";
import { type TreeAnchor, type TreeRecord, visibleFallback } from "./state.ts";

type Point = { x: number; y: number };

export function useTreeNavigation(
  viewport: HTMLDivElement | null,
  rows: readonly TreeRow[],
  selected: string,
  record: TreeRecord,
  loading: boolean,
  select: (path: string) => void,
  rowHeight: number,
) {
  const latest = useRef({ viewport, rows, selected, select });
  latest.current = { viewport, rows, selected, select };
  const pending = useRef<{ point: Point; index: number } | null>(null);
  const write = useCallback(
    (point: Point) => {
      const { viewport, rows } = latest.current;
      if (!viewport) return;
      viewport.scrollTop = point.y;
      viewport.scrollLeft = point.x;
      record.anchor = readAnchor(viewport, rows, rowHeight);
      if (pending.current?.point.y === point.y) pending.current = null;
    },
    [record, rowHeight],
  );
  const read = useCallback(
    () => ({ x: viewport?.scrollLeft ?? 0, y: viewport?.scrollTop ?? 0 }),
    [viewport],
  );
  const animate = useCameraAnimation(read, write);
  const cancel = useCallback(() => {
    animate.cancel();
    pending.current = null;
  }, [animate]);
  const previousRows = useRef<readonly TreeRow[]>([]);
  const previousSelected = useRef(selected);
  useLayoutEffect(() => {
    if (!viewport) return;
    const oldRows = previousRows.current;
    if (oldRows === rows) return;
    const followCursor = shouldFollowCursor(
      pending.current !== null,
      selected,
      oldRows,
      viewport,
      rowHeight,
    );
    cancel();
    const anchor = record.anchor;
    if (awaitingAnchor(anchor, rows, loading)) return;
    previousRows.current = rows;
    if (anchor) {
      const path = visibleFallback(anchor.path, rows, oldRows);
      write({
        x: anchor.left,
        y: rows.findIndex((row) => row.path === path) * rowHeight + anchor.offset,
      });
    }
    // Discovery changes row indices. Keep a previously visible cursor visible,
    // and finish interrupted paging at its path. Preserve manual scrolling when
    // the cursor was already outside the viewport before the discovery batch.
    if (followCursor) {
      const index = rows.findIndex((row) => row.path === selected);
      write(visiblePoint(read(), index, viewport.clientHeight, rows.length, rowHeight));
    }
    if (!loading && !rows.some((row) => row.path === selected)) {
      const fallback = visibleFallback(selected, rows, oldRows);
      previousSelected.current = fallback;
      select(fallback);
    }
  }, [rows, viewport, selected, select, loading, record, cancel, write, read, rowHeight]);
  useLayoutEffect(() => {
    const requested = record.pendingReveal;
    // Discovery can insert rows above an already represented target. Keep the
    // reveal pending until scanning settles, or its final row can stay clipped.
    if (!viewport || !requested || loading) return;
    const path = rows.some((row) => row.path === requested)
      ? requested
      : visibleFallback(requested, rows);
    cancel();
    previousSelected.current = path;
    select(path);
    write(
      visiblePoint(
        read(),
        rows.findIndex((row) => row.path === path),
        viewport.clientHeight,
        rows.length,
        rowHeight,
      ),
    );
    record.pendingReveal = null;
  }, [viewport, record, rows, loading, cancel, select, write, read, rowHeight]);
  useLayoutEffect(() => {
    if (!viewport || !record.restoreAnchor) return;
    const anchor = record.anchor;
    // Reopening after snapshot eviction initially represents only the root.
    // Restoring its fallback here discarded the saved anchor before discovery.
    if (awaitingAnchor(anchor, rows, loading)) return;
    if (anchor)
      write({
        x: anchor.left,
        y:
          Math.max(
            0,
            rows.findIndex((row) => row.path === visibleFallback(anchor.path, rows)),
          ) *
            rowHeight +
          anchor.offset,
      });
    previousSelected.current = selected;
    record.restoreAnchor = false;
  }, [viewport, rows, record, selected, write, loading, rowHeight]);
  useLayoutEffect(() => {
    if (previousSelected.current === selected) return;
    previousSelected.current = selected;
    if (pending.current || !viewport) return;
    const index = rows.findIndex((row) => row.path === selected);
    write(visiblePoint(read(), index, viewport.clientHeight, rows.length, rowHeight));
  }, [selected, rows, viewport, write, read, rowHeight]);
  useLayoutEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(cancel);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cancel();
    };
  }, [viewport, cancel]);
  const page = (direction: number, fraction: number) => {
    if (!viewport) return;
    const currentIndex = pending.current?.index ?? rows.findIndex((row) => row.path === selected);
    const delta =
      Math.max(1, Math.floor((viewport.clientHeight / rowHeight) * fraction)) * direction;
    const index = Math.max(0, Math.min(rows.length - 1, currentIndex + delta));
    const row = rows[index];
    if (!row) return;
    const start = pending.current?.point ?? read();
    const point = visiblePoint(
      { x: start.x, y: start.y + (index - currentIndex) * rowHeight },
      index,
      viewport.clientHeight,
      rows.length,
      rowHeight,
    );
    pending.current = { point, index };
    select(row.path);
    animate(point);
  };
  const jump = (end: boolean) => {
    cancel();
    const index = end ? rows.length - 1 : 0;
    const row = rows[index];
    if (!row || !viewport) return;
    select(row.path);
    write(visiblePoint(read(), index, viewport.clientHeight, rows.length, rowHeight));
  };
  return {
    cancel,
    page,
    jump,
    onScroll: () => {
      if (viewport) record.anchor = readAnchor(viewport, rows, rowHeight);
    },
  };
}

function readAnchor(viewport: HTMLElement, rows: readonly TreeRow[], rowHeight: number) {
  const index = Math.floor(viewport.scrollTop / rowHeight);
  const row = rows[index];
  return row
    ? { path: row.path, offset: viewport.scrollTop % rowHeight, left: viewport.scrollLeft }
    : null;
}

function visiblePoint(
  point: Point,
  index: number,
  height: number,
  count: number,
  rowHeight: number,
): Point {
  const top = Math.max(0, index) * rowHeight;
  const y = Math.min(Math.max(point.y, top + rowHeight - height), top);
  return { x: point.x, y: Math.max(0, Math.min(y, count * rowHeight - height)) };
}

function awaitingAnchor(anchor: TreeAnchor | null, rows: readonly TreeRow[], loading: boolean) {
  return loading && anchor !== null && !rows.some((row) => row.path === anchor.path);
}

function shouldFollowCursor(
  paging: boolean,
  selected: string,
  rows: readonly TreeRow[],
  viewport: HTMLElement,
  rowHeight: number,
) {
  if (paging) return true;
  const index = rows.findIndex((row) => row.path === selected);
  if (index < 0) return false;
  const top = index * rowHeight;
  return top >= viewport.scrollTop && top + rowHeight <= viewport.scrollTop + viewport.clientHeight;
}
