import type { Binding, HelpGroup, KeyContext, ViewKind } from "./types.ts";

/**
 * The single source of truth for normal-mode keybindings.
 *
 * Both the dispatcher and the help overlay read this one table, so a binding
 * added here automatically works AND appears in the cheat sheet. That is the
 * property the Qt original was built for and the reason it is ported as data
 * rather than rewritten as a switch.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * These are MODES, not bindings, and stay in the imperative cascade outside the
 * registry: the modal block, the bookmark sub-mode, chord RESOLUTION, and flash
 * navigation. Picker suppression is a pre-pass inside `dispatch`, not a row.
 *
 * ── Keys are browser key values, lowercased ─────────────────────────────────
 * `"j"`, `"arrowdown"`, `"enter"`, `"escape"`, `" "`, `"tab"`. Matching
 * lowercases the incoming `KeyboardEvent.key`, so `Shift+G` arrives as `"G"`,
 * compares as `"g"`, and its Shift requirement is checked separately by `mods`.
 *
 * ── One thing the web port gets for free ────────────────────────────────────
 * Qt needed a separate `Key_Backtab` for Shift+Tab. The browser reports
 * `key: "Tab"` with `shift: true`, so previous-tab is an ordinary
 * `mods: "Ctrl+Shift"` row on the same key as next-tab.
 */

// ── CORE: identical in both views ───────────────────────────────────────────

export const CORE: readonly Binding[] = [
  // Navigation
  {
    id: "nav.down",
    keys: ["j", "arrowdown"],
    mods: "",
    keycap: "j  ↓",
    label: "Move down",
    icon: "keyboard_arrow_down",
    group: "Navigation",
    run: (ctx) => ctx.actions.moveDown(),
  },
  {
    id: "nav.up",
    keys: ["k", "arrowup"],
    mods: "",
    keycap: "k  ↑",
    label: "Move up",
    icon: "keyboard_arrow_up",
    group: "Navigation",
    run: (ctx) => ctx.actions.moveUp(),
  },
  {
    id: "nav.bottom",
    keys: ["g"],
    mods: "Shift",
    keycap: "G",
    label: "Jump to bottom",
    icon: "vertical_align_bottom",
    group: "Navigation",
    run: (ctx) => ctx.actions.jumpToBottom(),
  },
  {
    id: "nav.activate",
    keys: ["enter"],
    mods: "",
    keycap: "⏎",
    label: "Open / enter",
    icon: "subdirectory_arrow_left",
    group: "Navigation",
    run: (ctx) => ctx.actions.activate(),
  },
  {
    id: "nav.halfDown",
    keys: ["d"],
    mods: "Ctrl",
    keycap: "⌃d",
    label: "Half-page down",
    icon: "keyboard_double_arrow_down",
    group: "Navigation",
    run: (ctx) => ctx.actions.halfPageDown(),
  },
  {
    id: "nav.halfUp",
    keys: ["u"],
    mods: "Ctrl",
    keycap: "⌃u",
    label: "Half-page up",
    icon: "keyboard_double_arrow_up",
    group: "Navigation",
    run: (ctx) => ctx.actions.halfPageUp(),
  },

  // History
  {
    id: "hist.back",
    keys: ["s"],
    mods: "Shift",
    keycap: "⇧S",
    label: "Back",
    icon: "arrow_back",
    group: "History",
    run: (ctx) => ctx.actions.historyBack(),
  },
  {
    id: "hist.forward",
    keys: ["d"],
    mods: "Shift",
    keycap: "⇧D",
    label: "Forward",
    icon: "arrow_forward",
    group: "History",
    run: (ctx) => ctx.actions.historyForward(),
  },

  // File operations
  {
    id: "op.delete",
    keys: ["d"],
    mods: "",
    keycap: "d",
    label: "Trash",
    icon: "delete",
    group: "File",
    run: (ctx) => ctx.actions.trash(),
  },
  {
    id: "op.rename",
    keys: ["r"],
    mods: "",
    keycap: "r",
    label: "Rename",
    icon: "drive_file_rename_outline",
    group: "File",
    run: (ctx) => ctx.actions.rename(false),
  },
  {
    id: "op.create",
    keys: ["a"],
    mods: "",
    keycap: "a",
    label: "New file / folder",
    icon: "add",
    group: "File",
    run: (ctx) => ctx.actions.createEntry(),
  },
  {
    id: "op.pickerSaveEdit",
    keys: ["r"],
    mods: "Ctrl",
    keycap: "⌃r",
    label: "Edit save name",
    icon: "edit_note",
    group: "File",
    when: (ctx) => ctx.state.picker.saveMode,
    run: (ctx) => ctx.actions.editSaveName(),
  },

  // Clipboard
  {
    id: "clip.yank",
    keys: ["y"],
    mods: "",
    keycap: "y",
    label: "Yank (copy)",
    icon: "content_copy",
    group: "Clipboard",
    run: (ctx) => ctx.actions.yank(),
  },
  {
    id: "clip.cut",
    keys: ["x"],
    mods: "",
    keycap: "x",
    label: "Cut",
    icon: "content_cut",
    group: "Clipboard",
    run: (ctx) => ctx.actions.cut(),
  },
  {
    id: "clip.paste",
    keys: ["p"],
    mods: "",
    keycap: "p",
    label: "Paste",
    icon: "content_paste",
    group: "Clipboard",
    run: (ctx) => ctx.actions.paste(),
  },
  {
    id: "clip.pasteCtrl",
    keys: ["v"],
    mods: "Ctrl",
    keycap: "⌃v",
    label: "Paste",
    icon: "content_paste",
    group: "Clipboard",
    run: (ctx) => ctx.actions.paste(),
  },

  // Selection
  {
    id: "sel.toggle",
    keys: [" "],
    mods: "",
    keycap: "␣",
    label: "Select / mark",
    icon: "check_box",
    group: "Selection",
    run: (ctx) => ctx.actions.toggleSelection(),
  },
  {
    id: "sel.clear",
    keys: ["escape"],
    mods: "",
    keycap: "Esc",
    label: "Clear selection",
    icon: "deselect",
    group: "Selection",
    when: (ctx) => ctx.state.selectedCount > 0,
    run: (ctx) => ctx.actions.clearSelection(),
  },

  // Search and jump
  {
    // `mods: "*"` — a symbol glyph. On the Latin-American layout `/` is Shift+7,
    // so the event carries Shift and a strict `""` match would reject it. See
    // the `Mods` documentation; every glyph binding below follows this rule.
    id: "search.start",
    keys: ["/"],
    mods: "*",
    keycap: "/",
    label: "Search",
    icon: "search",
    group: "Search & jump",
    run: (ctx) => ctx.actions.startSearch(),
  },
  {
    id: "match.next",
    keys: ["n"],
    mods: "",
    keycap: "n",
    label: "Next match",
    icon: "arrow_downward",
    group: "Search & jump",
    when: (ctx) => !ctx.state.searchActive && ctx.state.matchCount > 0,
    run: (ctx) => ctx.actions.nextMatch(),
  },
  {
    id: "match.prev",
    keys: ["n"],
    mods: "Shift",
    keycap: "⇧N",
    label: "Previous match",
    icon: "arrow_upward",
    group: "Search & jump",
    when: (ctx) => !ctx.state.searchActive && ctx.state.matchCount > 0,
    run: (ctx) => ctx.actions.previousMatch(),
  },
  {
    id: "flash.enter",
    keys: ["s"],
    mods: "",
    keycap: "s",
    label: "Flash jump",
    icon: "bolt",
    group: "Search & jump",
    run: (ctx) => ctx.actions.startFlash(),
  },
  {
    id: "finder.fuzzy",
    keys: ["f"],
    mods: "",
    keycap: "f",
    label: "Fuzzy finder",
    icon: "manage_search",
    group: "Search & jump",
    run: (ctx) => ctx.actions.openFuzzyFinder(),
  },

  // Chord prefixes. Resolution lives in the cascade, never here.
  {
    id: "chord.go",
    keys: ["g"],
    mods: "",
    keycap: "g",
    label: "Go to / bookmarks…",
    icon: "explore",
    group: "Chords",
    run: (ctx) => ctx.actions.setChordPrefix("g"),
  },
  {
    id: "chord.copy",
    keys: ["c"],
    mods: "",
    keycap: "c",
    label: "Copy to clipboard…",
    icon: "content_copy",
    group: "Chords",
    run: (ctx) => ctx.actions.setChordPrefix("c"),
  },
  {
    id: "chord.sort",
    keys: [","],
    mods: "*",
    keycap: ",",
    label: "Sort by…",
    icon: "sort",
    group: "Chords",
    run: (ctx) => ctx.actions.setChordPrefix(","),
  },

  // View
  {
    id: "view.toggle",
    keys: ["e"],
    mods: "Ctrl",
    keycap: "⌃e",
    label: "Toggle Miller / tree view",
    icon: "account_tree",
    group: "View",
    run: (ctx) => ctx.actions.toggleViewMode(),
  },

  // Help
  {
    id: "help.open",
    keys: ["?"],
    mods: "*",
    keycap: "?",
    label: "Keyboard help",
    icon: "help",
    group: "Help",
    run: (ctx) => ctx.actions.openHelp(),
  },
];

// ── MILLER_ONLY ─────────────────────────────────────────────────────────────

export const MILLER_ONLY: readonly Binding[] = [
  {
    id: "miller.up",
    keys: ["h", "arrowleft"],
    mods: "",
    keycap: "h  ←",
    label: "Up a directory",
    icon: "arrow_back",
    group: "Navigation",
    run: (ctx) => ctx.actions.goUp(),
  },
  {
    id: "miller.into",
    keys: ["l", "arrowright"],
    mods: "",
    keycap: "l  →",
    label: "Enter directory",
    icon: "arrow_forward",
    group: "Navigation",
    run: (ctx) => ctx.actions.enterDirectory(),
  },
  {
    id: "miller.contextMenu",
    keys: ["enter"],
    mods: "Ctrl",
    keycap: "⌃⏎",
    label: "Context menu",
    icon: "more_horiz",
    group: "Navigation",
    // A deliberate deviation from the original, which carried this same test
    // INSIDE its run body. There it consumed Ctrl+Enter on a directory and then
    // did nothing; as a `when` the key falls through instead, which is what the
    // registry's own contract says a false condition means. Nothing else claims
    // Ctrl+Enter today, so the visible behaviour is unchanged.
    when: (ctx) => ctx.state.cursorEntry !== null && !ctx.state.cursorEntry.isDirectory,
    run: (ctx) => ctx.actions.openContextMenu(),
  },
  {
    id: "miller.shiftEnter",
    keys: ["enter"],
    mods: "Shift",
    keycap: "⇧⏎",
    label: "Open (copy path in picker)",
    icon: "content_paste_go",
    group: "Navigation",
    run: (ctx) => ctx.actions.openCopyingPath(),
  },
  {
    id: "miller.tabBoundary",
    keys: ["tab"],
    mods: "",
    keycap: "⇥",
    label: "Jump dir / file boundary",
    icon: "swap_vert",
    group: "Navigation",
    run: (ctx) => ctx.actions.jumpDirectoryFileBoundary(),
  },
  {
    // Swallowing a stray Escape is Miller-only ON PURPOSE. The tree has no such
    // row so Escape propagates to the host's close-window handling, which is
    // what an embedded sidebar needs.
    id: "miller.escapeSwallow",
    keys: ["escape"],
    mods: "",
    keycap: "Esc",
    label: "Dismiss",
    icon: "close",
    group: "Navigation",
    run: (ctx) => ctx.actions.dismiss(),
  },

  // History aliases
  {
    id: "miller.home",
    keys: ["~"],
    mods: "*",
    keycap: "~",
    label: "Go home",
    icon: "home",
    group: "History",
    run: (ctx) => ctx.actions.goHome(),
  },
  {
    id: "miller.back",
    keys: ["-"],
    mods: "*",
    keycap: "-",
    label: "Back",
    icon: "arrow_back",
    group: "History",
    run: (ctx) => ctx.actions.historyBack(),
  },
  {
    id: "miller.forward",
    keys: ["="],
    mods: "*",
    keycap: "=",
    label: "Forward",
    icon: "arrow_forward",
    group: "History",
    run: (ctx) => ctx.actions.historyForward(),
  },

  // File
  {
    id: "miller.renameExt",
    keys: ["r"],
    mods: "Shift",
    keycap: "⇧R",
    label: "Rename (with extension)",
    icon: "edit",
    group: "File",
    run: (ctx) => ctx.actions.rename(true),
  },

  // View
  {
    id: "miller.toggleHidden",
    keys: ["."],
    mods: "*",
    keycap: ".",
    label: "Toggle hidden files",
    icon: "visibility",
    group: "View",
    run: (ctx) => ctx.actions.toggleHidden(),
  },
  {
    // Gated to HTML so Ctrl+R falls through on anything else — and so it never
    // clashes with `op.pickerSaveEdit`, which is also Ctrl+R, is gated on save
    // mode, and sits earlier in CORE so it wins inside a save picker.
    id: "miller.htmlRender",
    keys: ["r"],
    mods: "Ctrl",
    keycap: "⌃r",
    label: "Render HTML preview",
    icon: "html",
    group: "View",
    when: (ctx) => isHtml(ctx),
    run: (ctx) => ctx.actions.toggleHtmlRender(),
  },

  // Search and jump
  {
    id: "miller.zoxide",
    keys: ["z"],
    mods: "",
    keycap: "z",
    label: "Zoxide jump",
    icon: "history",
    group: "Search & jump",
    run: (ctx) => ctx.actions.openZoxide(),
  },

  // Tools
  {
    id: "miller.audioToggle",
    keys: ["p"],
    mods: "Ctrl",
    keycap: "⌃p",
    label: "Play / pause audio",
    icon: "play_circle",
    group: "Tools",
    run: (ctx) => ctx.actions.toggleAudioPlayback(),
  },

  // Tabs
  {
    id: "miller.tabNew",
    keys: ["t"],
    mods: "",
    keycap: "t",
    label: "New tab",
    icon: "add",
    group: "Tabs",
    run: (ctx) => ctx.actions.tabNew(),
  },
  {
    id: "miller.tabClose",
    keys: ["q"],
    mods: "Ctrl",
    keycap: "⌃q",
    label: "Close tab",
    icon: "close",
    group: "Tabs",
    run: (ctx) => ctx.actions.tabClose(),
  },
  {
    id: "miller.tabPrev",
    keys: ["["],
    mods: "*",
    keycap: "[",
    label: "Previous tab",
    icon: "chevron_left",
    group: "Tabs",
    run: (ctx) => ctx.actions.tabPrevious(),
  },
  {
    id: "miller.tabNext",
    keys: ["]"],
    mods: "*",
    keycap: "]",
    label: "Next tab",
    icon: "chevron_right",
    group: "Tabs",
    run: (ctx) => ctx.actions.tabNext(),
  },
  {
    id: "miller.tabNextCtrl",
    keys: ["tab"],
    mods: "Ctrl",
    keycap: "⌃⇥",
    label: "Next tab",
    icon: "chevron_right",
    group: "Tabs",
    run: (ctx) => ctx.actions.tabNext(),
  },
  {
    // Qt needed a separate `Key_Backtab` here. The browser reports Shift+Tab as
    // `key: "Tab"` with `shift: true`, so this is an ordinary modifier row.
    id: "miller.tabPrevCtrl",
    keys: ["tab"],
    mods: "Ctrl+Shift",
    keycap: "⌃⇧⇥",
    label: "Previous tab",
    icon: "chevron_left",
    group: "Tabs",
    run: (ctx) => ctx.actions.tabPrevious(),
  },
];

// ── TREE_ONLY ───────────────────────────────────────────────────────────────

/**
 * Ported now, unreachable until the tree view exists.
 *
 * Porting them with the rest keeps one table rather than two, and means the
 * collision and help-metadata tests cover them from the start.
 */
export const TREE_ONLY: readonly Binding[] = [
  {
    id: "tree.collapseOrParent",
    keys: ["h", "arrowleft"],
    mods: "",
    keycap: "h  ←",
    label: "Collapse / parent",
    icon: "chevron_left",
    group: "Navigation",
    run: (ctx) => ctx.actions.treeCollapseOrParent(),
  },
  {
    id: "tree.expandOrActivate",
    keys: ["l", "arrowright"],
    mods: "",
    keycap: "l  →",
    label: "Expand / open",
    icon: "chevron_right",
    group: "Navigation",
    run: (ctx) => ctx.actions.treeExpandOrActivate(),
  },
  {
    id: "tree.toggleExpand",
    keys: ["o"],
    mods: "",
    keycap: "o",
    label: "Toggle expand",
    icon: "unfold_more",
    group: "Navigation",
    run: (ctx) => ctx.actions.treeToggleExpand(),
  },
  {
    id: "tree.toggleHidden",
    keys: ["h"],
    mods: "Shift",
    keycap: "⇧H",
    label: "Toggle hidden files",
    icon: "visibility",
    group: "View",
    run: (ctx) => ctx.actions.treeToggleHidden(),
  },
  {
    id: "tree.toggleGitignore",
    keys: ["."],
    mods: "*",
    keycap: ".",
    label: "Toggle .gitignore filter",
    icon: "rule",
    group: "View",
    run: (ctx) => ctx.actions.treeToggleGitignore(),
  },
  {
    id: "tree.refreshAll",
    keys: ["r"],
    mods: "Shift",
    keycap: "⇧R",
    label: "Refresh tree",
    icon: "refresh",
    group: "View",
    run: (ctx) => ctx.actions.treeRefresh(),
  },
];

function isHtml(ctx: KeyContext): boolean {
  const mime = ctx.state.cursorEntry?.mimeType ?? "";
  return mime === "text/html" || mime === "application/xhtml+xml";
}

export function bindingsFor(view: ViewKind): readonly Binding[] {
  return [...CORE, ...(view === "tree" ? TREE_ONLY : MILLER_ONLY)];
}

/**
 * The order the help overlay renders groups in.
 *
 * A test asserts every binding's group is one of these, so a row given an
 * unknown group cannot silently vanish from the cheat sheet — which would
 * recreate exactly the drift this registry exists to prevent. "Chords" is
 * rendered from the chord table as expanded sub-menus rather than from the bare
 * prefix rows, so the overlay filters it out of this list.
 */
export const HELP_GROUPS: readonly HelpGroup[] = [
  "Navigation",
  "History",
  "File",
  "Clipboard",
  "Selection",
  "Search & jump",
  "Chords",
  "View",
  "Tabs",
  "Tools",
  "Help",
];

/** A text-input mode, which has no binding row but still belongs in the help. */
export interface HelpMode {
  readonly keycap: string;
  readonly label: string;
  readonly icon: string;
}

/** The modes, as static help rows, so the cheat sheet is complete. */
export const MODES: readonly HelpMode[] = [
  { keycap: "s", label: "Flash jump — type letters to jump, Esc cancels", icon: "bolt" },
  { keycap: "/", label: "Search — type to filter, n/N to cycle, Enter confirms", icon: "search" },
  { keycap: "gn / gx", label: "Bookmarks — assign / delete with a letter", icon: "bookmark" },
];
