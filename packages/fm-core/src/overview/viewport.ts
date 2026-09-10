import type { Direction } from "./navigation.ts";
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}
export function panTarget(
  current: Point,
  viewport: Size,
  direction: Direction,
  fraction: number,
  bounds: Size,
): Point {
  const dx = direction === "left" ? -viewport.width : direction === "right" ? viewport.width : 0;
  const dy = direction === "up" ? -viewport.height : direction === "down" ? viewport.height : 0;
  return {
    x: Math.max(0, Math.min(Math.max(0, bounds.width - viewport.width), current.x + dx * fraction)),
    y: Math.max(
      0,
      Math.min(Math.max(0, bounds.height - viewport.height), current.y + dy * fraction),
    ),
  };
}
export function zoomScroll(scroll: Point, anchor: Point, from: number, to: number): Point {
  return {
    x: ((scroll.x + anchor.x) * to) / from - anchor.x,
    y: ((scroll.y + anchor.y) * to) / from - anchor.y,
  };
}
