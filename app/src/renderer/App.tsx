import type { CascadeMode } from "@symmetria/fm-core/keys/cascade";
import type { KeyContext } from "@symmetria/fm-core/keys/types";
import { useMemo } from "react";

import { HelpOverlay } from "./components/HelpOverlay.tsx";
import { MillerColumns } from "./components/MillerColumns.tsx";
import { OpsModals } from "./components/modals/OpsModals.tsx";
import { PathBar } from "./components/PathBar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { StatusStrip } from "./components/StatusStrip.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { WhichKeyOverlay } from "./components/WhichKeyOverlay.tsx";
import { useKeyDispatch } from "./hooks/useKeyDispatch.ts";
import { useFileOps } from "./useFileOps.ts";
import { useKeyActions } from "./useKeyActions.ts";
import { usePreview } from "./usePreview.ts";
import { useTabs } from "./useTabs.ts";

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
  const tabs = useTabs(startPath ?? initialPath());
  const ops = useFileOps(tabs);
  const { actions, modes, state } = useKeyActions(tabs, ops);
  const preview = usePreview(state.cursorEntry?.path ?? null);

  const context = useMemo<KeyContext>(
    // Miller is the only view that exists. The tree rows are ported and
    // unreachable until it does, which is deliberate — see the registry.
    () => ({ view: "miller", state, actions }),
    [state, actions],
  );

  const mode = useMemo<CascadeMode>(
    () => ({
      // One gate for every dialog: the help sheet and the operation dialogs
      // share it, so two can never be open at once.
      modalOpen: modes.helpOpen || ops.modal.kind !== "none",
      bookmarkSubMode: modes.bookmarkSubMode,
      chordPrefix: modes.chordPrefix,
      // Flash jump is a text-input mode that arrives with its own phase. Until
      // then nothing can enter it, so the cascade never reaches that step.
      flashActive: false,
      textInputFocused: false,
    }),
    [modes.helpOpen, modes.bookmarkSubMode, modes.chordPrefix, ops.modal.kind],
  );

  useKeyDispatch({ mode, context });

  return (
    <main className="app">
      {tabs.showBar ? (
        <TabBar
          views={tabs.views}
          activeIndex={tabs.activeIndex}
          onActivate={tabs.activate}
          onClose={tabs.close}
        />
      ) : null}
      <PathBar path={tabs.pane.path} />
      <MillerColumns
        path={tabs.pane.path}
        parentEntries={tabs.parentEntries}
        entries={tabs.pane.entries}
        cursorIndex={tabs.pane.cursorIndex}
        parentCursorName={tabs.parentCursorName}
        selection={tabs.pane.selection}
        preview={{
          route: preview.route,
          path: preview.path,
          size: preview.size,
          error: preview.error,
        }}
      />
      <WhichKeyOverlay
        prefix={modes.chordPrefix}
        cursorIsImage={state.cursorEntry?.isImage === true}
      />
      <StatusStrip
        error={tabs.error}
        message={ops.message ?? modes.message}
        progress={ops.progress}
        onCancelTransfer={ops.cancelRunningTransfer}
      />
      <StatusBar
        entryCount={tabs.pane.entries.length}
        selectedCount={state.selectedCount}
        sort={tabs.sort}
        showHidden={tabs.showHidden}
      />
      {modes.helpOpen ? <HelpOverlay context={context} onClose={modes.closeHelp} /> : null}
      <OpsModals
        modal={ops.modal}
        onCancel={ops.closeModal}
        onConfirmDelete={ops.confirmDelete}
        onConfirmRename={ops.confirmRename}
        onConfirmCreate={ops.confirmCreate}
        onConfirmOverwrite={ops.confirmOverwrite}
      />
    </main>
  );
}
