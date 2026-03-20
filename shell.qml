//@ pragma Env QT_QPA_PLATFORM=wayland
//@ pragma Env QSG_RENDER_LOOP=threaded

import "modules/filemanager"
import Quickshell
import QtQuick

ShellRoot {
    // WindowFactory is a Singleton — importing the module registers the
    // IPC handler automatically. The portal backend (or manual IPC) calls
    // create("") or createPicker("...") to open windows on demand.
    //
    // Open the file manager:
    //   qs ipc --any-display -c yazi-fm call filemanager open ""
    //
    // This process runs headless as a systemd service. No window is
    // created on startup — windows appear only when requested via IPC.
    Component.onCompleted: {
        // Reference WindowFactory to force Singleton instantiation —
        // this registers the IpcHandler. Without this, the Singleton
        // is lazily created and the IPC target never appears.
        void WindowFactory;
        console.log("yazi-fm: IPC service ready (target: filemanager)");
    }
}
