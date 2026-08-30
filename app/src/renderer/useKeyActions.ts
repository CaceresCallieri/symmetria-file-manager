import type { BookmarkSubMode, KeyActions, KeyState } from "@symmetria/fm-core/keys/types";
import { useMemo, useState } from "react";

import type { Pane } from "./usePane.ts";

/**
 * The host's half of the keyboard contract.
 *
 * The registry says WHICH operation a key means; this says what the operation
 * does. Splitting them is what lets the whole keymap be tested without a window
 * — and it is what makes the gap below visible rather than hidden.
 *
 * ── Operations that do not exist yet ────────────────────────────────────────
 * The registry is ported whole, so it names operations later phases build:
 * file operations, tabs, previews, the fuzzy finder, flash jump. Rather than
 * omit those rows — which would make the cheat sheet lie — each one reports
 * that it is not built yet. A key that says "not yet" is honest; a key that
 * silently does nothing is a bug report waiting to happen.
 */

/** Modes the cascade needs and the host owns. */
interface KeyModes {
  readonly chordPrefix: string;
  readonly bookmarkSubMode: BookmarkSubMode | null;
  readonly helpOpen: boolean;
  readonly message: string | null;
  closeHelp(): void;
  clearMessage(): void;
}

export interface KeyWiring {
  readonly actions: KeyActions;
  readonly modes: KeyModes;
  readonly state: KeyState;
}

/**
 * Roughly half a screen of rows.
 *
 * The Qt original asked the view for its own metric. Nothing reports one yet,
 * so this derives from the window: at a 24-pixel row, half the viewport is a
 * usable approximation and is never zero.
 */
function halfPageRows(): number {
  const viewport = typeof window === "undefined" ? 800 : window.innerHeight;
  return Math.max(1, Math.floor(viewport / 2 / 24));
}

export function useKeyActions(pane: Pane): KeyWiring {
  const [chordPrefix, setChordPrefix] = useState("");
  const [bookmarkSubMode, setBookmarkSubMode] = useState<BookmarkSubMode | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const actions = useMemo<KeyActions>(() => {
    const soon = (what: string) => () => setMessage(`${what} is not built yet`);

    return {
      // Navigation — the operations this phase can actually perform.
      moveDown: () => pane.moveBy(1),
      moveUp: () => pane.moveBy(-1),
      jumpToTop: () => pane.moveTo(0),
      jumpToBottom: () => pane.moveTo(pane.state.entries.length - 1),
      halfPageDown: () => pane.moveBy(halfPageRows()),
      halfPageUp: () => pane.moveBy(-halfPageRows()),
      activate: () => pane.enter(),
      goUp: () => pane.leave(),
      enterDirectory: () => pane.enter(),
      goHome: soon("Go home"),
      jumpDirectoryFileBoundary: soon("Jump to the directory/file boundary"),
      dismiss: () => setMessage(null),

      historyBack: soon("History"),
      historyForward: soon("History"),

      trash: soon("Trash"),
      rename: soon("Rename"),
      createEntry: soon("New file or folder"),
      editSaveName: soon("Editing the save name"),

      yank: soon("Yank"),
      cut: soon("Cut"),
      paste: soon("Paste"),
      copyToClipboard: soon("Copy to clipboard"),

      toggleSelection: soon("Selection"),
      clearSelection: soon("Selection"),

      startSearch: soon("Search"),
      nextMatch: soon("Search"),
      previousMatch: soon("Search"),
      startFlash: soon("Flash jump"),
      openFuzzyFinder: soon("The fuzzy finder"),
      openZoxide: soon("Zoxide"),

      // Chords resolve for real; what they resolve TO may not exist yet.
      setChordPrefix,
      startBookmarkSubMode: setBookmarkSubMode,
      exitBookmarkSubMode: () => setBookmarkSubMode(null),
      navigateToBookmark: soon("Bookmarks"),
      assignBookmark: soon("Bookmarks"),
      deleteBookmark: soon("Bookmarks"),
      setSort: soon("Sorting"),
      showMessage: setMessage,

      toggleViewMode: soon("The tree view"),
      toggleHidden: soon("Hidden files"),
      toggleHtmlRender: soon("The HTML preview"),
      openContextMenu: soon("The context menu"),
      openCopyingPath: () => pane.enter(),

      tabNew: soon("Tabs"),
      tabClose: soon("Tabs"),
      tabNext: soon("Tabs"),
      tabPrevious: soon("Tabs"),

      toggleAudioPlayback: soon("Audio playback"),

      openHelp: () => setHelpOpen(true),

      treeCollapseOrParent: soon("The tree view"),
      treeExpandOrActivate: soon("The tree view"),
      treeToggleExpand: soon("The tree view"),
      treeToggleHidden: soon("The tree view"),
      treeToggleGitignore: soon("The tree view"),
      treeRefresh: soon("The tree view"),
    };
  }, [pane]);

  const state = useMemo<KeyState>(() => {
    const entry = pane.state.entries[pane.state.cursorIndex];
    return {
      selectedCount: 0,
      searchActive: false,
      matchCount: 0,
      cursorEntry:
        entry === undefined
          ? null
          : {
              name: entry.name,
              path: `${pane.state.path}/${entry.name}`,
              isDirectory: entry.kind === "directory",
              // Both need a MIME type the renderer does not have yet; previews
              // are the phase that brings one.
              isImage: false,
              mimeType: "",
            },
      picker: { active: false, saveMode: false, fileOps: false, multiple: false, directory: false },
    };
  }, [pane.state]);

  const modes = useMemo<KeyModes>(
    () => ({
      chordPrefix,
      bookmarkSubMode,
      helpOpen,
      message,
      closeHelp: () => setHelpOpen(false),
      clearMessage: () => setMessage(null),
    }),
    [chordPrefix, bookmarkSubMode, helpOpen, message],
  );

  return { actions, modes, state };
}
