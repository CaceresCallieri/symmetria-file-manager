import { isTreeDirectory, type TreeRow } from "./model.ts";
import type { TreeCommand } from "./useTreeMode.ts";

interface TreeActions {
  select(path: string): void;
  toggle(path: string): void;
  activate(index: number): void;
}

function left(row: TreeRow, actions: TreeActions) {
  if (row.expanded) actions.toggle(row.path);
  else if (row.parent) actions.select(row.parent);
}

function right(row: TreeRow, child: TreeRow | undefined, actions: TreeActions) {
  if (!isTreeDirectory(row)) return;
  if (!row.expanded) actions.toggle(row.path);
  else if (child?.parent === row.path) actions.select(child.path);
}

export function runTreeCommand(
  command: TreeCommand,
  rows: readonly TreeRow[],
  cursor: number,
  actions: TreeActions,
) {
  const row = rows[cursor];
  if (!row) return;
  const move = (delta: number) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, cursor + delta))];
    if (next) actions.select(next.path);
  };
  const commands = {
    down: () => move(1),
    up: () => move(-1),
    activate: () => actions.activate(cursor),
    toggle: () => {
      if (isTreeDirectory(row)) actions.toggle(row.path);
    },
    left: () => left(row, actions),
    right: () => right(row, rows[cursor + 1], actions),
  } satisfies Record<TreeCommand, () => void>;
  commands[command]();
}
