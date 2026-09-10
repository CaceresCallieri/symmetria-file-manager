import { useEffect, useRef, useState } from "react";
import { OverviewSession, type OverviewSnapshot } from "./session.ts";
export function useOverview(root: string | null, showHidden: boolean) {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot>({
    folders: new Map(),
    loading: true,
    inspected: 0,
  });
  const include = useRef<(path: string) => void>(() => undefined);
  useEffect(() => {
    if (root === null) return;
    const active = new OverviewSession(root, showHidden, setSnapshot);
    include.current = (path) => active.include(path);
    active.start();
    return () => {
      active.stop();
      include.current = () => undefined;
    };
  }, [root, showHidden]);
  return { ...snapshot, include: (path: string) => include.current(path) };
}
