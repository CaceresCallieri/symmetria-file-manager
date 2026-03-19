import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var entry

    ColumnLayout {
        anchors.centerIn: parent
        width: parent.width - Theme.padding.large * 2
        spacing: Theme.spacing.normal

        // Mime-based icon — mirrors the mapping in FileListItem.qml
        // application/pdf appears here only if isImage is false for PDFs in the
        // C++ model (i.e. PDF compositing is disabled), otherwise PDFs are routed
        // to ImagePreview instead.
        MaterialIcon {
            Layout.alignment: Qt.AlignHCenter
            text: {
                if (!root.entry)
                    return "description";
                const mime = root.entry.mimeType;
                if (mime.startsWith("text/"))
                    return "article";
                if (mime.startsWith("video/"))
                    return "movie";
                if (mime.startsWith("audio/"))
                    return "music_note";
                if (mime.startsWith("application/pdf"))
                    return "picture_as_pdf";
                return "description";
            }
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.extraLarge * 2
            font.weight: 500
        }

        // Filename
        StyledText {
            Layout.alignment: Qt.AlignHCenter
            Layout.maximumWidth: parent.width
            text: root.entry?.name ?? ""
            color: Theme.palette.m3onSurface
            font.pointSize: Theme.font.size.larger
            font.weight: 500
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
            elide: Text.ElideMiddle
            maximumLineCount: 3
        }

        // File size
        StyledText {
            Layout.alignment: Qt.AlignHCenter
            text: root.entry ? FileManagerService.formatSize(root.entry.size) : ""
            color: Theme.palette.m3onSurfaceVariant
            font.pointSize: Theme.font.size.smaller
            font.family: Theme.font.family.mono
        }

        // MIME type
        StyledText {
            Layout.alignment: Qt.AlignHCenter
            text: root.entry?.mimeType ?? ""
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.small
            font.family: Theme.font.family.mono
        }
    }
}
