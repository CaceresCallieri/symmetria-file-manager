import "../../components"
import "../../services"
import Symmetria.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property var entry

    // Exposed for PreviewMetadata
    readonly property int lineCount: helper.lineCount
    readonly property string language: helper.language
    readonly property bool truncated: helper.truncated

    SyntaxHighlightHelper {
        id: helper
        filePath: root.entry ? root.entry.path : ""
        document: textEdit.textDocument
    }

    // QUIRK: Must use explicit x/y/width/height instead of anchors.fill + anchors.margins.
    // When a Loader with anchors.fill creates a sourceComponent, it force-sets the loaded
    // item's geometry. This breaks the anchor chain for children: anchors.margins on a
    // Flickable (or wrapper Item) inside the loaded root are silently ignored — the margin
    // evaluates but has no visual effect. Explicit positioning bypasses the anchor system
    // entirely and works reliably. See also: QUIRKS.md in project root.
    Flickable {
        x: Theme.padding.large
        y: Theme.padding.normal
        width: parent.width - Theme.padding.large * 2
        height: parent.height - Theme.padding.normal * 2
        clip: true
        contentWidth: textEdit.contentWidth
        contentHeight: textEdit.contentHeight
        boundsBehavior: Flickable.StopAtBounds
        interactive: false

        TextEdit {
            id: textEdit

            width: Math.max(contentWidth, parent.width)
            readOnly: true
            selectByMouse: false
            activeFocusOnPress: false
            focus: false
            text: helper.content
            textFormat: TextEdit.PlainText
            font.family: Theme.font.family.mono
            font.pointSize: Theme.font.size.small
            wrapMode: TextEdit.NoWrap
            color: Theme.palette.m3onSurface
            renderType: TextEdit.QtRendering
        }

        opacity: helper.content !== "" && !helper.loading ? 1 : 0

        Behavior on opacity {
            Anim {}
        }
    }

    // Loading indicator
    Loader {
        anchors.centerIn: parent
        active: helper.loading
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

    // Error state (binary file or read failure)
    Loader {
        anchors.centerIn: parent
        active: helper.error
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
}
