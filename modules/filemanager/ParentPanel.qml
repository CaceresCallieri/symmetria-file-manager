import "../../components"
import "../../services"
import "../../config"
import Symmetria.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    readonly property string _parentPath: {
        const path = FileManagerService.currentPath;
        return path === "/" ? "" : path.replace(/\/[^/]+$/, "") || "/";
    }

    readonly property string _currentDirName: {
        const path = FileManagerService.currentPath;
        return path === "/" ? "" : path.substring(path.lastIndexOf("/") + 1);
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
            spacing: Theme.spacing.normal

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "device_hub"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.extraLarge * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Root")
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
        id: parentView

        anchors.fill: parent
        anchors.margins: Theme.padding.small
        visible: root._parentPath !== ""
        clip: true
        focus: false
        interactive: false
        keyNavigationEnabled: false
        boundsBehavior: Flickable.StopAtBounds

        model: FileSystemModel {
            id: parentModel
            path: root._parentPath !== "" ? root._parentPath : ""
            showHidden: Config.fileManager.showHidden
            sortReverse: Config.fileManager.sortReverse
            watchChanges: true
        }

        delegate: FileListItem {
            width: parentView.width
        }

        // Highlight the entry that matches the current directory name
        Connections {
            target: parentModel
            function onEntriesChanged() {
                root._syncHighlight();
            }
        }
    }

    function _syncHighlight(): void {
        if (_currentDirName === "") {
            parentView.currentIndex = -1;
            return;
        }
        for (let i = 0; i < parentModel.entries.length; i++) {
            if (parentModel.entries[i].name === _currentDirName) {
                parentView.currentIndex = i;
                return;
            }
        }
        parentView.currentIndex = -1;
    }

    // Re-sync when the current path changes (parent path may stay the same
    // but the highlighted entry needs to update, e.g. navigating between siblings)
    Connections {
        target: FileManagerService
        function onCurrentPathChanged() {
            root._syncHighlight();
        }
    }
}
