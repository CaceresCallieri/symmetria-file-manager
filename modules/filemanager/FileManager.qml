import "../../components"
import "../../services"
import "../../config"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    signal closeRequested()

    // Set by WindowFactory — determines starting directory for this window
    property string initialPath: Paths.home

    // Per-window state — each FileManager instance owns its own
    WindowState {
        id: windowState
        initialPath: root.initialPath
    }

    readonly property WindowState state: windowState

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        PathBar {
            Layout.fillWidth: true
            windowState: root.state
        }

        MillerColumns {
            id: millerColumns
            Layout.fillWidth: true
            Layout.fillHeight: true
            windowState: root.state
            onCloseRequested: root.closeRequested()
        }

        StatusBar {
            Layout.fillWidth: true
            windowState: root.state
            fileCount: millerColumns.fileCount
            currentEntry: millerColumns.currentEntry
        }
    }

    // Modal overlays — render above the entire layout.
    // Each popup is itself a Loader with its own active guard;
    // picker guard is folded into the popup's active binding.
    DeleteConfirmPopup {
        anchors.fill: parent
        windowState: root.state
    }
    CreateFilePopup {
        anchors.fill: parent
        windowState: root.state
    }
}
