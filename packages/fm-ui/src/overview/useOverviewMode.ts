import type { ViewKind } from "@symmetria/fm-core/keys/types";
import { useCallback, useState } from "react";
import { useOverview } from "./useOverview.ts";
export function useOverviewMode(path: string, showHidden: boolean, openAt: (path: string) => void) {
  const [root, setRoot] = useState<string | null>(null);
  const model = useOverview(root, showHidden);
  const close = useCallback(() => setRoot(null), []);
  const toggle = () => setRoot((current) => (current === null ? path : null));
  const openExternal = useCallback(
    (next: string) => {
      setRoot(null);
      openAt(next);
    },
    [openAt],
  );
  const view: ViewKind = root === null ? "miller" : "overview";
  return { root, model, close, toggle, openExternal, view };
}
