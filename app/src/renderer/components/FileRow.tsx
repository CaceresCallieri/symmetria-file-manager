import type { FsEntry } from "@symmetria/fm-core/entry";

import { FileIcon } from "./FileIcon.tsx";

export interface FileRowProps {
  readonly entry: FsEntry;
  readonly isCursor: boolean;
  /** Marked for a file operation. Distinct from the cursor, which is where you are. */
  readonly isMarked?: boolean;
  /**
   * Matches the running search.
   *
   * A third state, and independent of the other two: a row can be the cursor,
   * marked for a copy, and a search match all at once, so each needs its own
   * attribute and its own class rather than one shared highlight.
   */
  readonly isMatch?: boolean;
  /** A single click. Absent means the row is not clickable at all. */
  readonly onSelect?: () => void;
  /** A double click. Absent means a double click does nothing beyond selecting. */
  readonly onActivate?: () => void;
}

/**
 * One row.
 *
 * **A plain element with no transition and no gradient.** The Qt version
 * measured visible stutter during fast `j`/`k` when a per-delegate rectangle
 * carried a `Behavior` animation, and the zebra striping was removed
 * deliberately: over a near-black base the alternation read as banding rather
 * than as a reading aid. The only row fill is the cursor highlight.
 *
 * **It stays a `div` and never becomes a `button`.** A focusable row takes the
 * keyboard when it is clicked, and every key after that goes to the row instead
 * of to the document handler that owns the keymap — the pointer would work once
 * and the application would then look dead. `onMouseDown` cancels the browser's
 * default focus for the same reason. Navigation by keyboard is the primary
 * interface here; the pointer is the addition, and it does not get to take the
 * keyboard away.
 *
 * ── Why two accessibility rules are suppressed ─────────────────────────────
 * `noStaticElementInteractions` and `useKeyWithClickEvents` both want a
 * clickable element to be focusable and to carry its own key handler. Every row
 * here is ALREADY reachable and activatable by keyboard — `j`/`k` move, `Enter`
 * and `l` activate — through the document-level keymap, so the capability the
 * rules protect is present; what is absent is the per-element form they check
 * for, and adding it is precisely what would break the keymap.
 *
 * The genuinely accessible shape for a list like this is a `listbox` whose
 * CONTAINER holds focus and names the active row with `aria-activedescendant`.
 * That is the right answer and it is a larger change than adding a pointer:
 * the container taking focus has to be reconciled with the document handler.
 * **Recorded as follow-up work rather than done here.**
 */
export function FileRow({
  entry,
  isCursor,
  isMarked = false,
  isMatch = false,
  onSelect,
  onActivate,
}: FileRowProps) {
  const clickable = onSelect !== undefined;

  // The two suppressions below must sit on the lines directly above the element
  // — biome attaches a suppression to what follows it — so the reasoning is in
  // the block comment above rather than beside them.
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard-driven list, see above
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard-driven list, see above
    <div
      // One test id for every row, and the cursor state as its own attribute.
      // Two ids meant a test matching `/^row-/` collected ONLY the cursor row,
      // so an assertion that the mounted count stays bounded passed even when
      // nothing was virtualised at all.
      data-testid="row"
      data-cursor={isCursor ? "true" : undefined}
      data-marked={isMarked ? "true" : undefined}
      data-match={isMatch ? "true" : undefined}
      className={`row${isCursor ? " row--cursor" : ""}${isMarked ? " row--marked" : ""}${
        isMatch ? " row--match" : ""
      }${clickable ? " row--clickable" : ""}`}
      data-kind={entry.kind}
      onMouseDown={clickable ? (event) => event.preventDefault() : undefined}
      onClick={onSelect}
      onDoubleClick={onActivate}
    >
      {/* A mark is shown as a leading glyph, not only as a fill: the cursor is
          also a fill, and two fills over a near-black base are hard to tell
          apart at a glance. */}
      <span className="row__mark">{isMarked ? "▸" : ""}</span>
      <FileIcon name={entry.name} kind={entry.kind} />
      <span className="row__name">{entry.name}</span>
      {entry.isSymlink ? <span className="row__link">→</span> : null}
    </div>
  );
}
