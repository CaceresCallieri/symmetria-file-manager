import { cursorEntry, joinPath, type PaneState } from "@symmetria/fm-core/pane";

/** The absolute path of the entry under the cursor, or none. */
export function cursorPathOf(pane: PaneState): string | null {
  const entry = cursorEntry(pane);
  return entry === null ? null : joinPath(pane.path, entry.name);
}
