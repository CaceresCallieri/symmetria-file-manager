import { basename } from "@symmetria/fm-core/pane";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { isEscape, useOverlayCloseKeys } from "../../hooks/useOverlayCloseKeys.ts";
import type { OpsModal } from "../../useFileOps.ts";

/**
 * Every dialog the file operations open, behind one gate.
 *
 * A single active-modal value decides which one is up, so two cannot be open at
 * once — the pattern the Qt build used and the reason it never had to reason
 * about a rename dialog over a delete confirmation.
 *
 * Each dialog handles its own Escape and its own Enter. The cascade reports
 * `modal` and does nothing, which is what makes "the modal handles it" true
 * rather than a claim.
 */

export interface OpsModalsProps {
  readonly modal: OpsModal;
  onCancel(): void;
  onConfirmDelete(): void;
  onConfirmRename(name: string): void;
  onConfirmCreate(name: string): void;
  onConfirmOverwrite(): void;
}

/** Wrap from the panel or a boundary; the browser moves between other controls. */
function keepDialogFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
  // The panel and entry list keep focus inside after a click. Tab from the
  // panel enters at the first control; Shift+Tab enters at the last control.
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    'input:not(:disabled), button:not(:disabled), [tabindex="0"]',
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  const boundary = event.shiftKey ? first : last;
  if (event.target !== boundary && event.target !== event.currentTarget) return;

  // Unrestricted Tab left focus behind the modal, where the key cascade
  // swallowed subsequent Tab presses. Keep both boundaries inside the dialog.
  event.preventDefault();
  const destination = event.shiftKey ? last : first;
  destination?.focus();
}

/** A dialog shell: a title, whatever it asks, and its own keyboard handling. */
function Dialog({
  title,
  confirmLabel,
  testId,
  onCancel,
  onConfirm,
  focusConfirm = true,
  describedBy,
  children,
}: {
  readonly title: string;
  readonly confirmLabel: string;
  readonly testId: string;
  onCancel(): void;
  onConfirm(): void;
  readonly focusConfirm?: boolean;
  readonly describedBy?: string;
  readonly children?: React.ReactNode;
}) {
  useOverlayCloseKeys(onCancel, isEscape);
  const titleId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusConfirm) confirmButton.current?.focus();
  }, [focusConfirm]);

  return (
    <div className="overlay" data-testid={testId}>
      <div
        className="overlay__panel ops-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={keepDialogFocus}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">
          <button className="dialog__button dialog__cancel" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmButton}
            type="button"
            className="dialog__button dialog__confirm"
            data-testid="dialog-confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A dialog whose answer is a name the user types. */
function NameDialog({
  title,
  confirmLabel,
  testId,
  initial,
  selectTo,
  hint,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly confirmLabel: string;
  readonly testId: string;
  readonly initial: string;
  readonly selectTo: number;
  readonly hint?: string;
  onCancel(): void;
  onConfirm(name: string): void;
}) {
  const hintId = useId();
  const [name, setName] = useState(initial);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = field.current;
    if (input === null) return;

    input.focus();
    // Select the stem, not the whole name: the extension is almost never what
    // changes, and having to skip past it every time is the friction `⇧R`
    // exists to opt out of.
    input.setSelectionRange(0, selectTo);
  }, [selectTo]);

  return (
    <Dialog
      title={title}
      confirmLabel={confirmLabel}
      testId={testId}
      onCancel={onCancel}
      onConfirm={() => onConfirm(name)}
      focusConfirm={false}
    >
      <input
        ref={field}
        aria-label="Name"
        aria-describedby={hint === undefined ? undefined : hintId}
        className="dialog__name"
        value={name}
        data-testid="dialog-name"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onConfirm(name);
        }}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="dialog__hint">
          {hint}
        </p>
      )}
    </Dialog>
  );
}

/** Entries can be full trash paths or conflict names supplied by the bridge. */
function EntryList({
  entries,
  label,
  testId,
}: {
  readonly entries: readonly string[];
  readonly label: string;
  readonly testId: string;
}) {
  return (
    <ul
      className="dialog__entries"
      data-testid={testId}
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus and scroll every entry before confirmation.
      tabIndex={0}
      data-scrolls="true"
    >
      {entries.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Confirmation snapshots never reorder, and repeated destination names need distinct keys.
        <li key={`${index}:${entry}`} title={entry}>
          {basename(entry)}
        </li>
      ))}
    </ul>
  );
}

export function OpsModals(props: OpsModalsProps) {
  const { modal, onCancel } = props;
  const hintId = useId();

  if (modal.kind === "delete") {
    return (
      <Dialog
        title={
          modal.paths.length === 1
            ? "Move to trash?"
            : `Move ${modal.paths.length} entries to trash?`
        }
        confirmLabel="Move to trash"
        testId="modal-delete"
        onCancel={onCancel}
        onConfirm={props.onConfirmDelete}
        describedBy={hintId}
      >
        <EntryList entries={modal.paths} label="Entries to move to trash" testId="delete-list" />
        {/* Not a delete. It goes to the desktop trash and comes back from it. */}
        <p id={hintId} className="dialog__hint">
          Recoverable from the desktop trash.
        </p>
      </Dialog>
    );
  }

  if (modal.kind === "rename") {
    return (
      <NameDialog
        title="Rename"
        confirmLabel="Rename"
        testId="modal-rename"
        initial={modal.name}
        selectTo={modal.selectTo}
        onCancel={onCancel}
        onConfirm={props.onConfirmRename}
      />
    );
  }

  if (modal.kind === "create") {
    return (
      <NameDialog
        title="New file or folder"
        confirmLabel="Create"
        testId="modal-create"
        initial=""
        selectTo={0}
        hint="End with / for a folder. Missing parents are created."
        onCancel={onCancel}
        onConfirm={props.onConfirmCreate}
      />
    );
  }

  if (modal.kind === "conflict") {
    return (
      <Dialog
        title={`Replace existing ${modal.conflicts.length === 1 ? "entry" : "entries"}?`}
        confirmLabel="Replace"
        testId="modal-conflict"
        onCancel={onCancel}
        onConfirm={props.onConfirmOverwrite}
        describedBy={hintId}
      >
        <EntryList
          entries={modal.conflicts}
          label="Entries already at the destination"
          testId="conflict-list"
        />
        <p id={hintId} className="dialog__hint">
          Nothing was transferred. Replace overwrites existing content.
        </p>
      </Dialog>
    );
  }

  return null;
}
