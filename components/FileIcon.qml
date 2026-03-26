import QtQuick
import "../services"
import "../config"

Item {
    id: root

    // entry is always a FileSystemEntry QObject from the C++ plugin (Symmetria.FileManager.Models).
    // Typed as QtObject here because FileIcon lives in components/ which does not import the plugin.
    required property QtObject entry
    required property string materialIconName

    property color materialColor: Theme.palette.m3onSurfaceVariant
    property real materialFill: 0
    property real materialPointSize: Theme.font.size.xl
    // -1 means "use the font's default weight". QML does not support binding font.weight
    // directly as a property initializer, so weight is applied in Component.onCompleted.
    property int materialWeight: -1

    readonly property bool useSystemIcon: Config.fileManager.iconMode === "system"
                                          && (root.entry?.iconPath ?? "") !== ""

    implicitWidth: Theme.font.size.xl * 1.5
    implicitHeight: Theme.font.size.xl * 1.5

    Image {
        anchors.centerIn: parent
        width: root.width
        height: root.height
        // Use optional chaining to guard against entry being null during model resets.
        source: root.useSystemIcon ? "file://" + (root.entry?.iconPath ?? "") : ""
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
            // font.weight cannot be set as a plain property binding in QML; it must
            // be assigned imperatively after the component tree is complete.
            if (root.materialWeight >= 0)
                materialIcon.font.weight = root.materialWeight;
        }
    }
}
