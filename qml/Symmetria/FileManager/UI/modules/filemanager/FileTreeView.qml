pragma ComponentBehavior: Bound

// FileTreeView — recursive expandable directory tree.
//
// Reuses the C++ FileSystemModel by instantiating one model per expanded
// directory (lazy, on-first-expand). Each model's QFileSystemWatcher gives
// us live disk-change updates without a separate watcher layer.
//
// Two consumer surfaces:
//   1. Standalone FM via Ctrl-E in FileManager.qml's Loader swap.
//   2. Symmetria-IDE sidebar via `import Symmetria.FileManager.UI as FmUi`.
//
// Out of scope for v1: drag-drop, inline rename/create/delete, multi-select,
// right-click menu, persistent expansion across restarts (the expandedPaths
// prop is reserved for v2).

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Controls

Item {
    id: root

    required property string rootPath

    property bool showHidden: false
    property bool respectGitignore: true
    property var expandedPaths: []
    property WindowState windowState: null

    readonly property int indentPixels: 16
    readonly property var currentRow: (view.currentIndex >= 0 && view.currentIndex < _rows.length) ? _rows[view.currentIndex] : null
    readonly property var currentEntry: currentRow ? currentRow.entry : null
    readonly property int fileCount: _rows.length

    // Stub positional props — MillerColumns exposes these for RenamePopup positioning;
    // FileTreeView always returns 0 since inline rename is out of scope for v1.
    readonly property real currentItemBottomY: 0
    readonly property real currentColumnX: 0
    readonly property real currentColumnWidth: 0

    property var _models: ({})
    property var _expanded: ({})
    property var _ignored: ({})
    property var _rows: []
    property int _generation: 0
    property bool _pendingG: false
    property var _pending: ({})
    property bool _loading: false

    signal fileActivated(string path)
    signal directoryChanged(string path)
    signal showHiddenToggleRequested()

    implicitWidth: 280

    onRootPathChanged: {
        _resetTreeState();
        if (rootPath !== "") {
            _expand(rootPath);
            root.directoryChanged(rootPath);
        }
    }

    onShowHiddenChanged: _refreshAllExpanded()

    onRespectGitignoreChanged: {
        gitignoreSvc.clear();
        _refreshAllExpanded();
    }

    function _isHidden(name: string): bool {
        return name.length > 0 && name.charAt(0) === ".";
    }

    function _resetTreeState(): void {
        _generation++;
        const models = _models;
        for (const key in models) {
            const m = models[key];
            if (m && m.destroy) m.destroy();
        }
        _models = ({});
        _expanded = ({});
        _ignored = ({});
        _pending = ({});
        _rows = [];
        _loading = false;
        gitignoreSvc.clear();
        view.currentIndex = 0;
    }

    function _expand(path: string): void {
        if (_models[path] || _pending[path]) {
            if (_models[path]) {
                const e = Object.assign({}, _expanded);
                e[path] = true;
                _expanded = e;
                _rebuildRows();
            }
            return;
        }
        const newPending = Object.assign({}, _pending);
        newPending[path] = true;
        _pending = newPending;
        _loading = true;
        const gen = _generation;
        const m = fsModelComponent.createObject(root, {
            "path": path,
            "showHidden": root.showHidden,
            "sortBy": FileSystemModel.Natural,
            "sortReverse": false,
            "watchChanges": true
        });
        if (!m) {
            Logger.warn("FileTreeView", "failed to create FileSystemModel for " + path);
            const failedPending = Object.assign({}, _pending);
            delete failedPending[path];
            _pending = failedPending;
            _loading = Object.keys(failedPending).length > 0;
            return;
        }
        const onChange = function() {
            if (gen !== root._generation) return;
            const entries = m.entries;
            const candidates = [];
            for (let i = 0; i < entries.length; i++)
                candidates.push(entries[i].path);

            const finish = function(ignoredSet) {
                if (gen !== root._generation) return;
                // Defensive orphan guard: only destroy `m` if a DIFFERENT model
                // is already registered for `path` (the orphan-races-winner
                // scenario). The earlier identity-less check
                // (`if (root._models[path])`) was a regression — it fired on
                // EVERY subsequent entriesChanged emit on the registered model
                // (showHidden flip, watchChanges disk update), destroying the
                // live model and emptying the tree. With the _pending guard at
                // the top of _expand, the true orphan case is unreachable, but
                // this defensive check is cheap and correct.
                if (root._models[path] && root._models[path] !== m) {
                    m.destroy();
                    return;
                }
                const newIgnored = Object.assign({}, root._ignored);
                newIgnored[path] = ignoredSet || ({});
                root._ignored = newIgnored;
                const newPendingClear = Object.assign({}, root._pending);
                delete newPendingClear[path];
                root._pending = newPendingClear;
                root._loading = Object.keys(newPendingClear).length > 0;
                if (!root._models[path]) {
                    const newModels = Object.assign({}, root._models);
                    newModels[path] = m;
                    root._models = newModels;
                    const newExpanded = Object.assign({}, root._expanded);
                    newExpanded[path] = true;
                    root._expanded = newExpanded;
                }
                root._rebuildRows();
            };
            if (root.respectGitignore && candidates.length > 0)
                gitignoreSvc.filter(path, candidates, finish);
            else
                finish({});
        };
        m.entriesChanged.connect(onChange);
    }

    function _collapse(path: string): void {
        const e = Object.assign({}, _expanded);
        delete e[path];
        // Recursively forget descendant expansion state
        const prefix = path === "/" ? "/" : path + "/";
        for (const key in _expanded)
            if (key !== path && key.startsWith(prefix))
                delete e[key];
        _expanded = e;

        const newModels = Object.assign({}, _models);
        const cur = newModels[path];
        if (cur && cur.destroy) cur.destroy();
        delete newModels[path];
        for (const key in _models) {
            if (key !== path && key.startsWith(prefix)) {
                const cm = newModels[key];
                if (cm && cm.destroy) cm.destroy();
                delete newModels[key];
            }
        }
        _models = newModels;

        const newIgnored = Object.assign({}, _ignored);
        delete newIgnored[path];
        for (const key in _ignored)
            if (key !== path && key.startsWith(prefix))
                delete newIgnored[key];
        _ignored = newIgnored;

        _rebuildRows();
    }

    function _toggle(path: string): void {
        if (_expanded[path]) _collapse(path);
        else _expand(path);
    }

    function _refreshAllExpanded(): void {
        // Propagate showHidden to all live models (they re-scan automatically).
        // Also called when respectGitignore changes to rebuild the visible rows.
        for (const path in _models) {
            const m = _models[path];
            if (m) m.showHidden = root.showHidden;
        }
        _rebuildRows();
    }

    function _refreshAll(): void {
        const r = root.rootPath;
        _resetTreeState();
        if (r !== "") _expand(r);
    }

    function _rebuildRows(): void {
        const newRows = [];
        const visited = ({});
        const walk = function(parentPath, depth) {
            if (visited[parentPath]) return;
            visited[parentPath] = true;
            const m = root._models[parentPath];
            if (!m) return;
            const entries = m.entries;
            const ignored = root._ignored[parentPath] || ({});
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                if (!e) continue;
                if (!root.showHidden && root._isHidden(e.name)) continue;
                if (root.respectGitignore && ignored[e.path]) continue;
                newRows.push({
                    "path": e.path,
                    "name": e.name,
                    "isDir": e.isDir,
                    "depth": depth,
                    "expanded": !!root._expanded[e.path],
                    "entry": e
                });
                if (e.isDir && root._expanded[e.path])
                    walk(e.path, depth + 1);
            }
        };
        walk(root.rootPath, 0);
        _rows = newRows;
        if (view.currentIndex >= newRows.length)
            view.currentIndex = Math.max(0, newRows.length - 1);
    }

    function _jumpToParent(): void {
        const cur = currentRow;
        if (!cur || cur.depth === 0) return;
        for (let i = view.currentIndex - 1; i >= 0; i--) {
            if (_rows[i].depth === cur.depth - 1) {
                view.currentIndex = i;
                view.positionViewAtIndex(i, ListView.Contain);
                return;
            }
        }
    }

    function _activate(row: var): void {
        if (!row) return;
        if (row.isDir) _toggle(row.path);
        else root.fileActivated(row.path);
    }

    Component {
        id: fsModelComponent
        FileSystemModel {}
    }

    Gitignore {
        id: gitignoreSvc
        enabled: root.respectGitignore
    }

    Timer {
        id: ggTimer
        interval: 500
        onTriggered: root._pendingG = false
    }

    StyledRect {
        anchors.fill: parent
        color: FmTheme.layer(FmTheme.palette.surfaceContainerLow, 1)
    }

    Loader {
        anchors.centerIn: parent
        active: view.count === 0 && !root._loading
        sourceComponent: PreviewStateIndicator {
            iconName: "folder_open"
            message: qsTr("Empty")
        }
    }

    ListView {
        id: view

        anchors.fill: parent
        anchors.margins: FmTheme.padding.sm
        clip: true
        focus: true
        keyNavigationEnabled: false
        boundsBehavior: Flickable.StopAtBounds
        model: root._rows

        Component.onCompleted: view.forceActiveFocus()

        ScrollBar.vertical: ScrollBar {
            policy: ScrollBar.AsNeeded
            width: 6
            contentItem: Rectangle {
                implicitWidth: 6
                radius: width / 2
                color: FmTheme.palette.onSurfaceVariant
                opacity: 0.4
            }
        }

        delegate: Item {
            id: delegateRoot

            required property var modelData
            required property int index

            readonly property int rowDepth: modelData ? modelData.depth : 0
            readonly property bool rowIsDir: modelData ? modelData.isDir : false
            readonly property bool rowExpanded: modelData ? modelData.expanded : false

            width: ListView.view ? ListView.view.width : 0
            implicitHeight: Config.fileManager.sizes.itemHeight

            Rectangle {
                anchors.fill: parent
                anchors.leftMargin: FmTheme.padding.sm
                anchors.rightMargin: FmTheme.padding.sm
                radius: FmTheme.rounding.sm
                color: FmTheme.palette.secondaryContainer
                opacity: delegateRoot.ListView.isCurrentItem ? 0.35 : 0
                Behavior on opacity { Anim {} }
            }

            Repeater {
                model: delegateRoot.rowDepth
                delegate: Rectangle {
                    required property int index
                    width: 1
                    height: delegateRoot.height
                    x: index * root.indentPixels + FmTheme.padding.lg
                    color: FmTheme.palette.outlineVariant
                    opacity: 0.4
                }
            }

            Row {
                x: delegateRoot.rowDepth * root.indentPixels + FmTheme.padding.lg
                anchors.verticalCenter: parent.verticalCenter
                spacing: FmTheme.spacing.md

                MaterialIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: delegateRoot.rowIsDir
                    text: delegateRoot.rowExpanded ? "expand_more" : "chevron_right"
                    color: FmTheme.palette.onSurfaceVariant
                    font.pointSize: FmTheme.font.size.md
                }
                Item {
                    visible: !delegateRoot.rowIsDir
                    width: FmTheme.font.size.md
                    height: 1
                }
                FileIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    entry: delegateRoot.modelData ? delegateRoot.modelData.entry : null
                    materialIconName: {
                        if (!delegateRoot.modelData) return "description";
                        const e = delegateRoot.modelData.entry;
                        if (!e) return "description";
                        if (e.isDir) return "folder";
                        if (e.isImage) return "image";
                        return FileManagerService.iconNameForMime(e.mimeType);
                    }
                    materialColor: delegateRoot.rowIsDir
                                   ? FmTheme.palette.primary
                                   : FmTheme.palette.onSurfaceVariant
                    materialFill: delegateRoot.rowIsDir ? 1 : 0
                }
                StyledText {
                    anchors.verticalCenter: parent.verticalCenter
                    text: delegateRoot.modelData ? delegateRoot.modelData.name : ""
                    color: FmTheme.palette.onSurface
                    font.pointSize: FmTheme.font.size.md
                }
            }

            StateLayer {
                onClicked: view.currentIndex = delegateRoot.index
                onDoubleClicked: root._activate(delegateRoot.modelData)
            }
        }

        Keys.onPressed: function(event) {
            const mods = event.modifiers;
            const key = event.key;

            if (key === Qt.Key_E && (mods & Qt.ControlModifier)) {
                if (root.windowState) root.windowState.toggleViewMode();
                event.accepted = true;
                return;
            }

            switch (key) {
            case Qt.Key_J:
            case Qt.Key_Down:
                if (view.currentIndex < view.count - 1) view.currentIndex++;
                event.accepted = true;
                break;

            case Qt.Key_K:
            case Qt.Key_Up:
                if (view.currentIndex > 0) view.currentIndex--;
                event.accepted = true;
                break;

            case Qt.Key_G:
                if (mods & Qt.ShiftModifier) {
                    if (view.count > 0) view.currentIndex = view.count - 1;
                    root._pendingG = false;
                    ggTimer.stop();
                } else if (root._pendingG) {
                    if (view.count > 0) view.currentIndex = 0;
                    root._pendingG = false;
                    ggTimer.stop();
                } else {
                    root._pendingG = true;
                    ggTimer.restart();
                }
                event.accepted = true;
                break;

            case Qt.Key_H:
                if (mods & Qt.ShiftModifier) {
                    root.showHiddenToggleRequested();
                } else {
                    const cur = root.currentRow;
                    if (cur && cur.isDir && cur.expanded) root._collapse(cur.path);
                    else root._jumpToParent();
                }
                event.accepted = true;
                break;

            case Qt.Key_Left: {
                const row = root.currentRow;
                if (row && row.isDir && row.expanded) root._collapse(row.path);
                else root._jumpToParent();
                event.accepted = true;
                break;
            }

            case Qt.Key_L:
            case Qt.Key_Right: {
                const row = root.currentRow;
                if (!row) { event.accepted = true; break; }
                if (row.isDir) {
                    if (!row.expanded) root._expand(row.path);
                    else if (view.currentIndex + 1 < view.count) view.currentIndex++;
                } else {
                    root.fileActivated(row.path);
                }
                event.accepted = true;
                break;
            }

            case Qt.Key_Return:
            case Qt.Key_Enter:
                root._activate(root.currentRow);
                event.accepted = true;
                break;

            case Qt.Key_O: {
                const row = root.currentRow;
                if (row && row.isDir) root._toggle(row.path);
                event.accepted = true;
                break;
            }

            case Qt.Key_R:
                if (mods & Qt.ShiftModifier) {
                    root._refreshAll();
                    event.accepted = true;
                }
                break;

            case Qt.Key_Period:
                root.respectGitignore = !root.respectGitignore;
                event.accepted = true;
                break;
            }
        }
    }
}
