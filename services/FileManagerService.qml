pragma Singleton

import Quickshell

Singleton {
    id: root

    property string currentPath: Paths.home

    // Navigation history — array of path strings
    property var _history: [Paths.home]
    property int _historyIndex: 0

    readonly property bool canGoBack: _historyIndex > 0
    readonly property bool canGoForward: _historyIndex < _history.length - 1
    readonly property bool canGoUp: currentPath !== "/"

    function navigate(path: string): void {
        if (path === currentPath)
            return;

        // Truncate forward history and append new path
        _history = _history.slice(0, _historyIndex + 1).concat([path]);
        _historyIndex = _history.length - 1;
        currentPath = path;
    }

    function back(): void {
        if (!canGoBack)
            return;

        _historyIndex--;
        currentPath = _history[_historyIndex];
    }

    function forward(): void {
        if (!canGoForward)
            return;

        _historyIndex++;
        currentPath = _history[_historyIndex];
    }

    function formatSize(bytes: int): string {
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

        const parentPath = currentPath.replace(/\/[^/]+$/, "") || "/";
        navigate(parentPath);
    }
}
