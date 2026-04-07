// Chord execution and bookmark sub-mode handling.
//
// Non-library JS — shares the QML component scope of FileList.qml.
// Singletons accessed via scope: BookmarkService, Paths, FileManagerService,
// FileSystemModel (for sort enum values), Logger.

// Bookmark sub-mode: capture a single letter for create/delete.
function handleBookmarkSubMode(event, root) {
    var windowState = root.windowState;
    var key = event.key;

    if (key === Qt.Key_Shift || key === Qt.Key_Control
        || key === Qt.Key_Alt || key === Qt.Key_Meta) {
        event.accepted = true;
        return;
    }
    if (key === Qt.Key_Escape) {
        windowState.bookmarkSubMode = "";
        event.accepted = true;
        return;
    }
    var letter = event.text.toLowerCase();
    if (letter.length === 1 && /^[a-z]$/.test(letter)) {
        if (windowState.bookmarkSubMode === "create") {
            if (BookmarkService.isReservedKey(letter)) {
                windowState.showTransientMessage("'" + letter + "' is reserved");
            } else {
                windowState.showTransientMessage("Bookmark '" + letter + "' → " + Paths.shortenHome(windowState.currentPath));
                BookmarkService.addBookmark(letter, windowState.currentPath);
            }
        } else if (windowState.bookmarkSubMode === "delete") {
            if (BookmarkService.hasBookmark(letter)) {
                BookmarkService.removeBookmark(letter);
                windowState.showTransientMessage("Bookmark '" + letter + "' deleted");
            } else {
                windowState.showTransientMessage("No bookmark on '" + letter + "'");
            }
        }
        windowState.bookmarkSubMode = "";
    } else {
        // Non-letter key (digit, Return, etc.) — cancel sub-mode
        windowState.bookmarkSubMode = "";
    }
    event.accepted = true;
}

// Resolve active chord prefix: ignore modifiers, cancel on Escape, dispatch.
function resolveChord(event, root, view, clipboardCopyProcess) {
    var windowState = root.windowState;
    var key = event.key;

    // Ignore bare modifier keys — they don't resolve a chord
    if (key === Qt.Key_Shift || key === Qt.Key_Control
        || key === Qt.Key_Alt || key === Qt.Key_Meta) {
        event.accepted = true;
        return;
    }
    var prefix = windowState.activeChordPrefix;
    windowState.activeChordPrefix = "";
    // All current chord prefixes (g=navigate, c=copy-path, ,=sort)
    // are safe in picker mode — no destructive chords exist yet.
    // Escape cancels the chord without executing it.
    if (key !== Qt.Key_Escape) {
        var keyChar = prefix === "," ? event.text : event.text.toLowerCase();
        _executeChord(prefix, keyChar, root, view, clipboardCopyProcess);
    }
    event.accepted = true;
}

function _executeChord(prefix, keyChar, root, view, clipboardCopyProcess) {
    var windowState = root.windowState;

    if (prefix === "g") {
        switch (keyChar) {
        case "g":
            view.currentIndex = 0;
            view.positionViewAtIndex(0, ListView.Beginning);
            break;
        case "n":
            windowState.bookmarkSubMode = "create";
            break;
        case "x":
            windowState.bookmarkSubMode = "delete";
            break;
        default:
            var bmPath = BookmarkService.getBookmarkPath(keyChar);
            if (bmPath !== "")
                root._saveCursorAndNavigate(function() { windowState.navigate(bmPath); });
            break;
        }
    } else if (prefix === "c") {
        if (clipboardCopyProcess.running)
            return;
        var hasSelection = windowState.selectedCount > 0;
        if (!hasSelection && !root.currentEntry)
            return;
        // "d" copies the current directory regardless of selection state
        if (keyChar === "d") {
            clipboardCopyProcess.command = ["wl-copy", "--", windowState.currentPath];
            clipboardCopyProcess.running = true;
            return;
        }
        var textToCopy;
        if (hasSelection) {
            var paths = windowState.getSelectedPathsArray();
            if (paths.length === 0)
                return;
            switch (keyChar) {
            case "c":
                textToCopy = paths.join("\n");
                break;
            case "f":
                textToCopy = paths.map(function(p) { return _basename(p); }).join("\n");
                break;
            case "n":
                textToCopy = paths.map(function(p) { return _stripExtension(_basename(p)); }).join("\n");
                break;
            default:
                return;
            }
        } else {
            switch (keyChar) {
            case "c":
                textToCopy = root.currentEntry.path;
                break;
            case "f":
                textToCopy = root.currentEntry.name;
                break;
            case "n":
                textToCopy = _stripExtension(root.currentEntry.name);
                break;
            default:
                return;
            }
        }
        clipboardCopyProcess.command = ["wl-copy", "--", textToCopy];
        clipboardCopyProcess.running = true;
    } else if (prefix === ",") {
        if (keyChar === "")
            return;
        // Lowercase = ascending, Uppercase = descending
        var isReverse = keyChar === keyChar.toUpperCase();
        var sortKey = keyChar.toLowerCase();
        var sortMap = {
            a: FileSystemModel.Alphabetical,
            m: FileSystemModel.Modified,
            s: FileSystemModel.Size,
            e: FileSystemModel.Extension,
            n: FileSystemModel.Natural
        };
        if (sortMap[sortKey] !== undefined) {
            windowState.sortBy = sortMap[sortKey];
            windowState.sortReverse = isReverse;
        }
    }
}

// String helpers used by the clipboard chord
function _basename(path) {
    return Paths.basename(path);
}

function _stripExtension(name) {
    var dotIndex = name.lastIndexOf(".");
    return dotIndex > 0 ? name.substring(0, dotIndex) : name;
}
