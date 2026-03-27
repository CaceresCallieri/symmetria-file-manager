pragma Singleton

import "../../components"
import "../../services"
import "../../config"
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick

Singleton {
    id: root

    property var _activeWindows: []
    property var _activePickerWindow: null
    property var _activeOverlayWindow: null

    function create(initialPath: string): void {
        const win = fileManagerWindow.createObject(dummy, {
            "initialPath": initialPath || Paths.home
        });
        _activeWindows = _activeWindows.concat([win]);
    }

    function createOverlay(initialPath: string): void {
        if (_activeOverlayWindow) {
            console.warn("FileManager: Overlay already active, ignoring request");
            return;
        }
        _activeOverlayWindow = overlayWindow.createObject(dummy, {
            "initialPath": initialPath || Paths.home
        });
    }

    QtObject {
        id: dummy
    }

    // === IPC handler for external control ===
    IpcHandler {
        target: "filemanager"

        readonly property string _validFifoPrefix: "/tmp/symmetria-picker-"
        property real _lastPickerCallTime: 0
        readonly property int _rateLimitMs: 1000

        function open(initialPath: string): void {
            root.create(initialPath);
        }

        function openOverlay(initialPath: string): void {
            root.createOverlay(initialPath);
        }

        function createPicker(optionsJson: string): void {
            if (root._activePickerWindow) {
                console.warn("FileManager: Picker already active, ignoring request");
                return;
            }

            // Rate limiting — prevent rapid dialog spam
            const now = Date.now();
            if (now - _lastPickerCallTime < _rateLimitMs) {
                console.warn("FileManager: Picker rate-limited, ignoring request");
                return;
            }
            _lastPickerCallTime = now;

            let options;
            try {
                options = JSON.parse(optionsJson);
            } catch (e) {
                console.error("FileManager: Invalid picker options JSON:", e);
                return;
            }

            // 4-layer FIFO path validation — guards against a malicious IPC caller
            // providing a FIFO path that could redirect picker output to an arbitrary file.
            const fifoPath = options.fifo || "";
            // Layer 1: Prefix check — only accept our own temp files
            if (!fifoPath.startsWith(_validFifoPrefix)) {
                console.error("FileManager: Invalid FIFO path prefix:", fifoPath);
                return;
            }
            // Layer 2: Traversal check — prevent /tmp/symmetria-picker-../../etc/passwd
            if (fifoPath.includes("..") || fifoPath.includes("\0")) {
                console.error("FileManager: Suspicious FIFO path rejected:", fifoPath);
                return;
            }
            // Layer 3: Length check — prevent excessively long paths
            if (fifoPath.length > 128) {
                console.error("FileManager: FIFO path too long:", fifoPath.substring(0, 50) + "...");
                return;
            }
            // Layer 4: Charset check — suffix must be alphanumeric (uuid4 hex + dashes)
            const suffix = fifoPath.substring(_validFifoPrefix.length);
            if (!/^[a-zA-Z0-9._-]+$/.test(suffix)) {
                console.error("FileManager: FIFO path contains invalid characters:", fifoPath);
                return;
            }

            FileManagerService.startPickerMode(options);
            root._activePickerWindow = pickerWindow.createObject(dummy, {
                "initialPath": options.currentFolder || Paths.home
            });
        }
    }

    // === FIFO communication for picker results ===
    Connections {
        target: FileManagerService

        function onPickerCompleted(fifoPath: string, paths: var): void {
            if (!fifoPath)
                return;

            // Write raw absolute paths — Python backend builds file:// URIs
            const rawPaths = paths.join("\n");
            fifoWriteProcess.fifoPath = fifoPath;
            fifoWriteProcess.payload = rawPaths;
            fifoWriteProcess.running = true;
        }

        function onPickerCancelled(fifoPath: string): void {
            if (!fifoPath)
                return;

            fifoCancelProcess.fifoPath = fifoPath;
            fifoCancelProcess.running = true;
        }
    }

    // Write selected URIs to FIFO (askpass pattern)
    Process {
        id: fifoWriteProcess

        property string fifoPath: ""
        property string payload: ""

        // Use python3 directly — avoids sh surface and handles paths with special characters
        command: ["python3", "-c", "import sys; open(sys.argv[2], 'w').write(sys.argv[1])", payload, fifoPath]

        onRunningChanged: {
            if (running) fifoWriteTimeout.start();
            else fifoWriteTimeout.stop();
        }

        onExited: (exitCode, exitStatus) => {
            fifoWriteTimeout.stop();
            if (exitCode !== 0)
                console.error("FileManager: FIFO write failed, exitCode:", exitCode);
            else
                console.log("FileManager: Picker result sent to FIFO");
            root._closePickerWindow();
        }
    }

    Timer {
        id: fifoWriteTimeout
        interval: 5000
        onTriggered: {
            console.error("FileManager: FIFO write timeout — forcing close");
            fifoWriteProcess.signal(9);
            root._closePickerWindow();
        }
    }

    // Write cancellation sentinel to FIFO
    Process {
        id: fifoCancelProcess

        property string fifoPath: ""

        // Use python3 directly — avoids sh surface and handles paths with special characters
        command: ["python3", "-c", "import sys; open(sys.argv[1], 'w').write('__PICKER_CANCELLED__')", fifoPath]

        onRunningChanged: {
            if (running) fifoCancelTimeout.start();
            else fifoCancelTimeout.stop();
        }

        onExited: (exitCode, exitStatus) => {
            fifoCancelTimeout.stop();
            if (exitCode !== 0)
                console.error("FileManager: FIFO cancel write failed, exitCode:", exitCode);
            else
                console.log("FileManager: Picker cancellation sent to FIFO");
            root._closePickerWindow();
        }
    }

    Timer {
        id: fifoCancelTimeout
        interval: 5000
        onTriggered: {
            console.error("FileManager: FIFO cancel timeout — forcing close");
            fifoCancelProcess.signal(9);
            root._closePickerWindow();
        }
    }

    // Setting visible = false triggers onVisibleChanged which nulls
    // _activePickerWindow and calls destroy()
    function _closePickerWindow(): void {
        if (_activePickerWindow)
            _activePickerWindow.visible = false;
    }

    // === Normal file manager window ===
    Component {
        id: fileManagerWindow

        FloatingWindow {
            id: win

            property string initialPath: Paths.home

            color: Theme.layer(Theme.palette.m3surface, 0)
            title: qsTr("File Manager")

            implicitWidth: Config.fileManager.sizes.windowWidth
            implicitHeight: Config.fileManager.sizes.windowHeight

            minimumSize.width: 600
            minimumSize.height: 400

            onVisibleChanged: {
                if (!visible) {
                    root._activeWindows = root._activeWindows.filter(w => w !== win);
                    // Clear shared state when the last window closes — prevents
                    // stale clipboard indicators from appearing in future sessions.
                    if (root._activeWindows.length === 0)
                        FileManagerService.clearClipboard();
                    destroy();
                }
            }

            FileManager {
                id: fm

                anchors.fill: parent
                initialPath: win.initialPath

                onCloseRequested: win.visible = false
            }

            Behavior on color {
                CAnim {}
            }
        }
    }

    // === Picker window (portal file chooser) ===
    Component {
        id: pickerWindow

        FloatingWindow {
            id: pickerWin

            property string initialPath: Paths.home

            color: Theme.layer(Theme.palette.m3surface, 0)
            title: FileManagerService.pickerTitle || qsTr("Select a File")

            implicitWidth: Config.fileManager.sizes.windowWidth
            implicitHeight: Config.fileManager.sizes.windowHeight

            minimumSize.width: 600
            minimumSize.height: 400

            onVisibleChanged: {
                if (!visible) {
                    // If picker mode is still active, user closed the window — cancel
                    if (FileManagerService.pickerMode)
                        FileManagerService.cancelPickerMode();
                    root._activePickerWindow = null;
                    destroy();
                }
            }

            FileManager {
                id: pickerFm

                anchors.fill: parent
                initialPath: pickerWin.initialPath

                onCloseRequested: {
                    // Always route through visible=false so onVisibleChanged is
                    // the single close handler. It will call cancelPickerMode()
                    // if picker state is still active (i.e. not already cancelled
                    // via FIFO path), preventing double-destroy.
                    pickerWin.visible = false;
                }
            }

            Behavior on color {
                CAnim {}
            }
        }
    }

    // === Overlay window (layer shell with centered file manager) ===
    Component {
        id: overlayWindow

        PanelWindow {
            id: overlayWin

            property string initialPath: Paths.home
            property bool _closing: false

            color: "transparent"

            WlrLayershell.namespace: "symmetria-fm-overlay"
            WlrLayershell.layer: WlrLayer.Overlay
            // Release keyboard focus during close animation so the compositor
            // can refocus the previous surface before the window disappears.
            WlrLayershell.keyboardFocus: _closing
                ? WlrKeyboardFocus.None
                : WlrKeyboardFocus.Exclusive
            WlrLayershell.exclusionMode: ExclusionMode.Ignore

            anchors.top: true
            anchors.bottom: true
            anchors.left: true
            anchors.right: true

            Component.onCompleted: {
                overlayContentWrapper.scale = 1.0;
                overlayContentWrapper.opacity = 1.0;
            }

            // Delay destroy until close animation finishes
            Timer {
                id: destroyTimer
                interval: Theme.animDuration + 50
                onTriggered: overlayWin.visible = false
            }

            onVisibleChanged: {
                if (!visible) {
                    if (root._activeWindows.length === 0 && !root._activePickerWindow)
                        FileManagerService.clearClipboard();
                    root._activeOverlayWindow = null;
                    destroy();
                }
            }

            function close(): void {
                if (_closing)
                    return;
                _closing = true;
                overlayContentWrapper.scale = 0.0;
                overlayContentWrapper.opacity = 0.0;
                destroyTimer.start();
            }

            // --- Click-outside-to-close area ---
            MouseArea {
                anchors.fill: parent
                onClicked: overlayWin.close()
            }

            // --- Centered file manager content ---
            Item {
                id: overlayContentWrapper

                anchors.centerIn: parent
                width: parent.width * Config.fileManager.sizes.overlayViewportFraction
                height: parent.height * Config.fileManager.sizes.overlayViewportFraction

                scale: 0.0
                opacity: 0.0

                Behavior on scale {
                    NumberAnimation {
                        duration: Theme.animDuration
                        easing.type: Easing.OutBack
                        easing.overshoot: 1.2
                    }
                }

                Behavior on opacity {
                    Anim {}
                }

                ClippingRect {
                    anchors.fill: parent
                    radius: Theme.rounding.lg
                    color: Theme.layer(Theme.palette.m3surface, 0)

                    // Absorb clicks on the card to prevent them reaching
                    // the click-outside MouseArea and triggering close.
                    MouseArea {
                        anchors.fill: parent
                    }

                    FileManager {
                        anchors.fill: parent
                        initialPath: overlayWin.initialPath

                        onCloseRequested: overlayWin.close()
                    }
                }
            }
        }
    }
}
