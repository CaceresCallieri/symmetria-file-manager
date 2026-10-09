import type { CursorEntry } from "@symmetria/fm-core/keys/types";
import { parentOf } from "@symmetria/fm-core/pane";
import type { OperationTarget } from "../fileOps/targets.ts";
import type { TreeRecord } from "./state.ts";
import type { TreeController } from "./useTreeMode.ts";

interface TreeOperationSource {
  readonly root: string | null;
  readonly entry: CursorEntry | null;
  readonly marks: ReadonlySet<string>;
  readonly record: TreeRecord | null;
  readonly controller: TreeController | null;
  isCurrent(): boolean;
  refresh(): void;
}

/** Capture targets now; capture the cursor again when the confirmed request starts. */
export function captureTreeTarget(source: TreeOperationSource): OperationTarget | null {
  const { root, entry, record, controller, isCurrent, refresh } = source;
  if (root === null || entry === null || record === null || controller === null) return null;
  const paths = source.marks.size > 0 ? [...source.marks] : [entry.path];
  return {
    cursor: entry,
    paths,
    directory: entry.isDirectory ? entry.path : parentOf(entry.path),
    protectedPath: root,
    supportsImageBytes: false,
    isCurrent,
    clearMarks: () => {
      if (isCurrent()) controller.clearMarks?.(paths);
    },
    captureCompletion: () => {
      const selected = record.shape.selected;
      return (change) => {
        if (!isCurrent()) return;
        if (change.removed) controller.clearMarks?.(change.removed);
        refresh();
        // A confirmed rename reveals its result until the user chooses another cursor.
        if (change.reveal && record.shape.selected === selected) controller.reveal(change.reveal);
      };
    },
  };
}
