import "../services"
import QtQuick

Text {
    id: root

    renderType: Text.NativeRendering
    textFormat: Text.PlainText
    color: Theme.palette.m3onSurface
    font.family: Theme.font.family.sans
    font.pointSize: Theme.font.size.smaller

    Behavior on color {
        CAnim {}
    }
}
