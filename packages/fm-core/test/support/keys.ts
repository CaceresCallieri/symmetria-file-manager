import type {
  KeyActions,
  KeyContext,
  KeyEvent,
  KeyState,
  Mods,
  ViewKind,
} from "../../src/keys/types.ts";

export interface Recorder {
  readonly calls: string[];
  readonly actions: KeyActions;
}

function recorder(): Recorder {
  const calls: string[] = [];
  const log =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(args.length === 0 ? name : `${name}(${args.join(",")})`);
    };

  const actions: KeyActions = {
    moveDown: log("moveDown"),
    moveUp: log("moveUp"),
    jumpToTop: log("jumpToTop"),
    jumpToBottom: log("jumpToBottom"),
    halfPageDown: log("halfPageDown"),
    halfPageUp: log("halfPageUp"),
    activate: log("activate"),
    goUp: log("goUp"),
    enterDirectory: log("enterDirectory"),
    goHome: log("goHome"),
    jumpDirectoryFileBoundary: log("jumpDirectoryFileBoundary"),
    dismiss: log("dismiss"),
    historyBack: log("historyBack"),
    historyForward: log("historyForward"),
    trash: log("trash"),
    rename: log("rename"),
    createEntry: log("createEntry"),
    editSaveName: log("editSaveName"),
    yank: log("yank"),
    cut: log("cut"),
    paste: log("paste"),
    copyToClipboard: log("copyToClipboard"),
    toggleSelection: log("toggleSelection"),
    clearSelection: log("clearSelection"),
    startSearch: log("startSearch"),
    nextMatch: log("nextMatch"),
    previousMatch: log("previousMatch"),
    startFlash: log("startFlash"),
    openFuzzyFinder: log("openFuzzyFinder"),
    openZoxide: log("openZoxide"),
    setChordPrefix: log("setChordPrefix"),
    startBookmarkSubMode: log("startBookmarkSubMode"),
    exitBookmarkSubMode: log("exitBookmarkSubMode"),
    navigateToBookmark: log("navigateToBookmark"),
    assignBookmark: log("assignBookmark"),
    deleteBookmark: log("deleteBookmark"),
    setSort: log("setSort"),
    showMessage: log("showMessage"),
    toggleViewMode: log("toggleViewMode"),
    toggleHidden: log("toggleHidden"),
    toggleDocumentRender: log("toggleDocumentRender"),
    expandPreview: log("expandPreview"),
    openCopyingPath: log("openCopyingPath"),
    tabNew: log("tabNew"),
    tabClose: log("tabClose"),
    tabNext: log("tabNext"),
    tabPrevious: log("tabPrevious"),
    toggleAudioPlayback: log("toggleAudioPlayback"),
    openHelp: log("openHelp"),
    treeCollapseOrParent: log("treeCollapseOrParent"),
    treeExpandOrActivate: log("treeExpandOrActivate"),
    treeToggleExpand: log("treeToggleExpand"),
    treeToggleHidden: log("treeToggleHidden"),
    treePageDown: log("treePageDown"),
    treePageUp: log("treePageUp"),
    treeRefresh: log("treeRefresh"),
  };

  return { calls, actions };
}

/** A state in which as many conditional rows as possible are live. */
export function permissiveState(): KeyState & {
  cursorEntry: NonNullable<KeyState["cursorEntry"]>;
} {
  return {
    selectedCount: 1,
    searchActive: false,
    matchCount: 2,
    cursorEntry: {
      name: "page.html",
      path: "/tmp/page.html",
      isDirectory: false,
      isImage: true,
      mimeType: "text/html",
    },
    picker: { active: false, saveMode: false, fileOps: false, multiple: false, directory: false },
  };
}

export function contextWith(
  state: Partial<KeyState>,
  view: ViewKind = "miller",
): KeyContext & Recorder {
  const { calls, actions } = recorder();
  return {
    view,
    state: { ...permissiveState(), ...state },
    actions,
    calls,
    overview: { toggle: () => calls.push("overview.toggle"), command: (name) => calls.push(name) },
    tree: { close: () => calls.push("tree.close") },
  };
}

export function press(key: string, mods: Mods = ""): KeyEvent {
  return {
    key,
    ctrl: mods === "Ctrl" || mods === "Ctrl+Shift",
    shift: mods === "Shift" || mods === "Ctrl+Shift",
    alt: mods === "Alt",
    meta: false,
  };
}
