import {
  type Box,
  type GraphGroup,
  graphBounds,
  intersects,
  visibleGroups,
} from "@symmetria/fm-core/overview/layout";
import { joinPath } from "@symmetria/fm-core/pane";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FolderGroup } from "./FolderGroup.tsx";
import { OverviewControls } from "./OverviewControls.tsx";
import { OverviewLinks } from "./OverviewLinks.tsx";
import { OverviewMinimap } from "./OverviewMinimap.tsx";
import { OverviewSearch } from "./OverviewSearch.tsx";
import { useGraphAnchor } from "./useGraphAnchor.ts";
import { useGraphCommands } from "./useGraphCommands.ts";
import { useGraphScene } from "./useGraphScene.ts";
import { useGraphState, useRememberGraph } from "./useGraphState.ts";
import type { useOverview } from "./useOverview.ts";
import type { OverviewPort } from "./useOverviewMode.ts";
export function ConnectedGroups({
  root,
  model,
  port,
  renderToolbar = (controls) => controls,
  minimapVisible = true,
  onToggleMinimap,
}: {
  readonly minimapVisible?: boolean;
  readonly onToggleMinimap?: () => void;
  readonly root: string;
  readonly model: ReturnType<typeof useOverview>;
  readonly port?: OverviewPort;
  readonly renderToolbar?: (controls: ReactNode) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const extent = useRef<HTMLDivElement>(null);
  const state = useGraphState(root, model);
  const { collapsed, setCollapsed, selected, setSelected, zoom, setZoom, origin, setOrigin } =
    state;
  const [searchOpen, setSearchOpen] = useState(false);
  const [scroll, sample] = useViewportSample(viewport, extent, state.initial?.scroll);
  const { groups, boxes, onMeasure, rearrange } = useGraphScene(
    model.folders,
    state.initial?.boxes,
  );
  useRememberGraph(model, state, viewport, boxes);
  const shown = useMemo(() => visibleGroups(groups, collapsed), [groups, collapsed]);
  const bounds = useMemo(() => graphBounds(shown), [shown]);
  const windowBox = graphWindow(scroll, origin, zoom);
  useGraphAnchor(groups, selected, zoom, viewport, extent);
  const mounted = groupsInViewport(shown, windowBox, zoom, selected);
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
  const backgroundDrag = useBackgroundDrag(commands.cancel, sample);
  const controls = (
    <OverviewControls
      minimapVisible={minimapVisible}
      onToggleMinimap={onToggleMinimap}
      zoom={zoom}
      run={commands.run}
      selected={selected}
      canFocus={model.folders.has(selected)}
      onFocus={() => port?.focus(selected)}
      onRearrange={rearrange}
    />
  );
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
      {renderToolbar(controls)}
      <div className="overview-graph-frame">
        <div
          ref={viewport}
          className="connected-groups"
          data-testid="connected-groups"
          data-zoom={zoom}
          data-selected={selected}
          onScroll={sample}
          onWheel={commands.cancel}
          {...backgroundDrag}
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
        <OverviewMinimap
          visible={minimapVisible}
          shown={shown}
          bounds={bounds}
          windowBox={windowBox}
          viewportSize={scroll}
          onNavigate={commands.moveTo}
          onCancel={commands.cancel}
        />
      </div>
    </>
  );
}

function groupsInViewport(
  shown: readonly GraphGroup[],
  windowBox: Box,
  zoom: number,
  selected: string,
) {
  return shown.filter(
    (group) =>
      intersects(group, windowBox, 200 / zoom) ||
      group.path === selected ||
      group.entries.some((entry) => joinPath(group.path, entry.name) === selected),
  );
}

function useViewportSample(
  viewport: RefObject<HTMLDivElement | null>,
  extent: RefObject<HTMLDivElement | null>,
  restored: { x: number; y: number } | undefined,
) {
  const initialScroll = useRef(restored);
  const [scroll, setScroll] = useState({ x: 0, y: 0, width: 1200, height: 800 });
  const sample = useCallback(() => {
    const node = viewport.current;
    if (node)
      setScroll({
        x: node.scrollLeft,
        y: node.scrollTop,
        width: node.clientWidth,
        height: node.clientHeight,
      });
  }, [viewport]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (initialScroll.current) {
      // Restore trailing space before cached offsets; native scroll otherwise clamps them.
      if (extent.current) {
        extent.current.style.minWidth = `${initialScroll.current.x + node.clientWidth}px`;
        extent.current.style.minHeight = `${initialScroll.current.y + node.clientHeight}px`;
      }
      node.scrollLeft = initialScroll.current.x;
      node.scrollTop = initialScroll.current.y;
    }
    sample();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sample);
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewport, extent, sample]);
  return [scroll, sample] as const;
}

function useBackgroundDrag(cancel: () => void, sample: () => void) {
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const stop = () => {
    drag.current = null;
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element && event.target.closest("button,section,details"))
      )
        return;
      cancel();
      const node = event.currentTarget;
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        left: node.scrollLeft,
        top: node.scrollTop,
      };
      node.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (!start) return;
      event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
      event.currentTarget.scrollTop = start.top + start.y - event.clientY;
      sample();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  };
}

function graphWindow(scroll: Box, origin: { x: number; y: number }, zoom: number): Box {
  return {
    x: (scroll.x - origin.x) / zoom,
    y: (scroll.y - origin.y) / zoom,
    width: (scroll.width || 1200) / zoom,
    height: (scroll.height || 800) / zoom,
  };
}
