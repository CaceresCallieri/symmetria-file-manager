import type { FsEntry } from "@symmetria/fm-core/entry";

export interface FileRowProps {
  readonly entry: FsEntry;
  readonly isCursor: boolean;
  /** Marked for a file operation. Distinct from the cursor, which is where you are. */
  readonly isMarked?: boolean;
}

/**
 * One row.
 *
 * **A plain element with no transition and no gradient.** The Qt version
 * measured visible stutter during fast `j`/`k` when a per-delegate rectangle
 * carried a `Behavior` animation, and the zebra striping was removed
 * deliberately: over a near-black base the alternation read as banding rather
 * than as a reading aid. The only row fill is the cursor highlight.
 */
export function FileRow({ entry, isCursor, isMarked = false }: FileRowProps) {
  return (
    <div
      // One test id for every row, and the cursor state as its own attribute.
      // Two ids meant a test matching `/^row-/` collected ONLY the cursor row,
      // so an assertion that the mounted count stays bounded passed even when
      // nothing was virtualised at all.
      data-testid="row"
      data-cursor={isCursor ? "true" : undefined}
      data-marked={isMarked ? "true" : undefined}
      className={`row${isCursor ? " row--cursor" : ""}${isMarked ? " row--marked" : ""}`}
      data-kind={entry.kind}
    >
      {/* A mark is shown as a leading glyph, not only as a fill: the cursor is
          also a fill, and two fills over a near-black base are hard to tell
          apart at a glance. */}
      <span className="row__mark">{isMarked ? "▸" : ""}</span>
      <span className="row__name">{entry.name}</span>
      {entry.isSymlink ? <span className="row__link">→</span> : null}
    </div>
  );
}
