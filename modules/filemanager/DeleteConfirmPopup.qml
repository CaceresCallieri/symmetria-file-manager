import "../../components"
import "../../services"
import Quickshell.Io
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    anchors.fill: parent

    opacity: FileManagerService.deleteConfirmPath !== "" ? 1 : 0
    active: opacity > 0
    asynchronous: true

    sourceComponent: FocusScope {
        id: popupScope

        property string targetPath

        Component.onCompleted: targetPath = FileManagerService.deleteConfirmPath

        // Scrim backdrop — click to cancel
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            onClicked: FileManagerService.cancelDelete()
        }

        StyledRect {
            anchors.fill: parent
            color: Qt.alpha(Theme.palette.m3shadow, 0.5)
        }

        // Dialog card
        StyledRect {
            id: dialog

            anchors.centerIn: parent
            radius: Theme.rounding.large
            color: Theme.palette.m3surfaceContainerHigh

            width: Math.min(parent.width - Theme.padding.large * 4, dialogLayout.implicitWidth + Theme.padding.large * 3)
            implicitHeight: dialogLayout.implicitHeight + Theme.padding.large * 3

            scale: 0.1
            Component.onCompleted: scale = Qt.binding(
                () => FileManagerService.deleteConfirmPath !== "" ? 1 : 0
            )

            Behavior on scale {
                NumberAnimation {
                    duration: Theme.animDuration
                    easing.type: Easing.OutBack
                    easing.overshoot: 1.5
                }
            }

            // Block clicks from passing through to scrim
            MouseArea {
                anchors.fill: parent
            }

            // Keyboard handler for the entire dialog
            Keys.onPressed: function(event) {
                switch (event.key) {
                case Qt.Key_Y:
                case Qt.Key_Return:
                case Qt.Key_Enter:
                    if (noButton.activeFocus)
                        FileManagerService.cancelDelete();
                    else
                        trashProcess.running = true;
                    event.accepted = true;
                    break;
                case Qt.Key_N:
                case Qt.Key_Escape:
                    FileManagerService.cancelDelete();
                    event.accepted = true;
                    break;
                case Qt.Key_Tab:
                case Qt.Key_Left:
                case Qt.Key_Right:
                case Qt.Key_H:
                case Qt.Key_L:
                    if (yesButton.activeFocus)
                        noButton.forceActiveFocus();
                    else
                        yesButton.forceActiveFocus();
                    event.accepted = true;
                    break;
                default:
                    event.accepted = true;
                    break;
                }
            }

            ColumnLayout {
                id: dialogLayout

                anchors.fill: parent
                anchors.margins: Theme.padding.large * 1.5
                spacing: Theme.spacing.normal

                MaterialIcon {
                    Layout.alignment: Qt.AlignHCenter
                    text: "delete"
                    color: Theme.palette.m3error
                    font.pointSize: Theme.font.size.extraLarge
                    font.weight: 500
                }

                StyledText {
                    Layout.alignment: Qt.AlignHCenter
                    text: qsTr("Trash this file?")
                    font.pointSize: Theme.font.size.large
                    font.weight: 600
                }

                StyledText {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.maximumWidth: 280
                    text: popupScope.targetPath.split("/").pop()
                    color: Theme.palette.m3onSurfaceVariant
                    font.pointSize: Theme.font.size.smaller
                    font.family: Theme.font.family.mono
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                }

                RowLayout {
                    Layout.topMargin: Theme.spacing.normal
                    Layout.alignment: Qt.AlignHCenter
                    spacing: Theme.spacing.normal

                    // Yes button — focused by default
                    StyledRect {
                        id: yesButton

                        radius: Theme.rounding.small
                        color: yesButton.activeFocus
                            ? Qt.alpha(Theme.palette.m3error, 0.25)
                            : Qt.alpha(Theme.palette.m3error, 0.12)
                        implicitWidth: yesRow.implicitWidth + Theme.padding.large * 2
                        implicitHeight: yesRow.implicitHeight + Theme.padding.normal * 2
                        focus: true
                        Component.onCompleted: forceActiveFocus()

                        Behavior on color {
                            CAnim {}
                        }

                        RowLayout {
                            id: yesRow
                            anchors.centerIn: parent
                            spacing: Theme.spacing.small

                            StyledText {
                                text: qsTr("Yes")
                                color: Theme.palette.m3error
                                font.pointSize: Theme.font.size.smaller
                                font.weight: 600
                            }

                            StyledText {
                                text: "(Y)"
                                color: Qt.alpha(Theme.palette.m3error, 0.6)
                                font.pointSize: Theme.font.size.small
                                font.family: Theme.font.family.mono
                            }
                        }

                        StateLayer {
                            color: Theme.palette.m3error
                            onClicked: trashProcess.running = true
                        }
                    }

                    // No button
                    StyledRect {
                        id: noButton

                        radius: Theme.rounding.small
                        color: noButton.activeFocus
                            ? Qt.alpha(Theme.palette.m3onSurface, 0.12)
                            : Qt.alpha(Theme.palette.m3onSurface, 0.06)
                        implicitWidth: noRow.implicitWidth + Theme.padding.large * 2
                        implicitHeight: noRow.implicitHeight + Theme.padding.normal * 2

                        Behavior on color {
                            CAnim {}
                        }

                        RowLayout {
                            id: noRow
                            anchors.centerIn: parent
                            spacing: Theme.spacing.small

                            StyledText {
                                text: qsTr("No")
                                font.pointSize: Theme.font.size.smaller
                                font.weight: 600
                            }

                            StyledText {
                                text: "(N)"
                                color: Theme.palette.m3onSurfaceVariant
                                font.pointSize: Theme.font.size.small
                                font.family: Theme.font.family.mono
                            }
                        }

                        StateLayer {
                            onClicked: FileManagerService.cancelDelete()
                        }
                    }
                }
            }
        }

        // gio trash process
        Process {
            id: trashProcess
            command: ["gio", "trash", popupScope.targetPath]
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    FileManagerService.cancelDelete();
                } else {
                    console.warn("DeleteConfirmPopup: gio trash failed with exit code", exitCode);
                }
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
