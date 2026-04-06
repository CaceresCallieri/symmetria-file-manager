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

    // Reserved keys that can never be assigned to bookmarks (g = Top, n = New, x = Delete)
    readonly property var _reservedKeys: ["g", "n", "x"]

    // Default bookmarks seeded on first run — deletable by the user
    readonly property var _defaultBookmarks: ({
        "h": { path: Paths.home, label: "Home" },
        "d": { path: Paths.home + "/Downloads", label: "Downloads" }
    })

    // ── Public API ──────────────────────────────────────────────

    function addBookmark(key: string, path: string): void {
        const label = Paths.basename(path) || path;
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

    function isReservedKey(key: string): bool {
        return _reservedKeys.indexOf(key) >= 0;
    }

    // Well-known directory → icon mapping (matched by trailing path segment)
    readonly property var _knownDirectoryIcons: ({
        "": "home",                       // exact home directory
        "Downloads": "download",
        "Documents": "description",
        "Pictures": "image",
        "Pictures/Screenshots": "screenshot_monitor",
        "Videos": "video_library",
        "Music": "library_music",
        "Desktop": "desktop_windows",
        ".config": "settings"
    })

    function iconForPath(path: string): string {
        // Strip trailing slash and compute path relative to home
        const clean = path.endsWith("/") ? path.slice(0, -1) : path;
        const home = Paths.home;
        if (clean === home)
            return _knownDirectoryIcons[""];
        if (clean.startsWith(home + "/")) {
            const relative = clean.substring(home.length + 1);
            if (_knownDirectoryIcons.hasOwnProperty(relative))
                return _knownDirectoryIcons[relative];
        }
        return "bookmark";
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

        property string _capturedText: ""

        stdout: StdioCollector {
            onStreamFinished: readProcess._capturedText = text
        }

        onExited: (exitCode, exitStatus) => {
            const captured = _capturedText;
            _capturedText = "";
            if (exitCode === 0 && captured.trim() !== "") {
                root._applyBookmarks(captured);
            } else if (!_loaded) {
                // First run — seed with default bookmarks and persist
                bookmarks = Object.assign({}, _defaultBookmarks);
                _loaded = true;
                _save();
            }
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
