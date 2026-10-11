import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { type Key, useCallback } from "react";

import { useRowHeight } from "./rowHeight.ts";
import { INITIAL_RECT, observeWithFallback } from "./virtualize.ts";

export interface RowVirtualizerOptions {
  readonly count: number;
  readonly scrollElement: HTMLDivElement | null;
  /** The cursor row, mounted whatever the window. Below zero means none. */
  readonly cursorIndex: number;
  readonly getItemKey?: (index: number) => Key;
}

/**
 * The virtualiser every fixed-height list shares: the Miller columns and the
 * file tree. One definition, because the two were written out twice and the
 * row height has to reach both from the same place (`RowHeightContext`).
 *
 * Rows are a fixed `rowHeight` apart, so there is no measurement pass.
 *
 * The cursor row is always mounted, whether or not it falls in the visible
 * window. Two reasons, and the second is the load-bearing one: it lets the row
 * below scroll itself into view, and it means the highlight EXISTS even if the
 * scroll position and the virtualiser ever disagree — the failure mode is then
 * a row briefly off screen, not a list with no cursor at all.
 */
export function useRowVirtualizer({
  count,
  scrollElement,
  cursorIndex,
  getItemKey = (index) => index,
}: RowVirtualizerOptions) {
  const rowHeight = useRowHeight();
  const rangeExtractor = useCallback(
    (range: Range) => {
      const visible = defaultRangeExtractor(range);
      if (cursorIndex < 0 || visible.includes(cursorIndex)) return visible;
      return [...visible, cursorIndex].sort((a, b) => a - b);
    },
    [cursorIndex],
  );
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => rowHeight,
    overscan: 8,
    initialRect: INITIAL_RECT,
    observeElementRect: observeWithFallback,
    rangeExtractor,
    getItemKey,
  });
  return { virtualizer, rowHeight };
}
