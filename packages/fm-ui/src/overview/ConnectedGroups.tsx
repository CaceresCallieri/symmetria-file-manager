import { graphBounds, intersects, visibleGroups } from "@symmetria/fm-core/overview/layout";
import { joinPath } from "@symmetria/fm-core/pane";
import { useLayoutEffect, useRef, useState } from "react";
import { FolderGroup } from "./FolderGroup.tsx";
import { OverviewControls } from "./OverviewControls.tsx";
import { OverviewLinks } from "./OverviewLinks.tsx";
import { OverviewSearch } from "./OverviewSearch.tsx";
import { useGraphAnchor } from "./useGraphAnchor.ts";
import { useGraphCommands } from "./useGraphCommands.ts";
import { useGraphScene } from "./useGraphScene.ts";
import type { useOverview } from "./useOverview.ts";
import type { OverviewPort } from "./useOverviewMode.ts";
export function ConnectedGroups({
  root,
  model,
  port,
}: {
  readonly root: string;
  readonly model: ReturnType<typeof useOverview>;
  readonly port?: OverviewPort;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const extent = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [selected, setSelected] = useState(root);
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [scroll, setScroll] = useState({ x: 0, y: 0, width: 1200, height: 800 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const { groups, boxes, onMeasure, rearrange } = useGraphScene(model.folders);
  const shown = visibleGroups(groups, collapsed);
  const bounds = graphBounds(shown);
  const windowBox = {
    x: (scroll.x - origin.x) / zoom,
    y: (scroll.y - origin.y) / zoom,
    width: scroll.width / zoom,
    height: scroll.height / zoom,
  };
  const sample = () => {
    const node = viewport.current;
    if (node)
      setScroll({
        x: node.scrollLeft,
        y: node.scrollTop,
        width: node.clientWidth || 1200,
        height: node.clientHeight || 800,
      });
  };
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () =>
      setScroll({
        x: node.scrollLeft,
        y: node.scrollTop,
        width: node.clientWidth || 1200,
        height: node.clientHeight || 800,
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useGraphAnchor(groups, selected, zoom, viewport, extent);
  const mounted = shown.filter(
    (group) =>
      intersects(group, windowBox, 200 / zoom) ||
      group.path === selected ||
      group.entries.some((entry) => joinPath(group.path, entry.name) === selected),
  );
  const commands = useGraphCommands({
    root,
    model,
    selected,
    setSelected,
    collapsed,
    setCollapsed,
    viewport,
    zoom,
    setZoom,
    origin,
    setOrigin,
    extent,
    bounds,
    port,
    search: () => setSearchOpen(true),
  });
  return (
    <>
      {searchOpen ? (
        <OverviewSearch
          model={model}
          onChoose={commands.select}
          onClose={() => {
            setSearchOpen(false);
            viewport.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
          }}
        />
      ) : null}
      <OverviewControls
        zoom={zoom}
        run={commands.run}
        selected={selected}
        canFocus={model.folders.has(selected)}
        onFocus={() => port?.focus(selected)}
        onRearrange={rearrange}
      />
      <div
        ref={viewport}
        className="connected-groups"
        data-testid="connected-groups"
        data-zoom={zoom}
        data-selected={selected}
        onScroll={sample}
        onWheel={commands.cancel}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest("button,section,details"))
          )
            return;
          commands.cancel();
          const node = event.currentTarget;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: node.scrollLeft,
            top: node.scrollTop,
          };
          node.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
          event.currentTarget.scrollTop = start.top + start.y - event.clientY;
          sample();
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          ref={extent}
          style={{
            width: bounds.width * zoom + origin.x + 24,
            height: bounds.height * zoom + origin.y + 24,
            overflow: "hidden",
          }}
        >
          <div
            className="overview-canvas"
            style={{
              width: bounds.width,
              height: bounds.height,
              transform: `translate(${origin.x}px, ${origin.y}px) scale(${zoom})`,
            }}
          >
            <OverviewLinks
              shown={shown}
              boxes={boxes.current}
              bounds={bounds}
              windowBox={windowBox}
              zoom={zoom}
              selected={selected}
            />
            {mounted.map((group) => (
              <FolderGroup
                key={group.path}
                group={group}
                selected={selected}
                collapsed={collapsed.has(group.path)}
                onSelect={commands.select}
                onToggle={commands.toggle}
                onMeasure={onMeasure}
                onInclude={model.include}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
