import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var entry
    property size imageDimensions: Qt.size(0, 0)

    visible: !!entry
    implicitHeight: metaLayout.implicitHeight + Theme.padding.small * 2

    // Subtle top separator
    Rectangle {
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        height: 1
        color: Theme.palette.m3outlineVariant
    }

    RowLayout {
        id: metaLayout

        anchors.fill: parent
        anchors.margins: Theme.padding.small
        anchors.leftMargin: Theme.padding.normal
        anchors.rightMargin: Theme.padding.normal
        spacing: Theme.spacing.small

        // Symlink indicator
        MaterialIcon {
            visible: root.entry?.isSymlink ?? false
            text: "link"
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.small
        }

        // Filename (takes remaining space)
        StyledText {
            Layout.fillWidth: true
            text: root.entry?.name ?? ""
            elide: Text.ElideMiddle
            color: Theme.palette.m3onSurfaceVariant
            font.pointSize: Theme.font.size.small
            font.family: Theme.font.family.mono
        }

        // Image/video dimensions (only shown when available)
        StyledText {
            visible: root.imageDimensions.width > 0
            text: root.imageDimensions.width + "\u00d7" + root.imageDimensions.height
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.small
            font.family: Theme.font.family.mono
        }

        // Modified date
        StyledText {
            text: root.entry ? FileManagerService.formatDate(root.entry.modifiedDate) : ""
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.small
            font.family: Theme.font.family.mono
        }

        // File size
        StyledText {
            text: root.entry ? FileManagerService.formatSize(root.entry.size) : ""
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.small
            font.family: Theme.font.family.mono
        }
    }
}
