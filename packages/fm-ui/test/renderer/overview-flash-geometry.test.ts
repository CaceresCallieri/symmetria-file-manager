/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type FlashScene,
  positionFlashLabels,
  readFlashScene,
} from "../../src/overview/flashTargets.ts";
import { mockTextRanges } from "./flash-text-geometry.ts";

beforeEach(() => mockTextRanges((character) => (character === "l" ? 4 : 9)));
afterEach(() => vi.restoreAllMocks());
function scene(occluders: FlashScene["occluders"] = []): FlashScene {
  const name = document.createElement("span");
  name.textContent = "pull";
  vi.spyOn(name, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 26, 24));
  return {
    zoom: 1,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    token: "fixture",
    occluders,
    names: new Map([["/pull", name]]),
    targets: [{ path: "/pull", name: "pull", left: 100, right: 126, top: 100, bottom: 124 }],
  };
}
const match = { path: "/pull", name: "pull", label: "s" };
it("places labels over the suffix after the actual matched glyphs", () => {
  const captured = scene();
  const labels = positionFlashLabels(captured, [match], "pu");
  expect(labels?.[0]?.x).toBe(118);
  expect(labels?.[0]?.match).toEqual({ x: 100, y: 100, width: 18, height: 24, text: "pu" });
  expect(positionFlashLabels(captured, [match], "ul")?.[0]?.x).toBe(122);
  expect(positionFlashLabels(captured, [match], "pull")?.[0]?.x).toBe(126);
});
it("refuses a label hidden by a minimap, status, or viewport edge instead of moving it before the query", () => {
  const captured = scene([{ left: 117, right: 140, top: 95, bottom: 130 }]);
  expect(positionFlashLabels(captured, [match], "pu")).toBeNull();
  expect(positionFlashLabels({ ...scene(), right: 120 }, [match], "pu")).toBeNull();
});
it("allows replacement of the target suffix but protects nearby names and other labels", () => {
  const captured = scene();
  const neighbor = { path: "/other", name: "other", left: 127, right: 180, top: 100, bottom: 124 };
  expect(
    positionFlashLabels({ ...captured, targets: [...captured.targets, neighbor] }, [match], "pu"),
  ).toBeNull();
  expect(positionFlashLabels(captured, [match, { ...match, label: "d" }], "pu")).toBeNull();
});

it("excludes only open popovers when capturing visible names", () => {
  const panel = document.createElement("div");
  panel.setAttribute("role", "dialog");
  const viewport = document.createElement("div");
  const row = document.createElement("button");
  row.dataset.entry = "/pull";
  const name = document.createElement("span");
  name.textContent = "pull";
  row.append(name);
  viewport.append(row);
  const details = document.createElement("details");
  const popover = document.createElement("div");
  popover.className = "overview-popover";
  details.append(popover);
  panel.append(viewport, details);
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
  vi.spyOn(name, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 26, 24));
  vi.spyOn(popover, "getBoundingClientRect").mockReturnValue(new DOMRect(90, 90, 100, 100));
  expect(readFlashScene(viewport).targets.map((target) => target.path)).toEqual(["/pull"]);
  details.open = true;
  expect(readFlashScene(viewport).targets).toEqual([]);
});

it("scales jump typography with the graph and preserves the matched filename case", () => {
  const captured = scene();
  const name = captured.names.get("/pull");
  if (!name) throw new Error("Missing fixture name");
  name.textContent = "Pull";
  const label = positionFlashLabels({ ...captured, zoom: 2 }, [match], "pu")?.[0];
  expect(label?.typography).toMatchObject({ fontSize: "28px", lineHeight: "48px", height: 48 });
  expect(label?.match.text).toBe("Pu");
  expect(label?.y).toBe(label?.match.y);
});
