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

        MillerColumns {
            id: millerColumns
            Layout.fillWidth: true
            Layout.fillHeight: true
            onCloseRequested: root.closeRequested()
        }

        StatusBar {
            Layout.fillWidth: true
            fileCount: millerColumns.fileCount
            currentEntry: millerColumns.currentEntry
        }
    }

    // Modal overlays — render above the entire layout
    DeleteConfirmPopup {}
    CreateFilePopup {}
}
