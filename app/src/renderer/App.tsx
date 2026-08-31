import type { CascadeMode } from "@symmetria/fm-core/keys/cascade";
import type { KeyContext } from "@symmetria/fm-core/keys/types";
import { entryAt, isDirectoryEntry, joinPath, parentOf } from "@symmetria/fm-core/pane";
import { useMemo } from "react";

import { HelpOverlay } from "./components/HelpOverlay.tsx";
import { MillerColumns } from "./components/MillerColumns.tsx";
import { OpsModals } from "./components/modals/OpsModals.tsx";
import { PathBar } from "./components/PathBar.tsx";
import { SearchField } from "./components/SearchField.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { StatusStrip } from "./components/StatusStrip.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { WhichKeyOverlay } from "./components/WhichKeyOverlay.tsx";
import { useKeyDispatch } from "./hooks/useKeyDispatch.ts";
import { useBookmarks } from "./useBookmarks.ts";
import { useFileOps } from "./useFileOps.ts";
import { useKeyActions } from "./useKeyActions.ts";
import { usePreview } from "./usePreview.ts";
import { useSearch } from "./useSearch.ts";
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
  const search = useSearch({
    entries: tabs.pane.entries,
    cursorIndex: tabs.pane.cursorIndex,
    path: tabs.pane.path,
    moveTo: tabs.moveTo,
  });
  const bookmarks = useBookmarks();
  const { actions, modes, state } = useKeyActions(tabs, ops, search, bookmarks);
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
      // The seam the cascade documented and nothing used until now. The field
      // is a real `<input>`, so `useKeyDispatch` would report this anyway from
      // the event target — stating it here as well means a key that arrives
      // while the field is open but not yet focused is still not the
      // dispatcher's.
      textInputFocused: search.active,
    }),
    [modes.helpOpen, modes.bookmarkSubMode, modes.chordPrefix, ops.modal.kind, search.active],
  );

  useKeyDispatch({ mode, context });

  /**
   * A double click: move the cursor to what was clicked, then act on it.
   *
   * The order is load-bearing. Acting first would enter or open whatever the
   * cursor happened to be sitting on, which is almost never the row under the
   * pointer. `entryAt` asks about the clicked index rather than the cursor for
   * the same reason.
   *
   * The enter-or-open decision calls `isDirectoryEntry`, which is the same
   * function `useKeyActions` calls for the Enter key. Not the same SHAPE of
   * test — the same function, because two copies would eventually disagree
   * about a symlinked directory, which the scan reports as `directory`
   * precisely so it can be entered.
   */
  const activateAt = (index: number) => {
    tabs.moveTo(index);
    if (isDirectoryEntry(entryAt(tabs.pane, index))) tabs.enter();
    else ops.openAt(index);
  };

  /**
   * A click in the parent column: go to that sibling directory.
   *
   * Reached by name rather than by index, because the parent column's own
   * cursor is derived from a name lookup too — see `MillerColumns` — and the
   * two would have to be kept in step if either used an index.
   */
  const leaveTo = (name: string) => tabs.navigate(joinPath(parentOf(tabs.pane.path), name));

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
      <PathBar path={tabs.pane.path} onNavigate={tabs.navigate} />
      {search.active ? (
        <SearchField
          query={search.query}
          matchCount={search.matchCount}
          onChange={search.setQuery}
          onConfirm={search.confirm}
          onCancel={search.cancel}
        />
      ) : null}
      <MillerColumns
        path={tabs.pane.path}
        parentEntries={tabs.parentEntries}
        entries={tabs.pane.entries}
        cursorIndex={tabs.pane.cursorIndex}
        parentCursorName={tabs.parentCursorName}
        selection={tabs.pane.selection}
        matches={search.matches}
        onSelect={tabs.moveTo}
        onActivate={activateAt}
        onLeaveTo={leaveTo}
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
        bookmarks={bookmarks.byLetter}
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
        reverse={tabs.reverse}
        showHidden={tabs.showHidden}
      />
      {modes.helpOpen ? (
        <HelpOverlay context={context} bookmarks={bookmarks.byLetter} onClose={modes.closeHelp} />
      ) : null}
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
