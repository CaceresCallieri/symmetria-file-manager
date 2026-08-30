import type { SortMode } from "@symmetria/fm-core/sort";

export interface StatusBarProps {
  readonly entryCount: number;
  readonly selectedCount: number;
  readonly sort: SortMode;
  readonly showHidden: boolean;
}

/**
 * What is in this pane, and how it is ordered.
 *
 * The hidden-file state is shown because it changes what the count MEANS: "42
 * entries" with hidden files off is a different claim from the same number with
 * them on, and a user who cannot see which is in force cannot trust either.
 */
export function StatusBar({ entryCount, selectedCount, sort, showHidden }: StatusBarProps) {
  return (
    <footer data-testid="status-bar" className="status-bar">
      <span>{entryCount} entries</span>
      {selectedCount > 0 ? <span>{selectedCount} selected</span> : null}
      <span>sort: {sort}</span>
      {showHidden ? <span>hidden shown</span> : null}
    </footer>
  );
}
