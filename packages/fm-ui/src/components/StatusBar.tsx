import type { SortMode } from "@symmetria/fm-core/sort";

import type { PickerChrome } from "../usePicker.ts";
import { SearchField, type SearchFieldProps } from "./SearchField.tsx";
import { type TransientLineProps, transientLine } from "./transientLine.tsx";

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
  /** The search field, when one is open. Null closes it. */
  readonly search: SearchFieldProps | null;
  /** A failure, a running transfer, or what just happened. */
  readonly transient: TransientLineProps;
}

/**
 * The one line at the bottom, and the only thing in the window that changes.
 *
 * ── It has a FIXED height, and that is the whole point ──────────────────────
 * The search field used to be a row of its own above the columns and the
 * transient strip a row of its own below them, so opening a search pushed the
 * listing down and a copy starting pushed it up — under the eyes of somebody
 * reading it. The operator asked to "use the status line that we have below,
 * just replace everything and just put the search there so that we do not have
 * any layout shift".
 *
 * So nothing enters or leaves the window's stack any more. This bar swaps its
 * CONTENTS, and `statusBar.test.tsx` asserts exactly that — happy-dom has no
 * layout engine, so what is checked is the cause rather than the pixels.
 *
 * ── Precedence, highest first ───────────────────────────────────────────────
 * The search field, because the user is typing into it. Then a failure, which
 * is the one they must act on. Then a transfer, which is running. Then a
 * message. Then the counts. The middle three are `transientLine`'s own order and
 * its comment says why; this file does not repeat it.
 *
 * The dialog chrome is a separate axis from the mode: Accept, Cancel and the
 * save-name field show whenever this is a dialog UNLESS search has the bar.
 * The operator chose that over crowding the row, and Escape brings them back.
 */
export function StatusBar({
  picker,
  entryCount,
  selectedCount,
  sort,
  reverse,
  showHidden,
  search,
  transient,
}: StatusBarProps) {
  return (
    <footer data-testid="status-bar" className="status-bar">
      {search === null ? (
        <>
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
          <Body
            entryCount={entryCount}
            selectedCount={selectedCount}
            sort={sort}
            reverse={reverse}
            showHidden={showHidden}
            transient={transient}
          />
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
        </>
      ) : (
        <SearchField {...search} />
      )}
    </footer>
  );
}

/**
 * What is in this pane, or what just happened to it.
 *
 * The transient line REPLACES the counts rather than sitting beside them, which
 * is what "just replace everything" means and what keeps the row from growing.
 *
 * The hidden-file state is shown because it changes what the count MEANS: "42
 * entries" with hidden files off is a different claim from the same number with
 * them on, and a user who cannot see which is in force cannot trust either.
 */
function Body({
  entryCount,
  selectedCount,
  sort,
  reverse,
  showHidden,
  transient,
}: Omit<StatusBarProps, "picker" | "search">) {
  const transientContent = transientLine(transient);
  if (transientContent !== null) return transientContent;

  return (
    <>
      <span>{entryCount} entries</span>
      {selectedCount > 0 ? <span>{selectedCount} selected</span> : null}
      {/* The direction is an arrow rather than the word "reversed", because it
          sits beside the mode name and reads as one phrase: "sort: size ↓". */}
      <span>
        sort: {sort} {reverse ? "↓" : "↑"}
      </span>
      {showHidden ? <span>hidden shown</span> : null}
    </>
  );
}
