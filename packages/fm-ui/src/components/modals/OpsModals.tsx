import { type KeyboardEvent, useEffect, useRef, useState } from "react";

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

/** Wrap only at the boundaries; the browser moves between the other controls. */
function keepDialogFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    "input:not(:disabled), button:not(:disabled)",
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  const boundary = event.shiftKey ? first : last;
  if (event.target !== boundary) return;

  // Unrestricted Tab left focus behind the modal, where the key cascade
  // swallowed subsequent Tab presses. Keep both boundaries inside the dialog.
  event.preventDefault();
  const destination = event.shiftKey ? last : first;
  destination?.focus();
}

/** A dialog shell: a title, whatever it asks, and its own keyboard handling. */
function Dialog({
  title,
  testId,
  onCancel,
  onConfirm,
  focusConfirm = true,
  children,
}: {
  readonly title: string;
  readonly testId: string;
  onCancel(): void;
  onConfirm(): void;
  readonly focusConfirm?: boolean;
  readonly children?: React.ReactNode;
}) {
  useOverlayCloseKeys(onCancel, isEscape);
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
        aria-label={title}
        onKeyDown={keepDialogFocus}
      >
        <h2>{title}</h2>
        {children}
        <div className="dialog__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmButton}
            type="button"
            data-testid="dialog-confirm"
            onClick={onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/** A dialog whose answer is a name the user types. */
function NameDialog({
  title,
  testId,
  initial,
  selectTo,
  hint,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly testId: string;
  readonly initial: string;
  readonly selectTo: number;
  readonly hint?: string;
  onCancel(): void;
  onConfirm(name: string): void;
}) {
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
      testId={testId}
      onCancel={onCancel}
      onConfirm={() => onConfirm(name)}
      focusConfirm={false}
    >
      <input
        ref={field}
        value={name}
        data-testid="dialog-name"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onConfirm(name);
        }}
      />
      {hint === undefined ? null : <p className="dialog__hint">{hint}</p>}
    </Dialog>
  );
}

export function OpsModals(props: OpsModalsProps) {
  const { modal, onCancel } = props;

  if (modal.kind === "delete") {
    return (
      <Dialog
        title={`Trash ${modal.paths.length} ${modal.paths.length === 1 ? "entry" : "entries"}?`}
        testId="modal-delete"
        onCancel={onCancel}
        onConfirm={props.onConfirmDelete}
      >
        <ul data-testid="delete-list">
          {modal.paths.map((path) => (
            <li key={path}>{path.split("/").pop()}</li>
          ))}
        </ul>
        {/* Not a delete. It goes to the desktop trash and comes back from it. */}
        <p className="dialog__hint">Recoverable from the desktop trash.</p>
      </Dialog>
    );
  }

  if (modal.kind === "rename") {
    return (
      <NameDialog
        title="Rename"
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
        title="Already there"
        testId="modal-conflict"
        onCancel={onCancel}
        onConfirm={props.onConfirmOverwrite}
      >
        <ul data-testid="conflict-list">
          {modal.conflicts.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="dialog__hint">Confirm to replace. Nothing has been transferred yet.</p>
      </Dialog>
    );
  }

  return null;
}
