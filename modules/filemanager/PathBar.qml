pragma ComponentBehavior: Bound

import qs.components
import qs.services
import qs.config
import qs.utils
import QtQuick
import QtQuick.Layouts

StyledRect {
    id: root

    implicitHeight: inner.implicitHeight + Appearance.padding.normal * 2
    color: Colours.tPalette.m3surfaceContainer

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
        anchors.margins: Appearance.padding.normal
        spacing: Appearance.spacing.small

        // Up button
        Item {
            implicitWidth: implicitHeight
            implicitHeight: upIcon.implicitHeight + Appearance.padding.small * 2

            StateLayer {
                radius: Appearance.rounding.small
                disabled: !FileManagerService.canGoUp

                function onClicked(): void {
                    FileManagerService.goUp();
                }
            }

            MaterialIcon {
                id: upIcon

                anchors.centerIn: parent
                text: "drive_folder_upload"
                color: !FileManagerService.canGoUp ? Colours.palette.m3outline : Colours.palette.m3onSurface
                grade: 200
            }
        }

        // Breadcrumb bar
        StyledRect {
            Layout.fillWidth: true
            radius: Appearance.rounding.small
            color: Colours.tPalette.m3surfaceContainerHigh
            implicitHeight: breadcrumbs.implicitHeight + breadcrumbs.anchors.margins * 2

            RowLayout {
                id: breadcrumbs

                anchors.fill: parent
                anchors.margins: Appearance.padding.small / 2
                anchors.leftMargin: 0
                spacing: Appearance.spacing.small

                Repeater {
                    model: root._segments

                    RowLayout {
                        id: segment

                        required property var modelData
                        required property int index

                        spacing: 0

                        // Separator "/"
                        StyledText {
                            Layout.rightMargin: Appearance.spacing.small
                            visible: segment.index > 0
                            text: "/"
                            color: Colours.palette.m3onSurfaceVariant
                            font.bold: true
                        }

                        // Clickable segment
                        Item {
                            implicitWidth: homeIcon.implicitWidth + (homeIcon.visible ? Appearance.padding.small : 0) + segmentName.implicitWidth + Appearance.padding.normal * 2
                            implicitHeight: segmentName.implicitHeight + Appearance.padding.small * 2

                            // Clickable only if not the last segment
                            Loader {
                                anchors.fill: parent
                                active: segment.index < root._segments.length - 1
                                sourceComponent: StateLayer {
                                    radius: Appearance.rounding.small

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
                                anchors.leftMargin: Appearance.padding.normal

                                visible: segment.modelData.isHome
                                text: "home"
                                color: segment.index < root._segments.length - 1 ? Colours.palette.m3onSurfaceVariant : Colours.palette.m3onSurface
                                fill: 1
                            }

                            StyledText {
                                id: segmentName

                                anchors.left: homeIcon.right
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: homeIcon.visible ? Appearance.padding.small : 0

                                text: segment.modelData.name
                                color: segment.index < root._segments.length - 1 ? Colours.palette.m3onSurfaceVariant : Colours.palette.m3onSurface
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
