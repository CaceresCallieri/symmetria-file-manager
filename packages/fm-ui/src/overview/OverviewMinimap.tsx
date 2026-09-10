import type { Box, GraphGroup } from "@symmetria/fm-core/overview/layout";
import {
  minimapProjection,
  projectMinimapViewport,
  type Size,
} from "@symmetria/fm-core/overview/viewport";
import { memo, useMemo } from "react";
import { OverviewLinks } from "./OverviewLinks.tsx";

const MinimapGeometry = memo(function MinimapGeometry({
  shown,
  bounds,
}: {
  readonly shown: readonly GraphGroup[];
  readonly bounds: Box;
}) {
  const boxes = useMemo(() => new Map(shown.map((group) => [group.path, group])), [shown]);
  return (
    <g className="minimap-geometry">
      <OverviewLinks
        shown={shown}
        boxes={boxes}
        bounds={bounds}
        windowBox={bounds}
        zoom={1}
        selected=""
      />
      {shown.map((group) => (
        <rect
          key={group.path}
          data-minimap-group={group.path}
          x={group.x}
          y={group.y}
          width={group.width}
          height={group.height}
        />
      ))}
    </g>
  );
});

export function OverviewMinimap({
  visible,
  shown,
  bounds,
  windowBox,
  viewportSize,
}: {
  readonly shown: readonly GraphGroup[];
  readonly bounds: Box;
  readonly windowBox: Box;
  readonly viewportSize: Size;
  readonly visible: boolean;
}) {
  const projection = minimapProjection(bounds, viewportSize);
  if (!visible || !projection) return null;
  const indicator = projectMinimapViewport(windowBox, projection);
  return (
    <svg
      className="overview-minimap"
      role="img"
      aria-label="Folder overview minimap"
      width={projection.width}
      height={projection.height}
      viewBox={`0 0 ${projection.width} ${projection.height}`}
    >
      <title>Folder overview minimap</title>
      <g
        transform={`translate(${projection.offset.x} ${projection.offset.y}) scale(${projection.scale})`}
      >
        <MinimapGeometry shown={shown} bounds={bounds} />
      </g>
      <rect
        data-minimap-viewport=""
        className="minimap-viewport"
        x={indicator.x}
        y={indicator.y}
        width={indicator.width}
        height={indicator.height}
      />
      {indicator.outside ? (
        <circle className="minimap-outside" cx={indicator.x} cy={indicator.y} r={3} />
      ) : null}
    </svg>
  );
}
