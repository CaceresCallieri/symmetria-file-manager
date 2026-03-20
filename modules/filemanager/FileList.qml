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

    readonly property var currentEntry: view.currentIndex >= 0 && view.currentIndex < view.count ? fsModel.entries[view.currentIndex] : null
    readonly property int fileCount: view.count
    signal closeRequested()

    // Set by onPathChanged (sync, before C++ async scan starts), cleared by
    // onEntriesChanged (async, after QtConcurrent scan and applyChanges complete).
    // Ensures currentIndex resets only after new entries are populated.
    property bool _pathJustChanged: false

    // Search: cursor position saved before entering search mode
    property int _preSearchIndex: 0

    // Filename to focus once the model refreshes (set by paste, create, etc.)
    property string _pendingFocusName: ""

    function _saveCursorAndNavigate(navigateFn: var): void {
        FileManagerService.saveCursor(FileManagerService.currentPath, view.currentIndex);
        navigateFn();
    }

    function _activateCurrentItem(): void {
        if (!root.currentEntry)
            return;
        if (root.currentEntry.isDir)
            _saveCursorAndNavigate(() => FileManagerService.navigate(root.currentEntry.path));
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
                _saveCursorAndNavigate(() => FileManagerService.navigate(Paths.home));
                break;
            case "d":
                _saveCursorAndNavigate(() => FileManagerService.navigate(Paths.home + "/Downloads"));
                break;
            case "s":
                _saveCursorAndNavigate(() => FileManagerService.navigate(Paths.home + "/Pictures/Screenshots"));
                break;
            case "v":
                _saveCursorAndNavigate(() => FileManagerService.navigate(Paths.home + "/Videos"));
                break;
            }
        }
    }

    function _executePaste(): void {
        if (FileManagerService.clipboardPath === "" || pasteProcess.running)
            return;

        const sourcePath = FileManagerService.clipboardPath;
        const destDir = FileManagerService.currentPath;

        // Extract basename to focus after model refreshes
        root._pendingFocusName = sourcePath.substring(sourcePath.lastIndexOf("/") + 1);

        if (FileManagerService.clipboardMode === "yank")
            pasteProcess.command = ["cp", "-r", "--", sourcePath, destDir];
        else
            pasteProcess.command = ["mv", "--", sourcePath, destDir];

        pasteProcess.running = true;
    }

    function _halfPageCount(): int {
        return Math.max(1, Math.floor(view.height / Config.fileManager.sizes.itemHeight / 2));
    }

    function _computeMatches(preservePosition: bool): void {
        const query = FileManagerService.searchQuery.toLowerCase();
        if (query === "") {
            FileManagerService.matchIndices = [];
            FileManagerService.currentMatchIndex = -1;
            return;
        }

        const entries = fsModel.entries;
        let indices = [];
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].name.toLowerCase().indexOf(query) !== -1)
                indices.push(i);
        }

        FileManagerService.matchIndices = indices;

        if (indices.length === 0) {
            FileManagerService.currentMatchIndex = -1;
        } else if (preservePosition) {
            const previousTarget = view.currentIndex;
            const newPos = indices.indexOf(previousTarget);
            FileManagerService.currentMatchIndex = newPos >= 0 ? newPos : 0;
        } else {
            FileManagerService.currentMatchIndex = 0;
        }

        // Always jump after recomputing — the onChanged signal won't fire
        // when currentMatchIndex stays at the same numeric value (e.g. 0→0)
        // even though matchIndices changed and the target file is different.
        _jumpToCurrentMatch();
    }

    function _jumpToCurrentMatch(): void {
        const idx = FileManagerService.currentMatchIndex;
        const matches = FileManagerService.matchIndices;
        if (idx >= 0 && idx < matches.length) {
            view.currentIndex = matches[idx];
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
        }
    }

    Connections {
        target: FileManagerService

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

        function onDeleteConfirmPathChanged() {
            if (FileManagerService.deleteConfirmPath === "")
                Qt.callLater(() => view.forceActiveFocus());
        }

        function onCreateInputActiveChanged() {
            if (!FileManagerService.createInputActive)
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
            path: FileManagerService.currentPath
            showHidden: Config.fileManager.showHidden
            sortReverse: Config.fileManager.sortReverse
            watchChanges: true
            onPathChanged: root._pathJustChanged = true
            onEntriesChanged: {
                if (root._pathJustChanged) {
                    root._pathJustChanged = false;
                    const restored = FileManagerService.restoreCursor(fsModel.path);
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
                if (FileManagerService.searchQuery !== "")
                    root._computeMatches(true);
            }
        }

        delegate: FileListItem {
            width: view.width
            searchQuery: FileManagerService.searchQuery
            isSearchMatch: FileManagerService.matchIndices.indexOf(index) !== -1
            onActivated: root._activateCurrentItem()
        }

        // Vim-style keyboard navigation
        Keys.onPressed: function(event) {
            // Block all keys while a modal popup is visible
            if (FileManagerService.deleteConfirmPath !== "" || FileManagerService.createInputActive) {
                event.accepted = true;
                return;
            }

            const key = event.key;
            const mods = event.modifiers;

            // Resolve active chord — any keypress completes or cancels it
            if (FileManagerService.activeChordPrefix !== "") {
                const prefix = FileManagerService.activeChordPrefix;
                FileManagerService.activeChordPrefix = "";

                if (key !== Qt.Key_Escape) {
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
                root._saveCursorAndNavigate(() => FileManagerService.goUp());
                event.accepted = true;
                break;

            case Qt.Key_L:
            case Qt.Key_Right:
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
                    FileManagerService.activeChordPrefix = "g";
                }
                event.accepted = true;
                break;

            case Qt.Key_D:
                if (mods & Qt.ControlModifier) {
                    // Ctrl+D — half-page down
                    if (view.count > 0) {
                        view.currentIndex = Math.min(view.currentIndex + root._halfPageCount(), view.count - 1);
                        view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                    }
                } else if (root.currentEntry) {
                    // D — trash file (request confirmation)
                    FileManagerService.requestDelete(root.currentEntry.path);
                }
                event.accepted = true;
                break;

            case Qt.Key_U:
                if ((mods & Qt.ControlModifier) && view.count > 0) {
                    view.currentIndex = Math.max(view.currentIndex - root._halfPageCount(), 0);
                    view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                    event.accepted = true;
                }
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
                root._saveCursorAndNavigate(() => FileManagerService.navigate(Paths.home));
                event.accepted = true;
                break;

            case Qt.Key_Minus:
                root._saveCursorAndNavigate(() => FileManagerService.back());
                event.accepted = true;
                break;

            case Qt.Key_Equal:
                root._saveCursorAndNavigate(() => FileManagerService.forward());
                event.accepted = true;
                break;

            case Qt.Key_Slash:
                root._preSearchIndex = view.currentIndex;
                FileManagerService.startSearch();
                event.accepted = true;
                break;

            case Qt.Key_Y:
                if (root.currentEntry)
                    FileManagerService.yank(root.currentEntry.path);
                event.accepted = true;
                break;

            case Qt.Key_X:
                if (root.currentEntry)
                    FileManagerService.cut(root.currentEntry.path);
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
                if (!FileManagerService.searchActive && FileManagerService.matchIndices.length > 0) {
                    if (mods & Qt.ShiftModifier)
                        FileManagerService.previousMatch();
                    else
                        FileManagerService.nextMatch();
                    event.accepted = true;
                }
                break;

            case Qt.Key_A:
                FileManagerService.requestCreate();
                event.accepted = true;
                break;
            }
        }

        onActiveFocusChanged: {
            if (!activeFocus && FileManagerService.activeChordPrefix !== "")
                FileManagerService.activeChordPrefix = "";
        }
    }

    Process {
        id: pasteProcess
        onExited: (exitCode, exitStatus) => {
            if (exitCode === 0 && exitStatus === Process.NormalExit) {
                if (FileManagerService.clipboardMode === "cut")
                    FileManagerService.clearClipboard();
            } else {
                console.warn("FileList: paste failed — exitCode:", exitCode, "exitStatus:", exitStatus);
                root._pendingFocusName = "";
            }
        }
    }
}
