import type { FlashMatch, FlashTarget } from "@symmetria/fm-core/flash";
import { basename } from "@symmetria/fm-core/overview/model";

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
  readonly occluders: readonly Rectangle[];
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
  const buttons = viewport.querySelectorAll<HTMLElement>("[data-entry], [data-basename]");
  for (const button of buttons) {
    const name = button.querySelector<HTMLElement>("span:last-child");
    if (!name) continue;
    const rect = name.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !overlaps(rect, clip) || covered(rect, occluders))
      continue;
    const path = button.dataset.entry ?? button.closest<HTMLElement>("[data-group]")?.dataset.group;
    if (!path || paths.has(path)) continue;
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
    targets,
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
}
/** If badges cannot fit without ambiguity, keep the query available for refinement. */
export function positionFlashLabels(
  scene: FlashScene,
  matches: readonly FlashMatch[],
): FlashLabel[] | null {
  const anchors = new Map(scene.targets.map((target) => [target.path, target]));
  const labels: FlashLabel[] = [];
  for (const match of matches) {
    if (!match.label) return null;
    const anchor = anchors.get(match.path);
    if (!anchor) return null;
    const width = match.label.length * 8 + 8;
    const top = Math.max(scene.top, (anchor.top + anchor.bottom) / 2 - 9);
    const left = [anchor.left - width - 3, anchor.right + 3].find((candidate) =>
      labelFits(
        { left: candidate, right: candidate + width, top, bottom: top + 18 },
        scene,
        labels,
      ),
    );
    if (left === undefined) return null;
    labels.push({
      path: match.path,
      label: match.label,
      x: left - scene.left,
      y: top - scene.top,
      width,
    });
  }
  return labels;
}

function labelFits(box: Rectangle, scene: FlashScene, labels: readonly FlashLabel[]) {
  if (
    box.left < scene.left ||
    box.top < scene.top ||
    box.right > scene.right ||
    box.bottom > scene.bottom
  )
    return false;
  if (covered(box, scene.occluders) || covered(box, scene.targets)) return false;
  return !labels.some((label) =>
    overlaps(box, {
      left: label.x + scene.left,
      right: label.x + scene.left + label.width,
      top: label.y + scene.top,
      bottom: label.y + scene.top + 18,
    }),
  );
}
