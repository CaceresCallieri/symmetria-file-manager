pragma Singleton

import Quickshell
import Quickshell.Io
import QtQuick

Singleton {
    id: root

    // Live bookmark map: { "p": { path: "/home/.../projects", label: "projects" }, ... }
    property var bookmarks: ({})

    readonly property string _configPath: Paths.home + "/.config/symmetria-fm/bookmarks.json"
    property bool _loaded: false

    // Built-in G-chord keys that the user can override (with a warning)
    readonly property var _builtinKeys: ["g", "h", "d", "s", "v"]
    // Reserved keys that can never be assigned to bookmarks
    readonly property var _reservedKeys: ["n", "x"]

    // ── Public API ──────────────────────────────────────────────

    function addBookmark(key: string, path: string): void {
        const label = path.substring(path.lastIndexOf("/") + 1) || path;
        const updated = Object.assign({}, bookmarks);
        updated[key] = { path: path, label: label };
        bookmarks = updated;
        _save();
    }

    function removeBookmark(key: string): void {
        const updated = Object.assign({}, bookmarks);
        delete updated[key];
        bookmarks = updated;
        _save();
    }

    function hasBookmark(key: string): bool {
        return bookmarks.hasOwnProperty(key);
    }

    function getBookmarkPath(key: string): string {
        return bookmarks.hasOwnProperty(key) ? bookmarks[key].path : "";
    }

    function isBuiltinKey(key: string): bool {
        return _builtinKeys.indexOf(key) >= 0;
    }

    function isReservedKey(key: string): bool {
        return _reservedKeys.indexOf(key) >= 0;
    }

    // ── Persistence ─────────────────────────────────────────────

    function _save(): void {
        const json = JSON.stringify(bookmarks, null, 2);
        if (writeProcess.running) {
            writeProcess._pendingPayload = json;
            return;
        }
        writeProcess.payload = json;
        writeProcess.running = true;
    }

    function _applyBookmarks(json: string): void {
        try {
            const parsed = JSON.parse(json);
            bookmarks = parsed && typeof parsed === "object" ? parsed : {};
        } catch (e) {
            console.warn("[BookmarkService] Failed to parse bookmarks:", e);
            bookmarks = {};
        }
        _loaded = true;
    }

    Component.onCompleted: readProcess.running = true

    // Watch for external edits to the bookmarks file
    FileView {
        path: "file://" + root._configPath
        watchChanges: true
        onFileChanged: readProcess.running = true
    }

    // Read the bookmarks file via cat — gracefully handles missing file
    Process {
        id: readProcess

        command: ["cat", root._configPath]

        stdout: StdioCollector {
            id: readCollector
        }

        onExited: (exitCode, exitStatus) => {
            if (exitCode === 0 && readCollector.text.trim() !== "")
                root._applyBookmarks(readCollector.text);
            else
                root._loaded = true;  // Missing or empty file — start with no bookmarks
        }
    }

    // Write full JSON to disk (mkdir -p for first run)
    Process {
        id: writeProcess
        property string payload: ""
        property string _pendingPayload: ""

        command: [
            "sh", "-c",
            "mkdir -p \"$(dirname \"$1\")\" && printf '%s' \"$2\" > \"$1\"",
            "--",
            root._configPath,
            payload
        ]

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0)
                console.error("[BookmarkService] Write failed, exitCode:", exitCode);
            if (_pendingPayload !== "") {
                payload = _pendingPayload;
                _pendingPayload = "";
                running = true;
            }
        }
    }
}
