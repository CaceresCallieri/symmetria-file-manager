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
    property string clipboardPath: ""    // Absolute path of yanked/cut file, "" when empty
    property string clipboardMode: ""    // "" | "yank" | "cut"

    function yank(path: string): void {
        clipboardPath = path;
        clipboardMode = "yank";
    }

    function cut(path: string): void {
        clipboardPath = path;
        clipboardMode = "cut";
    }

    function clearClipboard(): void {
        clipboardPath = "";
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

    // === Create file/folder ===
    property bool createInputActive: false

    signal createCompleted(filename: string)

    function requestCreate(): void {
        createInputActive = true;
    }

    function cancelCreate(): void {
        createInputActive = false;
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

    function formatDate(date: date): string {
        if (!date || isNaN(date.getTime()))
            return "";

        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 60)
            return "just now";
        if (diffMin < 60)
            return diffMin + "m ago";
        if (diffHour < 24)
            return diffHour + "h ago";
        if (diffDay < 7)
            return diffDay + "d ago";

        return Qt.formatDateTime(date, "MMM d");
    }

    function goUp(): void {
        if (currentPath === "/")
            return;

        clearSearch();
        const parentPath = currentPath.replace(/\/[^/]+$/, "") || "/";
        navigate(parentPath);
    }
}
