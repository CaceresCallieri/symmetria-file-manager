import QtQuick
import "../services"
import "../config"

Item {
    id: root

    required property var entry
    required property string materialIconName

    property color materialColor: Theme.palette.m3onSurfaceVariant
    property real materialFill: 0
    property real materialPointSize: Theme.font.size.xl
    property int materialWeight: -1

    readonly property bool useSystemIcon: Config.fileManager.iconMode === "system"
                                          && (root.entry?.iconPath ?? "") !== ""

    implicitWidth: Theme.font.size.xl * 1.5
    implicitHeight: Theme.font.size.xl * 1.5

    Image {
        anchors.centerIn: parent
        width: root.width
        height: root.height
        source: root.useSystemIcon ? "file://" + root.entry.iconPath : ""
        visible: root.useSystemIcon
        sourceSize: Qt.size(width * 2, height * 2)
        fillMode: Image.PreserveAspectFit
        asynchronous: true
        smooth: true
    }

    MaterialIcon {
        id: materialIcon
        anchors.centerIn: parent
        visible: !root.useSystemIcon
        text: root.materialIconName
        color: root.materialColor
        fill: root.materialFill
        font.pointSize: root.materialPointSize
        Component.onCompleted: {
            if (root.materialWeight >= 0)
                materialIcon.font.weight = root.materialWeight;
        }
    }
}
