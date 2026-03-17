//@ pragma Env QT_QPA_PLATFORM=wayland
//@ pragma Env QSG_RENDER_LOOP=threaded

import "modules/filemanager"
import Quickshell
import QtQuick

ShellRoot {
    Component.onCompleted: WindowFactory.create("")
}
