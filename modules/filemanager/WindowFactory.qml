pragma Singleton

import "../../components"
import "../../services"
import "../../config"
import Quickshell
import QtQuick

Singleton {
    id: root

    property var _activeWindow: null

    function create(initialPath: string): void {
        if (_activeWindow)
            return;
        if (initialPath)
            FileManagerService.navigate(initialPath);
        _activeWindow = fileManagerWindow.createObject(dummy);
    }

    QtObject {
        id: dummy
    }

    Component {
        id: fileManagerWindow

        FloatingWindow {
            id: win

            color: Theme.tPalette.m3surface
            title: qsTr("File Manager")

            implicitWidth: Config.fileManager.sizes.windowWidth
            implicitHeight: Config.fileManager.sizes.windowHeight

            minimumSize.width: 600
            minimumSize.height: 400

            onVisibleChanged: {
                if (!visible) {
                    root._activeWindow = null;
                    destroy();
                }
            }

            FileManager {
                id: fm

                anchors.fill: parent

                onCloseRequested: win.destroy()
            }

            Behavior on color {
                CAnim {}
            }
        }
    }
}
