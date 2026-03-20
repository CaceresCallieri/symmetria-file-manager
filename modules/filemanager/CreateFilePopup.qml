import "../../components"
import "../../services"
import Quickshell.Io
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    anchors.fill: parent

    opacity: FileManagerService.createInputActive ? 1 : 0
    // Drive active from the source property, not from animated opacity — avoids
    // a race where the Loader activates mid-fade-out with an already-closed state.
    active: FileManagerService.createInputActive
    asynchronous: true

    sourceComponent: FocusScope {
        id: popupScope

        property string basePath

        Component.onCompleted: basePath = FileManagerService.currentPath

        // Click outside the card to dismiss — NO dark scrim
        MouseArea {
            anchors.fill: parent
            onClicked: FileManagerService.cancelCreate()
        }

        // Dialog card — positioned at top-third of file list area
        StyledRect {
            id: createDialog

            anchors.horizontalCenter: parent.horizontalCenter
            y: parent.height * 0.2
            radius: Theme.rounding.lg
            color: Theme.palette.m3surfaceContainerHigh

            width: Math.min(parent.width - Theme.padding.lg * 4, 360)
            implicitHeight: createLayout.implicitHeight + Theme.padding.lg * 3

            scale: 0.1
            Component.onCompleted: scale = Qt.binding(
                () => FileManagerService.createInputActive ? 1 : 0
            )

            Behavior on scale {
                NumberAnimation {
                    duration: Theme.animDuration
                    easing.type: Easing.OutBack
                    easing.overshoot: 1.5
                }
            }

            // Block clicks from reaching the dismiss MouseArea
            MouseArea {
                anchors.fill: parent
            }

            ColumnLayout {
                id: createLayout

                anchors.fill: parent
                anchors.margins: Theme.padding.lg * 1.5
                spacing: Theme.spacing.md

                // Label row
                RowLayout {
                    spacing: Theme.spacing.sm

                    MaterialIcon {
                        text: "add"
                        color: Theme.palette.m3primary
                        font.pointSize: Theme.font.size.lg
                    }

                    StyledText {
                        text: qsTr("Create:")
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
                    implicitHeight: createInput.implicitHeight + Theme.padding.md * 2

                    TextInput {
                        id: createInput

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

                        Component.onCompleted: forceActiveFocus()

                        Keys.onPressed: function(event) {
                            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                                popupScope._attemptCreate();
                                event.accepted = true;
                            } else if (event.key === Qt.Key_Escape) {
                                FileManagerService.cancelCreate();
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

        // Internal state for focus-after-create
        property string _pendingFocusName: ""
        property string _currentInput: ""

        function _shellQuote(s: string): string {
            return "'" + s.replace(/'/g, "'\\''") + "'";
        }

        function _attemptCreate(): void {
            const rawInput = createInput.text.trim();
            if (rawInput === "" || checkProcess.running || createProcess.running)
                return;

            errorLabel.text = "";

            const isDirectory = rawInput.endsWith("/");
            const topLevelName = rawInput.split("/")[0];
            _pendingFocusName = topLevelName;
            _currentInput = rawInput;

            // Check if the top-level entry already exists
            // No -- needed: basePath is always absolute, so the path can never
            // be mistaken for a flag.  test(1) does not support -- anyway.
            checkProcess.command = ["test", "-e", basePath + "/" + topLevelName];
            checkProcess.running = true;
        }

        function _runCreate(): void {
            const rawInput = _currentInput;
            const isDirectory = rawInput.endsWith("/");
            const cleanedInput = rawInput.replace(/\/+$/, "");
            const fullPath = basePath + "/" + cleanedInput;

            if (isDirectory) {
                createProcess.command = ["mkdir", "-p", "--", fullPath];
            } else {
                // Create file — always mkdir -p the parent dir first
                const lastSlash = fullPath.lastIndexOf("/");
                const parentDir = fullPath.substring(0, lastSlash);
                createProcess.command = ["sh", "-c",
                    "mkdir -p -- " + _shellQuote(parentDir) + " && touch -- " + _shellQuote(fullPath)];
            }

            // Emit focus signal BEFORE starting the process — mkdir -p triggers
            // QFileSystemWatcher immediately, so _pendingFocusName must already
            // be set when onEntriesChanged fires.
            FileManagerService.createCompleted(_pendingFocusName);
            createProcess.running = true;
        }

        // Existence check process
        Process {
            id: checkProcess
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    // Already exists — show inline error and move the cursor to
                    // the conflicting entry in the background so the user sees
                    // what they're colliding with while the popup stays open.
                    errorLabel.text = qsTr("'%1' already exists").arg(popupScope._pendingFocusName);
                    FileManagerService.createCompleted(popupScope._pendingFocusName);
                } else {
                    popupScope._runCreate();
                }
            }
        }

        // File/directory creation process
        Process {
            id: createProcess
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    FileManagerService.cancelCreate();
                } else {
                    errorLabel.text = qsTr("Creation failed (exit code %1)").arg(exitCode);
                }
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
