import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    readonly property var _binds: {
        const prefix = FileManagerService.activeChordPrefix;
        if (prefix === "")
            return [];
        const bindings = FileManagerService.chordBindings;
        return bindings.hasOwnProperty(prefix) ? bindings[prefix].binds : [];
    }

    visible: opacity > 0
    opacity: FileManagerService.chordActive ? 1 : 0

    Behavior on opacity {
        Anim {}
    }

    // Matte pill background
    Rectangle {
        anchors.fill: parent
        radius: Theme.rounding.small
        color: Theme.pillMedium.background
        border.color: Theme.pillMedium.border
        border.width: 1
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.padding.normal
        spacing: Theme.spacing.small

        // Header: prefix key badge + group label
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacing.small

            Rectangle {
                width: 22
                height: 22
                radius: 6
                color: Qt.alpha(Theme.palette.m3primary, 0.18)

                StyledText {
                    anchors.centerIn: parent
                    text: FileManagerService.activeChordPrefix
                    color: Theme.palette.m3primary
                    font.family: Theme.font.family.mono
                    font.pointSize: Theme.font.size.smaller
                    font.weight: 700
                }
            }

            StyledText {
                text: {
                    const prefix = FileManagerService.activeChordPrefix;
                    if (prefix === "") return "";
                    const bindings = FileManagerService.chordBindings;
                    return bindings.hasOwnProperty(prefix) ? bindings[prefix].label : "";
                }
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.smaller
                font.weight: 500
            }
        }

        // Thin separator
        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: Qt.alpha("#ffffff", 0.06)
        }

        // Binding rows
        Repeater {
            model: root._binds

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spacing.small

                // Keycap badge
                Rectangle {
                    width: 22
                    height: 22
                    radius: 6
                    color: Qt.alpha("#ffffff", 0.06)
                    border.color: Qt.alpha("#ffffff", 0.10)
                    border.width: 1

                    StyledText {
                        anchors.centerIn: parent
                        text: modelData.key
                        color: Theme.palette.m3onSurface
                        font.family: Theme.font.family.mono
                        font.pointSize: Theme.font.size.small
                        font.weight: 600
                    }
                }

                // Icon
                MaterialIcon {
                    text: modelData.icon
                    color: Theme.palette.m3onSurfaceVariant
                    font.pointSize: Theme.font.size.normal
                }

                // Label
                StyledText {
                    text: modelData.label
                    color: Theme.palette.m3onSurface
                    font.pointSize: Theme.font.size.smaller
                }
            }
        }

        // Push bindings to top
        Item {
            Layout.fillHeight: true
        }
    }
}
