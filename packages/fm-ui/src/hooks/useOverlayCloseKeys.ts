import { useEffect, useRef } from "react";

export interface OverlayCloseKeyOptions {
  /**
   * Cancel the key and stop every listener registered AFTER this one.
   *
   * An operation dialog can arrive asynchronously behind the overlay that owns
   * the key — it mounts later, so its own window listener is registered later,
   * and without this it would cancel that operation on the same press. This is
   * a listener-ORDERING contract, not a fact about any one overlay: it can only
   * suppress what came after it, and it can never suppress `useKeyDispatch`,
   * whose listener is attached at application mount and has already run.
   */
  readonly consume?: boolean;
}

/** The key every overlay closes on, so the call sites cannot drift apart. */
export function isEscape(event: KeyboardEvent): boolean {
  return event.key === "Escape";
}

/**
 * Close an overlay from the keys the overlay itself owns.
 *
 * One window listener, attached once and reading the caller's callbacks through
 * a ref. Re-attaching on every render would be correct for the closing, and
 * WRONG for `consume`: a re-attached listener moves to the end of the
 * registration order, behind the dialogs it exists to suppress, and nothing
 * would fail to say so.
 */
export function useOverlayCloseKeys(
  onClose: () => void,
  matches: (event: KeyboardEvent) => boolean,
  options?: OverlayCloseKeyOptions,
): void {
  const latest = useRef({ onClose, matches, consume: options?.consume === true });
  latest.current = { onClose, matches, consume: options?.consume === true };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { onClose: close, matches: owns, consume } = latest.current;
      if (!owns(event)) return;
      if (consume) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
