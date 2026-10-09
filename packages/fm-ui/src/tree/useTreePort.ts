import type { CursorEntry } from "@symmetria/fm-core/keys/types";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FlashPort } from "../flash/useFlashPort.ts";
import type { TreeController, TreePort } from "./useTreeMode.ts";

/** The port publishes selection during layout and scopes replies to the mounted controller. */
export function useTreePort(key: string, flash: FlashPort) {
  const [entry, setEntry] = useState<CursorEntry | null>(null);
  const [marks, setMarks] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState({ active: false, count: 0 });
  const owner = useRef<string | null>(key);
  const handler = useRef<TreeController | null>(null);
  useLayoutEffect(() => {
    owner.current = key;
  }, [key]);
  useLayoutEffect(
    () => () => {
      owner.current = null;
    },
    [],
  );
  const connect = useCallback((next: TreeController) => {
    handler.current = next;
    return () => {
      if (handler.current === next) handler.current = null;
    };
  }, []);
  return {
    entry,
    marks,
    search,
    handler,
    owner,
    port: {
      flash,
      connect,
      select: setEntry,
      marks: setMarks,
      search: setSearch,
    } satisfies TreePort,
  };
}
