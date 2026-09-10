import type { Box } from "@symmetria/fm-core/overview/layout";
import type { Point } from "@symmetria/fm-core/overview/viewport";
import { type OverviewSnapshot, representedEntries } from "./session.ts";
export interface OverviewViewState {
  readonly selected: string;
  readonly collapsed: ReadonlySet<string>;
  readonly zoom: number;
  readonly origin: Point;
  readonly scroll: Point;
  readonly boxes: ReadonlyMap<string, Box>;
}
interface CachedOverview {
  snapshot: OverviewSnapshot;
  view?: OverviewViewState;
}
/** One renderer owns this cache; no subscriptions or pending work enter it. */
export class OverviewCache {
  private roots = new Map<string, CachedOverview>();
  get size(): number {
    return this.roots.size;
  }
  get entries(): number {
    return [...this.roots.values()].reduce(
      (count, item) => count + representedEntries(item.snapshot.folders),
      0,
    );
  }
  get(key: string): CachedOverview | undefined {
    return this.roots.get(key);
  }
  save(key: string, snapshot: OverviewSnapshot): void {
    const previous = this.roots.get(key);
    this.roots.delete(key);
    this.roots.set(key, { ...previous, snapshot });
    while (this.roots.size > 3 || this.entries > 15000) {
      const oldest = this.roots.keys().next().value;
      if (oldest === undefined) break;
      this.roots.delete(oldest);
    }
  }
  saveView(key: string, view: OverviewViewState): void {
    const item = this.roots.get(key);
    if (item) item.view = view;
  }
}
