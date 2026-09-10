import {
  type GraphGroup,
  layoutGroups,
  type Measurement,
} from "@symmetria/fm-core/overview/layout";
import type { OverviewFolder } from "@symmetria/fm-core/overview/model";
import { useCallback, useMemo, useRef, useState } from "react";
export function useGraphScene(folders: ReadonlyMap<string, OverviewFolder>) {
  const boxes = useRef(new Map<string, GraphGroup>());
  const [measurements, setMeasurements] = useState(new Map<string, Measurement>());
  const groups = useMemo(() => {
    const next = layoutGroups([...folders.values()], boxes.current, measurements);
    boxes.current = new Map(next.map((group) => [group.path, group]));
    return next;
  }, [folders, measurements]);
  const onMeasure = useCallback(
    (path: string, size: Measurement) =>
      setMeasurements((current) => {
        const old = current.get(path);
        if (old?.width === size.width && old.height === size.height) return current;
        return new Map(current).set(path, size);
      }),
    [],
  );
  return {
    groups,
    boxes,
    onMeasure,
    rearrange: () => {
      boxes.current = new Map();
      setMeasurements(new Map());
    },
  };
}
