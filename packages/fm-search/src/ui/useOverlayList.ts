/**
 * The keyboard behaviour every overlay list shares.
 *
 * Focus on mount, an Escape backstop at the window, a Tab trap, and a clamped
 * highlight moved by the arrows or by Ctrl+J and Ctrl+K. The finder and the
 * panel's zoxide popup both need exactly this, and they differ only in what
 * Enter means — which is why confirming is deliberately NOT in here.
 *
 * **It is extracted because this logic has already had a bug.** The zoxide
 * popup was once UNCLOSABLE by keyboard: Tab moved focus off the field, so its
 * own handler stopped firing, and the dispatch cascade's modal step only calls
 * `preventDefault`, which swallowed every key into a dialog nothing could
 * dismiss. The window-level Escape listener below is the half of that fix which
 * does not depend on having thought of every key. Two copies of a fix like that
 * is one copy that will silently lose it.
 *
 * **It lives in this package for a boundary reason, not a topical one.** It is
 * a generic list primitive rather than anything to do with searching, but the
 * two consumers sit in packages that must not import each other: the finder
 * cannot reach into the file-manager panel, or a host could not mount it alone.
 * The shared home it deserves is a DOM-capable primitives package that does not
 * exist yet; until one does, the package both sides already depend on is the
 * only place it can go without breaking that rule.
 */
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";

export interface OverlayList {
  /** Attach to the query field. It takes focus on mount and keeps it. */
  readonly field: RefObject<HTMLInputElement | null>;
  /** The current row, always a real index while the list is non-empty. */
  readonly highlighted: number;
  /** Put the highlight back on the first row. Called when the query changes. */
  resetHighlight(): void;
  /**
   * Handle a key that belongs to the list.
   *
   * Returns whether it consumed the key, so a caller can add its own bindings
   * — Enter, above all — without repeating the ones here.
   */
  handleKey(event: KeyboardEvent): boolean;
}

export function useOverlayList(count: number, onClose: () => void): OverlayList {
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement | null>(null);

  // The field takes the keyboard, so what the user types goes into it rather
  // than into the pane behind. The dispatch cascade also reports a text input
  // as focused, which is the other half of the same guarantee.
  useEffect(() => {
    field.current?.focus();
  }, []);

  // Escape at the WINDOW, as a backstop. See this module's header for the bug
  // that put it here.
  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [onClose]);

  const last = Math.max(count - 1, 0);
  // Clamped rather than reset: narrowing the list under a highlight near the
  // bottom must leave it on something real, and putting it back to the top on
  // every keystroke would fight the user's arrow keys.
  const highlighted = Math.min(active, last);

  function handleKey(event: KeyboardEvent): boolean {
    // Every key belongs to the overlay while it is up. Letting one through
    // would move the cursor in the pane the user cannot see behind it.
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return true;
    }
    // One focusable element, so Tab has nowhere useful to go and moving focus
    // off the field would take the keyboard with it.
    if (event.key === "Tab") {
      event.preventDefault();
      return true;
    }
    // Ctrl+J and Ctrl+K beside the arrows: the pair the Qt finder binds, and
    // the pair a hand already on the home row reaches for.
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "j")) {
      event.preventDefault();
      setActive(Math.min(highlighted + 1, last));
      return true;
    }
    if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "k")) {
      event.preventDefault();
      setActive(Math.max(highlighted - 1, 0));
      return true;
    }
    return false;
  }

  return { field, highlighted, resetHighlight: () => setActive(0), handleKey };
}
