import type { OverviewFolder } from "@symmetria/fm-core/overview/model";
import { joinPath } from "@symmetria/fm-core/pane";
import { cancelOverview, readOverview } from "../bridge.ts";
export const EXCLUSIONS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "__pycache__",
] as const;
export interface OverviewSnapshot {
  readonly folders: ReadonlyMap<string, OverviewFolder>;
  readonly loading: boolean;
  readonly inspected: number;
}
let nextSession = 0;
/** Owns reservations before starting reads, including reads whose replies are still pending. */
export class OverviewSession {
  readonly folders = new Map<string, OverviewFolder>();
  private queue: { path: string; depth: number }[] = [];
  private pending = new Set<string>();
  private inspected = 0;
  private reserved = 0;
  private reads = 0;
  private stopped = false;
  private serial = 0;
  private readonly id = nextSession++;
  constructor(
    readonly root: string,
    private readonly showHidden: boolean,
    private readonly changed: (snapshot: OverviewSnapshot) => void,
  ) {
    this.queue.push({ path: root, depth: 0 });
  }
  start(): void {
    this.pump();
  }
  stop(): void {
    this.stopped = true;
    for (const id of this.pending) cancelOverview(id);
    this.pending.clear();
  }
  include(path: string): void {
    const folder = this.folders.get(path);
    if (
      !folder ||
      folder.status === "Loaded" ||
      folder.status === "Loading" ||
      folder.status === "Queued"
    )
      return;
    this.folders.set(path, { ...folder, status: "Queued" });
    this.queue.push({ path, depth: folder.depth });
    this.pump();
  }
  private publish(): void {
    if (!this.stopped)
      this.changed({
        folders: new Map(this.folders),
        loading: this.pending.size > 0,
        inspected: this.inspected,
      });
  }
  private pump(): void {
    if (this.stopped) return;
    while (
      this.queue.length > 0 &&
      this.pending.size < 4 &&
      this.reads < 128 &&
      this.inspected + this.reserved < 5000
    ) {
      const next = this.queue.shift();
      if (!next) break;
      const limit = Math.min(1000, 5000 - this.inspected - this.reserved);
      const id = `overview:${this.id}:${this.serial++}`;
      this.reserved += limit;
      this.reads++;
      this.pending.add(id);
      this.folders.set(next.path, { ...next, entries: [], status: "Loading" });
      void this.read(next, id, limit);
    }
    if (this.pending.size === 0) {
      for (const next of this.queue)
        this.folders.set(next.path, { ...next, entries: [], status: "Traversal budget reached" });
      this.queue = [];
    }
    this.publish();
  }
  private addChildren(folder: OverviewFolder): void {
    for (const entry of folder.entries) {
      if (entry.kind !== "directory" || entry.isSymlink) continue;
      const path = joinPath(folder.path, entry.name);
      const depth = folder.depth + 1;
      if (this.folders.has(path)) continue;
      const excluded = EXCLUSIONS.some((name) => name === entry.name);
      const status = excluded ? "Excluded by scope" : depth >= 4 ? "Depth limit reached" : "Queued";
      this.folders.set(path, { path, depth, entries: [], status });
      if (status === "Queued") this.queue.push({ path, depth });
    }
  }
  private async read(
    next: { path: string; depth: number },
    id: string,
    limit: number,
  ): Promise<void> {
    const reply = await readOverview(next.path, id, limit);
    if (this.stopped) return;
    this.pending.delete(id);
    this.reserved -= limit;
    if (reply.ok) {
      this.inspected += reply.value.inspected;
      const entries = reply.value.entries
        .filter((entry) => this.showHidden || !entry.isHidden)
        .sort(
          (a, b) =>
            Number(b.kind === "directory") - Number(a.kind === "directory") ||
            a.name.localeCompare(b.name),
        );
      const folder = {
        ...next,
        entries,
        status: reply.value.truncated
          ? "Partial sorted subset — directory limit reached"
          : "Loaded",
      };
      this.folders.set(next.path, folder);
      this.addChildren(folder);
    } else
      this.folders.set(next.path, {
        ...next,
        entries: [],
        status: `Unreadable: ${reply.error.message}`,
      });
    this.pump();
  }
}
