export interface StatusStripProps {
  readonly error: string | null;
  readonly message: string | null;
  readonly progress: { readonly done: number; readonly total: number } | null;
  onCancelTransfer(): void;
}

/**
 * The transient line: a failure, a running transfer, or what just happened.
 *
 * One component rather than three conditionals in the window, and one place
 * that decides which of the three wins when more than one is true. A failure
 * outranks a message because it is the one the user has to act on.
 */
export function StatusStrip({ error, message, progress, onCancelTransfer }: StatusStripProps) {
  if (error !== null) {
    return (
      <p data-testid="pane-error" className="pane-error">
        {error}
      </p>
    );
  }

  if (progress !== null) {
    return (
      <p data-testid="transfer-progress" className="pane-message">
        {progress.done} of {progress.total}
        {/* The control cancellation was missing.
            The whole path existed and worked — an `AbortController` per
            transfer, checked between entries, its own IPC channel — and
            nothing in the interface ever called it. Machinery with no way in
            is machinery that does not exist. */}
        <button type="button" data-testid="cancel-transfer" onClick={onCancelTransfer}>
          Cancel
        </button>
      </p>
    );
  }

  if (message !== null) {
    return (
      <p data-testid="pane-message" className="pane-message">
        {message}
      </p>
    );
  }

  return null;
}
