/** @vitest-environment happy-dom */
import { expect, it } from "vitest";
import { type FlashScene, positionFlashLabels } from "../../src/overview/flashTargets.ts";

function scene(occluders: FlashScene["occluders"] = []): FlashScene {
  return {
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    token: "fixture",
    occluders,
    targets: [{ path: "/a", name: "a", left: 100, right: 150, top: 100, bottom: 124 }],
  };
}
it("tries the other side when a minimap or status would cover a badge", () => {
  const captured = scene([{ left: 60, right: 99, top: 100, bottom: 125 }]);
  const labels = positionFlashLabels(captured, [{ path: "/a", name: "a", label: "s" }]);
  expect(labels?.[0]?.x).toBe(153);
  expect(
    positionFlashLabels(scene([{ left: 0, right: 800, top: 95, bottom: 130 }]), [
      { path: "/a", name: "a", label: "s" },
    ]),
  ).toBeNull();
});
it("refuses overlapping badges and preserves nearby name text", () => {
  const captured = scene();
  const targets = [
    ...captured.targets,
    { path: "/b", name: "b", left: 100, right: 150, top: 102, bottom: 126 },
    { path: "/c", name: "c", left: 100, right: 150, top: 104, bottom: 128 },
  ];
  expect(
    positionFlashLabels(
      { ...captured, targets },
      targets.map((target, index) => ({ ...target, label: String(index) })),
    ),
  ).toBeNull();
  const names = [
    ...captured.targets,
    { path: "/b", name: "b", left: 75, right: 99, top: 100, bottom: 125 },
  ];
  expect(
    positionFlashLabels({ ...captured, targets: names }, [
      { path: "/a", name: "a", label: "s" },
    ])?.[0]?.x,
  ).toBe(153);
});
