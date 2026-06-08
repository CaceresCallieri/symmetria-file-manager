import Symmetria.FileManager.UI
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState
    property TabManager tabManager

    readonly property var currentEntry: currentPanel.currentEntry
    readonly property int fileCount: currentPanel.fileCount
    // Map the cursor's bottom-Y and the column geometry into MillerColumns'
    // own coordinate space. The center column is now inset (RowLayout margin +
    // the FileList's own margin inside its surface), so RenamePopup — which
    // anchors to these — must account for those offsets, not assume the file
    // list sits flush at (0,0).
    readonly property real currentItemBottomY: centerColumn.y + currentPanel.y + currentPanel.currentItemBottomY
    readonly property real currentColumnX: centerColumn.x
    readonly property real currentColumnWidth: centerColumn.width
    signal closeRequested()

    // Each Miller column is a SOLID rounded surface floating on the near-opaque
    // window backdrop (Tahoe/Files look). The panels' own internal backgrounds
    // stay transparent (FmTheme.layer at _transparencyLayers 0) and reveal these
    // surfaces. Content is inset (anchors.margins) so square rows/previews clear
    // the rounded corners. Column gaps + the chrome are where transparency lives.
    RowLayout {
        anchors.fill: parent
        // Outer margin = the general window margin (padding.md); the inter-column
        // gap is exactly HALF of it (padding.sm == padding.md / 2), so the edge
        // spacing and the gaps between cards relate consistently.
        anchors.margins: FmTheme.padding.md
        spacing: FmTheme.padding.sm

        // Left: parent directory listing + which-key overlay
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 2

            StyledRect {
                anchors.fill: parent
                radius: FmTheme.rounding.lg
                color: FmTheme.palette.surfaceContainerLow
                border.color: FmTheme.overlay.subtle
                border.width: 1
            }

            ParentPanel {
                id: parentPanel
                anchors.fill: parent
                anchors.margins: FmTheme.padding.md
                windowState: root.windowState
                opacity: (root.windowState && root.windowState.chordActive) ? 0 : 1

                Behavior on opacity {
                    Anim {}
                }
            }

            WhichKeyPopup {
                anchors.fill: parent
                anchors.margins: FmTheme.padding.md
                windowState: root.windowState
            }
        }

        // Center: active file list (keyboard nav, cursor)
        Item {
            id: centerColumn

            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 5

            StyledRect {
                anchors.fill: parent
                radius: FmTheme.rounding.lg
                color: FmTheme.palette.surfaceContainerLow
                border.color: FmTheme.overlay.subtle
                border.width: 1
            }

            // FileList is wrapped from OUTSIDE (it is protected WIP); inset it
            // over the surface so its rows clear the rounded corners.
            FileList {
                id: currentPanel
                anchors.fill: parent
                anchors.margins: FmTheme.padding.md
                windowState: root.windowState
                tabManager: root.tabManager
                parentEntries: parentPanel.entries
                previewDirectoryEntries: previewPanel.directoryEntries
                previewDirectoryPath: previewPanel.directoryPath
                onCloseRequested: root.closeRequested()
            }
        }

        // Right: passive preview of highlighted entry
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredWidth: 3

            StyledRect {
                anchors.fill: parent
                radius: FmTheme.rounding.lg
                color: FmTheme.palette.surfaceContainerLow
                border.color: FmTheme.overlay.subtle
                border.width: 1
            }

            PreviewPanel {
                id: previewPanel
                anchors.fill: parent
                anchors.margins: FmTheme.padding.md
                previewEntry: currentPanel.currentEntry ?? null
                windowState: root.windowState
            }
        }
    }
}
