pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
import "FlashLogic.js" as FlashLogic
import Symmetria.FileManager.Models
import Quickshell.Io
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState

    readonly property var currentEntry: view.currentIndex >= 0 && view.currentIndex < view.count ? fsModel.entries[view.currentIndex] : null
    readonly property int fileCount: view.count
    signal closeRequested()

    // Set by onPathChanged (sync, before C++ async scan starts), cleared by
    // onEntriesChanged (async, after QtConcurrent scan and applyChanges complete).
    // Ensures currentIndex resets only after new entries are populated.
    property bool _pathJustChanged: false

    // Search: cursor position saved before entering search mode
    property int _preSearchIndex: 0

    // Keys suppressed in picker mode (file operations have no meaning in a file chooser).
    // Note: Key_C is intentionally absent — it starts the harmless "copy path" chord.
    readonly property var _pickerSuppressedKeys: [Qt.Key_D, Qt.Key_Y, Qt.Key_X, Qt.Key_P, Qt.Key_A, Qt.Key_R, Qt.Key_Space]

    // Filename to focus once the model refreshes (set by paste, create, rename, etc.)
    property string _pendingFocusName: ""

    // Flash navigation: cross-column entry sources (wired from MillerColumns)
    property var parentEntries: []
    property var previewDirectoryEntries: []
    property string previewDirectoryPath: ""
    property int _preFlashIndex: 0

    // Y of the bottom edge of the current item, relative to FileList root.
    // Used by RenamePopup for contextual positioning below the selected item.
    readonly property real currentItemBottomY: {
        if (view.currentIndex < 0 || view.count === 0) return 0;
        const itemY = view.currentIndex * Config.fileManager.sizes.itemHeight - view.contentY;
        return itemY + Config.fileManager.sizes.itemHeight + Theme.padding.sm;
    }

    function _saveCursorAndNavigate(navigateFn: var): void {
        windowState.saveCursor(windowState.currentPath, view.currentIndex);
        navigateFn();
    }

    function _navigateIntoCurrentItem(): void {
        if (!root.currentEntry || !root.currentEntry.isDir)
            return;
        _saveCursorAndNavigate(() => windowState.navigate(root.currentEntry.path));
    }

    function _activateCurrentItem(): void {
        if (!root.currentEntry)
            return;

        // Picker mode — Enter always means "confirm/select", never navigate.
        // Use l/→ to navigate into directories instead.
        //   saveMode=true  → return current browsing directory as save location (mirrors Save button)
        //   directory=true → select dirs only, ignore files
        //   (default)      → select files only, ignore dirs
        if (FileManagerService.pickerMode) {
            if (FileManagerService.pickerSaveMode) {
                // Save mode: Enter = Save button — returns current directory
                // as the save location (same as StatusBar's accept button).
                FileManagerService.completePickerMode([windowState.currentPath]);
            } else if (FileManagerService.pickerDirectory) {
                // Directory picker: only dirs are selectable; ignore Enter on files.
                if (root.currentEntry.isDir)
                    FileManagerService.completePickerMode([root.currentEntry.path]);
            } else {
                // Open file picker: Enter selects files only; use l/→ for dirs.
                if (!root.currentEntry.isDir)
                    FileManagerService.completePickerMode([root.currentEntry.path]);
            }
            return;
        }

        if (root.currentEntry.isDir)
            _navigateIntoCurrentItem();
        else
            Qt.openUrlExternally("file://" + root.currentEntry.path);
    }

    function _executeChord(prefix: string, keyChar: string): void {
        if (prefix === "g") {
            switch (keyChar) {
            case "g":
                view.currentIndex = 0;
                view.positionViewAtIndex(0, ListView.Beginning);
                break;
            case "h":
                _saveCursorAndNavigate(() => windowState.navigate(Paths.home));
                break;
            case "d":
                _saveCursorAndNavigate(() => windowState.navigate(Paths.home + "/Downloads"));
                break;
            case "s":
                _saveCursorAndNavigate(() => windowState.navigate(Paths.home + "/Pictures/Screenshots"));
                break;
            case "v":
                _saveCursorAndNavigate(() => windowState.navigate(Paths.home + "/Videos"));
                break;
            }
        } else if (prefix === "c") {
            if (clipboardCopyProcess.running)
                return;
            const hasSelection = windowState.selectedCount > 0;
            if (!hasSelection && !root.currentEntry)
                return;
            let textToCopy;
            if (hasSelection) {
                const paths = windowState.getSelectedPathsArray();
                switch (keyChar) {
                case "c":
                    textToCopy = paths.join("\n");
                    break;
                case "f":
                    textToCopy = paths.map(p => _basename(p)).join("\n");
                    break;
                case "n":
                    textToCopy = paths.map(p => _stripExtension(_basename(p))).join("\n");
                    break;
                case "d":
                    textToCopy = windowState.currentPath;
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
                case "d":
                    textToCopy = windowState.currentPath;
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
            const isReverse = keyChar === keyChar.toUpperCase();
            const sortKey = keyChar.toLowerCase();
            // Integer values MUST match C++ FileSystemModel::SortBy enum order
            const sortMap = { a: 0, m: 1, s: 2, e: 3, n: 4 };
            if (sortMap[sortKey] !== undefined) {
                windowState.sortBy = sortMap[sortKey];
                windowState.sortReverse = isReverse;
            }
        }
    }

    function _basename(path: string): string {
        return path.substring(path.lastIndexOf("/") + 1);
    }

    function _stripExtension(name: string): string {
        const dotIndex = name.lastIndexOf(".");
        return dotIndex > 0 ? name.substring(0, dotIndex) : name;
    }

    function _executePaste(): void {
        if (FileManagerService.clipboardPaths.length === 0 || pasteProcess.running)
            return;

        const paths = FileManagerService.clipboardPaths;
        const destDir = windowState.currentPath;

        // Focus the first pasted item after model refreshes
        root._pendingFocusName = paths[0].substring(paths[0].lastIndexOf("/") + 1);

        // cp and mv both accept multiple source args before a single destination:
        //   cp -r -- file1 file2 file3 destDir
        if (FileManagerService.clipboardMode === "yank")
            pasteProcess.command = ["cp", "-r", "--", ...paths, destDir];
        else
            pasteProcess.command = ["mv", "--", ...paths, destDir];

        pasteProcess.running = true;
    }

    function _halfPageCount(): int {
        return Math.max(1, Math.floor(view.height / Config.fileManager.sizes.itemHeight / 2));
    }

    function _computeMatches(preservePosition: bool): void {
        const query = windowState.searchQuery.toLowerCase();
        if (query === "") {
            windowState.matchIndices = [];
            windowState.currentMatchIndex = -1;
            return;
        }

        const entries = fsModel.entries;
        let indices = [];
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].name.toLowerCase().indexOf(query) !== -1)
                indices.push(i);
        }

        windowState.matchIndices = indices;

        if (indices.length === 0) {
            windowState.currentMatchIndex = -1;
        } else if (preservePosition) {
            const previousTarget = view.currentIndex;
            const newPos = indices.indexOf(previousTarget);
            windowState.currentMatchIndex = newPos >= 0 ? newPos : 0;
        } else {
            windowState.currentMatchIndex = 0;
        }

        // Always jump after recomputing — the onChanged signal won't fire
        // when currentMatchIndex stays at the same numeric value (e.g. 0→0)
        // even though matchIndices changed and the target file is different.
        _jumpToCurrentMatch();
    }

    function _jumpToCurrentMatch(): void {
        const idx = windowState.currentMatchIndex;
        const matches = windowState.matchIndices;
        if (idx >= 0 && idx < matches.length) {
            view.currentIndex = matches[idx];
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
        }
    }

    function _recomputeFlash(): void {
        const query = windowState.flashQuery.toLowerCase();
        if (query === "") {
            // Reset result state only — flash remains active, just with no matches yet.
            // Do not clear flashActive or flashPendingLabel here.
            windowState.flashMatches = [];
            windowState.flashLabelChars = {};
            windowState.flashContinuations = {};
            return;
        }

        // Collect entries from all three columns
        const allEntries = [];

        const currentEntries = fsModel.entries;
        for (let i = 0; i < currentEntries.length; i++) {
            allEntries.push({
                name:   currentEntries[i].name,
                column: "current",
                index:  i,
                path:   currentEntries[i].path,
                isDir:  currentEntries[i].isDir
            });
        }

        // Only include preview entries if the directory path is resolved
        // (avoids searching stale entries during the 150ms debounce window)
        const prevEntries = root.previewDirectoryPath !== "" ? root.previewDirectoryEntries : null;
        if (prevEntries) {
            for (let i = 0; i < prevEntries.length; i++) {
                allEntries.push({
                    name:   prevEntries[i].name,
                    column: "preview",
                    index:  i,
                    path:   prevEntries[i].path,
                    isDir:  prevEntries[i].isDir
                });
            }
        }

        const parEntries = root.parentEntries;
        for (let i = 0; i < parEntries.length; i++) {
            allEntries.push({
                name:   parEntries[i].name,
                column: "parent",
                index:  i,
                path:   parEntries[i].path,
                isDir:  parEntries[i].isDir
            });
        }

        const result = FlashLogic.computeFlash(query, allEntries, view.currentIndex);
        windowState.flashMatches = result.matches;
        windowState.flashLabelChars = result.labelChars;
        windowState.flashContinuations = result.continuations;

        if (Logger.minLevel <= Logger.levelDebug) {
            const contKeys = Object.keys(result.continuations).join("");
            const labelKeys = Object.keys(result.labelChars).join("");
            const labelList = result.matches.map(m => m.label + "→" + m.name.substring(0, 15)).join(", ");
            Logger.debug("Flash", "Recompute query='" + query + "' | entries=" + allEntries.length
                + " | matches=" + result.matches.length
                + " | continuations=[" + contKeys + "] | labelPool=[" + labelKeys + "]"
                + " | labels: " + labelList);
        }
    }

    Connections {
        target: windowState

        function onSearchQueryChanged() {
            root._computeMatches(false);
        }

        function onCurrentMatchIndexChanged() {
            root._jumpToCurrentMatch();
        }

        function onSearchCancelled() {
            view.currentIndex = root._preSearchIndex;
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
            Qt.callLater(() => view.forceActiveFocus());
        }

        function onSearchConfirmed() {
            Qt.callLater(() => view.forceActiveFocus());
        }

        function onDeleteConfirmPathsChanged() {
            if (windowState.deleteConfirmPaths.length === 0)
                Qt.callLater(() => view.forceActiveFocus());
        }

        function onCreateInputActiveChanged() {
            if (!windowState.createInputActive)
                Qt.callLater(() => view.forceActiveFocus());
        }

        function onCreateCompleted(filename: string) {
            root._pendingFocusName = filename;
        }

        function onRenameTargetPathChanged() {
            if (windowState.renameTargetPath === "")
                Qt.callLater(() => view.forceActiveFocus());
        }

        function onRenameCompleted(newName: string) {
            root._pendingFocusName = newName;
        }

        function onContextMenuTargetPathChanged() {
            if (windowState.contextMenuTargetPath === "")
                Qt.callLater(() => view.forceActiveFocus());
        }

        function onFlashJump(column: string, index: int, path: string) {
            Logger.info("Flash", "Jump → " + column + ":" + index + " path=" + path);
            if (column === "current") {
                view.currentIndex = index;
                view.positionViewAtIndex(index, ListView.Contain);
            } else if (column === "preview") {
                if (root.previewDirectoryPath !== "") {
                    windowState.saveCursor(root.previewDirectoryPath, index);
                    root._saveCursorAndNavigate(() => windowState.navigate(root.previewDirectoryPath));
                }
            } else if (column === "parent") {
                const parentPath = windowState.currentPath.replace(/\/[^/]+$/, "") || "/";
                // Save the flash target cursor BEFORE _saveCursorAndNavigate, which saves
                // currentPath's cursor (a different path). Order is load-bearing.
                windowState.saveCursor(parentPath, index);
                root._saveCursorAndNavigate(() => windowState.goUp());
            }
        }
    }

    // Background
    StyledRect {
        anchors.fill: parent
        color: Theme.layer(Theme.palette.m3surfaceContainerLow, 1)
    }

    // Empty state
    Loader {
        anchors.centerIn: parent
        opacity: view.count === 0 ? 1 : 0
        active: opacity > 0
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.md

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "folder_open"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("This folder is empty")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xl
                font.weight: 500
            }
        }

        Behavior on opacity {
            Anim {}
        }
    }

    ListView {
        id: view

        anchors.fill: parent
        anchors.margins: Theme.padding.sm
        anchors.rightMargin: Theme.padding.sm + 10 // reserve space for re-parented scrollbar (6px wide + 4px clearance)

        clip: true
        focus: true
        keyNavigationEnabled: false
        boundsBehavior: Flickable.StopAtBounds
        Component.onCompleted: view.forceActiveFocus()

        // Re-parented to view.parent so the scrollbar lives outside the ListView's
        // clipping rect and can be positioned independently in the right margin gap.
        ScrollBar.vertical: ScrollBar {
            policy: ScrollBar.AlwaysOn
            parent: view.parent
            anchors.top: view.top
            anchors.bottom: view.bottom
            anchors.right: parent.right
            anchors.rightMargin: Theme.padding.sm + 3 // right-aligns the 6px bar with 3px clearance from the window edge
            width: 6

            contentItem: Rectangle {
                implicitWidth: 6
                radius: width / 2
                color: Theme.palette.m3onSurfaceVariant
                opacity: 0.4
            }
        }

        model: FileSystemModel {
            id: fsModel
            path: root.windowState ? root.windowState.currentPath : Paths.home
            showHidden: Config.fileManager.showHidden
            sortBy: root.windowState ? root.windowState.sortBy : 1
            sortReverse: root.windowState ? root.windowState.sortReverse : true
            watchChanges: true
            onPathChanged: root._pathJustChanged = true
            onEntriesChanged: {
                if (root._pathJustChanged) {
                    root._pathJustChanged = false;
                    const restored = root.windowState ? root.windowState.restoreCursor(fsModel.path) : 0;
                    const safeIndex = Math.min(restored, Math.max(view.count - 1, 0));
                    view.currentIndex = safeIndex;
                    view.positionViewAtIndex(safeIndex, ListView.Beginning);
                } else {
                    // Clamp cursor after file deletion or external changes
                    if (view.currentIndex >= view.count && view.count > 0)
                        view.currentIndex = view.count - 1;
                    // Focus a specific file if pending (set by paste, create, etc.) —
                    // only applies to same-directory refreshes, never to path navigations
                    if (root._pendingFocusName !== "") {
                        const entries = fsModel.entries;
                        for (let i = 0; i < entries.length; i++) {
                            if (entries[i].name === root._pendingFocusName) {
                                view.currentIndex = i;
                                view.positionViewAtIndex(i, ListView.Contain);
                                break;
                            }
                        }
                        root._pendingFocusName = "";
                    }
                }
                // Re-compute matches if search is active (handles async model reload)
                if (root.windowState && root.windowState.searchQuery !== "")
                    root._computeMatches(true);
            }
        }

        delegate: FileListItem {
            width: view.width
            searchQuery: root.windowState ? root.windowState.searchQuery : ""
            isSearchMatch: root.windowState ? root.windowState.matchIndices.indexOf(index) !== -1 : false
            // Reading selectedPaths in the expression makes QML re-evaluate
            // this binding whenever the object reference changes (toggleSelection
            // assigns a new object each time, triggering the notify signal).
            isSelected: root.windowState && root.windowState.selectedPaths
                        ? !!root.windowState.selectedPaths[modelData.path] : false
            flashActive: root.windowState ? root.windowState.flashActive : false
            flashQuery: root.windowState ? root.windowState.flashQuery : ""
            flashLabel: root.windowState?.flashMatchMap["current:" + index]?.label ?? ""
            flashMatchStart: root.windowState?.flashMatchMap["current:" + index]?.matchStart ?? -1
            onActivated: root._activateCurrentItem()
        }

        // Vim-style keyboard navigation
        Keys.onPressed: function(event) {
            // Block all keys while a modal popup is visible
            if (windowState.deleteConfirmPaths.length > 0 || windowState.createInputActive
                || windowState.renameTargetPath !== "" || windowState.contextMenuTargetPath !== "") {
                event.accepted = true;
                return;
            }

            const key = event.key;
            const mods = event.modifiers;

            // Resolve active chord BEFORE picker suppression — otherwise a
            // chord like g,d is broken because 'd' gets suppressed before
            // the chord resolver can see it.
            if (windowState.activeChordPrefix !== "") {
                // Ignore bare modifier keys (Shift, Ctrl, Alt, Meta) — they don't
                // resolve a chord, they're just held to modify the next real key.
                if (key === Qt.Key_Shift || key === Qt.Key_Control
                    || key === Qt.Key_Alt || key === Qt.Key_Meta) {
                    event.accepted = true;
                    return;
                }
                const prefix = windowState.activeChordPrefix;
                windowState.activeChordPrefix = "";
                // All current chord prefixes (g=navigate, c=copy-path, ,=sort)
                // are safe in picker mode — no destructive chords exist yet.
                // Escape cancels the chord without executing it.
                if (key !== Qt.Key_Escape) {
                    const keyChar = prefix === "," ? event.text : event.text.toLowerCase();
                    root._executeChord(prefix, keyChar);
                }
                event.accepted = true;
                return;
            }

            // Flash navigation mode: intercept all keys for search/label/jump
            if (windowState.flashActive) {
                if (key === Qt.Key_Shift || key === Qt.Key_Control
                    || key === Qt.Key_Alt || key === Qt.Key_Meta) {
                    event.accepted = true;
                    return;
                }

                if (key === Qt.Key_Escape) {
                    Logger.debug("Flash", "Escape → cancel flash");
                    view.currentIndex = root._preFlashIndex;
                    view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                    windowState.clearFlash();
                    event.accepted = true;
                    return;
                }

                if (key === Qt.Key_Backspace) {
                    // Cancel pending 2-char label without touching the query
                    if (windowState.flashPendingLabel !== "") {
                        Logger.debug("Flash", "Backspace → cancel pending 2-char label '" + windowState.flashPendingLabel + "'");
                        windowState.flashPendingLabel = "";
                    } else if (windowState.flashQuery.length > 0) {
                        Logger.debug("Flash", "Backspace → query '" + windowState.flashQuery + "' → '" + windowState.flashQuery.slice(0, -1) + "'");
                        windowState.flashQuery = windowState.flashQuery.slice(0, -1);
                        root._recomputeFlash();
                    } else {
                        Logger.debug("Flash", "Backspace → empty query, cancel flash");
                        view.currentIndex = root._preFlashIndex;
                        view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                        windowState.clearFlash();
                    }
                    event.accepted = true;
                    return;
                }

                const ch = event.text.toLowerCase();
                if (ch === "") {
                    Logger.debug("Flash", "Ignored non-printable key=" + key + " text='" + event.text + "'");
                    event.accepted = true;
                    return;
                }

                if (Logger.minLevel <= Logger.levelDebug) {
                    Logger.debug("Flash", "Keypress '" + ch + "' | query='" + windowState.flashQuery
                        + "' | isLabel=" + !!windowState.flashLabelChars[ch]
                        + " | isContinuation=" + !!windowState.flashContinuations[ch]
                        + " | pendingLabel='" + windowState.flashPendingLabel + "'");
                }

                // Resolve second char of a 2-char label
                if (windowState.flashPendingLabel !== "") {
                    const fullLabel = windowState.flashPendingLabel + ch;
                    windowState.flashPendingLabel = "";
                    const pending = windowState.flashMatches;
                    for (let i = 0; i < pending.length; i++) {
                        if (pending[i].label === fullLabel) {
                            Logger.info("Flash", "2-char label '" + fullLabel + "' → jump " + pending[i].column + ":" + pending[i].index + " " + pending[i].path);
                            windowState.flashJump(pending[i].column, pending[i].index, pending[i].path);
                            windowState.clearFlash();
                            event.accepted = true;
                            return;
                        }
                    }
                    Logger.debug("Flash", "Invalid 2-char label '" + fullLabel + "' — ignored");
                    event.accepted = true;
                    return;
                }

                // Check if char is a label
                if (windowState.flashLabelChars[ch]) {
                    const matches = windowState.flashMatches;
                    // Try exact 1-char label
                    const exact = matches.find(m => m.label === ch);
                    if (exact) {
                        Logger.info("Flash", "Label '" + ch + "' → jump " + exact.column + ":" + exact.index + " " + exact.path);
                        windowState.flashJump(exact.column, exact.index, exact.path);
                        windowState.clearFlash();
                        event.accepted = true;
                        return;
                    }
                    // Check if first char of any 2-char label
                    if (matches.some(m => m.label.length === 2 && m.label[0] === ch)) {
                        Logger.debug("Flash", "'" + ch + "' is 2-char label prefix → waiting for second char");
                        windowState.flashPendingLabel = ch;
                        event.accepted = true;
                        return;
                    }
                }

                // Check if char is a continuation → extend query.
                // When query is empty, every printable char is a valid first search char
                // (no continuations or labels exist yet).
                if (windowState.flashQuery === "" || windowState.flashContinuations[ch]) {
                    Logger.debug("Flash", "Continuation '" + ch + "' → query becomes '" + windowState.flashQuery + ch + "'");
                    windowState.flashQuery += ch;
                    root._recomputeFlash();
                    event.accepted = true;
                    return;
                }

                // Neither label nor continuation — ignore
                Logger.warn("Flash", "'" + ch + "' is neither label nor continuation — dropped");
                event.accepted = true;
                return;
            }

            // Picker mode: Escape cancels, suppress file-op keys
            if (FileManagerService.pickerMode) {
                if (key === Qt.Key_Escape) {
                    FileManagerService.cancelPickerMode();
                    event.accepted = true;
                    return;
                }
                // Suppress file operations — they don't belong in a picker.
                // Ctrl+D (half-page down) is allowed; bare D (delete) is suppressed.
                const isCtrlD = key === Qt.Key_D && (mods & Qt.ControlModifier);
                if (!isCtrlD && root._pickerSuppressedKeys.indexOf(key) !== -1) {
                    event.accepted = true;
                    return;
                }
                // Suppress Ctrl+V (paste) in picker mode
                if (key === Qt.Key_V && (mods & Qt.ControlModifier)) {
                    event.accepted = true;
                    return;
                }
            }

            switch (key) {
            case Qt.Key_J:
            case Qt.Key_Down:
                if (view.currentIndex < view.count - 1)
                    view.currentIndex++;
                event.accepted = true;
                break;

            case Qt.Key_K:
            case Qt.Key_Up:
                if (view.currentIndex > 0)
                    view.currentIndex--;
                event.accepted = true;
                break;

            case Qt.Key_H:
            case Qt.Key_Left:
                root._saveCursorAndNavigate(() => windowState.goUp());
                event.accepted = true;
                break;

            case Qt.Key_L:
            case Qt.Key_Right:
                root._navigateIntoCurrentItem();
                event.accepted = true;
                break;

            case Qt.Key_Return:
            case Qt.Key_Enter:
                if (mods & Qt.ControlModifier) {
                    // Ctrl+Enter: open context menu for current file (not directories)
                    if (root.currentEntry && !root.currentEntry.isDir) {
                        windowState.requestContextMenu(
                            root.currentEntry.path,
                            root.currentEntry.mimeType
                        );
                    }
                } else {
                    root._activateCurrentItem();
                }
                event.accepted = true;
                break;

            case Qt.Key_G:
                if (mods & Qt.ShiftModifier) {
                    // G — jump to last
                    if (view.count > 0) {
                        view.currentIndex = view.count - 1;
                        view.positionViewAtIndex(view.count - 1, ListView.End);
                    }
                } else {
                    // g — start "go to" chord, show which-key popup
                    windowState.activeChordPrefix = "g";
                }
                event.accepted = true;
                break;

            case Qt.Key_C:
                // c — start "copy to clipboard" chord
                windowState.activeChordPrefix = "c";
                event.accepted = true;
                break;

            case Qt.Key_D:
                if (mods & Qt.ControlModifier) {
                    // Ctrl+D — half-page down
                    if (view.count > 0) {
                        view.currentIndex = Math.min(view.currentIndex + root._halfPageCount(), view.count - 1);
                        view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                    }
                } else {
                    // D — trash file(s) (request confirmation)
                    if (windowState.selectedCount > 0) {
                        windowState.requestDelete(windowState.getSelectedPathsArray());
                        windowState.clearSelection();
                    } else if (root.currentEntry) {
                        windowState.requestDelete([root.currentEntry.path]);
                    }
                }
                event.accepted = true;
                break;

            case Qt.Key_U:
                if ((mods & Qt.ControlModifier) && view.count > 0) {
                    view.currentIndex = Math.max(view.currentIndex - root._halfPageCount(), 0);
                    view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                }
                event.accepted = true;
                break;

            case Qt.Key_Period:
                Config.fileManager.showHidden = !Config.fileManager.showHidden;
                Config.save();
                event.accepted = true;
                break;

            case Qt.Key_AsciiTilde:
                root._saveCursorAndNavigate(() => windowState.navigate(Paths.home));
                event.accepted = true;
                break;

            case Qt.Key_Minus:
                root._saveCursorAndNavigate(() => windowState.back());
                event.accepted = true;
                break;

            case Qt.Key_Equal:
                root._saveCursorAndNavigate(() => windowState.forward());
                event.accepted = true;
                break;

            case Qt.Key_Slash:
                root._preSearchIndex = view.currentIndex;
                windowState.startSearch();
                event.accepted = true;
                break;

            case Qt.Key_S:
                Logger.info("Flash", "S pressed → entering flash mode (cursor at " + view.currentIndex + ")");
                root._preFlashIndex = view.currentIndex;
                windowState.startFlash();
                event.accepted = true;
                break;

            case Qt.Key_Y:
                if (windowState.selectedCount > 0) {
                    FileManagerService.yank(windowState.getSelectedPathsArray());
                    windowState.clearSelection();
                } else if (root.currentEntry) {
                    FileManagerService.yank([root.currentEntry.path]);
                }
                event.accepted = true;
                break;

            case Qt.Key_X:
                if (windowState.selectedCount > 0) {
                    FileManagerService.cut(windowState.getSelectedPathsArray());
                    windowState.clearSelection();
                } else if (root.currentEntry) {
                    FileManagerService.cut([root.currentEntry.path]);
                }
                event.accepted = true;
                break;

            case Qt.Key_P:
                root._executePaste();
                event.accepted = true;
                break;

            case Qt.Key_V:
                if (mods & Qt.ControlModifier) {
                    root._executePaste();
                    event.accepted = true;
                }
                // bare V is unbound — let event propagate
                break;

            case Qt.Key_N:
                if (!windowState.searchActive && windowState.matchIndices.length > 0) {
                    if (mods & Qt.ShiftModifier)
                        windowState.previousMatch();
                    else
                        windowState.nextMatch();
                    event.accepted = true;
                }
                break;

            case Qt.Key_Space:
                if (root.currentEntry) {
                    windowState.toggleSelection(root.currentEntry.path);
                    // Advance cursor after toggling, like Yazi
                    if (view.currentIndex < view.count - 1)
                        view.currentIndex++;
                }
                event.accepted = true;
                break;

            case Qt.Key_Escape:
                if (windowState.selectedCount > 0)
                    windowState.clearSelection();
                event.accepted = true;
                break;

            case Qt.Key_A:
                windowState.requestCreate();
                event.accepted = true;
                break;

            case Qt.Key_R:
                if (root.currentEntry) {
                    const includeExt = (mods & Qt.ShiftModifier) !== 0;
                    windowState.requestRename(root.currentEntry.path, includeExt);
                }
                event.accepted = true;
                break;

            case Qt.Key_Comma:
                windowState.activeChordPrefix = ",";
                event.accepted = true;
                break;
            }
        }

        onActiveFocusChanged: {
            if (!activeFocus && windowState.activeChordPrefix !== "")
                windowState.activeChordPrefix = "";
        }
    }

    Process {
        id: pasteProcess
        onExited: (exitCode, exitStatus) => {
            if (exitCode === 0 && exitStatus === Process.NormalExit) {
                FileManagerService.clearClipboard();
            } else {
                console.warn("FileList: paste failed — exitCode:", exitCode, "exitStatus:", exitStatus);
                root._pendingFocusName = "";
            }
        }
    }

    Process {
        id: clipboardCopyProcess
        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0 || exitStatus !== Process.NormalExit)
                console.warn("FileList: wl-copy failed — exitCode:", exitCode, "exitStatus:", exitStatus);
        }
    }
}
