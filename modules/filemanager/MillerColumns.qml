import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    readonly property var currentEntry: currentPanel.currentEntry
    readonly property int fileCount: currentPanel.fileCount
    signal closeRequested()

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Left: parent directory listing + which-key overlay
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 2

            ParentPanel {
                anchors.fill: parent
                opacity: FileManagerService.chordActive ? 0 : 1

                Behavior on opacity {
                    Anim {}
                }
            }

            WhichKeyPopup {
                anchors.fill: parent
            }
        }

        // Separator
        StyledRect {
            Layout.fillHeight: true
            implicitWidth: 1
            color: Theme.palette.m3outlineVariant
        }

        // Center: active file list (keyboard nav, cursor)
        FileList {
            id: currentPanel
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 5
            onCloseRequested: root.closeRequested()
        }

        // Separator
        StyledRect {
            Layout.fillHeight: true
            implicitWidth: 1
            color: Theme.palette.m3outlineVariant
        }

        // Right: passive preview of highlighted entry
        PreviewPanel {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 3
            previewPath: currentPanel.currentEntry?.isDir ? currentPanel.currentEntry.path : ""
        }
    }
}
