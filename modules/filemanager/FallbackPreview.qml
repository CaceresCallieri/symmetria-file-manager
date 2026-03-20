import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var entry

    // Derived visibility flags — avoids repeating the same null-guard expression
    // on both the label and value cells of each optional grid row.
    readonly property bool _showOwner: (root.entry?.owner ?? "") !== ""
    readonly property bool _showSymlinkTarget: root.entry?.isSymlink ?? false

    ColumnLayout {
        anchors.centerIn: parent
        width: parent.width - Theme.padding.lg * 2
        spacing: Theme.spacing.md

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
            font.pointSize: Theme.font.size.xxl * 2
            font.weight: 500
        }

        // Filename
        StyledText {
            Layout.alignment: Qt.AlignHCenter
            Layout.maximumWidth: parent.width
            text: root.entry?.name ?? ""
            color: Theme.palette.m3onSurface
            font.pointSize: Theme.font.size.lg
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
            font.pointSize: Theme.font.size.sm
            font.family: Theme.font.family.mono
        }

        // MIME type
        StyledText {
            Layout.alignment: Qt.AlignHCenter
            text: root.entry?.mimeType ?? ""
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.xs
            font.family: Theme.font.family.mono
        }

        // Separator
        Rectangle {
            Layout.fillWidth: true
            Layout.topMargin: Theme.padding.sm
            Layout.bottomMargin: Theme.padding.sm
            height: 1
            color: Theme.palette.m3outlineVariant
        }

        // Metadata detail grid
        GridLayout {
            Layout.alignment: Qt.AlignHCenter
            columns: 2
            columnSpacing: Theme.spacing.md
            rowSpacing: Theme.spacing.sm

            // Modified
            StyledText {
                text: qsTr("Modified")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }
            StyledText {
                text: root.entry ? FileManagerService.formatDate(root.entry.modifiedDate) : ""
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            // Permissions
            StyledText {
                text: qsTr("Permissions")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }
            StyledText {
                text: root.entry?.permissions ?? ""
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            // Owner (hidden when empty)
            StyledText {
                visible: root._showOwner
                text: qsTr("Owner")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }
            StyledText {
                visible: root._showOwner
                text: root.entry?.owner ?? ""
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            // Symlink target (only for symlinks)
            StyledText {
                visible: root._showSymlinkTarget
                text: qsTr("Target")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }
            StyledText {
                visible: root._showSymlinkTarget
                // Constrain width: two sides × two levels of padding (column + outer item)
                Layout.maximumWidth: root.width - Theme.padding.lg * 4
                text: root.entry?.symlinkTarget ?? ""
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
                elide: Text.ElideMiddle
            }
        }
    }
}
