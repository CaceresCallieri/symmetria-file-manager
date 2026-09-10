import {
  type GraphGroup,
  graphBounds,
  intersects,
  layoutGroups,
  type Measurement,
  visibleGroups,
} from "@symmetria/fm-core/overview/layout";
import { isAncestorPath } from "@symmetria/fm-core/overview/model";
import { joinPath } from "@symmetria/fm-core/pane";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FolderGroup } from "./FolderGroup.tsx";
import type { useOverview } from "./useOverview.ts";
export function ConnectedGroups({
  root,
  model,
}: {
  readonly root: string;
  readonly model: ReturnType<typeof useOverview>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const extent = useRef<HTMLDivElement>(null);
  const boxes = useRef(new Map<string, GraphGroup>());
  const [measurements, setMeasurements] = useState(new Map<string, Measurement>());
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [selected, setSelected] = useState(root);
  const [zoom, setZoom] = useState(1);
  const [scroll, setScroll] = useState({ x: 0, y: 0, width: 1200, height: 800 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const groups = useMemo(() => {
    const next = layoutGroups([...model.folders.values()], boxes.current, measurements);
    boxes.current = new Map(next.map((group) => [group.path, group]));
    return next;
  }, [model.folders, measurements]);
  const shown = visibleGroups(groups, collapsed);
  const bounds = graphBounds(shown);
  const windowBox = {
    x: scroll.x / zoom,
    y: scroll.y / zoom,
    width: scroll.width / zoom,
    height: scroll.height / zoom,
  };
  const onMeasure = useCallback(
    (path: string, size: Measurement) =>
      setMeasurements((current) => {
        const old = current.get(path);
        if (old?.width === size.width && old.height === size.height) return current;
        const next = new Map(current);
        next.set(path, size);
        return next;
      }),
    [],
  );
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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
  const anchor = useRef<{ selection: string; path: string; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const group =
      groups.find((item) => item.path === selected) ??
      groups.find((item) =>
        item.entries.some((entry) => joinPath(item.path, entry.name) === selected),
      );
    if (!group) return;
    const previous = anchor.current;
    const node = viewport.current;
    if (node && previous?.selection === selected && previous.path === group.path) {
      const x = node.scrollLeft + (group.x - previous.x) * zoom;
      const y = node.scrollTop + (group.y - previous.y) * zoom;
      // A last group has no content below it. Reserve trailing camera space
      // before scrolling so the browser does not clamp away the retained anchor.
      if (extent.current) {
        extent.current.style.minWidth = `${Math.max(0, x) + node.clientWidth}px`;
        extent.current.style.minHeight = `${Math.max(0, y) + node.clientHeight}px`;
      }
      node.scrollLeft = x;
      node.scrollTop = y;
    }
    anchor.current = { selection: selected, path: group.path, x: group.x, y: group.y };
  }, [groups, selected, zoom]);
  const mounted = shown.filter(
    (group) =>
      intersects(group, windowBox, 200 / zoom) ||
      group.path === selected ||
      group.entries.some((entry) => joinPath(group.path, entry.name) === selected),
  );
  return (
    <>
      <div className="overview-camera-controls">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom((value) => Math.max(0.1, value / 1.2))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom((value) => Math.min(2, value * 1.2))}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(
              Math.max(
                0.1,
                Math.min(
                  2,
                  (scroll.width - 48) / bounds.width,
                  (scroll.height - 48) / bounds.height,
                ),
              ),
            );
            viewport.current?.scrollTo(0, 0);
          }}
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => {
            boxes.current = new Map();
            setMeasurements(new Map());
          }}
        >
          Rearrange
        </button>
        <details>
          <summary>Details</summary>
          <div className="overview-popover">
            <p>{selected}</p>
          </div>
        </details>
      </div>
      <div
        ref={viewport}
        className="connected-groups"
        data-testid="connected-groups"
        data-zoom={zoom}
        onScroll={sample}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target instanceof Element && event.target.closest("button,section,details"))
          )
            return;
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
        <div ref={extent} style={{ width: bounds.width * zoom, height: bounds.height * zoom }}>
          <div
            className="overview-canvas"
            style={{ width: bounds.width, height: bounds.height, transform: `scale(${zoom})` }}
          >
            <svg
              className="overview-links"
              width={bounds.width}
              height={bounds.height}
              aria-hidden="true"
            >
              {shown.map((group) => {
                if (group.parent === null) return null;
                const parent = boxes.current.get(group.parent);
                if (!parent) return null;
                const x = parent.x + parent.width,
                  y = parent.y + 20,
                  ty = group.y + 20;
                if (
                  !intersects(
                    { x, y: Math.min(y, ty), width: group.x - x, height: Math.abs(y - ty) },
                    windowBox,
                    200 / zoom,
                  )
                )
                  return null;
                return (
                  <g
                    key={group.path}
                    data-edge={group.path}
                    className={
                      isAncestorPath(group.path, selected)
                        ? "overview-edge active"
                        : "overview-edge"
                    }
                  >
                    <path
                      d={`M ${x} ${y} C ${x + 40} ${y}, ${group.x - 40} ${ty}, ${group.x} ${ty}`}
                    />
                    <circle cx={x} cy={y} r={3} />
                    <circle cx={group.x} cy={ty} r={3} />
                  </g>
                );
              })}
            </svg>
            {mounted.map((group) => (
              <FolderGroup
                key={group.path}
                group={group}
                selected={selected}
                collapsed={collapsed.has(group.path)}
                onSelect={setSelected}
                onToggle={toggle}
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
