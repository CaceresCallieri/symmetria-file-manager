import "../../components"
import "../../services"
import Quickshell.Io
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    property WindowState windowState

    anchors.fill: parent

    opacity: windowState && windowState.activeModal === windowState.modalDelete ? 1 : 0
    // Drive active from the source property, not from animated opacity — avoids
    // a race where the Loader activates mid-fade-out with an already-empty path.
    active: windowState && windowState.activeModal === windowState.modalDelete
    asynchronous: true

    sourceComponent: FocusScope {
        id: popupScope

        // Snapshot paths on creation — this component is destroyed/recreated each
        // time the Loader reactivates (active flips false→true), so onCompleted
        // always captures the correct paths even though deleteConfirmPaths is
        // cleared before the component is destroyed.
        property var targetPaths: []

        Component.onCompleted: targetPaths = root.windowState.deleteConfirmPaths

        // Scrim backdrop — click to cancel
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            onClicked: root.windowState.closeModal()
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

            // Start at 0.1 — the Behavior on scale animates to 1 (OutBack pop-in).
            // No live binding needed: this component is only created when deleteConfirmPaths
            // is non-empty (Loader active is driven by it), so the target is always 1.
            scale: 0.1
            Component.onCompleted: scale = 1

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
                        root.windowState.closeModal();
                    else if (!trashProcess.running)
                        trashProcess.running = true;
                    event.accepted = true;
                    break;
                case Qt.Key_N:
                case Qt.Key_Escape:
                    root.windowState.closeModal();
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
                    font.weight: Font.Medium
                }

                StyledText {
                    Layout.alignment: Qt.AlignHCenter
                    text: popupScope.targetPaths.length === 1
                        ? qsTr("Trash this item?")
                        : qsTr("Trash %1 files?").arg(popupScope.targetPaths.length)
                    font.pointSize: Theme.font.size.xl
                    font.weight: Font.DemiBold
                }

                StyledText {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.maximumWidth: 280
                    text: {
                        const paths = popupScope.targetPaths;
                        if (paths.length === 0) return "";
                        const names = paths.map(p => p.split("/").pop());
                        if (names.length <= 3)
                            return names.join("\n");
                        return names.slice(0, 3).join("\n") + "\n\u2026 and " + (names.length - 3) + " more";
                    }
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
                                font.weight: Font.DemiBold
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
                                font.weight: Font.DemiBold
                            }

                            StyledText {
                                text: "(N)"
                                color: Theme.palette.m3onSurfaceVariant
                                font.pointSize: Theme.font.size.xs
                                font.family: Theme.font.family.mono
                            }
                        }

                        StateLayer {
                            onClicked: root.windowState.closeModal()
                        }
                    }
                }
            }
        }

        // gio trash process
        Process {
            id: trashProcess
            command: ["gio", "trash", "--"].concat(popupScope.targetPaths)
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    root.windowState.closeModal();
                } else {
                    Logger.warn("DeleteConfirmPopup", "gio trash failed with exit code " + exitCode);
                    // Dismiss the popup even on failure — user can retry via D again
                    root.windowState.closeModal();
                }
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
