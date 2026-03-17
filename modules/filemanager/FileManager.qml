import "../../components"
import "../../services"
import "../../config"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    signal closeRequested()

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        PathBar {
            Layout.fillWidth: true
        }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            Sidebar {
                Layout.fillHeight: true
            }

            // Thin separator
            StyledRect {
                Layout.fillHeight: true
                implicitWidth: 1
                color: Theme.tPalette.m3outlineVariant
            }

            FileList {
                id: fileList
                Layout.fillWidth: true
                Layout.fillHeight: true
                onCloseRequested: root.closeRequested()
            }
        }

        StatusBar {
            Layout.fillWidth: true
            fileCount: fileList.fileCount
            currentEntry: fileList.currentEntry
            currentPath: FileManagerService.currentPath
        }
    }
}
