import "../../components"
import "../../services"
import Quickshell.Io
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    anchors.fill: parent

    opacity: FileManagerService.deleteConfirmPath !== "" ? 1 : 0
    // Drive active from the source property, not from animated opacity — avoids
    // a race where the Loader activates mid-fade-out with an already-empty path.
    active: FileManagerService.deleteConfirmPath !== ""
    asynchronous: true

    sourceComponent: FocusScope {
        id: popupScope

        // Snapshot path on creation — this component is destroyed/recreated each
        // time the Loader reactivates (active flips false→true), so onCompleted
        // always captures the correct path even though deleteConfirmPath is
        // cleared before the component is destroyed.
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
            radius: Theme.rounding.lg
            color: Theme.palette.m3surfaceContainerHigh

            width: Math.min(parent.width - Theme.padding.lg * 4, dialogLayout.implicitWidth + Theme.padding.lg * 3)
            implicitHeight: dialogLayout.implicitHeight + Theme.padding.lg * 3

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

            // Prevent clicks on the card from reaching the scrim MouseArea behind it
            MouseArea {
                anchors.fill: parent
            }

            // Keyboard handler for the entire dialog
            Keys.onPressed: function(event) {
                switch (event.key) {
                case Qt.Key_Y:
                    // Y always confirms, regardless of which button has focus
                    if (!trashProcess.running)
                        trashProcess.running = true;
                    event.accepted = true;
                    break;
                case Qt.Key_Return:
                case Qt.Key_Enter:
                    // Return/Enter is focus-aware: confirms on Yes, cancels on No
                    if (noButton.activeFocus)
                        FileManagerService.cancelDelete();
                    else if (!trashProcess.running)
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
                anchors.margins: Theme.padding.lg * 1.5
                spacing: Theme.spacing.md

                MaterialIcon {
                    Layout.alignment: Qt.AlignHCenter
                    text: "delete"
                    color: Theme.palette.m3error
                    font.pointSize: Theme.font.size.xxl
                    font.weight: 500
                }

                StyledText {
                    Layout.alignment: Qt.AlignHCenter
                    text: qsTr("Trash this file?")
                    font.pointSize: Theme.font.size.xl
                    font.weight: 600
                }

                StyledText {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.maximumWidth: 280
                    text: popupScope.targetPath.split("/").pop()
                    color: Theme.palette.m3onSurfaceVariant
                    font.pointSize: Theme.font.size.sm
                    font.family: Theme.font.family.mono
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                }

                RowLayout {
                    Layout.topMargin: Theme.spacing.md
                    Layout.alignment: Qt.AlignHCenter
                    spacing: Theme.spacing.md

                    // Yes button — focused by default
                    StyledRect {
                        id: yesButton

                        radius: Theme.rounding.sm
                        color: yesButton.activeFocus
                            ? Qt.alpha(Theme.palette.m3error, 0.25)
                            : Qt.alpha(Theme.palette.m3error, 0.12)
                        implicitWidth: yesRow.implicitWidth + Theme.padding.lg * 2
                        implicitHeight: yesRow.implicitHeight + Theme.padding.md * 2
                        focus: true
                        Component.onCompleted: forceActiveFocus()

                        Behavior on color {
                            CAnim {}
                        }

                        RowLayout {
                            id: yesRow
                            anchors.centerIn: parent
                            spacing: Theme.spacing.sm

                            StyledText {
                                text: qsTr("Yes")
                                color: Theme.palette.m3error
                                font.pointSize: Theme.font.size.sm
                                font.weight: 600
                            }

                            StyledText {
                                text: "(Y)"
                                color: Qt.alpha(Theme.palette.m3error, 0.6)
                                font.pointSize: Theme.font.size.xs
                                font.family: Theme.font.family.mono
                            }
                        }

                        StateLayer {
                            color: Theme.palette.m3error
                            onClicked: {
                                if (!trashProcess.running)
                                    trashProcess.running = true;
                            }
                        }
                    }

                    // No button
                    StyledRect {
                        id: noButton

                        radius: Theme.rounding.sm
                        color: noButton.activeFocus
                            ? Qt.alpha(Theme.palette.m3onSurface, 0.12)
                            : Qt.alpha(Theme.palette.m3onSurface, 0.06)
                        implicitWidth: noRow.implicitWidth + Theme.padding.lg * 2
                        implicitHeight: noRow.implicitHeight + Theme.padding.md * 2

                        Behavior on color {
                            CAnim {}
                        }

                        RowLayout {
                            id: noRow
                            anchors.centerIn: parent
                            spacing: Theme.spacing.sm

                            StyledText {
                                text: qsTr("No")
                                font.pointSize: Theme.font.size.sm
                                font.weight: 600
                            }

                            StyledText {
                                text: "(N)"
                                color: Theme.palette.m3onSurfaceVariant
                                font.pointSize: Theme.font.size.xs
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
                    // Dismiss the popup even on failure — user can retry via D again
                    FileManagerService.cancelDelete();
                }
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
