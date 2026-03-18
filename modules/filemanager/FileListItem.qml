import "../../components"
import "../../services"
import "../../config"
import Symmetria.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property int index
    required property FileSystemEntry modelData

    signal activated()

    implicitHeight: Config.fileManager.sizes.itemHeight

    // Selection highlight — separate Rectangle avoids StyledRect's color animation
    // which would cause visible stutter during rapid j/k navigation
    Rectangle {
        anchors.fill: parent
        radius: Theme.rounding.small
        color: Theme.palette.m3surfaceContainerHighest
        opacity: root.ListView.isCurrentItem ? 1 : 0
    }

    StateLayer {
        onClicked: root.ListView.view.currentIndex = root.index

        onDoubleClicked: root.activated()
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: Theme.padding.large
        anchors.rightMargin: Theme.padding.large
        spacing: Theme.spacing.normal

        // File/folder icon
        MaterialIcon {
            text: {
                if (!root.modelData)
                    return "description";
                if (root.modelData.isDir)
                    return "folder";
                if (root.modelData.isImage)
                    return "image";
                const mime = root.modelData.mimeType;
                if (mime.startsWith("text/"))
                    return "article";
                if (mime.startsWith("video/"))
                    return "movie";
                if (mime.startsWith("audio/"))
                    return "music_note";
                return "description";
            }
            color: root.modelData?.isDir ? Theme.palette.m3primary : Theme.palette.m3onSurfaceVariant
            fill: root.modelData?.isDir ? 1 : 0
            font.pointSize: Theme.font.size.large
        }

        // File name
        StyledText {
            Layout.fillWidth: true
            text: root.modelData?.name ?? ""
            color: Theme.palette.m3onSurface
            font.pointSize: Theme.font.size.normal
            elide: Text.ElideRight
        }

        // File size (hidden for directories)
        StyledText {
            visible: !(root.modelData?.isDir ?? true)
            text: root.modelData ? FileManagerService.formatSize(root.modelData.size) : ""
            color: Theme.palette.m3onSurfaceVariant
            font.pointSize: Theme.font.size.small
            font.family: Theme.font.family.mono
            horizontalAlignment: Text.AlignRight
            Layout.minimumWidth: 60
        }
    }

}
