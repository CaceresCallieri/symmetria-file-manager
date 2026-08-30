import type { FsEntry } from "@symmetria/fm-core/entry";

import { FileList, NO_SELECTION } from "./FileList.tsx";
import { PreviewPane, type PreviewPaneProps } from "./preview/PreviewPane.tsx";

export interface MillerColumnsProps {
  readonly path: string;
  readonly parentEntries: readonly FsEntry[];
  readonly entries: readonly FsEntry[];
  readonly cursorIndex: number;
  /** Which entry the parent column sits on — the directory we are inside. */
  readonly parentCursorName: string;
  /** Marked entries in the CURRENT column, by name. */
  readonly selection?: ReadonlySet<string>;
  /** What the third column shows. Absent means an empty slot. */
  readonly preview?: PreviewPaneProps;
}

/**
 * Three columns: where we came from, where we are, and what is under the cursor.
 *
 * Each column is a solid surface over the window backdrop, per the transparency
 * model: the panes are opaque and the chrome between them is where the desktop
 * shows through.
 */
export function MillerColumns({
  path,
  parentEntries,
  entries,
  cursorIndex,
  parentCursorName,
  selection,
  preview,
}: MillerColumnsProps) {
  // NOT clamped to 0. If the directory we are inside has been renamed or
  // removed between reads, clamping would highlight whatever sits at index
  // zero and claim "this is where you are" — a false statement, which is worse
  // than no highlight. `-1` matches nothing.
  const parentCursor = parentEntries.findIndex((e) => e.name === parentCursorName);

  return (
    <div className="columns" data-path={path}>
      <FileList
        entries={parentEntries}
        cursorIndex={parentCursor}
        testId="column-parent"
        selection={NO_SELECTION}
      />
      <FileList
        entries={entries}
        cursorIndex={cursorIndex}
        testId="column-current"
        selection={selection ?? NO_SELECTION}
      />
      {preview === undefined ? (
        <div className="list" data-testid="column-preview">
          <span>{entries[cursorIndex]?.name ?? ""}</span>
        </div>
      ) : (
        <PreviewPane {...preview} />
      )}
    </div>
  );
}
