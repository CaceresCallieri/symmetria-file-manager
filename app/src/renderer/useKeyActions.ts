import { isReservedLetter, labelFor } from "@symmetria/fm-core/bookmarks";
import type { BookmarkSubMode, KeyActions, KeyState } from "@symmetria/fm-core/keys/types";
import { boundaryIndex, cursorEntry, isDirectoryEntry, joinPath } from "@symmetria/fm-core/pane";
import { useMemo, useState } from "react";
import type { Bookmarks } from "./useBookmarks.ts";
import type { FileOps } from "./useFileOps.ts";
import type { Search } from "./useSearch.ts";
import type { Tabs } from "./useTabs.ts";

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
 * Is the cursor on a directory? Deciding enter-versus-open needs only this.
 *
 * The predicate itself is shared with the pointer, which asks the same question
 * about a clicked row rather than about the cursor.
 */
function isDirectoryUnderCursor(tabs: Tabs): boolean {
  return isDirectoryEntry(cursorEntry(tabs.pane));
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

export function useKeyActions(
  tabs: Tabs,
  ops: FileOps,
  search: Search,
  bookmarks: Bookmarks,
  /** Where the tilde goes. Supplied by the caller, which reads the window URL. */
  home: string,
  /**
   * The MIME type of the image under the cursor, or null when it is not one.
   *
   * Supplied by the caller because the answer comes from the preview, which
   * asks the main process about the cursor entry and is debounced. This hook
   * has no way to know it, and the field it fills was hardcoded to "not an
   * image" from the phase that introduced it — so the copy chord's image row
   * never appeared and `i` always answered "Not an image".
   */
  cursorImageMime: string | null,
): KeyWiring {
  const [chordPrefix, setChordPrefix] = useState("");
  const [bookmarkSubMode, setBookmarkSubMode] = useState<BookmarkSubMode | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const actions = useMemo<KeyActions>(() => {
    const soon = (what: string) => () => setMessage(`${what} is not built yet`);

    return {
      // Navigation — the operations this phase can actually perform.
      moveDown: () => tabs.moveBy(1),
      moveUp: () => tabs.moveBy(-1),
      jumpToTop: () => tabs.moveTo(0),
      jumpToBottom: () => tabs.moveTo(tabs.pane.entries.length - 1),
      halfPageDown: () => tabs.moveBy(halfPageRows()),
      halfPageUp: () => tabs.moveBy(-halfPageRows()),
      // A directory is entered; anything else is handed to the desktop.
      activate: () => (isDirectoryUnderCursor(tabs) ? tabs.enter() : ops.open()),
      goUp: () => tabs.leave(),
      enterDirectory: () => (isDirectoryUnderCursor(tabs) ? tabs.enter() : ops.open()),
      goHome: () => tabs.navigate(home),
      jumpDirectoryFileBoundary: () => {
        // -1 means the listing holds one kind, or none. Leaving the cursor put
        // is the honest answer: there is no other block to be at the start of.
        const target = boundaryIndex(tabs.pane);
        if (target >= 0) tabs.moveTo(target);
      },
      dismiss: () => setMessage(null),

      historyBack: () => tabs.historyBack(),
      historyForward: () => tabs.historyForward(),

      trash: () => ops.requestDelete(),
      rename: (withExtension) => ops.requestRename(withExtension),
      createEntry: () => ops.requestCreate(),
      editSaveName: soon("Editing the save name"),

      yank: () => ops.yank(),
      cut: () => ops.cut(),
      paste: () => ops.paste(),
      copyToClipboard: (target) => ops.copyToClipboard(target),

      toggleSelection: () => tabs.toggleMark(),
      clearSelection: () => tabs.clearMarks(),

      startSearch: () => search.open(),
      nextMatch: () => search.goNext(),
      previousMatch: () => search.goPrevious(),
      startFlash: soon("Flash jump"),
      openFuzzyFinder: soon("The fuzzy finder"),
      openZoxide: soon("Zoxide"),

      // Chords resolve for real; what they resolve TO may not exist yet.
      setChordPrefix,
      startBookmarkSubMode: setBookmarkSubMode,
      exitBookmarkSubMode: () => setBookmarkSubMode(null),
      navigateToBookmark: (letter) => {
        const path = bookmarks.pathFor(letter);
        // Saying which letter is empty beats a silent no-op: the user pressed
        // `g` and then something, and needs to know the second key was heard.
        if (path === null) setMessage(`No bookmark on ${letter}`);
        else tabs.navigate(path);
      },
      assignBookmark: (letter) => {
        // The store drops a reserved letter on read, so binding one would look
        // like a save that worked and be gone after a restart. Refusing here
        // and saying which letter is the honest version of the same rule.
        if (isReservedLetter(letter)) {
          setMessage(`${letter} is reserved`);
          return;
        }
        const path = tabs.pane.path;
        const label = labelFor(path);
        bookmarks.assign(letter, { path, label });
        setMessage(`${letter} → ${label}`);
      },
      deleteBookmark: (letter) => {
        if (isReservedLetter(letter)) {
          setMessage(`${letter} is reserved`);
          return;
        }
        // Silent for a letter that was not bound: the user asked for it to be
        // gone and it is.
        if (bookmarks.pathFor(letter) !== null) setMessage(`${letter} removed`);
        bookmarks.remove(letter);
      },
      setSort: (sort, reverse) => tabs.setSort(sort, reverse),
      showMessage: setMessage,

      toggleViewMode: soon("The tree view"),
      toggleHidden: () => tabs.toggleHidden(),
      toggleHtmlRender: soon("The HTML preview"),
      openContextMenu: soon("The context menu"),
      openCopyingPath: () => ops.open(),

      tabNew: () => tabs.open(),
      tabClose: () => tabs.close(),
      tabNext: () => tabs.goNext(),
      tabPrevious: () => tabs.goPrevious(),

      toggleAudioPlayback: soon("Audio playback"),

      openHelp: () => setHelpOpen(true),

      treeCollapseOrParent: soon("The tree view"),
      treeExpandOrActivate: soon("The tree view"),
      treeToggleExpand: soon("The tree view"),
      treeToggleHidden: soon("The tree view"),
      treeToggleGitignore: soon("The tree view"),
      treeRefresh: soon("The tree view"),
    };
  }, [tabs, ops, search, bookmarks, home]);

  const state = useMemo<KeyState>(() => {
    const entry = tabs.pane.entries[tabs.pane.cursorIndex];
    return {
      selectedCount: tabs.pane.selection.size,
      searchActive: search.active,
      matchCount: search.matchCount,
      cursorEntry:
        entry === undefined
          ? null
          : {
              name: entry.name,
              path: joinPath(tabs.pane.path, entry.name),
              isDirectory: entry.kind === "directory",
              // Both come from the preview's route, which the caller resolves
              // and hands in. They therefore AGREE by construction FROM THIS
              // HOST: the router only reports an image for a MIME its tables
              // call one, so the chord's second guard — "Can't copy this image
              // format" — cannot fire here.
              //
              // That guard is NOT dead code. The chord lives in the shared
              // package, its own suite drives it against a hand-built context
              // where the two disagree, and a host that fed a real content
              // sniff in here would reach it — an RPG-Maker `.rpgmvp` sniffs as
              // an image and reports `application/octet-stream`.
              isImage: cursorImageMime !== null,
              mimeType: cursorImageMime ?? "",
            },
      picker: { active: false, saveMode: false, fileOps: false, multiple: false, directory: false },
    };
  }, [tabs.pane, search.active, search.matchCount, cursorImageMime]);

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
