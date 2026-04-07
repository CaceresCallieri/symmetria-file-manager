pragma ComponentBehavior: Bound

import "../services"
import QtQuick.Layouts

ColumnLayout {
    id: root

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
