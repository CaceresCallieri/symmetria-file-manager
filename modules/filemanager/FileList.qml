import "../../components"
import "../../services"
import "../../config"
import Symmetria.Models
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    readonly property var currentEntry: view.currentIndex >= 0 && view.currentIndex < view.count ? view.currentItem?.modelData ?? null : null
    readonly property int fileCount: view.count
    signal closeRequested()

    // gg chord state
    property bool _gPending: false

    Timer {
        id: gTimer
        interval: 500
        onTriggered: root._gPending = false
    }

    function _activateCurrentItem(): void {
        if (!root.currentEntry)
            return;
        if (root.currentEntry.isDir)
            FileManagerService.navigate(root.currentEntry.path);
        else
            Qt.openUrlExternally(Qt.resolvedUrl(root.currentEntry.path));
    }

    // Background
    StyledRect {
        anchors.fill: parent
        color: Theme.tPalette.m3surfaceContainerLow
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
            onPathChanged: view.currentIndex = 0
        }

        delegate: FileListItem {
            width: view.width
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
                FileManagerService.goUp();
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
                    if (view.count > 0)
                        view.currentIndex = view.count - 1;
                } else {
                    // g — start gg chord
                    root._gPending = true;
                    gTimer.restart();
                }
                event.accepted = true;
                break;

            case Qt.Key_D:
                if ((mods & Qt.ControlModifier) && view.count > 0) {
                    const halfPage = Math.max(1, Math.floor(view.height / Config.fileManager.sizes.itemHeight / 2));
                    view.currentIndex = Math.min(view.currentIndex + halfPage, view.count - 1);
                    event.accepted = true;
                }
                break;

            case Qt.Key_U:
                if ((mods & Qt.ControlModifier) && view.count > 0) {
                    const halfPage = Math.max(1, Math.floor(view.height / Config.fileManager.sizes.itemHeight / 2));
                    view.currentIndex = Math.max(view.currentIndex - halfPage, 0);
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
                FileManagerService.navigate(Paths.home);
                event.accepted = true;
                break;

            case Qt.Key_Minus:
                FileManagerService.back();
                event.accepted = true;
                break;

            case Qt.Key_Equal:
                FileManagerService.forward();
                event.accepted = true;
                break;
            }
        }

    }
}
