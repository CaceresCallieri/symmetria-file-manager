import type { SortMode } from "@symmetria/fm-core/sort";

import type { PickerChrome } from "../usePicker.ts";

export interface StatusBarProps {
  /**
   * The dialog chrome, or null in the browse window.
   *
   * In the status bar rather than in a row of its own, matching the Qt build —
   * the operator chose that, and it is what "parity" means to anyone comparing
   * the two side by side.
   */
  readonly picker: PickerChrome | null;
  readonly entryCount: number;
  readonly selectedCount: number;
  readonly sort: SortMode;
  readonly reverse: boolean;
  readonly showHidden: boolean;
}

/**
 * What is in this pane, and how it is ordered.
 *
 * The hidden-file state is shown because it changes what the count MEANS: "42
 * entries" with hidden files off is a different claim from the same number with
 * them on, and a user who cannot see which is in force cannot trust either.
 */
export function StatusBar({
  picker,
  entryCount,
  selectedCount,
  sort,
  reverse,
  showHidden,
}: StatusBarProps) {
  return (
    <footer data-testid="status-bar" className="status-bar">
      {picker === null ? null : (
        <button
          type="button"
          data-testid="picker-accept"
          className="status-bar__accept"
          disabled={!picker.acceptEnabled}
          onClick={picker.confirm}
        >
          {picker.acceptLabel}
        </button>
      )}
      {picker?.saveMode === true ? (
        <input
          type="text"
          data-testid="picker-save-name"
          className="status-bar__save-name"
          ref={picker.saveNameRef}
          value={picker.saveName}
          aria-label="File name"
          onChange={(event) => picker.setSaveName(event.target.value)}
        />
      ) : null}
      <span>{entryCount} entries</span>
      {selectedCount > 0 ? <span>{selectedCount} selected</span> : null}
      {/* The direction is an arrow rather than the word "reversed", because it
          sits beside the mode name and reads as one phrase: "sort: size ↓". */}
      <span>
        sort: {sort} {reverse ? "↓" : "↑"}
      </span>
      {showHidden ? <span>hidden shown</span> : null}
      {picker === null ? null : (
        <button
          type="button"
          data-testid="picker-cancel"
          className="status-bar__cancel"
          onClick={picker.cancel}
        >
          Cancel
        </button>
      )}
    </footer>
  );
}
