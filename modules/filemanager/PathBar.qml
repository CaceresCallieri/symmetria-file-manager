pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
import QtQuick
import QtQuick.Layouts

StyledRect {
    id: root

    implicitHeight: inner.implicitHeight + Theme.padding.normal * 2
    color: Theme.tPalette.m3surfaceContainer

    // Build breadcrumb segments: [{name, path, isHome}]
    readonly property var _segments: {
        const path = FileManagerService.currentPath;
        const home = Paths.home;

        if (path === home)
            return [{name: "~", path: home, isHome: true}];

        if (path.startsWith(home + "/")) {
            const relative = path.slice(home.length + 1).split("/");
            let segments = [{name: "~", path: home, isHome: true}];
            let accumulated = home;
            for (const part of relative) {
                accumulated += "/" + part;
                segments.push({name: part, path: accumulated, isHome: false});
            }
            return segments;
        }

        // Outside home — absolute path
        const parts = path.split("/").filter(p => p !== "");
        let segments = [{name: "/", path: "/", isHome: false}];
        let accumulated = "";
        for (const part of parts) {
            accumulated += "/" + part;
            segments.push({name: part, path: accumulated, isHome: false});
        }
        return segments;
    }

    RowLayout {
        id: inner

        anchors.fill: parent
        anchors.margins: Theme.padding.normal
        spacing: Theme.spacing.small

        // Up button
        Item {
            implicitWidth: implicitHeight
            implicitHeight: upIcon.implicitHeight + Theme.padding.small * 2

            StateLayer {
                radius: Theme.rounding.small
                disabled: !FileManagerService.canGoUp

                function onClicked(): void {
                    FileManagerService.goUp();
                }
            }

            MaterialIcon {
                id: upIcon

                anchors.centerIn: parent
                text: "drive_folder_upload"
                color: !FileManagerService.canGoUp ? Theme.palette.m3outline : Theme.palette.m3onSurface
                grade: 200
            }
        }

        // Breadcrumb bar
        StyledRect {
            Layout.fillWidth: true
            radius: Theme.rounding.small
            color: Theme.tPalette.m3surfaceContainerHigh
            implicitHeight: breadcrumbs.implicitHeight + breadcrumbs.anchors.margins * 2

            RowLayout {
                id: breadcrumbs

                anchors.fill: parent
                anchors.margins: Theme.padding.small / 2
                anchors.leftMargin: 0
                spacing: Theme.spacing.small

                Repeater {
                    model: root._segments

                    RowLayout {
                        id: segment

                        required property var modelData
                        required property int index

                        spacing: 0

                        // Separator "/"
                        StyledText {
                            Layout.rightMargin: Theme.spacing.small
                            visible: segment.index > 0
                            text: "/"
                            color: Theme.palette.m3onSurfaceVariant
                            font.bold: true
                        }

                        // Clickable segment
                        Item {
                            implicitWidth: homeIcon.implicitWidth + (homeIcon.visible ? Theme.padding.small : 0) + segmentName.implicitWidth + Theme.padding.normal * 2
                            implicitHeight: segmentName.implicitHeight + Theme.padding.small * 2

                            // Clickable only if not the last segment
                            Loader {
                                anchors.fill: parent
                                active: segment.index < root._segments.length - 1
                                sourceComponent: StateLayer {
                                    radius: Theme.rounding.small

                                    function onClicked(): void {
                                        FileManagerService.navigate(segment.modelData.path);
                                    }
                                }
                            }

                            // Home icon
                            MaterialIcon {
                                id: homeIcon

                                anchors.left: parent.left
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: Theme.padding.normal

                                visible: segment.modelData.isHome
                                text: "home"
                                color: segment.index < root._segments.length - 1 ? Theme.palette.m3onSurfaceVariant : Theme.palette.m3onSurface
                                fill: 1
                            }

                            StyledText {
                                id: segmentName

                                anchors.left: homeIcon.right
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: homeIcon.visible ? Theme.padding.small : 0

                                text: segment.modelData.name
                                color: segment.index < root._segments.length - 1 ? Theme.palette.m3onSurfaceVariant : Theme.palette.m3onSurface
                                font.bold: true
                            }
                        }
                    }
                }

                Item { Layout.fillWidth: true }
            }
        }
    }
}
