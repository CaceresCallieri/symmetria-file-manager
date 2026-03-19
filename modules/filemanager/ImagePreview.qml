import "../../components"
import "../../services"
import Symmetria.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var entry

    // Exposed for PreviewMetadata — reflects actual image dimensions
    readonly property size naturalSize: preview.status === Image.Ready
        ? Qt.size(preview.implicitWidth, preview.implicitHeight)
        : Qt.size(0, 0)

    // Resolves PDF transparency by compositing over white background in C++.
    // Normal images pass through untouched (zero overhead).
    PreviewImageHelper {
        id: previewHelper
        source: root.entry ? root.entry.path : ""
    }

    Image {
        id: preview

        anchors.fill: parent
        anchors.margins: Theme.padding.normal

        source: previewHelper.resolvedUrl
        asynchronous: true
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true

        // Cap decoded pixel dimensions for memory safety.
        // 2x multiplier ensures sharp rendering on HiDPI displays.
        sourceSize.width: Math.max(root.width, 1) * 2
        sourceSize.height: Math.max(root.height, 1) * 2

        opacity: status === Image.Ready ? 1 : 0

        Behavior on opacity {
            Anim {}
        }
    }

    // Loading indicator
    Loader {
        anchors.centerIn: parent
        opacity: preview.status === Image.Loading ? 1 : 0
        active: preview.status === Image.Loading
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

        Behavior on opacity {
            Anim {}
        }
    }

    // Error state
    Loader {
        anchors.centerIn: parent
        opacity: preview.status === Image.Error ? 1 : 0
        active: preview.status === Image.Error
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.normal

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "broken_image"
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

        Behavior on opacity {
            Anim {}
        }
    }
}
