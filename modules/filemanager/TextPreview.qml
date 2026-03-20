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

    SyntaxHighlightHelper {
        id: helper
        filePath: root.entry ? root.entry.path : ""
    }

    // QUIRK: explicit x/y/width/height required — anchors.margins silently ignored inside
    // Loader sourceComponent. See QUIRKS.md §1 for full explanation.
    Flickable {
        id: textFlickable

        x: Theme.padding.lg
        y: Theme.padding.md
        width: parent.width - Theme.padding.lg * 2
        height: parent.height - Theme.padding.md * 2
        clip: true
        contentWidth: Math.max(textEdit.implicitWidth, textFlickable.width)
        contentHeight: textEdit.implicitHeight
        boundsBehavior: Flickable.StopAtBounds
        interactive: false

        TextEdit {
            id: textEdit

            readOnly: true
            selectByMouse: false
            activeFocusOnPress: false
            focus: false
            text: helper.highlightedContent
            textFormat: TextEdit.RichText
            font.family: Theme.font.family.mono
            font.pointSize: Theme.font.size.xs
            wrapMode: TextEdit.NoWrap
            // Text color is set by the <pre style="color:..."> injected in SyntaxHighlightHelper.
            // The QML color property has no effect in RichText mode when the HTML provides its own color.
            renderType: TextEdit.QtRendering
        }

        opacity: helper.hasContent ? 1 : 0

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
            spacing: Theme.spacing.sm

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "hourglass_empty"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Loading\u2026")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.md
            }
        }
    }

    // Error state (binary file or read failure)
    Loader {
        anchors.centerIn: parent
        active: helper.error
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.md

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "block"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Cannot preview")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xl
                font.weight: 500
            }
        }
    }
}
