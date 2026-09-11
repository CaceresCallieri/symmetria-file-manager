import type { FlashMatch, FlashTarget } from "@symmetria/fm-core/flash";
import { basename } from "@symmetria/fm-core/overview/model";
import { measureFlashTypography } from "./flashTypography.ts";

export interface FlashAnchor extends FlashTarget {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
interface Rectangle {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
export const FLASH_STATUS_LAYOUT = { inset: 12, width: 460, height: 48 };
export interface FlashScene {
  readonly zoom: number;
  readonly occluders: readonly Rectangle[];
  readonly names: ReadonlyMap<string, HTMLElement>;
  readonly targets: readonly FlashAnchor[];
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly token: string;
}
function overlaps(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function covered(rect: Rectangle, overlays: readonly Rectangle[]) {
  return overlays.some((overlay) => overlaps(rect, overlay));
}

/** Measure actual name spans; mounted overscan and pinned selection are not visibility. */
export function readFlashScene(viewport: HTMLElement): FlashScene {
  const clip = viewport.getBoundingClientRect();
  const panel = viewport.closest('[role="dialog"]');
  const overlays = [
    ...(panel?.querySelectorAll<HTMLElement>(
      ".overview-minimap-surface, .overview-popover, .overview-toolbar",
    ) ?? []),
  ]
    // Closed details can retain measurable boxes, but their popovers do not cover names.
    .filter((element) => !element.closest("details:not([open])"))
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  const status = FLASH_STATUS_LAYOUT;
  const occluders = [
    ...overlays,
    {
      left: clip.left + status.inset,
      right: Math.min(clip.right - status.inset, clip.left + status.inset + status.width),
      top: clip.bottom - status.inset - status.height,
      bottom: clip.bottom - status.inset,
    },
  ];
  const paths = new Map<string, FlashAnchor>();
  const names = new Map<string, HTMLElement>();
  const buttons = viewport.querySelectorAll<HTMLElement>("[data-entry], [data-basename]");
  for (const button of buttons) {
    const name = button.querySelector<HTMLElement>("span:last-child");
    if (!name) continue;
    const rect = name.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !overlaps(rect, clip) || covered(rect, occluders))
      continue;
    const path = button.dataset.entry ?? button.closest<HTMLElement>("[data-group]")?.dataset.group;
    if (!path || paths.has(path)) continue;
    names.set(path, name);
    paths.set(path, {
      path,
      name: basename(path),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
  }
  const targets = [...paths.values()].sort(
    (a, b) => a.top - b.top || a.left - b.left || (a.path < b.path ? -1 : 1),
  );
  return {
    zoom: Number(viewport.dataset.zoom ?? 1),
    targets,
    names,
    occluders,
    left: clip.left,
    right: clip.right,
    top: clip.top,
    bottom: clip.bottom,
    token: JSON.stringify([
      viewport.scrollLeft,
      viewport.scrollTop,
      viewport.clientWidth,
      viewport.clientHeight,
      viewport.dataset.zoom,
      targets,
      overlays.map((rect) => [rect.x, rect.y, rect.width, rect.height]),
    ]),
  };
}
export interface FlashLabel {
  readonly path: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly typography: ReturnType<typeof measureFlashTypography>;
  readonly match: { x: number; y: number; width: number; height: number; text: string };
}
/** If badges cannot fit without ambiguity, keep the query available for refinement. */
export function positionFlashLabels(
  scene: FlashScene,
  matches: readonly FlashMatch[],
  query: string,
): FlashLabel[] | null {
  const anchors = new Map(scene.targets.map((target) => [target.path, target]));
  const labels: FlashLabel[] = [];
  for (const match of matches) {
    if (!match.label) return null;
    const anchor = anchors.get(match.path);
    if (!anchor) return null;
    const name = scene.names.get(match.path);
    if (!name) return null;
    const matched = matchedTextRect(name, query);
    if (!matched) return null;
    const { rect: range, text, lineOffset } = matched;
    const typography = measureFlashTypography(name, match.label, scene.zoom);
    const { width, height } = typography;
    const top = anchor.top + lineOffset;
    const left = range.right;
    if (
      !labelFits(
        { left, right: left + width, top, bottom: top + height },
        scene,
        labels,
        match.path,
      )
    )
      return null;
    labels.push({
      path: match.path,
      label: match.label,
      x: left - scene.left,
      y: top - scene.top,
      width,
      typography,
      match: {
        x: range.left - scene.left,
        y: top - scene.top,
        width: range.width,
        height,
        text,
      },
    });
  }
  return labels;
}

function labelFits(box: Rectangle, scene: FlashScene, labels: readonly FlashLabel[], path: string) {
  if (
    box.left < scene.left ||
    box.top < scene.top ||
    box.right > scene.right ||
    box.bottom > scene.bottom
  )
    return false;
  if (
    covered(box, scene.occluders) ||
    covered(
      box,
      scene.targets.filter((target) => target.path !== path),
    )
  )
    return false;
  return !labels.some((label) =>
    overlaps(box, {
      left: label.x + scene.left,
      right: label.x + scene.left + label.width,
      top: label.y + scene.top,
      bottom: label.y + scene.top + label.typography.height,
    }),
  );
}

/** Measure the matched glyphs in the real font, including the current graph scale. */
function matchedTextRect(name: HTMLElement, query: string) {
  const text = name?.firstChild;
  if (!text || text.nodeType !== Node.TEXT_NODE || !query) return null;
  const content = text.textContent ?? "";
  const start = content.toLowerCase().indexOf(query.toLowerCase());
  if (start < 0) return null;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, Math.min(content.length, start + query.length));
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  range.setStart(text, 0);
  range.setEnd(text, Math.min(content.length, 1));
  const firstLine = range.getBoundingClientRect();
  return {
    rect,
    text: content.slice(start, start + query.length),
    lineOffset: rect.top - firstLine.top,
  };
}
