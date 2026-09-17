import { type RefObject, useEffect } from "react";
/**
 * Focus the dialog, and restore the triggering control when it closes.
 *
 * **The panel never takes focus a descendant already holds.** React runs child
 * effects before parent effects, so a viewer that focuses its own scroll
 * container is focused by the time this runs — and without the containment
 * check this would take it straight back, leaving the reader open with keyboard
 * scrolling silently dead. That does not happen today only because the file
 * read is asynchronous and the viewer mounts in a later commit; any read cache
 * makes the two commits one. Do not simplify this to a bare `focus()`.
 */
export function useDialogFocus(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const origin = document.activeElement;
    if (panel.current?.contains(document.activeElement) !== true) panel.current?.focus();
    return () => {
      if (origin instanceof HTMLElement) origin.focus();
    };
  }, [panel]);
}
