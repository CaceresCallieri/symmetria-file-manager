import { basename, parentOf } from "@symmetria/fm-core/pane";
import type { OperationTarget } from "../fileOps/targets.ts";

/** Keyboard and pointer invocation share selection and destination semantics. */
export function menuTarget(
  source: OperationTarget,
  clicked: string | undefined,
  entryFor: (path: string) => { readonly kind: string; readonly isSymlink: boolean } | undefined,
  tree: boolean,
): OperationTarget {
  // Treat the cursor like a clicked row. Unconditionally using marks for `;`
  // gave a different target from right-click when the cursor left the selection.
  const invoked = clicked ?? source.cursor?.path;
  const selected = invoked === undefined || source.paths.includes(invoked);
  const paths = selected ? source.paths : [invoked];
  const path = paths[0] ?? source.cursor?.path ?? source.directory;
  const entry = entryFor(path);
  // Tree symlink directories activate as files. This matches isTreeDirectory.
  const folder = entry
    ? entry.kind === "directory" && (!tree || !entry.isSymlink)
    : source.cursor?.path === path && source.cursor.isDirectory;
  return {
    ...source,
    paths,
    cursor: { name: basename(path), path, isDirectory: folder, isImage: false, mimeType: "" },
    directory: paths.length === 1 && folder ? path : parentOf(path),
    clearMarks: selected ? source.clearMarks : () => {},
    captureCompletion: () => {
      const complete = source.captureCompletion();
      return (change) => {
        if (selected) complete(change);
        else if (change.reveal !== undefined) complete({ reveal: change.reveal });
      };
    },
  };
}
