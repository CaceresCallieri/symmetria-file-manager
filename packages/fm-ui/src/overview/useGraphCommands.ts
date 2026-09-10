import { isAncestorPath } from "@symmetria/fm-core/overview/model";
import {
  type Direction,
  moveSelection,
  type OverviewCommand,
} from "@symmetria/fm-core/overview/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { type GraphCameraOptions, selectedElement, useGraphCamera } from "./useGraphCamera.ts";
import type { useOverview } from "./useOverview.ts";
import type { OverviewPort } from "./useOverviewMode.ts";

interface GraphCommandOptions extends GraphCameraOptions {
  root: string;
  model: ReturnType<typeof useOverview>;
  setSelected: (path: string) => void;
  collapsed: ReadonlySet<string>;
  setCollapsed: (value: Set<string>) => void;
  port: OverviewPort | undefined;
  search: () => void;
}
export function useGraphCommands(options: GraphCommandOptions) {
  const { viewport, selected, zoom, model, root, collapsed, setCollapsed, setSelected } = options;
  const pendingChild = useRef<string | null>(null);
  const camera = useGraphCamera(options);
  const { cancel, changeZoom, pan, fit } = camera;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (node)
      selectedElement(node, selected)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected, viewport]);
  useEffect(() => {
    const path = pendingChild.current;
    if (path === null) return;
    const folder = model.folders.get(path);
    if (!folder || folder.status === "Loading" || folder.status === "Queued") return;
    pendingChild.current = null;
    setSelected(moveSelection(model.folders, root, path, "right"));
  }, [model.folders, root, setSelected]);
  const expand = (path: string) => {
    const next = new Set(collapsed);
    for (const ancestor of next) if (isAncestorPath(ancestor, path)) next.delete(ancestor);
    setCollapsed(next);
  };
  const navigate = (direction: Direction) => {
    cancel();
    pendingChild.current = null;
    if (direction === "right") {
      expand(selected);
      const folder = model.folders.get(selected);
      if (folder && folder.status !== "Loaded" && folder.entries.length === 0) {
        pendingChild.current = selected;
        model.include(selected);
        return;
      }
    }
    setSelected(moveSelection(model.folders, root, selected, direction));
  };
  const toggle = (path: string) => {
    const folder = model.folders.get(path);
    if (!folder) return;
    const next = new Set(collapsed);
    const unopened = folder.entries.length === 0 && folder.status !== "Loaded";
    if (next.has(path) || unopened) {
      next.delete(path);
      if (unopened) model.include(path);
    } else {
      next.add(path);
      if (isAncestorPath(path, selected)) setSelected(path);
    }
    setCollapsed(next);
  };
  const actions = new Map<OverviewCommand, () => void>([
    ["zoom-in", () => changeZoom(zoom * 1.2)],
    ["zoom-out", () => changeZoom(zoom / 1.2)],
    ["reset", () => changeZoom(1)],
    ["fit", fit],
    ["toggle", () => toggle(selected)],
    ["search", options.search],
    ["reveal", () => options.port?.reveal(selected)],
  ]);
  const run = (command: OverviewCommand) => {
    const direction = command.split("-").at(-1);
    if (isDirection(direction)) {
      if (command.startsWith("half-")) pan(direction, 0.5);
      else if (command.startsWith("full-")) pan(direction, 1);
      else navigate(direction);
      return;
    }
    actions.get(command)?.();
  };
  useEffect(() => options.port?.connect(run));
  return {
    run,
    cancel,
    toggle,
    select: (path: string) => {
      cancel();
      pendingChild.current = null;
      expand(path);
      setSelected(path);
    },
  };
}

function isDirection(value: string | undefined): value is Direction {
  return value === "left" || value === "right" || value === "up" || value === "down";
}
