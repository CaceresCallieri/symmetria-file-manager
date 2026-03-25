pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState

    // Horizontal inset matching PathBar pill spacing in PathBar and StatusBar
    readonly property real _barHorizontalMargin: Theme.padding.lg + Theme.padding.md

    implicitHeight: inner.implicitHeight + Theme.padding.md * 2

    // Build breadcrumb segments: [{name, path, isHome}]
    readonly property var _segments: {
        if (!windowState) return [];
        const path = windowState.currentPath;
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
        anchors.topMargin: Theme.padding.md
        anchors.bottomMargin: Theme.padding.md
        anchors.leftMargin: root._barHorizontalMargin
        anchors.rightMargin: root._barHorizontalMargin
        spacing: Theme.spacing.sm

        // Back button
        Item {
            implicitWidth: implicitHeight
            implicitHeight: Math.max(backIcon.implicitHeight + Theme.padding.sm * 2, Theme.padding.md)

            StateLayer {
                radius: Theme.rounding.sm
                disabled: !root.windowState || !root.windowState.canGoBack
                onClicked: root.windowState.back()
            }

            MaterialIcon {
                id: backIcon

                anchors.centerIn: parent
                text: "arrow_back"
                color: root.windowState && root.windowState.canGoBack ? Theme.palette.m3onSurface : Theme.palette.m3outline
                grade: 200
            }
        }

        // Forward button
        Item {
            implicitWidth: implicitHeight
            implicitHeight: Math.max(forwardIcon.implicitHeight + Theme.padding.sm * 2, Theme.padding.md)

            StateLayer {
                radius: Theme.rounding.sm
                disabled: !root.windowState || !root.windowState.canGoForward
                onClicked: root.windowState.forward()
            }

            MaterialIcon {
                id: forwardIcon

                anchors.centerIn: parent
                text: "arrow_forward"
                color: root.windowState && root.windowState.canGoForward ? Theme.palette.m3onSurface : Theme.palette.m3outline
                grade: 200
            }
        }

        // Breadcrumb bar
        StyledRect {
            id: breadcrumbContainer

            Layout.fillWidth: true
            radius: Theme.rounding.full
            color: Theme.pillMedium.background
            border.color: Theme.pillMedium.border
            border.width: 1
            implicitHeight: breadcrumbs.implicitHeight + Math.round(Theme.padding.sm / 2) * 2

            RowLayout {
                id: breadcrumbs

                anchors.fill: parent
                anchors.margins: Math.round(Theme.padding.sm / 2)
                spacing: 0

                Item { Layout.fillWidth: true } // Left spacer — centers breadcrumbs

                Repeater {
                    model: root._segments

                    RowLayout {
                        id: segment

                        required property var modelData
                        required property int index

                        spacing: 0

                        // Separator "/"
                        StyledText {
                            Layout.rightMargin: 0
                            visible: segment.index > 0
                            text: "/"
                            color: Theme.palette.m3onSurfaceVariant
                            font.bold: true
                        }

                        // Clickable segment
                        Item {
                            implicitWidth: ((homeIcon.visible ? homeIcon.implicitWidth + Theme.padding.sm : 0) + segmentName.implicitWidth + Theme.padding.sm * 2) || 0
                            implicitHeight: segmentName.implicitHeight + Theme.padding.sm * 2

                            // Clickable only if not the last segment
                            Loader {
                                anchors.fill: parent
                                active: segment.index < root._segments.length - 1
                                sourceComponent: StateLayer {
                                    radius: Theme.rounding.sm
                                    onClicked: root.windowState.navigate(segment.modelData.path)
                                }
                            }

                            // Home icon — collapse width when hidden so anchors
                            // and implicitWidth don't include ghost icon space
                            // (QML visible:false hides visually but retains geometry)
                            MaterialIcon {
                                id: homeIcon

                                anchors.left: parent.left
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: Theme.padding.sm

                                visible: segment.modelData.isHome
                                width: visible ? implicitWidth : 0
                                text: "home"
                                color: segment.index < root._segments.length - 1 ? Theme.palette.m3onSurfaceVariant : Theme.palette.m3onSurface
                                fill: 1
                            }

                            StyledText {
                                id: segmentName

                                anchors.left: homeIcon.visible ? homeIcon.right : parent.left
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: Theme.padding.sm

                                text: segment.modelData.name
                                color: segment.index < root._segments.length - 1 ? Theme.palette.m3onSurfaceVariant : Theme.palette.m3onSurface
                                font.bold: true
                            }
                        }
                    }
                }

                Item { Layout.fillWidth: true } // Right spacer — centers breadcrumbs
            }
        }

        // Hidden files toggle
        Item {
            implicitWidth: implicitHeight
            implicitHeight: Math.max(hiddenIcon.implicitHeight + Theme.padding.sm * 2, Theme.padding.md)

            StateLayer {
                radius: Theme.rounding.sm
                onClicked: {
                    Config.fileManager.showHidden = !Config.fileManager.showHidden;
                    Config.save();
                }
            }

            MaterialIcon {
                id: hiddenIcon

                anchors.centerIn: parent
                text: Config.fileManager.showHidden ? "visibility" : "visibility_off"
                color: Config.fileManager.showHidden ? Theme.palette.m3onSurface : Theme.palette.m3outline
                grade: 200
            }
        }
    }
}
