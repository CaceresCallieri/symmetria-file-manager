import "../../components"
import "../../services"
import "../../config"
import Symmetria.Models
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

    // Keys suppressed in picker mode (file operations have no meaning in a file chooser)
    readonly property var _pickerSuppressedKeys: [Qt.Key_D, Qt.Key_Y, Qt.Key_X, Qt.Key_P, Qt.Key_A, Qt.Key_Space, Qt.Key_C]

    // Filename to focus once the model refreshes (set by paste, create, etc.)
    property string _pendingFocusName: ""

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

        // Picker mode — four behavioural cases based on mode flags:
        //   saveMode=true  → navigate dirs, select file as "overwrite" target
        //   directory=true → select dirs only, ignore files
        //   (default)      → navigate dirs, select files
        //   (saveMode+dir is handled by SaveFiles in the portal: directory=true,
        //    saveMode=true → a directory picker where Enter selects the dir)
        if (FileManagerService.pickerMode) {
            if (FileManagerService.pickerSaveMode) {
                // Save mode: Enter on a dir navigates into it so the user can
                // choose a target directory. Enter on a file selects it as the
                // overwrite target (returns that file's path to the caller).
                if (root.currentEntry.isDir)
                    _navigateIntoCurrentItem();
                else
                    FileManagerService.completePickerMode([root.currentEntry.path]);
            } else if (FileManagerService.pickerDirectory) {
                // Directory picker: only dirs are selectable; ignore Enter on files.
                if (root.currentEntry.isDir)
                    FileManagerService.completePickerMode([root.currentEntry.path]);
            } else {
                // Open file picker: navigate into dirs, select files.
                if (root.currentEntry.isDir)
                    _navigateIntoCurrentItem();
                else
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
            if (!root.currentEntry)
                return;
            if (clipboardCopyProcess.running)
                return;
            let textToCopy;
            switch (keyChar) {
            case "c":
                textToCopy = root.currentEntry.path;
                break;
            case "f":
                textToCopy = root.currentEntry.name;
                break;
            case "n": {
                // Strip extension (last dot onwards), but keep names that start with a dot
                const name = root.currentEntry.name;
                const dotIndex = name.lastIndexOf(".");
                textToCopy = dotIndex > 0 ? name.substring(0, dotIndex) : name;
                break;
            }
            case "d":
                textToCopy = windowState.currentPath;
                break;
            default:
                return;
            }
            clipboardCopyProcess.command = ["wl-copy", "--", textToCopy];
            clipboardCopyProcess.running = true;
        }
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

        clip: true
        focus: true
        keyNavigationEnabled: false
        boundsBehavior: Flickable.StopAtBounds
        Component.onCompleted: view.forceActiveFocus()

        ScrollBar.vertical: ScrollBar {
            policy: ScrollBar.AsNeeded
        }

        model: FileSystemModel {
            id: fsModel
            path: root.windowState ? root.windowState.currentPath : Paths.home
            showHidden: Config.fileManager.showHidden
            sortReverse: Config.fileManager.sortReverse
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
            onActivated: root._activateCurrentItem()
        }

        // Vim-style keyboard navigation
        Keys.onPressed: function(event) {
            // Block all keys while a modal popup is visible
            if (windowState.deleteConfirmPaths.length > 0 || windowState.createInputActive) {
                event.accepted = true;
                return;
            }

            // Picker mode: Escape cancels, suppress file-op keys
            if (FileManagerService.pickerMode) {
                if (event.key === Qt.Key_Escape) {
                    FileManagerService.cancelPickerMode();
                    event.accepted = true;
                    return;
                }
                // Suppress file operations — they don't belong in a picker.
                // Ctrl+D (half-page down) is allowed; bare D (delete) is suppressed.
                const isCtrlD = event.key === Qt.Key_D && (event.modifiers & Qt.ControlModifier);
                if (!isCtrlD && root._pickerSuppressedKeys.indexOf(event.key) !== -1) {
                    event.accepted = true;
                    return;
                }
                // Suppress Ctrl+V (paste) in picker mode
                if (event.key === Qt.Key_V && (event.modifiers & Qt.ControlModifier)) {
                    event.accepted = true;
                    return;
                }
            }

            const key = event.key;
            const mods = event.modifiers;

            // Resolve active chord — any keypress completes or cancels it
            if (windowState.activeChordPrefix !== "") {
                const prefix = windowState.activeChordPrefix;
                windowState.activeChordPrefix = "";
                // In picker mode, cancel the chord without executing it
                if (!FileManagerService.pickerMode && key !== Qt.Key_Escape) {
                    const keyChar = event.text.toLowerCase();
                    root._executeChord(prefix, keyChar);
                }
                event.accepted = true;
                return;
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
                root._activateCurrentItem();
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

            case Qt.Key_Q:
                root.closeRequested();
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
