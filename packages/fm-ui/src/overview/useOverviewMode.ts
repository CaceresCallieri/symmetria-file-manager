import type { ViewKind } from "@symmetria/fm-core/keys/types";
import type { OverviewCommand } from "@symmetria/fm-core/overview/navigation";
import { useCallback, useRef, useState } from "react";
import { useOverview } from "./useOverview.ts";
export interface OverviewPort {
  connect(handler: (command: OverviewCommand) => void): () => void;
  reveal(path: string): void;
  focus(path: string): void;
}
export function useOverviewMode(
  path: string,
  showHidden: boolean,
  openAt: (path: string) => void,
  reveal: (path: string) => void,
  navigate: (path: string) => void,
) {
  const handler = useRef<(command: OverviewCommand) => void>(() => undefined);
  const connect = useCallback((next: (command: OverviewCommand) => void) => {
    handler.current = next;
    return () => {
      if (handler.current === next) handler.current = () => undefined;
    };
  }, []);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const toggleMinimap = () => setMinimapVisible((visible) => !visible);
  const command = (name: OverviewCommand) => {
    if (name === "toggle-minimap") toggleMinimap();
    else handler.current(name);
  };
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
  return {
    minimapVisible,
    toggleMinimap,
    root,
    model,
    close,
    toggle,
    openExternal,
    view,
    command,
    port: {
      connect,
      reveal: (selected: string) => {
        setRoot(null);
        if (selected === root) navigate(selected);
        else reveal(selected);
      },
      focus: (selected: string) => setRoot(selected),
    },
  };
}
