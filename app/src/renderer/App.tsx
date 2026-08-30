import { useEffect } from "react";

import { MillerColumns } from "./components/MillerColumns.tsx";
import { PathBar } from "./components/PathBar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { usePane } from "./usePane.ts";

/**
 * Where a window opens when nothing says otherwise.
 *
 * The home directory, read from the location hash so the main process can open
 * a window elsewhere without a second channel. Falling back to `/` rather than
 * throwing keeps a window with a malformed hash usable.
 */
function initialPath(): string {
  const requested = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return requested.startsWith("/") ? requested : "/";
}

export interface AppProps {
  /** Overridden by tests, which must not depend on the real location. */
  readonly startPath?: string;
}

export function App({ startPath }: AppProps = {}) {
  const pane = usePane(startPath ?? initialPath());
  const { moveBy, enter, leave } = pane;

  // A minimal, deliberately temporary key handler.
  //
  // The real one is the ported `KeyRegistry` — 54 declarative bindings feeding
  // both dispatch and the help popup — which is phase 6 and replaces this
  // wholesale. Four keys are here because "navigate" is what this phase claims
  // to deliver, and a claim nobody can exercise from the keyboard is not
  // delivered. Do NOT grow this switch: every key added here is one the
  // registry has to reclaim.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const moved = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[event.key];
      if (moved !== undefined) {
        moveBy(moved);
      } else if (event.key === "l" || event.key === "ArrowRight" || event.key === "Enter") {
        enter();
      } else if (event.key === "h" || event.key === "ArrowLeft") {
        leave();
      } else {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveBy, enter, leave]);

  return (
    <main className="app">
      <PathBar path={pane.state.path} />
      {pane.error === null ? null : (
        <p data-testid="pane-error" className="pane-error">
          {pane.error}
        </p>
      )}
      <MillerColumns
        path={pane.state.path}
        parentEntries={pane.parentEntries}
        entries={pane.state.entries}
        cursorIndex={pane.state.cursorIndex}
        parentCursorName={pane.parentCursorName}
      />
      <StatusBar
        entryCount={pane.state.entries.length}
        selectedCount={0}
        sort={pane.sort}
        showHidden={pane.showHidden}
      />
    </main>
  );
}
