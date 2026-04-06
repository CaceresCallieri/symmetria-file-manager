import "../../components"
import "../../services"
import Quickshell.Io
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    property WindowState windowState

    // Positioning inputs from MillerColumns — coordinates relative to FileManager
    property real targetItemY: 0
    property real targetColumnX: 0
    property real targetColumnWidth: 0

    anchors.fill: parent

    opacity: windowState && windowState.renameTargetPath !== "" ? 1 : 0
    active: windowState && windowState.renameTargetPath !== ""
    asynchronous: true

    sourceComponent: FocusScope {
        id: popupScope

        // Snapshot on creation — Loader destroys/recreates each activation
        property string originalPath
        property string originalName
        property bool includeExtension

        Component.onCompleted: {
            originalPath = root.windowState.renameTargetPath;
            includeExtension = root.windowState.renameIncludeExtension;

            // Extract filename from path
            const lastSlash = originalPath.lastIndexOf("/");
            originalName = originalPath.substring(lastSlash + 1);

            // Pre-fill and set selection after the TextInput is ready
            renameInput.text = originalName;
            Qt.callLater(_applySelection);
        }

        function _applySelection(): void {
            renameInput.forceActiveFocus();
            if (includeExtension) {
                renameInput.selectAll();
            } else {
                const dotIndex = originalName.lastIndexOf(".");
                if (dotIndex > 0)
                    renameInput.select(0, dotIndex);
                else
                    renameInput.selectAll();
            }
        }

        // Click outside the card to dismiss — no scrim
        MouseArea {
            anchors.fill: parent
            onClicked: root.windowState.cancelRename()
        }

        // Dialog card — positioned below the selected item, aligned to the file list column
        StyledRect {
            id: renameDialog

            // Horizontal: align to the current file list column
            x: root.targetColumnX
            width: Math.min(root.targetColumnWidth, 360)

            // Vertical: just below the selected item, clamped to stay in bounds
            y: {
                const desiredY = root.targetItemY;
                const maxY = parent.height - renameDialog.implicitHeight - Theme.padding.lg;
                return Math.max(Theme.padding.sm, Math.min(desiredY, maxY));
            }

            radius: Theme.rounding.lg
            color: Theme.palette.m3surfaceContainerHigh
            implicitHeight: renameLayout.implicitHeight + Theme.padding.lg * 3

            // Block clicks from reaching the dismiss MouseArea
            MouseArea {
                anchors.fill: parent
            }

            ColumnLayout {
                id: renameLayout

                anchors.fill: parent
                anchors.margins: Theme.padding.lg * 1.5
                spacing: Theme.spacing.md

                // Label row
                RowLayout {
                    spacing: Theme.spacing.sm

                    MaterialIcon {
                        text: "edit"
                        color: Theme.palette.m3primary
                        font.pointSize: Theme.font.size.lg
                    }

                    StyledText {
                        text: qsTr("Rename:")
                        color: Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.md
                        font.weight: 600
                    }
                }

                // Text input container
                StyledRect {
                    Layout.fillWidth: true
                    radius: Theme.rounding.sm
                    color: Qt.alpha(Theme.palette.m3onSurface, 0.06)
                    implicitHeight: renameInput.implicitHeight + Theme.padding.md * 2

                    TextInput {
                        id: renameInput

                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: Theme.padding.lg
                        anchors.rightMargin: Theme.padding.lg

                        color: Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.sm
                        font.family: Theme.font.family.mono
                        selectionColor: Theme.palette.m3primary
                        selectedTextColor: Theme.palette.m3onPrimary
                        clip: true
                        focus: true

                        Keys.onPressed: function(event) {
                            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                                popupScope._attemptRename();
                                event.accepted = true;
                            } else if (event.key === Qt.Key_Escape) {
                                root.windowState.cancelRename();
                                event.accepted = true;
                            } else if (event.key === Qt.Key_Tab) {
                                // Toggle between name-only and full-name selection
                                popupScope.includeExtension = !popupScope.includeExtension;
                                popupScope._applySelection();
                                event.accepted = true;
                            }
                        }
                    }
                }

                // Inline error (hidden by default)
                StyledText {
                    id: errorLabel

                    Layout.fillWidth: true
                    visible: text !== ""
                    text: ""
                    color: Theme.palette.m3error
                    font.pointSize: Theme.font.size.xs
                    font.family: Theme.font.family.mono
                    wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                }
            }
        }

        function _attemptRename(): void {
            const newName = renameInput.text.trim();

            if (newName === "" || newName === "." || newName === ".." || newName.indexOf("/") !== -1)
                return;
            if (newName === originalName) {
                root.windowState.cancelRename();
                return;
            }
            if (checkProcess.running || renameProcess.running)
                return;

            errorLabel.text = "";

            const parentDir = Paths.parentDir(originalPath);
            const newPath = parentDir + "/" + newName;

            checkProcess.pendingNewPath = newPath;
            checkProcess.pendingNewName = newName;
            checkProcess.command = ["test", "-e", newPath];
            checkProcess.running = true;
        }

        // Existence check process
        Process {
            id: checkProcess

            property string pendingNewPath: ""
            property string pendingNewName: ""

            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    errorLabel.text = qsTr("'%1' already exists").arg(pendingNewName);
                } else {
                    popupScope._runRename();
                }
            }
        }

        function _runRename(): void {
            renameProcess.command = ["mv", "--", originalPath, checkProcess.pendingNewPath];
            renameProcess.running = true;
        }

        // Rename process
        Process {
            id: renameProcess
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    root.windowState.renameCompleted(checkProcess.pendingNewName);
                    root.windowState.cancelRename();
                } else {
                    errorLabel.text = qsTr("Rename failed (exit code %1)").arg(exitCode);
                }
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
