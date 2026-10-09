import type { CursorEntry } from "@symmetria/fm-core/keys/types";
import { useEffect, useLayoutEffect, useRef } from "react";
import { isTreeDirectory, type TreeRow } from "./model.ts";
import type { TreeController, TreePort } from "./useTreeMode.ts";

export function useTreeController(
  port: TreePort,
  commands: TreeController,
  current: TreeRow | undefined,
  editing: boolean,
  count: number,
  viewport: HTMLElement | null,
) {
  const controller = useRef(commands);
  const published = useRef<{ entry: CursorEntry; select: TreePort["select"] } | null>(null);
  controller.current = commands;
  useEffect(
    () =>
      port.connect({
        command: (name) => controller.current.command(name),
        reveal: (path) => controller.current.reveal(path),
        cancel: () => controller.current.cancel(),
      }),
    [port.connect],
  );
  useEffect(() => {
    port.search?.({ active: editing, count });
  }, [port.search, editing, count]);
  // A passive effect published the cursor after the selected row could paint.
  // Clicking a deep file and immediately pressing a then created at the old
  // cursor's destination. Publish during layout so the host's key context
  // updates before the browser can show or act on the new selected row.
  useLayoutEffect(() => {
    if (!current) return;
    const next: CursorEntry = {
      name: current.name,
      path: current.path,
      isDirectory: isTreeDirectory(current),
      isImage: false,
      mimeType: "",
    };
    const previous = published.current;
    // Directory batches rebuild rows without changing the cursor. Compare all
    // published fields so those batches do not force a second App render before paint.
    if (previous?.select === port.select && sameCursorEntry(previous.entry, next)) return;
    published.current = { entry: next, select: port.select };
    port.select(next);
  }, [current, port.select]);
  useEffect(() => {
    viewport?.focus({ preventScroll: true });
  }, [viewport]);
}

function sameCursorEntry(previous: CursorEntry, next: CursorEntry): boolean {
  return (
    previous.path === next.path &&
    previous.name === next.name &&
    previous.isDirectory === next.isDirectory &&
    previous.isImage === next.isImage &&
    previous.mimeType === next.mimeType
  );
}
