import type { FsEntry } from "@symmetria/fm-core/entry";

export interface FileRowProps {
  readonly entry: FsEntry;
  readonly isCursor: boolean;
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
export function FileRow({ entry, isCursor }: FileRowProps) {
  return (
    <div
      // One test id for every row, and the cursor state as its own attribute.
      // Two ids meant a test matching `/^row-/` collected ONLY the cursor row,
      // so an assertion that the mounted count stays bounded passed even when
      // nothing was virtualised at all.
      data-testid="row"
      data-cursor={isCursor ? "true" : undefined}
      className={isCursor ? "row row--cursor" : "row"}
      data-kind={entry.kind}
    >
      <span className="row__name">{entry.name}</span>
      {entry.isSymlink ? <span className="row__link">→</span> : null}
    </div>
  );
}
