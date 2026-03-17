pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
import QtQuick
import QtQuick.Layouts

StyledRect {
    id: root

    implicitWidth: Config.fileManager.sizes.sidebarWidth
    color: Theme.tPalette.m3surfaceContainer

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
        anchors.margins: Theme.padding.normal
        spacing: 2

        StyledText {
            Layout.alignment: Qt.AlignHCenter
            Layout.topMargin: Theme.padding.small / 2
            Layout.bottomMargin: Theme.spacing.normal
            text: qsTr("Files")
            color: Theme.palette.m3onSurface
            font.pointSize: Theme.font.size.larger
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
                implicitHeight: placeInner.implicitHeight + Theme.padding.small * 2

                radius: Theme.rounding.full
                color: Qt.alpha(Theme.palette.m3secondaryContainer, selected ? 1 : 0)

                StateLayer {
                    color: place.selected ? Theme.palette.m3onSecondaryContainer : Theme.palette.m3onSurface

                    function onClicked(): void {
                        FileManagerService.navigate(place.modelData.path);
                    }
                }

                RowLayout {
                    id: placeInner

                    anchors.fill: parent
                    anchors.margins: Theme.padding.small
                    anchors.leftMargin: Theme.padding.normal
                    anchors.rightMargin: Theme.padding.normal
                    spacing: Theme.spacing.normal

                    MaterialIcon {
                        text: place.modelData.icon
                        color: place.selected ? Theme.palette.m3onSecondaryContainer : Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.large
                        fill: place.selected ? 1 : 0

                        Behavior on fill {
                            Anim {}
                        }
                    }

                    StyledText {
                        Layout.fillWidth: true
                        text: place.modelData.name
                        color: place.selected ? Theme.palette.m3onSecondaryContainer : Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.normal
                        elide: Text.ElideRight
                    }
                }
            }
        }
    }
}
