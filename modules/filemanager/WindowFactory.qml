pragma Singleton

import "../../components"
import "../../services"
import "../../config"
import Quickshell
import Quickshell.Io
import QtQuick

Singleton {
    id: root

    property var _activeWindows: []
    property var _activePickerWindow: null

    function create(initialPath: string): void {
        const win = fileManagerWindow.createObject(dummy, {
            "initialPath": initialPath || Paths.home
        });
        _activeWindows = _activeWindows.concat([win]);
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
}
