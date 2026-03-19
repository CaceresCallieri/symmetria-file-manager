pragma Singleton

import Quickshell

Singleton {
    id: root

    property string currentPath: Paths.home

    // Search state
    property bool searchActive: false
    property string searchQuery: ""
    property var matchIndices: []
    property int currentMatchIndex: -1

    signal searchConfirmed()
    signal searchCancelled()

    // === Clipboard (yank/cut) ===
    property var clipboardPaths: []       // Array of path strings
    property string clipboardMode: ""     // "" | "yank" | "cut"

    // O(1) lookup set — auto-updates when clipboardPaths changes
    readonly property var _clipboardSet: {
        let s = {};
        for (const p of clipboardPaths) s[p] = true;
        return s;
    }

    function yank(path: string): void {
        clipboardPaths = [path];
        clipboardMode = "yank";
    }

    function cut(path: string): void {
        clipboardPaths = [path];
        clipboardMode = "cut";
    }

    function clearClipboard(): void {
        clipboardPaths = [];
        clipboardMode = "";
    }

    // === Delete confirmation ===
    // Empty string means no pending deletion
    property string deleteConfirmPath: ""

    function requestDelete(path: string): void {
        deleteConfirmPath = path;
    }

    function cancelDelete(): void {
        deleteConfirmPath = "";
    }

    // === Chord / which-key state ===
    property string activeChordPrefix: ""
    readonly property bool chordActive: activeChordPrefix !== ""

    readonly property var chordBindings: ({
        "g": {
            label: "go to",
            binds: [
                { key: "g", label: "Top", icon: "vertical_align_top" },
                { key: "h", label: "Home", icon: "home" },
                { key: "d", label: "Downloads", icon: "download" },
                { key: "s", label: "Screenshots", icon: "screenshot_monitor" },
                { key: "v", label: "Videos", icon: "video_library" },
            ]
        }
    })

    function clearSearch(): void {
        searchActive = false;
        searchQuery = "";
        matchIndices = [];
        currentMatchIndex = -1;
    }

    function startSearch(): void {
        searchQuery = "";
        matchIndices = [];
        currentMatchIndex = -1;
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

    // Navigation history — array of path strings
    property var _history: [Paths.home]
    property int _historyIndex: 0

    readonly property bool canGoBack: _historyIndex > 0
    readonly property bool canGoForward: _historyIndex < _history.length - 1
    readonly property bool canGoUp: currentPath !== "/"

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

        // Truncate forward history and append new path
        _history = _history.slice(0, _historyIndex + 1).concat([path]);
        _historyIndex = _history.length - 1;
        currentPath = path;
    }

    function back(): void {
        if (!canGoBack)
            return;

        clearSearch();
        _historyIndex--;
        currentPath = _history[_historyIndex];
    }

    function forward(): void {
        if (!canGoForward)
            return;

        clearSearch();
        _historyIndex++;
        currentPath = _history[_historyIndex];
    }

    function formatSize(bytes: double): string {
        if (bytes < 1024)
            return bytes + " B";
        if (bytes < 1024 * 1024)
            return (bytes / 1024).toFixed(1) + " K";
        if (bytes < 1024 * 1024 * 1024)
            return (bytes / (1024 * 1024)).toFixed(1) + " M";
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " G";
    }

    function goUp(): void {
        if (!canGoUp)
            return;

        clearSearch();
        const parentPath = currentPath.replace(/\/[^/]+$/, "") || "/";
        navigate(parentPath);
    }
}
