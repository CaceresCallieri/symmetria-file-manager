import type { CascadeMode } from "@symmetria/fm-core/keys/cascade";
import type { KeyContext } from "@symmetria/fm-core/keys/types";
import { useMemo } from "react";

import { HelpOverlay } from "./components/HelpOverlay.tsx";
import { MillerColumns } from "./components/MillerColumns.tsx";
import { PathBar } from "./components/PathBar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { WhichKeyOverlay } from "./components/WhichKeyOverlay.tsx";
import { useKeyDispatch } from "./hooks/useKeyDispatch.ts";
import { useKeyActions } from "./useKeyActions.ts";
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
  const { actions, modes, state } = useKeyActions(pane);

  const context = useMemo<KeyContext>(
    // Miller is the only view that exists. The tree rows are ported and
    // unreachable until it does, which is deliberate — see the registry.
    () => ({ view: "miller", state, actions }),
    [state, actions],
  );

  const mode = useMemo<CascadeMode>(
    () => ({
      modalOpen: modes.helpOpen,
      bookmarkSubMode: modes.bookmarkSubMode,
      chordPrefix: modes.chordPrefix,
      // Flash jump is a text-input mode that arrives with its own phase. Until
      // then nothing can enter it, so the cascade never reaches that step.
      flashActive: false,
      textInputFocused: false,
    }),
    [modes.helpOpen, modes.bookmarkSubMode, modes.chordPrefix],
  );

  useKeyDispatch({ mode, context });

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
      <WhichKeyOverlay
        prefix={modes.chordPrefix}
        cursorIsImage={state.cursorEntry?.isImage === true}
      />
      {modes.message === null ? null : (
        <p data-testid="pane-message" className="pane-message">
          {modes.message}
        </p>
      )}
      <StatusBar
        entryCount={pane.state.entries.length}
        selectedCount={state.selectedCount}
        sort={pane.sort}
        showHidden={pane.showHidden}
      />
      {modes.helpOpen ? <HelpOverlay context={context} onClose={modes.closeHelp} /> : null}
    </main>
  );
}
