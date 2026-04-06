pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
import Symmetria.FileManager.Models
import Quickshell.Io
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState

    readonly property var entries: parentModel.entries

    readonly property string _parentPath: {
        if (!windowState) return "";
        const path = windowState.currentPath;
        return path === "/" ? "" : Paths.parentDir(path);
    }

    readonly property string _currentDirName: {
        if (!windowState) return "";
        const path = windowState.currentPath;
        return path === "/" ? "" : Paths.basename(path);
    }

    // Background — match PreviewPanel shade
    StyledRect {
        anchors.fill: parent
        color: Theme.layer(Theme.palette.m3surfaceContainerLow, 1)
    }

    // Empty state when at filesystem root
    Loader {
        anchors.centerIn: parent
        opacity: root._parentPath === "" ? 1 : 0
        active: opacity > 0
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.md

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "device_hub"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Root")
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
        id: parentView

        anchors.fill: parent
        anchors.margins: Theme.padding.sm
        visible: root._parentPath !== ""
        clip: true
        focus: false
        keyNavigationEnabled: false
        boundsBehavior: Flickable.StopAtBounds

        ScrollBar.vertical: ScrollBar {
            policy: ScrollBar.AsNeeded
        }

        model: FileSystemModel {
            id: parentModel
            path: root._parentPath
            showHidden: Config.fileManager.showHidden
            sortBy: root.windowState ? root.windowState.sortBy : FileSystemModel.Modified
            sortReverse: root.windowState ? root.windowState.sortReverse : true
            watchChanges: true
        }

        delegate: FileListItem {
            width: parentView.width
            flashActive: root.windowState ? root.windowState.flashActive : false
            flashQuery: root.windowState ? root.windowState.flashQuery : ""
            flashLabel: root.windowState?.flashMatchMap["parent:" + index]?.label ?? ""
            flashMatchStart: root.windowState?.flashMatchMap["parent:" + index]?.matchStart ?? -1
            onActivated: {
                if (modelData.isDir)
                    root.windowState.navigate(modelData.path);
                else {
                    const openPath = parentOpenFileHelper.resolvePathForOpen(modelData.path);
                    // xdg-open does NOT support "--" — see FileList.qml comment
                    parentXdgOpenProcess.command = ["xdg-open", openPath];
                    parentXdgOpenProcess.running = true;
                }
            }
        }

        // Highlight the entry that matches the current directory name
        Connections {
            target: parentModel
            function onEntriesChanged() {
                root._syncHighlight();
            }
        }

        // Prevent single-click from desyncing the highlight — the parent
        // panel's highlight always tracks the current directory, not user clicks
        onCurrentIndexChanged: Qt.callLater(root._syncHighlight)
    }

    function _syncHighlight(): void {
        if (_currentDirName === "") {
            parentView.currentIndex = -1;
            return;
        }
        // Skip O(n) scan if already pointing at the correct entry
        if (parentView.currentIndex >= 0
            && parentView.currentIndex < parentModel.entries.length
            && parentModel.entries[parentView.currentIndex].name === _currentDirName)
            return;
        for (let i = 0; i < parentModel.entries.length; i++) {
            if (parentModel.entries[i].name === _currentDirName) {
                parentView.currentIndex = i;
                return;
            }
        }
        parentView.currentIndex = -1;
    }

    PreviewImageHelper {
        id: parentOpenFileHelper
    }

    Process {
        id: parentXdgOpenProcess
    }

    // Re-sync when the current path changes (parent path may stay the same
    // but the highlighted entry needs to update, e.g. navigating between siblings)
    Connections {
        target: windowState
        function onCurrentPathChanged() {
            root._syncHighlight();
        }
    }
}
