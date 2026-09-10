import type { OverviewEntry } from "./contract.ts";
export interface OverviewFolder {
  readonly path: string;
  readonly depth: number;
  readonly entries: readonly OverviewEntry[];
  readonly status: string;
}
export function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "/";
}

export function isAncestorPath(parent: string, child: string): boolean {
  return parent === child || child.startsWith(parent === "/" ? "/" : `${parent}/`);
}
