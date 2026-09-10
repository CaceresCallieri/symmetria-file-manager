/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { ConnectedGroups } from "../../src/overview/ConnectedGroups.tsx";
import { installBridge } from "./support.ts";

let viewportWidth = 1200;
let viewportHeight = 800;
const resizeCallbacks = new Set<() => void>();
beforeEach(() => {
  viewportWidth = 1200;
  viewportHeight = 800;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("connected-groups") ? viewportWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("connected-groups") ? viewportHeight : 0;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {}
      observe() {
        resizeCallbacks.add(this.callback);
      }
      disconnect() {
        resizeCallbacks.delete(this.callback);
      }
      unobserve() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resizeCallbacks.clear();
});
async function open() {
  const log = installBridge();
  const bridge = window.symmetriaFm;
  if (!bridge) throw new Error("missing bridge");
  const overviewReads = vi.spyOn(bridge, "overview");
  render(<App startPath="/home/jc" />);
  fireEvent.keyDown(window, { key: "O", shiftKey: true });
  await screen.findByTestId("connected-groups");
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  return { ...log, overviewReads };
}
const map = () => screen.getByRole("img", { name: "Folder overview minimap" });
const leaf = (name: string) => ({
  name,
  kind: "directory" as const,
  isHidden: false,
  isSymlink: false,
});
function model() {
  return {
    folders: new Map([
      ["/root", { path: "/root", depth: 0, status: "Loaded", entries: [leaf("a")] }],
      ["/root/a", { path: "/root/a", depth: 1, status: "Loaded", entries: [leaf("b")] }],
      ["/root/a/b", { path: "/root/a/b", depth: 2, status: "Loaded", entries: [] }],
    ]),
    inspected: 2,
    loading: false,
    include: () => undefined,
  };
}
it("toggles through Alt+M and includes the binding in keyboard help", async () => {
  await open();
  expect(map()).toBeTruthy();
  fireEvent.keyDown(window, { key: "m", altKey: true });
  expect(screen.queryByRole("img", { name: "Folder overview minimap" })).toBeNull();
  fireEvent.keyDown(window, { key: "m", altKey: true });
  expect(map()).toBeTruthy();
  fireEvent.keyDown(window, { key: "?", shiftKey: true });
  expect(await screen.findByText("Toggle minimap")).toBeTruthy();
});
it("remembers visibility through close, reopen, and a focused root", async () => {
  await open();
  expect(map()).toBeTruthy();
  fireEvent.keyDown(window, { key: "m", altKey: true });
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyDown(window, { key: "O", shiftKey: true });
  await screen.findByTestId("connected-groups");
  expect(screen.queryByRole("img", { name: "Folder overview minimap" })).toBeNull();
  fireEvent.keyDown(window, { key: "l" });
  screen.getByText("Details").closest("details")?.setAttribute("open", "");
  fireEvent.click(screen.getByRole("button", { name: "Focus here" }));
  expect(screen.queryByRole("img", { name: "Folder overview minimap" })).toBeNull();
});
it("maps offscreen groups but omits descendants of collapsed groups", () => {
  render(<ConnectedGroups root="/root" model={model()} />);
  const viewport = screen.getByTestId("connected-groups");
  viewport.scrollLeft = 10000;
  fireEvent.scroll(viewport);
  expect(map().querySelectorAll("[data-minimap-group]")).toHaveLength(3);
  expect(viewport.querySelectorAll("[data-group]").length).toBeLessThan(3);
  viewport.scrollLeft = 0;
  fireEvent.scroll(viewport);
  fireEvent.click(screen.getByRole("button", { name: "Collapse a" }));
  expect(map().querySelectorAll("[data-minimap-group]")).toHaveLength(2);
});
it("updates the viewport indicator when actual scroll or zoom changes", () => {
  render(<ConnectedGroups root="/root" model={model()} />);
  const viewport = screen.getByTestId("connected-groups");
  const indicator = () => map().querySelector("[data-minimap-viewport]");
  const initial = indicator()?.getAttribute("x");
  viewport.scrollLeft = 500;
  fireEvent.scroll(viewport);
  expect(indicator()?.getAttribute("x")).not.toBe(initial);
  const before = indicator()?.getAttribute("width");
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(indicator()?.getAttribute("width")).not.toBe(before);
});
it("places the map outside the scrolling and scaled graph", () => {
  render(<ConnectedGroups root="/root" model={model()} />);
  const viewport = screen.getByTestId("connected-groups");
  expect(viewport.contains(map())).toBe(false);
  expect(map().closest(".overview-canvas")).toBeNull();
  expect(viewport.parentElement?.contains(map())).toBe(true);
});
it("does not add reads, watches, or full cards when toggled", async () => {
  const log = await open();
  const viewport = screen.getByTestId("connected-groups");
  const before = {
    overviewReads: log.overviewReads.mock.calls.length,
    reads: log.listed.length,
    watches: log.watched.length,
    cards: viewport.querySelectorAll("[data-group]").length,
  };
  expect(map().querySelectorAll("[data-minimap-group]").length).toBeGreaterThan(0);
  fireEvent.keyDown(window, { key: "m", altKey: true });
  fireEvent.keyDown(window, { key: "m", altKey: true });
  expect({
    overviewReads: log.overviewReads.mock.calls.length,
    reads: log.listed.length,
    watches: log.watched.length,
    cards: viewport.querySelectorAll("[data-group]").length,
  }).toEqual(before);
});
it("exposes visibility state without making graph primitives focusable", async () => {
  await open();
  screen.getByText("Details").closest("details")?.setAttribute("open", "");
  const toggle = screen.getByRole("button", { name: "Toggle minimap" });
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(map().querySelectorAll("button,[tabindex]")).toHaveLength(0);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
});

it("withholds a minimap after its measured viewport becomes zero-sized", () => {
  render(<ConnectedGroups root="/root" model={model()} />);
  expect(map()).toBeTruthy();
  viewportWidth = 0;
  act(() => {
    for (const callback of resizeCallbacks) callback();
  });
  expect(screen.queryByRole("img", { name: "Folder overview minimap" })).toBeNull();
});

function assertProjection() {
  const viewport = screen.getByTestId("connected-groups");
  const canvas = viewport.querySelector<HTMLElement>(".overview-canvas");
  if (!canvas) throw new Error("missing canvas");
  const match = /translate\(([-.\d]+)px, ([-.\d]+)px\)/.exec(canvas.style.transform);
  if (!match) throw new Error("missing origin");
  const zoom = Number(viewport.dataset.zoom);
  const graphWidth = Number.parseFloat(canvas.style.width);
  const graphHeight = Number.parseFloat(canvas.style.height);
  const width = Number(map().getAttribute("width"));
  const height = Number(map().getAttribute("height"));
  const scale = Math.min((width - 16) / graphWidth, (height - 16) / graphHeight);
  const offsetX = (width - graphWidth * scale) / 2;
  const offsetY = (height - graphHeight * scale) / 2;
  const x = (viewport.scrollLeft - Number(match[1])) / zoom;
  const y = (viewport.scrollTop - Number(match[2])) / zoom;
  const left = Math.max(0, Math.min(graphWidth, x));
  const top = Math.max(0, Math.min(graphHeight, y));
  const right = Math.max(0, Math.min(graphWidth, x + viewportWidth / zoom));
  const bottom = Math.max(0, Math.min(graphHeight, y + viewportHeight / zoom));
  const indicator = map().querySelector("[data-minimap-viewport]");
  for (const [attribute, value] of Object.entries({
    x: offsetX + left * scale,
    y: offsetY + top * scale,
    width: (right - left) * scale,
    height: (bottom - top) * scale,
  })) {
    expect(Number(indicator?.getAttribute(attribute))).toBeCloseTo(value, 8);
  }
}
it("projects restored origin, live layout, zoom, fit, and measured resize accurately", () => {
  const initial = {
    ...model(),
    view: {
      selected: "/root",
      collapsed: new Set<string>(),
      zoom: 0.5,
      origin: { x: 37, y: 29 },
      scroll: { x: 120, y: 70 },
      boxes: new Map(),
    },
  };
  const { rerender } = render(<ConnectedGroups root="/root" model={initial} />);
  assertProjection();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  fireEvent.scroll(screen.getByTestId("connected-groups"));
  assertProjection();
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  fireEvent.scroll(screen.getByTestId("connected-groups"));
  assertProjection();
  viewportWidth = 640;
  viewportHeight = 480;
  act(() => {
    for (const callback of resizeCallbacks) callback();
  });
  assertProjection();
  const changed = model();
  changed.folders.set("/root/a/b", {
    path: "/root/a/b",
    depth: 2,
    status: "Loaded",
    entries: Array.from({ length: 120 }, (_, i) => leaf(String(i))),
  });
  rerender(<ConnectedGroups root="/root" model={changed} />);
  fireEvent.scroll(screen.getByTestId("connected-groups"));
  assertProjection();
});
it("tracks the actual camera after keyboard pan", async () => {
  await open();
  vi.useFakeTimers();
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  act(() => vi.advanceTimersByTime(200));
  fireEvent.scroll(screen.getByTestId("connected-groups"));
  assertProjection();
});
