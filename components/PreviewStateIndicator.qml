pragma ComponentBehavior: Bound

import "../services"
import QtQuick.Layouts

ColumnLayout {
    id: root

    required property string iconName
    required property string message

    spacing: Theme.spacing.md

    MaterialIcon {
        Layout.alignment: Qt.AlignHCenter
        text: root.iconName
        color: Theme.palette.m3outline
        font.pointSize: Theme.font.size.xxl * 2
        font.weight: Font.Medium
    }

    StyledText {
        Layout.alignment: Qt.AlignHCenter
        text: root.message
        color: Theme.palette.m3outline
        font.pointSize: Theme.font.size.xl
        font.weight: Font.Medium
    }
}
