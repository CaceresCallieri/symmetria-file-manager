import { type RefObject, useEffect } from "react";

/**
 * Take keyboard focus back when it leaves the page into an embedded viewer.
 *
 * Chromium's PDF viewer is a plugin: once it holds keyboard focus, no key
 * reaches the page, the main process, or any listener, so the overlay holding
 * it could not be closed from the keyboard. When focus leaves the document into
 * an `<embed>` inside `panel`, this takes it back on the next tick. The plugin
 * keeps mouse scrolling, which follows the pointer; it loses its own keys.
 *
 * **`<iframe>` is deliberately excluded.** The only framed preview is the HTML
 * one, an in-process document that keeps its own keys — stealing focus back
 * from it would make the framed page keyboard-dead for no gain.
 *
 * **Alt-tab is not distinguished, and that is a choice.** The window's `blur`
 * also fires when the user switches away with the embed focused, so the steal
 * happens while the window is in the background and the plugin loses its
 * in-document position on return. Re-checking the active element inside the
 * timeout narrows the window but does not close it; the alternative — leaving
 * the plugin holding the keys — costs the overlay its only way out.
 */
export function useEmbedFocusGuard(panel: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;

    const onBlur = () => {
      const stolen = document.activeElement;
      if (!(stolen instanceof HTMLEmbedElement)) return;
      if (panel.current?.contains(stolen) !== true) return;
      pending = setTimeout(() => {
        // Focus may have moved on during the tick — to another element, or
        // back on its own. Only take it from the embed that stole it.
        if (document.activeElement === stolen) panel.current?.focus();
      }, 0);
    };

    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      if (pending !== undefined) clearTimeout(pending);
    };
  }, [panel]);
}
