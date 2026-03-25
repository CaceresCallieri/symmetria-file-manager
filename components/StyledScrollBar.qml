import "../services"
import QtQuick
import QtQuick.Controls

// Thin pill-shaped vertical scrollbar used in file list columns.
// Always visible so keyboard navigation position is always clear.
ScrollBar {
    policy: ScrollBar.AlwaysOn
    anchors.rightMargin: 5

    contentItem: Rectangle {
        implicitWidth: 5
        radius: width / 2
        color: Theme.palette.m3onSurfaceVariant
        opacity: 0.4
    }
}
