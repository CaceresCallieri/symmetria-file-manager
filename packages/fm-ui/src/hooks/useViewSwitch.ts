import type { KeyEvent, ViewKind } from "@symmetria/fm-core/keys/types";
import { useCallback, useEffect, useRef } from "react";

import type { PressKey } from "./useKeyDispatch.ts";

function ctrl(key: string): KeyEvent {
  return { key, ctrl: true, shift: false, alt: false, meta: false };
}

/** `view.toggle`: opens the tree. An idempotent OPEN, never a toggle. */
const OPEN_TREE = ctrl("e");
/** `miller.overview` opens it; `overview.toggle` closes it to where it came from. */
const TOGGLE_OVERVIEW = ctrl("o");

/**
 * The header's three-way switch, pressed through the same keys a person would
 * use (`Ctrl+E` opens the tree, `Ctrl+O` opens or closes the overview), so
 * every gate those keys have applies to the click too: the picker refuses
 * both, a dialog swallows them. Leaving the tree for Columns calls `closeTree`,
 * as the tree toolbar's own "Miller" control does: `Ctrl+E` never closes, and
 * Escape would first spend itself clearing marks or a search.
 *
 * From the overview, reaching Tree or Columns can take two steps. `Ctrl+O`
 * closes the overview back to the view it was opened FROM, and only once React
 * has rendered that view does the second step mean anything — the overview's
 * own bindings do not include `Ctrl+E`. So the second step waits for the view
 * to change, runs at most once, and is dropped if the first key was refused.
 */
export function useViewSwitch(
  view: ViewKind,
  press: PressKey,
  closeTree: () => void,
): (target: ViewKind) => void {
  const followUp = useRef<ViewKind | null>(null);

  const step = useCallback(
    (from: ViewKind, target: ViewKind) => {
      if (target === "tree") press(OPEN_TREE);
      else if (from === "tree") closeTree();
    },
    [press, closeTree],
  );

  useEffect(() => {
    const target = followUp.current;
    if (target === null || view === "overview") return;
    followUp.current = null;
    if (view !== target) step(view, target);
  }, [view, step]);

  return useCallback(
    (target: ViewKind) => {
      if (target === view) return;
      if (view !== "overview" && target !== "overview") {
        step(view, target);
        return;
      }
      const accepted = press(TOGGLE_OVERVIEW);
      followUp.current = accepted && view === "overview" ? target : null;
    },
    [view, press, step],
  );
}
