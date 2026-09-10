import { useCallback, useEffect, useRef, useState } from "react";
import { OverviewCache, type OverviewViewState } from "./cache.ts";
import { EXCLUSIONS, OverviewSession, type OverviewSnapshot } from "./session.ts";
export interface OverviewModel extends OverviewSnapshot {
  include(path: string): void;
  readonly view?: OverviewViewState | undefined;
  saveView?(view: OverviewViewState): void;
  refresh?(): void;
  readonly refreshing?: boolean;
  readonly paused?: boolean;
}
const EMPTY: OverviewSnapshot = { folders: new Map(), loading: true, inspected: 0 };
export function useOverview(root: string | null, showHidden: boolean): OverviewModel {
  const cache = useRef(new OverviewCache());
  const key = JSON.stringify([root, showHidden, EXCLUSIONS]);
  const [result, setResult] = useState({ key: "", snapshot: EMPTY, refreshing: false });
  const [paused, setPaused] = useState(document.visibilityState === "hidden");
  const active = useRef<{ stop(): void; include(path: string): void } | null>(null);
  const cached = cache.current.get(key);
  const snapshot = result.key === key ? result.snapshot : (cached?.snapshot ?? EMPTY);
  useEffect(() => {
    const visibility = () => setPaused(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  const start = useCallback(() => {
    active.current?.stop();
    active.current = null;
    if (root === null || paused) return;
    const stored = cache.current;
    const seed = stored.get(key)?.snapshot;
    const session = new OverviewSession(
      root,
      showHidden,
      (next) => {
        stored.save(key, next);
        setResult({ key, snapshot: next, refreshing: seed !== undefined && next.loading });
      },
      seed,
    );
    active.current = { stop: () => session.stop(), include: (path) => session.include(path) };
    session.start();
  }, [root, showHidden, key, paused]);
  useEffect(() => {
    start();
    return () => {
      active.current?.stop();
      active.current = null;
    };
  }, [start]);
  return {
    ...snapshot,
    paused,
    refreshing: result.key === key ? result.refreshing : cached !== undefined,
    view: cached?.view,
    saveView: (view) => cache.current.saveView(key, view),
    include: (path) => active.current?.include(path),
    refresh: start,
  };
}
