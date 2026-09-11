import type { ViewKind } from "@symmetria/fm-core/keys/types";
import type { OverviewCommand } from "@symmetria/fm-core/overview/navigation";
import { useCallback, useRef, useState } from "react";
import { type OverviewModel, useOverview } from "./useOverview.ts";
import { type TreeOriginHost, useOverviewNavigation } from "./useOverviewNavigation.ts";
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
  tree?: TreeOriginHost,
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
  const navigation = useOverviewNavigation({ path, treeRoot, tree, reveal, navigate });
  const { root, close } = navigation;
  const model = useOverview(root ?? treeRoot, showHidden);
  const treeModel = usePreservedTreeModel(root, treeRoot, model);
  const openExternal = useCallback(
    (next: string) => {
      close();
      openAt(next);
    },
    [openAt, close],
  );
  const view: ViewKind = root === null ? "miller" : "overview";
  return {
    flashActive: root !== null && flashActive,
    onFlashKey: (event: KeyboardEvent) => flashHandler.current(event),
    minimapVisible,
    toggleMinimap,
    root,
    model,
    treeModel,
    revealDestination: navigation.revealDestination,
    close,
    toggle: navigation.toggle,
    openExternal,
    view,
    command,
    port: {
      flash: { connect: connectFlash, setActive: setFlashActive },
      connect,
      reveal: navigation.reveal,
      focus: navigation.focus,
    },
  };
}

function usePreservedTreeModel(root: string | null, treeRoot: string | null, model: OverviewModel) {
  const preserved = useRef(model);
  if (root === null && treeRoot !== null) preserved.current = model;
  return root !== null && root !== treeRoot ? preserved.current : model;
}
