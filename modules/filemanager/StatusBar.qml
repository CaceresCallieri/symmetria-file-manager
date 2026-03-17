import "../../components"
import "../../services"
import "../../config"
import QtQuick
import QtQuick.Layouts

StyledRect {
    id: root

    required property int fileCount
    required property var currentEntry
    required property string currentPath

    implicitHeight: inner.implicitHeight + Theme.padding.small * 2
    color: Theme.tPalette.m3surfaceContainer

    RowLayout {
        id: inner

        anchors.fill: parent
        anchors.leftMargin: Theme.padding.large
        anchors.rightMargin: Theme.padding.large
        anchors.topMargin: Theme.padding.small
        anchors.bottomMargin: Theme.padding.small

        spacing: Theme.spacing.normal

        // Left: file count
        StyledText {
            text: root.fileCount + (root.fileCount === 1 ? " item" : " items")
            color: Theme.tPalette.m3onSurfaceVariant
            font.pointSize: Theme.font.size.small
        }

        Item { Layout.fillWidth: true }

        // Center: current entry info
        StyledText {
            visible: root.currentEntry !== null
            text: {
                if (root.currentEntry?.isDir)
                    return root.currentEntry.name + "/";
                return (root.currentEntry?.name ?? "") + "  " + FileManagerService.formatSize(root.currentEntry?.size ?? 0);
            }
            color: Theme.tPalette.m3onSurface
            font.pointSize: Theme.font.size.small
            font.family: Theme.font.family.mono
        }

        Item { Layout.fillWidth: true }

        // Right: abbreviated path
        StyledText {
            text: Paths.shortenHome(root.currentPath)
            color: Theme.tPalette.m3onSurfaceVariant
            font.pointSize: Theme.font.size.small
            elide: Text.ElideMiddle
            Layout.maximumWidth: root.width * 0.3
        }
    }
}
