import "../../components"
import "../../services"
import "../../config"
import Symmetria.Models
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    readonly property var currentEntry: view.currentIndex >= 0 && view.currentIndex < view.count ? fsModel.entries[view.currentIndex] ?? null : null
    readonly property int fileCount: view.count
    signal closeRequested()

    // gg chord state
    property bool _gPending: false
    // Set by onPathChanged (sync, before C++ async scan starts), cleared by
    // onEntriesChanged (async, after QtConcurrent scan and applyChanges complete).
    // Ensures currentIndex resets only after new entries are populated.
    property bool _pathJustChanged: false

    // Search: cursor position saved before entering search mode
    property int _preSearchIndex: 0

    Timer {
        id: gTimer
        interval: 500
        onTriggered: root._gPending = false
    }

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
            spacing: Theme.spacing.normal

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "folder_open"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.extraLarge * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("This folder is empty")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.large
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
        anchors.margins: Theme.padding.small

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
            const key = event.key;
            const mods = event.modifiers;

            // Handle gg chord — second g within timeout
            if (root._gPending) {
                root._gPending = false;
                gTimer.stop();
                if (key === Qt.Key_G && !(mods & Qt.ShiftModifier)) {
                    view.currentIndex = 0;
                    view.positionViewAtIndex(0, ListView.Beginning);
                }
                // Always consume the second keypress — it belongs to the chord sequence.
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
                    // g — start gg chord
                    root._gPending = true;
                    gTimer.restart();
                }
                event.accepted = true;
                break;

            case Qt.Key_D:
                if ((mods & Qt.ControlModifier) && view.count > 0) {
                    view.currentIndex = Math.min(view.currentIndex + root._halfPageCount(), view.count - 1);
                    view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                    event.accepted = true;
                }
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

            case Qt.Key_N:
                if (!FileManagerService.searchActive && FileManagerService.matchIndices.length > 0) {
                    if (mods & Qt.ShiftModifier)
                        FileManagerService.previousMatch();
                    else
                        FileManagerService.nextMatch();
                    event.accepted = true;
                }
                break;
            }
        }

    }
}
