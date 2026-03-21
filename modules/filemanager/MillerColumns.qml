import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState

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
                windowState: root.windowState
                opacity: (root.windowState && root.windowState.chordActive) ? 0 : 1

                Behavior on opacity {
                    Anim {}
                }
            }

            WhichKeyPopup {
                anchors.fill: parent
                windowState: root.windowState
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
            windowState: root.windowState
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
            previewEntry: currentPanel.currentEntry ?? null
        }
    }
}
