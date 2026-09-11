import type { ViewKind } from "@symmetria/fm-core/keys/types";
import type { OverviewCommand } from "@symmetria/fm-core/overview/navigation";
import { useCallback, useRef, useState } from "react";
import { useOverview } from "./useOverview.ts";
export interface OverviewPort {
  readonly flash?: {
    connect(handler: (event: KeyboardEvent) => boolean): () => void;
    setActive(active: boolean): void;
  };
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
  treeRoot: string | null = null,
) {
  const handler = useRef<(command: OverviewCommand) => void>(() => undefined);
  const connect = useCallback((next: (command: OverviewCommand) => void) => {
    handler.current = next;
    return () => {
      if (handler.current === next) handler.current = () => undefined;
    };
  }, []);
  const [flashActive, setFlashActive] = useState(false);
  const flashHandler = useRef<(event: KeyboardEvent) => boolean>(() => true);
  const connectFlash = useCallback((next: (event: KeyboardEvent) => boolean) => {
    flashHandler.current = next;
    return () => {
      if (flashHandler.current === next) flashHandler.current = () => true;
    };
  }, []);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const toggleMinimap = () => setMinimapVisible((visible) => !visible);
  const command = (name: OverviewCommand) => {
    if (name === "toggle-minimap") toggleMinimap();
    else handler.current(name);
  };
  const [root, setRoot] = useState<string | null>(null);
  const model = useOverview(root ?? treeRoot, showHidden);
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
    flashActive: root !== null && flashActive,
    onFlashKey: (event: KeyboardEvent) => flashHandler.current(event),
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
      flash: { connect: connectFlash, setActive: setFlashActive },
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
