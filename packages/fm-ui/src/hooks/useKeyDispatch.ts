import { type CascadeMode, handleKey, type KeyOutcome } from "@symmetria/fm-core/keys/cascade";
import { matchBinding } from "@symmetria/fm-core/keys/dispatch";
import type { KeyContext, KeyEvent } from "@symmetria/fm-core/keys/types";
import { useCallback, useEffect, useRef } from "react";

/**
 * Route every key press through the ported cascade.
 *
 * One listener on the window, because the cascade already decides who owns the
 * keyboard — a per-component handler would put that decision back in the DOM's
 * hands, where precedence is bubbling order rather than anything stated.
 */

/** True when the key landed in a field the user is typing into. */
function targetIsTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export interface KeyDispatchOptions {
  readonly mode: CascadeMode;
  readonly context: KeyContext;
  /** Called for a key the flash handler owns. */
  onFlashKey?: (event: KeyboardEvent) => boolean;
}

const SCROLL_KEYS = new Set([
  "PageDown",
  "PageUp",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  " ",
]);

/**
 * Focused reader surfaces need the browser's default scrolling action.
 *
 * The surface is resolved by ANCESTRY, not from the target itself. A link in a
 * markdown viewer — or any other focusable child of the scroll container — is
 * the event target while the container is the thing that scrolls, and matching
 * only the target left the reader unable to scroll by keyboard from then on.
 *
 * The `document.activeElement` fallback covers a target that is not an element,
 * which is how the suite dispatches a key on `window`, and also a key that
 * targets the document while `body` holds focus.
 */
function targetScrolls(event: KeyboardEvent): boolean {
  const node = event.target instanceof HTMLElement ? event.target : document.activeElement;
  const surface = node instanceof HTMLElement ? node.closest("[data-scrolls='true']") : null;
  return surface !== null && SCROLL_KEYS.has(event.key);
}

/**
 * Run one key through the cascade on a pointer control's behalf, and say
 * whether a binding ran.
 *
 * The header's buttons call this rather than the actions behind them, so a
 * click is gated exactly as its key is: a dialog swallows it, the picker
 * refuses the overview and a new tab, and `/` in the overview opens the
 * overview's own search. Calling `actions.startSearch` directly opened the
 * browsing search under the inert overview, where nothing could reach it.
 */
export type PressKey = (key: KeyEvent) => boolean;

export function useKeyDispatch({ mode, context, onFlashKey }: KeyDispatchOptions): PressKey {
  // The listener is attached once and reads through a ref.
  //
  // Re-attaching on every state change would be correct but wasteful, and it
  // would also drop a key that arrived mid-swap. The ref keeps one listener
  // looking at fresh state.
  const latest = useRef({ mode, context, onFlashKey });
  latest.current = { mode, context, onFlashKey };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (ignoredKeyEvent(event)) return;
      const { mode: currentMode, context: ctx, onFlashKey: flash } = latest.current;

      // Focus wins over everything, and it is decided by the DOM rather than by
      // the cascade — which is exactly what the corrected Escape order says.
      const effective: CascadeMode = {
        ...currentMode,
        textInputFocused: currentMode.textInputFocused || targetIsTextInput(event.target),
      };

      const key = {
        key: event.key,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
        altGraph: event.getModifierState("AltGraph"),
      };
      const outcome = routeKey(event, key, effective, ctx, flash);
      // `notOurs` and `unhandled` are the two that must NOT be swallowed: one
      // belongs to a text field, the other to whatever handles it next.
      if (outcome.kind === "notOurs" || outcome.kind === "unhandled") return;

      // A modal outcome consumes all keys, and the reader is the one modal that
      // must not swallow the browser's native scrolling. Asked AFTER the
      // cascade and only of a `modal` outcome: an early return would hand every
      // scroll key to the DOM for any surface that ever carries `data-scrolls`,
      // silently killing j/k navigation, flash mode and text-input routing
      // there. Escape and Ctrl+Enter are not scroll keys, so the reader's own
      // listener still gets them.
      if (outcome.kind === "modal" && targetScrolls(event)) return;

      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // True only when a binding RAN. A dialog, a pending chord, flash or the
  // picker pre-pass also consume a key, but nothing happened, and a caller that
  // read "consumed" as "done" queued its next step behind a swallowed click.
  return useCallback(
    (key: KeyEvent) =>
      handleKey(key, latest.current.mode, latest.current.context).kind === "dispatched",
    [],
  );
}

function routeKey(
  event: KeyboardEvent,
  key: KeyEvent,
  mode: CascadeMode,
  context: KeyContext,
  flash: KeyDispatchOptions["onFlashKey"],
): KeyOutcome {
  if (nativeOpsDialogKey(event, mode)) return { kind: "notOurs" };
  if (nativePdfControlKey(event, mode)) return { kind: "notOurs" };
  // Tree toolbar controls retain native activation. Otherwise Enter on Include
  // opened the selected file and prevented the focused button's default action.
  if (nativeControlActivation(event, context, mode)) return { kind: "notOurs" };
  if (repeatedFlash(event, key, mode, context)) return { kind: "unhandled" };
  const outcome = handleKey(key, mode, context);
  if (outcome.kind !== "flash" || flash?.(event) !== false) return outcome;
  return handleKey(key, { ...mode, flashActive: false }, context);
}

/** The modal gate must preserve native button activation and focus navigation. */
function nativeOpsDialogKey(event: KeyboardEvent, mode: CascadeMode): boolean {
  if (!mode.modalOpen || !(event.target instanceof Element)) return false;
  if (!event.target.closest(".ops-dialog")) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  return (
    event.key === "Tab" || (isPlainActivation(event) && event.target.closest("button") !== null)
  );
}

/** PDF controls use native activation and Tab navigation in both preview modes. */
function nativePdfControlKey(event: KeyboardEvent, mode: CascadeMode): boolean {
  if (mode.flashActive || mode.chordPrefix) return false;
  if (!(event.target instanceof Element)) return false;
  if (!event.target.closest(".preview--document")) return false;
  if ([event.ctrlKey, event.altKey, event.metaKey].some(Boolean)) return false;
  if (event.key === "Tab") return true;
  return isPlainActivation(event) && event.target.closest("button") !== null;
}

function nativeControlActivation(event: KeyboardEvent, context: KeyContext, mode: CascadeMode) {
  if (mode.modalOpen || mode.flashActive || mode.chordPrefix) return false;
  if (!isPlainActivation(event)) return false;
  if (!(event.target instanceof Element)) return false;
  // The status bar's buttons — a file dialog's Accept and Cancel, a transfer's
  // Cancel — keep native activation in every view. Without them in the list,
  // Enter on a focused Cancel in Columns ran `nav.activate`, which in a dialog
  // CONFIRMS the file under the cursor: the opposite of the button.
  const selector =
    context.view === "tree"
      ? "button, summary"
      : ".overview-toolbar button, .overview-toolbar summary, .status-bar button, .machine-dock button";
  return event.target.closest(selector) !== null;
}

function isPlainActivation(event: KeyboardEvent) {
  return (
    ![event.ctrlKey, event.altKey, event.metaKey, event.shiftKey].some(Boolean) &&
    ["Enter", " "].includes(event.key)
  );
}

function repeatedFlash(
  event: KeyboardEvent,
  key: KeyEvent,
  mode: CascadeMode,
  context: KeyContext,
) {
  return (
    event.repeat &&
    !mode.flashActive &&
    ["overview.flash", "flash.enter"].includes(matchBinding(key, context)?.id ?? "")
  );
}

function ignoredKeyEvent(event: KeyboardEvent): boolean {
  return [event.isComposing, event.defaultPrevented, event.repeat && event.key === "m"].some(
    Boolean,
  );
}
