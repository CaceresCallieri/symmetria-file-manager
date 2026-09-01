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
  /** Search matches in the CURRENT column, by index. Nowhere else searches. */
  readonly matches?: ReadonlySet<number>;
  /** What the third column shows. Absent means an empty slot. */
  readonly preview?: PreviewPaneProps;
  /** Move the cursor to a row of the current column. */
  readonly onSelect?: (index: number) => void;
  /** Enter or open a row of the current column. */
  readonly onActivate?: (index: number) => void;
  /** Go to a directory named in the parent column. */
  readonly onLeaveTo?: (name: string) => void;
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
  matches,
  preview,
  onSelect,
  onActivate,
  onLeaveTo,
}: MillerColumnsProps) {
  // NOT clamped to 0. If the directory we are inside has been renamed or
  // removed between reads, clamping would highlight whatever sits at index
  // zero and claim "this is where you are" — a false statement, which is worse
  // than no highlight. `-1` matches nothing.
  const parentCursor = parentEntries.findIndex((e) => e.name === parentCursorName);

  return (
    <div className="columns" data-path={path}>
      {/* One click, not two. The parent column is a list of destinations rather
          than a place the cursor lives, so there is no selecting to do first —
          and `onActivate` is deliberately absent, since the second click of a
          double click would then re-navigate somewhere it already went.

          A FILE in this column is not a destination and is left inert. Entering
          it is impossible and opening it on a single click would be both
          surprising and, for anything the desktop hands to an application, hard
          to undo. The hand cursor therefore appears only over the directories,
          which is what makes the column honest about where a click will go. */}
      <FileList
        entries={parentEntries}
        cursorIndex={parentCursor}
        testId="column-parent"
        selection={NO_SELECTION}
        {...(onLeaveTo === undefined
          ? {}
          : {
              onSelect: (index: number) => {
                const entry = parentEntries[index];
                if (entry?.kind === "directory") onLeaveTo(entry.name);
              },
              clickableWhen: (entry: FsEntry) => entry.kind === "directory",
            })}
      />
      <FileList
        entries={entries}
        cursorIndex={cursorIndex}
        testId="column-current"
        selection={selection ?? NO_SELECTION}
        {...(matches === undefined ? {} : { matches })}
        {...(onSelect === undefined ? {} : { onSelect })}
        {...(onActivate === undefined ? {} : { onActivate })}
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
