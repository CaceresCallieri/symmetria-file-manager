pragma ComponentBehavior: Bound

import qs.components
import qs.services
import qs.config
import qs.utils
import QtQuick
import QtQuick.Layouts

StyledRect {
    id: root

    implicitWidth: Config.fileManager.sizes.sidebarWidth
    color: Colours.tPalette.m3surfaceContainer

    readonly property var _places: [
        { name: "Home",      icon: "home",             path: Paths.home },
        { name: "Documents", icon: "description",      path: Paths.home + "/Documents" },
        { name: "Downloads", icon: "file_download",    path: Paths.home + "/Downloads" },
        { name: "Desktop",   icon: "desktop_windows",  path: Paths.home + "/Desktop" },
        { name: "Pictures",  icon: "image",            path: Paths.home + "/Pictures" },
        { name: "Music",     icon: "music_note",       path: Paths.home + "/Music" },
        { name: "Videos",    icon: "video_library",    path: Paths.home + "/Videos" },
    ]

    ColumnLayout {
        id: inner

        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        anchors.margins: Appearance.padding.normal
        spacing: Appearance.spacing.small / 2

        StyledText {
            Layout.alignment: Qt.AlignHCenter
            Layout.topMargin: Appearance.padding.small / 2
            Layout.bottomMargin: Appearance.spacing.normal
            text: qsTr("Files")
            color: Colours.palette.m3onSurface
            font.pointSize: Appearance.font.size.larger
            font.bold: true
        }

        Repeater {
            model: root._places

            StyledRect {
                id: place

                required property var modelData
                required property int index

                readonly property bool selected: FileManagerService.currentPath === modelData.path

                Layout.fillWidth: true
                implicitHeight: placeInner.implicitHeight + Appearance.padding.normal * 2

                radius: Appearance.rounding.full
                color: Qt.alpha(Colours.palette.m3secondaryContainer, selected ? 1 : 0)

                StateLayer {
                    color: place.selected ? Colours.palette.m3onSecondaryContainer : Colours.palette.m3onSurface

                    function onClicked(): void {
                        FileManagerService.navigate(place.modelData.path);
                    }
                }

                RowLayout {
                    id: placeInner

                    anchors.fill: parent
                    anchors.margins: Appearance.padding.normal
                    anchors.leftMargin: Appearance.padding.large
                    anchors.rightMargin: Appearance.padding.large
                    spacing: Appearance.spacing.normal

                    MaterialIcon {
                        text: place.modelData.icon
                        color: place.selected ? Colours.palette.m3onSecondaryContainer : Colours.palette.m3onSurface
                        font.pointSize: Appearance.font.size.large
                        fill: place.selected ? 1 : 0

                        Behavior on fill {
                            Anim {}
                        }
                    }

                    StyledText {
                        Layout.fillWidth: true
                        text: place.modelData.name
                        color: place.selected ? Colours.palette.m3onSecondaryContainer : Colours.palette.m3onSurface
                        font.pointSize: Appearance.font.size.normal
                        elide: Text.ElideRight
                    }
                }
            }
        }
    }
}
