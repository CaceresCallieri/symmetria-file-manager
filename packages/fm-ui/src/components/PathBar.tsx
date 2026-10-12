import { breadcrumbs } from "@symmetria/fm-core/pane";
import { CornerDownLeft, Folder, Pencil } from "lucide-react";
import type { usePickerPath } from "../usePickerPath.ts";

export interface PathBarProps {
  readonly path: string;
  /** Go to a segment. Absent leaves every crumb inert. */
  readonly onNavigate?: (path: string) => void;
  readonly pathEntry?: ReturnType<typeof usePickerPath> | undefined;
}

/**
 * The location, as segments.
 *
 * A picker can replace the breadcrumbs with an editable local path.
 *
 * The last crumb is inert because it is where we already are, and it stays a
 * `span` rather than becoming a disabled control — there is nothing to disable
 * when there was never anything to press.
 *
 * The two suppressed accessibility rules want a focusable element with its own
 * key handler. Every location a crumb points at is already reachable by
 * keyboard — `h` walks up one segment at a time — so a crumb adds a pointer
 * shortcut rather than a capability, and making it focusable would put it in
 * the tab order ahead of the list and take keys from the document keymap. The
 * same reasoning, at more length, is in `FileRow.tsx`.
 */
export function PathBar({ path, onNavigate, pathEntry }: PathBarProps) {
  if (pathEntry?.editing) return <PathInput entry={pathEntry} />;
  const crumbs = breadcrumbs(path);

  return (
    <nav data-testid="path-bar" className="path-bar">
      {crumbs.map((crumb, index) => {
        const isCurrent = index === crumbs.length - 1;
        const clickable = !isCurrent && onNavigate !== undefined;

        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut, see above
          // biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut, see above
          <span
            key={crumb.path}
            data-testid={isCurrent ? "crumb-current" : "crumb"}
            className={`crumb${isCurrent ? " crumb--current" : ""}${
              clickable ? " crumb--clickable" : ""
            }`}
            // Focus stays where it was, for the same reason it does on a row:
            // the document-level key handler owns the keymap, and a focused
            // crumb would swallow every key that followed the click.
            onMouseDown={clickable ? (event) => event.preventDefault() : undefined}
            onClick={clickable ? () => onNavigate(crumb.path) : undefined}
          >
            {crumb.label}
          </span>
        );
      })}
      {pathEntry ? (
        <button
          type="button"
          className="path-bar__edit"
          onClick={pathEntry.focus}
          aria-label="Enter file or folder path (Ctrl+L)"
          title="Enter file or folder path (Ctrl+L)"
        >
          <Pencil size={14} aria-hidden="true" />
          <kbd>
            Ctrl<span>L</span>
          </kbd>
        </button>
      ) : null}
    </nav>
  );
}

function PathInput({ entry }: { readonly entry: ReturnType<typeof usePickerPath> }) {
  return (
    <form
      className="path-entry"
      onSubmit={(event) => {
        event.preventDefault();
        void entry.submit();
      }}
    >
      <div className="path-entry__control" data-invalid={entry.error !== null}>
        <Folder size={15} className="path-entry__icon" aria-hidden="true" />
        <input
          ref={entry.inputRef}
          aria-label="File or folder path"
          className="path-entry__input"
          value={entry.value}
          readOnly={entry.busy}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={entry.error !== null}
          aria-describedby={entry.error ? "picker-path-error" : undefined}
          aria-busy={entry.busy}
          onChange={(event) => entry.setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void entry.submit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              entry.cancel();
            }
            if (event.key.toLowerCase() === "l" && event.ctrlKey) {
              event.preventDefault();
              event.currentTarget.select();
            }
          }}
        />
        {entry.error ? (
          <span
            id="picker-path-error"
            className="path-entry__error"
            role="alert"
            title={entry.error}
          >
            {entry.error}
          </span>
        ) : null}
        <button
          type="submit"
          className="path-entry__submit"
          disabled={entry.busy}
          aria-label="Go to path (Enter)"
          title="Go to path (Enter)"
        >
          <CornerDownLeft size={15} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
