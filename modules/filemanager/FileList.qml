pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
import "FlashLogic.js" as FlashLogic
import "handlers/SearchHandler.js" as SearchHandler
import "handlers/FlashHandler.js" as FlashHandler
import "handlers/ChordHandler.js" as ChordHandler
import "handlers/NormalModeHandler.js" as NormalModeHandler
import Symmetria.FileManager.Models
import Quickshell.Io
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState
    property TabManager tabManager

    readonly property var currentEntry: view.currentIndex >= 0 && view.currentIndex < view.count ? fsModel.entries[view.currentIndex] : null
    readonly property int fileCount: view.count
    signal closeRequested()

    // Set by onPathChanged (sync, before C++ async scan starts), cleared by
    // onEntriesChanged (async, after QtConcurrent scan and applyChanges complete).
    // Ensures currentIndex resets only after new entries are populated.
    property bool _pathJustChanged: false

    // Search: cursor position saved before entering search mode
    property int _preSearchIndex: 0

    // Filename to focus once the model refreshes (set by paste, create, rename, etc.)
    property string _pendingFocusName: ""

    // Flash navigation: cross-column entry sources (wired from MillerColumns)
    property var parentEntries: []
    property var previewDirectoryEntries: []
    property string previewDirectoryPath: ""
    property int _preFlashIndex: 0

    // Save cursor before tab switch so it can be restored when returning
    Connections {
        target: root.tabManager
        enabled: root.tabManager !== null
        function onAboutToSwitchTab(): void {
            if (!root.windowState)
                return;
            root.windowState.saveCursor(root.windowState.currentPath, view.currentIndex);
            // Cancel transient modes on the departing tab
            if (root.windowState.searchActive)
                root.windowState.clearSearch();
            if (root.windowState.flashActive)
                root.windowState.clearFlash();
            if (root.windowState.activeChordPrefix !== "")
                root.windowState.activeChordPrefix = "";
            if (root.windowState.bookmarkSubModeActive)
                root.windowState.bookmarkSubMode = "";
        }
    }

    // When the active tab (and thus windowState) changes, restore cursor position.
    // If the new tab has the same path, FSModel won't re-scan (no onPathChanged/onEntriesChanged),
    // so we must restore the cursor directly. If the path differs, onPathChanged will handle it.
    onWindowStateChanged: {
        if (windowState) {
            const newPath = windowState.currentPath;
            if (newPath === fsModel.path && view.count > 0) {
                // Same directory AND model already populated — restore cursor immediately.
                // If count is 0, the model is still loading; onEntriesChanged will handle it.
                const restored = windowState.restoreCursor(newPath);
                const safeIndex = Math.min(restored, view.count - 1);
                view.currentIndex = safeIndex;
                view.positionViewAtIndex(safeIndex, ListView.Contain);
            }
            // Different path — FSModel.path binding triggers onPathChanged → _pathJustChanged flow
        }
    }

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
        if (FileManagerService.pickerMode) {
            FileManagerService.confirmPickerSelection(root.currentEntry, windowState);
            return;
        }

        if (!root.currentEntry)
            return;

        if (root.currentEntry.isDir)
            _navigateIntoCurrentItem();
        else {
            fileOpener.open(root.currentEntry.path);
        }
    }

    Connections {
        target: windowState

        function onSearchQueryChanged() {
            SearchHandler.computeMatches(root, view, false);
        }

        function onCurrentMatchIndexChanged() {
            SearchHandler.jumpToCurrentMatch(root, view);
        }

        function onSearchCancelled() {
            view.currentIndex = root._preSearchIndex;
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
            Qt.callLater(() => view.forceActiveFocus());
        }

        function onSearchConfirmed() {
            Qt.callLater(() => view.forceActiveFocus());
        }

        function onActiveModalChanged() {
            if (windowState.activeModal === windowState.modalNone)
                Qt.callLater(() => view.forceActiveFocus());
        }

        function onCreateCompleted(filename: string) {
            root._pendingFocusName = filename;
        }

        function onRenameCompleted(newName: string) {
            root._pendingFocusName = newName;
        }

        function onFlashJump(column: string, index: int, path: string) {
            FlashHandler.handleJump(column, index, path, root, view);
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

        sourceComponent: PreviewStateIndicator {
            iconName: "folder_open"
            message: qsTr("This folder is empty")
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
            path: root.windowState ? root.windowState.currentPath : ""
            showHidden: Config.fileManager.showHidden
            sortBy: root.windowState ? root.windowState.sortBy : FileSystemModel.Modified
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
                    SearchHandler.computeMatches(root, view, true);
            }
        }

        delegate: FileListItem {
            width: view.width
            searchQuery: root.windowState ? root.windowState.searchQuery : ""
            isSearchMatch: root.windowState ? !!root.windowState._matchIndexSet[index] : false
            // Reading selectedPaths in the expression makes QML re-evaluate
            // this binding whenever the object reference changes (toggleSelection
            // assigns a new object each time, triggering the notify signal).
            isSelected: root.windowState && root.windowState.selectedPaths
                        ? !!root.windowState.selectedPaths[modelData?.path ?? ""] : false
            flashActive: root.windowState ? root.windowState.flashActive : false
            flashQuery: root.windowState ? root.windowState.flashQuery : ""
            flashLabel: root.windowState?.flashMatchMap["current:" + index]?.label ?? ""
            flashMatchStart: root.windowState?.flashMatchMap["current:" + index]?.matchStart ?? -1
            onActivated: root._activateCurrentItem()
        }

        // Vim-style keyboard navigation
        Keys.onPressed: function(event) {
            // Block all keys while a modal popup is visible
            if (windowState.activeModal !== windowState.modalNone) {
                event.accepted = true;
                return;
            }

            // Bookmark sub-mode: capture a single letter for create/delete
            if (windowState.bookmarkSubModeActive) {
                ChordHandler.handleBookmarkSubMode(event, root);
                return;
            }

            // Resolve active chord BEFORE picker suppression — otherwise a
            // chord like g,d is broken because 'd' gets suppressed before
            // the chord resolver can see it.
            if (windowState.activeChordPrefix !== "") {
                ChordHandler.resolveChord(event, root, view, clipboardCopyProcess);
                return;
            }

            // Flash navigation mode: intercept all keys for search/label/jump
            if (windowState.flashActive) {
                FlashHandler.handleKey(event, root, view);
                return;
            }

            // Normal mode: picker suppression + main key dispatch
            NormalModeHandler.handleKey(event, root, view, pasteProcess, clipboardCopyProcess);
        }

        onActiveFocusChanged: {
            if (!activeFocus) {
                if (windowState.activeChordPrefix !== "")
                    windowState.activeChordPrefix = "";
                if (windowState.bookmarkSubModeActive)
                    windowState.bookmarkSubMode = "";
            }
        }
    }

    FileOpener {
        id: fileOpener
    }

    Process {
        id: pasteProcess
        onExited: (exitCode, exitStatus) => {
            if (exitCode === 0 && exitStatus === Process.NormalExit) {
                FileManagerService.clearClipboard();
            } else {
                Logger.warn("FileList", "paste failed — exitCode: " + exitCode + " exitStatus: " + exitStatus);
                root._pendingFocusName = "";
            }
        }
    }

    Process {
        id: clipboardCopyProcess

        // Callback set by _copyPickerPathToClipboard() — called once wl-copy
        // exits so callers can safely proceed after the clipboard write.
        property var _pendingCallback: null

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0 || exitStatus !== Process.NormalExit)
                Logger.warn("FileList", "wl-copy failed — exitCode: " + exitCode + " exitStatus: " + exitStatus);
            const cb = _pendingCallback;
            _pendingCallback = null;
            if (cb)
                cb();
        }
    }
}
