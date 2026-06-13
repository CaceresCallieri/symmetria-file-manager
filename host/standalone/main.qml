pragma ComponentBehavior: Bound

// Headless root: instantiates no windows at startup. Windows are spawned
// dynamically when hostController emits openRequested / openOverlayRequested
// / createPickerRequested.
//
// QtObject has no default property, so all children (Components, Connections,
// ShellRunner, Timer) are declared as named properties. The `id: foo` form
// remains accessible from the rest of this scope.

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick

QtObject {
    id: root

    property var _pickerWindow: null

    property Component _fileManagerWindowComponent: Component {
        id: fileManagerWindowComponent

        Window {
            id: win

            required property string initialPath

            width: 1100
            height: 720
            visible: true
            color: FmTheme.windowBackdrop
            title: qsTr("File Manager")

            onClosing: () => destroy()

            FileManager {
                anchors.fill: parent
                initialPath: win.initialPath
                onCloseRequested: win.close()
            }
        }
    }

    property Component _pickerWindowComponent: Component {
        id: pickerWindowComponent

        Window {
            id: win

            required property string initialPath

            width: 900
            height: 600
            visible: true
            modality: Qt.ApplicationModal
            // Stay-on-top + Dialog flags help the picker grab focus on Hyprland
            // even though we no longer use Wayland layer-shell exclusive focus.
            // If keyboard focus still lands on the wrong surface, Hyprland's
            // `windowrulev2 = float, class:^(symmetria-fm)$` is the documented
            // fallback (see plan stage D risk hotspot a).
            flags: Qt.Dialog | Qt.WindowStaysOnTopHint
            color: FmTheme.windowBackdrop
            title: qsTr("Pick a File")

            Component.onCompleted: requestActivate()

            onClosing: () => {
                root._pickerWindow = null;
                if (FileManagerService.pickerMode)
                    FileManagerService.cancelPickerMode();
                destroy();
            }

            FileManager {
                anchors.fill: parent
                initialPath: win.initialPath
                onCloseRequested: win.close()
            }
        }
    }

    function _spawnFileManager(initialPath: string): void {
        const path = initialPath || Paths.home;
        // createObject(root, …) gives the window a QObject parent, so its
        // lifetime is owned by the host — no JS-side tracking array needed.
        // The window self-destroys on `onClosing`.
        const win = fileManagerWindowComponent.createObject(root, {
            initialPath: path
        });
        if (!win)
            Logger.error("HostController", "failed to create FileManager window for path: " + path);
    }

    function _spawnPicker(options: var): void {
        if (root._pickerWindow) {
            // Reject immediately instead of silently dropping: without a FIFO
            // response the requesting app's dialog call hangs until the portal's
            // 300s timeout (Electron apps may crash outright), and the user gets
            // no feedback. Cancelling the new request and raising the existing
            // picker makes the conflict visible and recoverable.
            Logger.warn("HostController", "picker already active — cancelling new request, raising existing picker");
            if (options.fifo) {
                fifoRejectProcess.fifoPath = options.fifo;
                fifoRejectProcess.start();
            }
            root._pickerWindow.requestActivate();
            return;
        }
        // Diagnostic: confirm the portal-supplied parent_window handle reaches the
        // picker spawn site. Used to validate the xdg-foreign-v2 import plan
        // (stage 1 of the focus-return fix). Empty string is normal for
        // requesters that don't export a toplevel (some XWayland apps).
        Logger.info("HostController",
                    "picker parentWindow=" + (options.parentWindow || "<empty>"));
        FileManagerService.startPickerMode(options);
        root._pickerWindow = pickerWindowComponent.createObject(root, {
            initialPath: options.currentFolder || Paths.home
        });
        if (!root._pickerWindow) {
            Logger.error("HostController", "failed to create picker window — cancelling picker mode");
            FileManagerService.cancelPickerMode();
        }
    }

    property Connections _hostConn: Connections {
        // hostController is a C++ context property (main.cpp setContextProperty),
        // invisible to qmllint's static analysis.
        target: hostController // qmllint disable unqualified
        function onOpenRequested(initialPath: string): void {
            root._spawnFileManager(initialPath);
        }
        function onOpenOverlayRequested(initialPath: string): void {
            // No layer-shell overlay in the standalone host — fall back to a
            // normal floating window. The shell-overlay use case existed to
            // make the FM appear on top of every workspace under QuickShell;
            // in the standalone host the user's compositor handles that via
            // window rules.
            root._spawnFileManager(initialPath);
        }
        function onCreatePickerRequested(options: var): void {
            root._spawnPicker(options);
        }
        function onClosePickerRequested(fifoPath: string): void {
            // Portal relayed org.freedesktop.impl.portal.Request.Close — the
            // requesting app cancelled or died. Only honour it for the picker
            // that owns this fifo; closing routes through the window's
            // onClosing, which cancels picker mode and answers the FIFO.
            if (root._pickerWindow && FileManagerService.pickerFifoPath === fifoPath) {
                Logger.info("HostController", "closing picker on portal Request.Close");
                root._pickerWindow.close();
            }
        }
    }

    // FIFO writes for picker results — same structure as the QuickShell
    // WindowFactory.qml. The 4-layer FIFO validation ran server-side in
    // server.cpp before this signal fired, so by the time we reach here the
    // path is already trusted.
    property Connections _serviceConn: Connections {
        target: FileManagerService

        function onPickerCompleted(fifoPath: string, paths: var): void {
            if (!fifoPath) return;
            const rawPaths = paths.join("\n");
            fifoWriteProcess.fifoPath = fifoPath;
            fifoWriteProcess.payload = rawPaths;
            fifoWriteProcess.start();
        }

        function onPickerCancelled(fifoPath: string): void {
            if (!fifoPath) return;
            fifoCancelProcess.fifoPath = fifoPath;
            fifoCancelProcess.start();
        }
    }

    property ShellRunner _fifoWriteProcess: ShellRunner {
        id: fifoWriteProcess

        property string fifoPath: ""
        property string payload: ""

        command: ["python3", "-c",
                  "import sys; open(sys.argv[2], 'w').write(sys.argv[1])",
                  payload, fifoPath]

        onRunningChanged: {
            if (running) fifoWriteTimeout.start();
            else fifoWriteTimeout.stop();
        }

        onExited: (exitCode, exitStatus) => {
            fifoWriteTimeout.stop();
            if (exitCode !== 0)
                Logger.error("HostController", "FIFO write failed, exitCode: " + exitCode);
            else
                Logger.info("HostController", "Picker result sent to FIFO");
            root._closePickerWindow();
        }
    }

    property Timer _fifoWriteTimeout: Timer {
        id: fifoWriteTimeout
        interval: 5000
        onTriggered: {
            Logger.error("HostController", "FIFO write timeout — forcing close");
            fifoWriteProcess.kill();
            root._closePickerWindow();
        }
    }

    property ShellRunner _fifoCancelProcess: ShellRunner {
        id: fifoCancelProcess

        property string fifoPath: ""

        command: ["python3", "-c",
                  "import sys; open(sys.argv[1], 'w').write('__PICKER_CANCELLED__')",
                  fifoPath]

        onRunningChanged: {
            if (running) fifoCancelTimeout.start();
            else fifoCancelTimeout.stop();
        }

        onExited: (exitCode, exitStatus) => {
            fifoCancelTimeout.stop();
            if (exitCode !== 0)
                Logger.error("HostController", "FIFO cancel write failed, exitCode: " + exitCode);
            else
                Logger.info("HostController", "Picker cancellation sent to FIFO");
            root._closePickerWindow();
        }
    }

    property Timer _fifoCancelTimeout: Timer {
        id: fifoCancelTimeout
        interval: 5000
        onTriggered: {
            Logger.error("HostController", "FIFO cancel timeout — forcing close");
            fifoCancelProcess.kill();
            root._closePickerWindow();
        }
    }

    // Cancels a busy-rejected request's FIFO. Deliberately separate from
    // fifoCancelProcess: that runner closes the ACTIVE picker window on exit,
    // which is exactly what a busy rejection must NOT do (the existing picker
    // stays open; only the new request is answered with a cancellation).
    property ShellRunner _fifoRejectProcess: ShellRunner {
        id: fifoRejectProcess

        property string fifoPath: ""

        command: ["python3", "-c",
                  "import sys; open(sys.argv[1], 'w').write('__PICKER_CANCELLED__')",
                  fifoPath]

        onRunningChanged: {
            if (running) fifoRejectTimeout.start();
            else fifoRejectTimeout.stop();
        }

        onExited: (exitCode, exitStatus) => {
            fifoRejectTimeout.stop();
            if (exitCode !== 0)
                Logger.error("HostController", "FIFO reject write failed, exitCode: " + exitCode);
            else
                Logger.info("HostController", "Busy rejection sent to FIFO");
        }
    }

    property Timer _fifoRejectTimeout: Timer {
        id: fifoRejectTimeout
        interval: 5000
        onTriggered: {
            Logger.error("HostController", "FIFO reject write timeout — killing writer");
            fifoRejectProcess.kill();
        }
    }

    function _closePickerWindow(): void {
        if (root._pickerWindow)
            root._pickerWindow.close();
    }

    Component.onCompleted: {
        Logger.info("symmetria-fm", "host ready, awaiting IPC");
    }
}
