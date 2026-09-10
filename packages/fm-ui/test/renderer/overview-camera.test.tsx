/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useGraphCamera } from "../../src/overview/useGraphCamera.ts";
import { useCameraAnimation } from "../../src/overview/useOverviewCamera.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("retargets held-key animation and uses immediate reduced motion", () => {
  vi.useFakeTimers();
  let point = { x: 0, y: 0 };
  const write = (value: typeof point) => {
    point = value;
  };
  const { result } = renderHook(() => useCameraAnimation(() => point, write, false));
  act(() => result.current({ x: 100, y: 0 }));
  act(() => vi.advanceTimersByTime(50));
  act(() => result.current({ x: 200, y: 0 }));
  act(() => vi.advanceTimersByTime(200));
  expect(point.x).toBe(200);
  const reduced = renderHook(() => useCameraAnimation(() => point, write, true));
  act(() => reduced.result.current({ x: 50, y: 10 }));
  expect(point).toEqual({ x: 50, y: 10 });
});

it.each([40, -20])(
  "retains a visible root header anchor at the scroll origin (left=%s)",
  (headerLeft) => {
    const viewport = document.createElement("div");
    const extent = document.createElement("div");
    const group = document.createElement("section");
    const header = document.createElement("button");
    group.dataset.group = "/root";
    header.setAttribute("data-basename", "");
    group.append(header);
    viewport.append(group);
    Object.defineProperties(viewport, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    group.getBoundingClientRect = () => new DOMRect(0, 0, 240, 500);
    header.getBoundingClientRect = () => new DOMRect(headerLeft, 20, 120, 20);
    let left = 0;
    Object.defineProperty(viewport, "scrollLeft", {
      get: () => left,
      set: (value: number) => {
        left = Math.max(0, value);
      },
    });
    const { result } = renderHook(() => {
      const [zoom, setZoom] = useState(1);
      const [origin, setOrigin] = useState({ x: 0, y: 0 });
      const camera = useGraphCamera({
        viewport: { current: viewport },
        extent: { current: extent },
        selected: "/root",
        zoom,
        setZoom,
        origin,
        setOrigin,
        bounds: { width: 2000, height: 1000 },
      });
      return { camera, zoom, origin };
    });
    act(() => result.current.camera.changeZoom(0.5));
    const center = headerLeft + 60;
    expect(result.current.origin).toEqual({ x: center / 2, y: 15 });
    expect(center * result.current.zoom + result.current.origin.x - viewport.scrollLeft).toBe(
      center,
    );
    expect(30 * result.current.zoom + result.current.origin.y - viewport.scrollTop).toBe(30);
  },
);
it("clamps keyboard pan to geometry with screen padding despite a larger browser extent", () => {
  vi.useFakeTimers();
  const viewport = document.createElement("div");
  Object.defineProperties(viewport, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
    scrollWidth: { value: 5000 },
    scrollHeight: { value: 5000 },
  });
  const { result } = renderHook(() =>
    useGraphCamera({
      viewport: { current: viewport },
      extent: { current: null },
      selected: "/root",
      zoom: 0.5,
      setZoom: () => undefined,
      origin: { x: 0, y: 0 },
      setOrigin: () => undefined,
      bounds: { width: 2000, height: 1000 },
    }),
  );
  act(() => result.current.pan("right", 1));
  act(() => vi.advanceTimersByTime(200));
  expect(viewport.scrollLeft).toBe(212);
  act(() => result.current.pan("down", 1));
  act(() => vi.advanceTimersByTime(200));
  expect(viewport.scrollTop).toBe(0);
});
