import qs.components
import qs.services
import qs.config
import qs.utils
import QtQuick
import QtQuick.Layouts

StyledRect {
    id: root

    required property int fileCount
    required property var currentEntry
    required property string currentPath

    implicitHeight: inner.implicitHeight + Appearance.padding.small * 2
    color: Colours.tPalette.m3surfaceContainer

    RowLayout {
        id: inner

        anchors.fill: parent
        anchors.leftMargin: Appearance.padding.large
        anchors.rightMargin: Appearance.padding.large
        anchors.topMargin: Appearance.padding.small
        anchors.bottomMargin: Appearance.padding.small

        spacing: Appearance.spacing.normal

        // Left: file count
        StyledText {
            text: root.fileCount + (root.fileCount === 1 ? " item" : " items")
            color: Colours.tPalette.m3onSurfaceVariant
            font.pointSize: Appearance.font.size.small
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
            color: Colours.tPalette.m3onSurface
            font.pointSize: Appearance.font.size.small
            font.family: Appearance.font.family.mono
        }

        Item { Layout.fillWidth: true }

        // Right: abbreviated path
        StyledText {
            text: Paths.shortenHome(root.currentPath)
            color: Colours.tPalette.m3onSurfaceVariant
            font.pointSize: Appearance.font.size.small
            elide: Text.ElideMiddle
            Layout.maximumWidth: root.width * 0.3
        }
    }
}
