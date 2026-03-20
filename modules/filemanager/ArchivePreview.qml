import "../../components"
import "../../services"
import Symmetria.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var entry

    // Exposed for PreviewMetadata
    readonly property int fileCount: archiveModel.fileCount
    readonly property int dirCount: archiveModel.dirCount

    ArchivePreviewModel {
        id: archiveModel
        filePath: root.entry ? root.entry.path : ""
    }

    // QUIRK: explicit x/y/width/height required — anchors.margins silently ignored inside
    // Loader sourceComponent. See QUIRKS.md §1 for full explanation.
    ListView {
        id: archiveListView

        x: Theme.padding.small
        y: Theme.padding.small
        width: parent.width - Theme.padding.small * 2
        height: parent.height - Theme.padding.small * 2
        clip: true
        focus: false
        interactive: false
        keyNavigationEnabled: false
        currentIndex: -1
        boundsBehavior: Flickable.StopAtBounds

        model: archiveModel

        delegate: Item {
            id: delegateRoot

            required property string name
            required property string fullPath
            required property int size
            required property bool isDir
            required property int depth

            width: archiveListView.width
            implicitHeight: delegateLayout.implicitHeight

            RowLayout {
                id: delegateLayout

                anchors.fill: parent
                anchors.leftMargin: Theme.padding.normal + (delegateRoot.depth * 18)
                anchors.rightMargin: Theme.padding.normal
                spacing: Theme.spacing.small

                MaterialIcon {
                    text: delegateRoot.isDir ? "folder" : "description"
                    color: delegateRoot.isDir
                        ? Theme.palette.m3primary
                        : Theme.palette.m3onSurfaceVariant
                    font.pointSize: Theme.font.size.small
                    font.weight: delegateRoot.isDir ? 600 : 400
                }

                StyledText {
                    Layout.fillWidth: true
                    text: delegateRoot.name
                    elide: Text.ElideRight
                    color: Theme.palette.m3onSurface
                    font.pointSize: Theme.font.size.small
                }

                StyledText {
                    visible: !delegateRoot.isDir
                    text: FileManagerService.formatSize(delegateRoot.size)
                    color: Theme.palette.m3outline
                    font.pointSize: Theme.font.size.smaller
                    font.family: Theme.font.family.mono
                }
            }
        }

        opacity: archiveModel.fileCount > 0 || archiveModel.dirCount > 0 ? 1 : 0

        Behavior on opacity {
            Anim {}
        }
    }

    // Truncation indicator — shown when archive has more entries than MaxEntries
    StyledText {
        visible: archiveModel.truncated
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.padding.small
        text: qsTr("Showing %1 of %2 entries").arg(archiveListView.count).arg(archiveModel.totalEntries)
        color: Theme.palette.m3outline
        font.pointSize: Theme.font.size.smaller
        font.family: Theme.font.family.mono
    }

    // Loading indicator
    Loader {
        anchors.centerIn: parent
        active: archiveModel.loading
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.small

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "hourglass_empty"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.extraLarge
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Loading\u2026")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.normal
            }
        }
    }

    // Error state (corrupted/password-protected archive)
    Loader {
        anchors.centerIn: parent
        active: archiveModel.error !== ""
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.normal

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "block"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.extraLarge * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Cannot preview")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.large
                font.weight: 500
            }
        }
    }

    // Empty archive indicator
    Loader {
        anchors.centerIn: parent
        active: !archiveModel.loading
            && archiveModel.error === ""
            && archiveModel.totalEntries === 0
            && archiveModel.filePath !== ""
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.normal

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "inventory_2"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.extraLarge * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Empty archive")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.large
                font.weight: 500
            }
        }
    }
}
