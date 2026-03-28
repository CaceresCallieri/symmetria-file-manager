import Quickshell
import QtQuick

QtObject {
    id: root

    // Set by the owning FileManager — determines starting directory
    property string initialPath: Paths.home

    // === Navigation ===
    property string currentPath: initialPath

    property var _history: [initialPath]
    property int _historyIndex: 0

    readonly property bool canGoBack: _historyIndex > 0
    readonly property bool canGoForward: _historyIndex < _history.length - 1

    // Per-directory cursor position cache: { path → index }
    property var _cursorCache: ({})

    function saveCursor(path: string, index: int): void {
        _cursorCache[path] = index;
    }

    function restoreCursor(path: string): int {
        return _cursorCache[path] ?? 0;
    }

    function navigate(path: string): void {
        if (path === currentPath)
            return;

        clearSearch();
        clearFlash();
        cancelZoxide();

        // Truncate forward history and append new path
        _history = _history.slice(0, _historyIndex + 1).concat([path]);
        _historyIndex = _history.length - 1;
        currentPath = path;
    }

    function back(): void {
        if (!canGoBack)
            return;

        clearSearch();
        clearFlash();
        cancelZoxide();
        _historyIndex--;
        currentPath = _history[_historyIndex];
    }

    function forward(): void {
        if (!canGoForward)
            return;

        clearSearch();
        clearFlash();
        cancelZoxide();
        _historyIndex++;
        currentPath = _history[_historyIndex];
    }

    function goUp(): void {
        if (currentPath === "/")
            return;

        clearSearch();
        clearFlash();
        const parentPath = currentPath.replace(/\/[^/]+$/, "") || "/";
        navigate(parentPath);
    }

    // === Search ===
    property bool searchActive: false
    property string searchQuery: ""
    property var matchIndices: []
    property int currentMatchIndex: -1

    signal searchConfirmed()
    signal searchCancelled()

    function clearSearch(): void {
        searchActive = false;
        searchQuery = "";
        matchIndices = [];
        currentMatchIndex = -1;
    }

    function startSearch(): void {
        clearSearch();
        clearFlash();
        searchActive = true;
    }

    function nextMatch(): void {
        if (matchIndices.length === 0)
            return;
        currentMatchIndex = (currentMatchIndex + 1) % matchIndices.length;
    }

    function previousMatch(): void {
        if (matchIndices.length === 0)
            return;
        currentMatchIndex = (currentMatchIndex - 1 + matchIndices.length) % matchIndices.length;
    }

    // === Flash navigation ===
    property bool flashActive: false
    property string flashQuery: ""
    property var flashMatches: []           // Match objects from FlashLogic.computeFlash()
    property var flashLabelChars: ({})      // { char: true } — chars assigned as labels
    property var flashContinuations: ({})   // { char: true } — chars that extend the query
    property string flashPendingLabel: ""   // First char of a 2-char label being resolved
    // O(1) lookup map: "column:index" → match object. Rebuilt when flashMatches changes.
    readonly property var flashMatchMap: {
        const map = {};
        for (let i = 0; i < flashMatches.length; i++) {
            const m = flashMatches[i];
            map[m.column + ":" + m.index] = m;
        }
        return map;
    }

    signal flashJump(string column, int index, string path)

    function startFlash(): void {
        clearSearch();
        clearFlash();
        flashActive = true;
    }

    function clearFlash(): void {
        flashActive = false;
        flashQuery = "";
        flashMatches = [];
        flashLabelChars = {};
        flashContinuations = {};
        flashPendingLabel = "";
    }

    // === Sort (per-window, ephemeral) ===
    property int sortBy: 1          // Default: Modified (matches C++ SortBy::Modified = 1)
    property bool sortReverse: true

    readonly property var _sortLabels: ["Alphabetical", "Modified", "Size", "Extension", "Natural"]
    readonly property string sortLabel: _sortLabels[sortBy] ?? "?"

    // === Chord / which-key state ===
    property string activeChordPrefix: ""
    readonly property bool chordActive: activeChordPrefix !== ""

    // === Bookmark sub-mode (entered via gn / gx) ===
    property string bookmarkSubMode: ""        // "" | "create" | "delete"
    readonly property bool bookmarkSubModeActive: bookmarkSubMode !== ""

    // === Transient status message (auto-clears after 2s) ===
    property string transientMessage: ""

    property Timer _transientTimer: Qt.createQmlObject(
        'import QtQuick; Timer { interval: 2000 }', root, "transientTimer")

    function showTransientMessage(msg: string): void {
        transientMessage = msg;
        _transientTimer.restart();
    }

    Component.onCompleted: {
        _transientTimer.triggered.connect(() => { root.transientMessage = ""; });
    }

    // Static chord configuration — the built-in binds that never change.
    readonly property var _staticChordBindings: ({
        "g": {
            label: "go to",
            binds: [
                { key: "g", label: "Top", icon: "vertical_align_top" },
                { key: "h", label: "Home", icon: "home" },
                { key: "d", label: "Downloads", icon: "download" },
                { key: "s", label: "Screenshots", icon: "screenshot_monitor" },
                { key: "v", label: "Videos", icon: "video_library" }
            ]
        },
        "c": {
            label: "copy to clipboard",
            binds: [
                { key: "c", label: "File path", icon: "link" },
                { key: "f", label: "Filename", icon: "description" },
                { key: "n", label: "Name without extension", icon: "label" },
                { key: "d", label: "Directory path", icon: "folder" }
            ]
        },
        ",": {
            label: "sort by",
            binds: [
                { key: "a/A", label: "Alphabetical", icon: "sort_by_alpha" },
                { key: "m/M", label: "Modified date", icon: "schedule" },
                { key: "s/S", label: "Size", icon: "straighten" },
                { key: "e/E", label: "Extension", icon: "extension" },
                { key: "n/N", label: "Natural", icon: "format_list_numbered" }
            ]
        }
    })

    // Merged view: static binds + user bookmarks. Re-evaluated when bookmarks change.
    readonly property var chordBindings: {
        const base = JSON.parse(JSON.stringify(_staticChordBindings));
        const userBookmarks = BookmarkService.bookmarks;
        const gBinds = base["g"].binds;

        // Track which keys are reserved (static nav + action keys)
        const usedKeys = { "n": true, "x": true };
        for (const b of gBinds)
            usedKeys[b.key] = true;

        for (const [key, bm] of Object.entries(userBookmarks)) {
            if (usedKeys[key]) {
                const idx = gBinds.findIndex(b => b.key === key);
                if (idx >= 0)
                    gBinds[idx] = { key: key, label: bm.label, icon: "bookmark", isUser: true };
            } else {
                gBinds.push({ key: key, label: bm.label, icon: "bookmark", isUser: true });
            }
        }

        // Separator + bookmark management actions — always last
        gBinds.push({ isSeparator: true });
        gBinds.push({ key: "n", label: "New bookmark", icon: "bookmark_add", isAction: true });
        gBinds.push({ key: "x", label: "Delete bookmark", icon: "bookmark_remove", isAction: true });

        return base;
    }

    // === Selection (Space-toggled marks) ===
    // Stores absolute paths as keys: { "/home/user/file.txt": true, ... }
    // Persists across directory changes — cleared explicitly by the user.
    property var selectedPaths: ({})
    // Explicit counter avoids allocating a temporary array via Object.keys()
    // on every read of selectedCount (StatusBar + FileList both bind to it).
    property int _selectionCount: 0
    readonly property int selectedCount: _selectionCount

    function toggleSelection(path: string): void {
        const copy = Object.assign({}, selectedPaths);
        if (copy[path]) {
            delete copy[path];
            _selectionCount--;
        } else {
            copy[path] = true;
            _selectionCount++;
        }
        selectedPaths = copy;
    }

    function clearSelection(): void {
        selectedPaths = {};
        _selectionCount = 0;
    }

    function getSelectedPathsArray(): var {
        return Object.keys(selectedPaths);
    }

    // === Delete confirmation ===
    // Empty array means no pending deletion
    property var deleteConfirmPaths: []

    function requestDelete(paths: var): void {
        deleteConfirmPaths = paths;
    }

    function cancelDelete(): void {
        deleteConfirmPaths = [];
    }

    // === Create file/folder ===
    property bool createInputActive: false

    signal createCompleted(filename: string)

    function requestCreate(): void {
        createInputActive = true;
    }

    function cancelCreate(): void {
        createInputActive = false;
    }

    // === Rename ===
    property string renameTargetPath: ""
    property bool renameIncludeExtension: false

    signal renameCompleted(newName: string)

    function requestRename(path: string, includeExtension: bool): void {
        renameTargetPath = path;
        renameIncludeExtension = includeExtension;
    }

    function cancelRename(): void {
        renameTargetPath = "";
        renameIncludeExtension = false;
    }

    // === Audio preview ===
    signal audioPlaybackToggle()

    // === Context menu ===
    property string contextMenuTargetPath: ""
    property string contextMenuTargetMimeType: ""

    function requestContextMenu(path: string, mimeType: string): void {
        // Set mimeType before path — the Loader activates on path !== "",
        // so mimeType must already be available when Component.onCompleted fires.
        contextMenuTargetMimeType = mimeType;
        contextMenuTargetPath = path;
    }

    function cancelContextMenu(): void {
        contextMenuTargetPath = "";
        contextMenuTargetMimeType = "";
    }

    // === Zoxide jump ===
    property bool zoxideActive: false

    function requestZoxide(): void {
        zoxideActive = true;
    }

    function cancelZoxide(): void {
        zoxideActive = false;
    }
}
