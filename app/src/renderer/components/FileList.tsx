import type { FsEntry } from "@symmetria/fm-core/entry";
import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileRow } from "./FileRow.tsx";

export interface FileListProps {
  readonly entries: readonly FsEntry[];
  readonly cursorIndex: number;
  readonly testId: string;
  /** Marked entries, by name. Empty in the columns that cannot be marked. */
  readonly selection: ReadonlySet<string>;
}

/**
 * Nothing marked.
 *
 * A shared frozen instance rather than a fresh `new Set()` per render: the
 * parent and preview columns can never be marked, and a new set each time would
 * change their props' identity on every keystroke.
 */
export const NO_SELECTION: ReadonlySet<string> = new Set();

/** Row height in pixels. Fixed, so the virtualiser needs no measurement pass. */
const ROW_HEIGHT = 24;

/**
 * The window to assume before the container has been measured.
 *
 * Not only for tests. A virtualiser with no measurement yet renders zero rows,
 * so the first frame after mount is blank until layout settles — and in a
 * headless DOM, where `getBoundingClientRect` always returns zeros, it never
 * settles and nothing renders at all. Assuming a plausible viewport gives the
 * first paint something real and makes the component testable without faking
 * layout.
 */
export const INITIAL_RECT = { width: 400, height: 800 };

/**
 * Report the element's size, falling back when it has none.
 *
 * A container that has not laid out yet measures zero, and a virtualiser told
 * its viewport is zero pixels tall renders zero rows. In production that is a
 * blank first frame; under a headless DOM, which has no layout engine at all
 * and always reports zero, it is a permanently empty list.
 *
 * Substituting a plausible viewport for a degenerate one keeps the component
 * honest in both: real measurements are used the moment they exist.
 */
export function observeWithFallback(
  instance: { scrollElement: Element | Window | null },
  cb: (rect: { width: number; height: number }) => void,
): (() => void) | undefined {
  const element = instance.scrollElement;
  if (element === null || !(element instanceof Element)) {
    cb(INITIAL_RECT);
    return undefined;
  }

  const report = () => {
    const { width, height } = element.getBoundingClientRect();
    cb(height > 0 ? { width, height } : INITIAL_RECT);
  };

  report();
  if (typeof ResizeObserver === "undefined") return undefined;

  const observer = new ResizeObserver(report);
  observer.observe(element);
  return () => observer.disconnect();
}

/**
 * A virtualised list of entries.
 *
 * Virtualisation is necessary and **not sufficient**. The measured lesson from
 * the Qt file tree is that the dominant cost was the NUMBER of directories
 * expanded, not the cost of rendering each row: a repository went from 3994 ms
 * to 449 ms by expanding three directories instead of a hundred, and row
 * rendering was never the bottleneck. Miller columns are safe by construction —
 * they show three levels and never expand a subtree — and decision D5 removed
 * automatic expansion entirely. This component handles the other half.
 */
export function FileList({ entries, cursorIndex, testId, selection }: FileListProps) {
  // A callback ref into state, not `useRef`.
  //
  // A `useRef` is null during the first render, so the virtualiser has no
  // element to measure and renders zero rows — and nothing schedules a second
  // render, so it stays empty. Storing the element in state re-renders once it
  // exists. That also removes a blank first frame in production, not only in a
  // headless test where `getBoundingClientRect` never reports a size.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => setScrollElement(node), []);

  // Always mount the cursor row, whether or not it falls in the visible window.
  //
  // Two reasons, and the second is the load-bearing one. It lets the row below
  // scroll itself into view, and it means the highlight EXISTS even if the
  // scroll position and the virtualiser ever disagree — the failure mode is
  // then a row briefly off screen, not a list with no cursor at all.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const visible = defaultRangeExtractor(range);
      if (cursorIndex < 0 || visible.includes(cursorIndex)) return visible;
      return [...visible, cursorIndex].sort((a, b) => a - b);
    },
    [cursorIndex],
  );

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    initialRect: INITIAL_RECT,
    observeElementRect: observeWithFallback,
    rangeExtractor,
  });

  // Follow the cursor by asking the BROWSER to scroll, not by setting the
  // offset ourselves.
  //
  // This was `virtualizer.scrollToIndex(...)`, and holding `j` broke it: a
  // programmatic scroll races the virtualiser's own scroll listener, and under
  // a fast burst the container ended up scrolled near the bottom while the
  // virtualiser still believed the offset was zero — so it rendered the rows at
  // the TOP, the cursor row was not among them, and the highlight vanished
  // until something dispatched another scroll event. It never recovered on its
  // own. Verified in real Chromium; a headless DOM has no scrolling and cannot
  // reproduce it, which is why the unit tests were happy throughout.
  //
  // `scrollIntoView` inverts the authority: the browser moves the container,
  // the virtualiser observes the resulting scroll event like any other, and
  // there is only one writer of the scroll position. Do NOT reintroduce
  // `scrollToIndex` here.
  const cursorRow = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Nothing to bring into view, and nothing to reconcile against.
    if (entries[cursorIndex] === undefined || scrollElement === null) return;

    cursorRow.current?.scrollIntoView({ block: "nearest" });

    // WORKAROUND: an independent verification run measured the virtualiser's
    // tracked offset stuck at 0 while the container's real `scrollTop` was
    // several hundred pixels down, after a burst of held-key navigation — so it
    // rendered the rows at the TOP of a list scrolled far past them. Dispatching
    // one bare `scroll` event on the container corrected it instantly, which is
    // what the reconciliation below does automatically when the two disagree.
    //
    // Why not a clean fix: the report could NOT be reproduced. Five runs — a
    // tall window and a short one, 40 keys at 60 ms and 150 at 15 ms, warm and
    // cold start — all measured the range tracking the real scroll correctly
    // (scrollTop 2890 rendering rows 112-159 with the cursor at 150). Without a
    // reproduction there is no root cause to fix, and the honest options were to
    // dismiss another observer's measurement or to make the reported state
    // recover on its own. This is the second.
    //
    // It costs one comparison per cursor move and dispatches nothing while the
    // two agree. REMOVE IT once either the desync is reproduced and fixed at its
    // root, or a later pass over a real session shows the condition never fires.
    const frame = requestAnimationFrame(() => {
      // `null` means the virtualiser has not observed an offset yet, which is
      // not a disagreement — there is nothing to compare against.
      const tracked = virtualizer.scrollOffset;
      if (tracked === null) return;

      if (Math.abs(tracked - scrollElement.scrollTop) > 1) {
        scrollElement.dispatchEvent(new Event("scroll"));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [cursorIndex, entries, scrollElement, virtualizer]);

  if (entries.length === 0) {
    return (
      <div data-testid={testId} className="list list--empty">
        <span>empty</span>
      </div>
    );
  }

  return (
    <div data-testid={testId} ref={attach} className="list">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          if (entry === undefined) return null;
          const isCursor = item.index === cursorIndex;
          return (
            <div
              key={entry.name}
              ref={isCursor ? cursorRow : undefined}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: item.size,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <FileRow entry={entry} isCursor={isCursor} isMarked={selection.has(entry.name)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
