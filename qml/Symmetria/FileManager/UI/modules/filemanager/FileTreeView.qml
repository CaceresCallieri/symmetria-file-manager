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
// Auto-expand (mount-only): `initialExpandDepth` controls how many directory
// levels are expanded automatically when the tree mounts or rootPath changes.
// 0 = collapsed (default), N>0 = N levels, -1 = recursive (capped by
// `maxExpandDepth`). After mount, expansion is fully user-controlled —
// unrelated prop changes (theme, width, respectGitignore toggle) do NOT
// re-trigger auto-expand.
//
// Guardrails are intentionally NOT props — they're failure-mode protection,
// not configuration:
//   - .git/ is unconditionally skipped (never useful, even without gitignore)
//   - directories with >200 children are skipped (unreadable expanded)
//   - total row ceiling 10k (last-resort backstop for pathological trees)
// Each hit emits one Logger.info so we can diagnose without exposing knobs.
//
// Out of scope for v1: drag-drop, inline rename/create/delete, multi-select,
// right-click menu, persistent expansion across restarts (the expandedPaths
// prop is reserved for v2).

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import "FlashLogic.js" as FlashLogic
import "handlers/TreeFlashHandler.js" as TreeFlashHandler
import QtQuick
import QtQuick.Controls

Item {
    id: root

    required property string rootPath

    property bool showHidden: false
    property bool respectGitignore: true
    property var expandedPaths: []
    property WindowState windowState: null

    // Auto-expand on mount or rootPath change.
    //   0  = collapsed (default — preserves all existing callers)
    //   N>0 = expand N levels below root
    //   -1 = expand recursively, capped by `maxExpandDepth`
    // Mount-only — after the initial expansion phase settles, expansion is
    // fully user-controlled. Re-triggers only on rootPath change.
    property int initialExpandDepth: 0

    // Hard cap when `initialExpandDepth: -1`. 8 covers realistic repo nesting;
    // deeper than that the row indentation is unreadable anyway. Exposed as a
    // prop so consumers with deeper projects can tune it.
    property int maxExpandDepth: 8

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
    // Cursor position captured when `/` is pressed; restored on Escape.
    property int _preSearchIndex: 0
    // Cursor position captured when `S` is pressed; restored on Escape/Backspace-on-empty.
    property int _preFlashIndex: 0
    // Set by the fuzzy-finder via WindowState.fuzzyFinderNavigated — consumed
    // by _rebuildRows once the new rootPath's children land, so the cursor
    // ends up on the file the user picked rather than at row 0.
    property string _pendingFocusName: ""

    // Auto-expand guardrails (failure-mode protection, NOT configuration).
    // Hidden behind the prop so callers can't accidentally raise them and
    // re-discover the failure modes the defaults protect against. Each
    // triggers a one-shot Logger.info on hit (not a warn — they're expected
    // outcomes on big trees, not bugs) so we can diagnose without UI feedback.
    readonly property int _autoExpandFanoutCap: 200
    readonly property int _autoExpandNodeCeiling: 10000
    readonly property var _autoExpandSkipNames: ({ ".git": true })

    // True between the initial _expand(rootPath) and the last pending model
    // settling. Gates the recursive fan-out so manual expansion after mount
    // doesn't trigger further auto-expansion.
    property bool _autoExpandActive: false
    property int _autoExpandTargetDepth: 0
    // childPath -> number of fan-out rounds from rootPath to reach it.
    // Carries the depth through the async expansion hop since _expand()
    // doesn't take a depth parameter (changing its signature would affect
    // the unrelated _toggle() callers). rootPath has no entry (implicit 0).
    property var _autoExpandPending: ({})
    // One-shot guards so the same diagnostic doesn't spam the log if the
    // tree mounts repeatedly within a session.
    property bool _autoExpandCeilingLogged: false
    property bool _autoExpandFanoutLogged: false

    signal fileActivated(string path)
    signal directoryChanged(string path)
    signal showHiddenToggleRequested()

    implicitWidth: 280

    onRootPathChanged: {
        _resetTreeState();
        if (rootPath !== "") {
            // Compute the effective auto-expand depth BEFORE _expand() so the
            // rootPath's onChange callback can see _autoExpandActive on its
            // first emission. Order is critical: _expand() registers an async
            // entriesChanged handler that reads these flags when entries land.
            const target = initialExpandDepth === -1
                ? maxExpandDepth
                : initialExpandDepth;
            _autoExpandTargetDepth = Math.max(0, target);
            _autoExpandActive = _autoExpandTargetDepth > 0;
            _autoExpandCeilingLogged = false;
            _autoExpandFanoutLogged = false;
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
        _autoExpandPending = ({});
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

                // Auto-expand fan-out — only during the mount-time phase.
                // Manual user toggles after _autoExpandActive flips false
                // don't trigger further recursion, preserving the user's
                // expansion choices for the rest of the session.
                if (root._autoExpandActive) {
                    const expansionsTaken = root._autoExpandPending[path] !== undefined
                        ? root._autoExpandPending[path]
                        : 0;  // rootPath itself — implicit zero
                    delete root._autoExpandPending[path];
                    root._autoExpandChildrenOf(path, expansionsTaken);
                    // BFS settles when no more directories are queued.
                    // _autoExpandChildrenOf adds to _pending synchronously,
                    // so this check correctly reflects the post-recursion
                    // state (children we just enqueued are visible here).
                    if (Object.keys(root._pending).length === 0) {
                        root._autoExpandActive = false;
                        Logger.info(
                            "FileTreeView",
                            "auto-expand complete: " + root._rows.length + " rows visible"
                        );
                    }
                }
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

    // Auto-expand fan-out — invoked from the async _expand finish callback
    // for each directory whose entries just landed. `parentExpansions` is the
    // number of fan-out rounds taken from rootPath to reach `parentPath`;
    // rootPath itself = 0, its direct children = 1, etc.
    //
    // We stop recursion if any of these guardrails fire:
    //   1. _autoExpandActive went false (BFS settled or rootPath changed)
    //   2. parentExpansions >= _autoExpandTargetDepth (budget exhausted)
    //   3. _rows.length >= _autoExpandNodeCeiling (last-resort backstop)
    //   4. The parent has > _autoExpandFanoutCap children (predictive skip
    //      — saves the I/O cost of expanding hundreds of siblings the user
    //      can't reasonably scan visually)
    function _autoExpandChildrenOf(parentPath: string, parentExpansions: int): void {
        if (!_autoExpandActive) return;
        if (parentExpansions >= _autoExpandTargetDepth) return;
        if (_rows.length >= _autoExpandNodeCeiling) {
            if (!_autoExpandCeilingLogged) {
                Logger.info(
                    "FileTreeView",
                    "auto-expand: node ceiling reached (" + _autoExpandNodeCeiling
                    + " rows), leaving remainder collapsed"
                );
                _autoExpandCeilingLogged = true;
            }
            return;
        }
        const m = _models[parentPath];
        if (!m) return;
        const entries = m.entries;
        if (entries.length > _autoExpandFanoutCap) {
            if (!_autoExpandFanoutLogged) {
                Logger.info(
                    "FileTreeView",
                    "auto-expand: skipping high-fanout dir (" + entries.length
                    + " children > " + _autoExpandFanoutCap + " cap): " + parentPath
                );
                _autoExpandFanoutLogged = true;
            }
            return;
        }
        const ignored = _ignored[parentPath] || ({});
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (!e || !e.isDir) continue;
            if (_autoExpandSkipNames[e.name]) continue;
            if (!showHidden && _isHidden(e.name)) continue;
            if (respectGitignore && ignored[e.path]) continue;
            // Skip if already expanded, has a model, or is mid-flight —
            // protects against re-entrant expansion of the same path.
            if (_expanded[e.path] || _models[e.path] || _pending[e.path]) continue;
            // Tag the child with its expansion depth so the async finish
            // callback can recover the budget when this dir's entries land.
            const tagged = Object.assign({}, _autoExpandPending);
            tagged[e.path] = parentExpansions + 1;
            _autoExpandPending = tagged;
            _expand(e.path);
        }
    }

    function _rebuildRows(): void {
        // Capture cursor by PATH before reassigning the model array.
        // Reassigning ListView.model to a fresh JS array resets currentIndex,
        // so an integer-only preservation strategy is unreliable. Path-based
        // restore also keeps the cursor stable across file-watcher mutations
        // (inserts/removes that shift indices around the cursor).
        const prevPath = root.currentRow ? root.currentRow.path : "";

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

        // Fuzzy-finder pending focus takes precedence over path-based restore:
        // the user explicitly asked for this file. Match name + depth=0 because
        // the popup always navigates to the file's parent, so the picked file
        // is a direct child of the new rootPath.
        let restored = -1;
        if (root._pendingFocusName !== "") {
            for (let i = 0; i < newRows.length; i++) {
                if (newRows[i].name === root._pendingFocusName && newRows[i].depth === 0) {
                    restored = i;
                    break;
                }
            }
            // Always consume _pendingFocusName — keeping it set when the file
            // isn't found on THIS rebuild causes every future rebuild to attempt
            // the same stale match, potentially hijacking cursor placement for
            // unrelated file-watcher or expand/collapse events.
            root._pendingFocusName = "";
        }
        if (restored < 0 && prevPath !== "") {
            for (let i = 0; i < newRows.length; i++) {
                if (newRows[i].path === prevPath) { restored = i; break; }
            }
        }
        if (restored >= 0) {
            view.currentIndex = restored;
            view.positionViewAtIndex(restored, ListView.Contain);
        } else if (view.currentIndex >= newRows.length) {
            view.currentIndex = Math.max(0, newRows.length - 1);
        }

        // Re-compute search matches against the new row list — expand/collapse
        // changes the set of visible rows, so previous indices are now stale.
        if (root.windowState && root.windowState.searchQuery !== "")
            root._computeMatches(true);

        // Same staleness concern for flash: row indices in flashCurrentMatchMap
        // reference the OLD row order, so re-resolve against the new rows.
        // Cache invalidation alone isn't enough — the active session's per-row
        // match map needs to be recomputed against the new index space.
        TreeFlashHandler.invalidateEntryCache();
        if (root.windowState && root.windowState.flashActive)
            TreeFlashHandler.recompute(root, view);
    }

    function _halfPageCount(): int {
        return Math.max(1, Math.floor(view.height / Config.fileManager.sizes.itemHeight / 2));
    }

    // Search — matches against `_rows` (the flattened DFS list), so only
    // currently-visible nodes match. Collapsed subtrees are intentionally
    // out of scope per the v1 spec ("every visible element").
    function _computeMatches(preservePosition: bool): void {
        if (!root.windowState) return;
        const query = root.windowState.searchQuery.toLowerCase();
        if (query === "") {
            root.windowState.matchIndices = [];
            root.windowState.currentMatchIndex = -1;
            return;
        }
        const rows = root._rows;
        const indices = [];
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].name.toLowerCase().indexOf(query) !== -1)
                indices.push(i);
        }
        root.windowState.matchIndices = indices;
        if (indices.length === 0) {
            root.windowState.currentMatchIndex = -1;
        } else if (preservePosition) {
            const prev = view.currentIndex;
            const pos = indices.indexOf(prev);
            root.windowState.currentMatchIndex = pos >= 0 ? pos : 0;
        } else {
            root.windowState.currentMatchIndex = 0;
        }
        // Always jump after recomputing — currentMatchIndexChanged won't fire
        // if the value stays numerically the same (e.g. 0→0) even though
        // matchIndices changed and the target row is different.
        root._jumpToCurrentMatch();
    }

    function _jumpToCurrentMatch(): void {
        if (!root.windowState) return;
        const idx = root.windowState.currentMatchIndex;
        const matches = root.windowState.matchIndices;
        if (idx >= 0 && idx < matches.length) {
            view.currentIndex = matches[idx];
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
        }
    }

    // Flash label rendering — mirrors FileListItem._highlightFlash so the
    // visual is identical across the Miller and Tree views.
    function _htmlEscape(s: string): string {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function _highlightFlash(name: string, query: string, label: string, matchStart: int): string {
        if (matchStart < 0 || query === "" || label === "")
            return root._htmlEscape(name);
        const before = name.substring(0, matchStart);
        const match = name.substring(matchStart, matchStart + query.length);
        const afterMatchStart = matchStart + query.length;
        const replacedEnd = Math.min(afterMatchStart + label.length, name.length);
        const after = name.substring(replacedEnd);
        const querySpan = "<span style=\"background-color: " + FmTheme.palette.secondaryContainer
                        + "; color: " + FmTheme.palette.onSecondaryContainer + ";\">"
                        + root._htmlEscape(match) + "</span>";
        const labelSpan = "<span style=\"background-color: " + FmTheme.palette.primary
                        + "; color: " + FmTheme.palette.onPrimary
                        + "; font-weight: 700; font-family: " + FmTheme.font.family.mono + ";\">"
                        + root._htmlEscape(label) + "</span>";
        return root._htmlEscape(before) + querySpan + labelSpan + root._htmlEscape(after);
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

    Connections {
        target: root.windowState

        function onSearchQueryChanged(): void { root._computeMatches(false); }
        function onCurrentMatchIndexChanged(): void { root._jumpToCurrentMatch(); }
        function onSearchCancelled(): void {
            const safe = Math.min(root._preSearchIndex, Math.max(0, root._rows.length - 1));
            view.currentIndex = safe;
            view.positionViewAtIndex(safe, ListView.Contain);
            Qt.callLater(() => view.forceActiveFocus());
        }
        function onSearchConfirmed(): void {
            Qt.callLater(() => view.forceActiveFocus());
        }

        // Any modal closing returns focus to the view. Required because the
        // popup (a top-level Loader at FileManager scope) sits outside the
        // tree's FocusScope, so closing it leaves focus orphaned — keyboard
        // appears dead until something explicitly reclaims it. Mirrors the
        // same handler in FileList.qml.
        function onActiveModalChanged(): void {
            if (root.windowState.activeModal === root.windowState.modalNone)
                Qt.callLater(() => view.forceActiveFocus());
        }

        // Fuzzy finder picked a file in some directory. The popup emits this
        // signal BEFORE calling navigate(parentPath) so we capture the name
        // first; if the parent is reached via tree retarget, _rebuildRows
        // consumes _pendingFocusName once the children land. The same-dir
        // case (file's parent === current rootPath) bypasses that path because
        // navigate() is a no-op on an unchanged path, so we focus immediately.
        function onFuzzyFinderNavigated(filename: string): void {
            root._pendingFocusName = filename;
            // depth === 0: only direct children of rootPath — the popup always
            // navigates to the file's parent before emitting this signal, so the
            // picked file is guaranteed to be a depth-0 row in the CURRENT tree.
            for (let i = 0; i < root._rows.length; i++) {
                if (root._rows[i].name === filename && root._rows[i].depth === 0) {
                    view.currentIndex = i;
                    view.positionViewAtIndex(i, ListView.Contain);
                    root._pendingFocusName = "";
                    return;
                }
            }
        }
    }

    StyledRect {
        anchors.fill: parent
        color: FmTheme.layer(FmTheme.palette.surfaceContainerLow)
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

            // Flash match for THIS row's index (null if not a match or flash inactive).
            readonly property var _flashMatch: root.windowState && root.windowState.flashActive
                ? root.windowState.flashCurrentMatchMap[delegateRoot.index] : null
            readonly property bool _isFlashMatch: !!_flashMatch

            width: ListView.view ? ListView.view.width : 0
            implicitHeight: Config.fileManager.sizes.itemHeight

            // Search-match tint (rendered beneath the current-item highlight)
            Rectangle {
                anchors.fill: parent
                anchors.leftMargin: FmTheme.padding.sm
                anchors.rightMargin: FmTheme.padding.sm
                radius: FmTheme.rounding.sm
                color: FmTheme.palette.primary
                opacity: root.windowState && root.windowState._matchIndexSet[delegateRoot.index] ? 0.08 : 0
                Behavior on opacity { Anim {} }
            }

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

                // Dim non-matching rows during flash so labels stand out.
                opacity: root.windowState && root.windowState.flashActive && !delegateRoot._isFlashMatch ? 0.25 : 1.0
                Behavior on opacity { Anim {} }

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
                    textFormat: delegateRoot._isFlashMatch ? Text.RichText : Text.PlainText
                    text: {
                        const name = delegateRoot.modelData ? delegateRoot.modelData.name : "";
                        if (delegateRoot._isFlashMatch && root.windowState)
                            return root._highlightFlash(name, root.windowState.flashQuery,
                                                        delegateRoot._flashMatch.label,
                                                        delegateRoot._flashMatch.matchStart);
                        return name;
                    }
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

            // Swallow all keys while a modal is open. The popup is a sibling
            // Loader at FileManager scope, so without this guard a focus race
            // can leave keystrokes hitting the tree ListView instead of the
            // popup's TextInput — search input would stay empty and the
            // popup would appear "broken". Matches FileList.qml's first
            // guard in its Keys.onPressed.
            if (root.windowState && root.windowState.activeModal !== root.windowState.modalNone) {
                event.accepted = true;
                return;
            }

            if (key === Qt.Key_E && (mods & Qt.ControlModifier)) {
                if (root.windowState) root.windowState.toggleViewMode();
                event.accepted = true;
                return;
            }

            // Flash mode captures every key — labels jump, continuations
            // extend the query, Escape/Backspace exit.
            if (root.windowState && root.windowState.flashActive) {
                TreeFlashHandler.handleKey(event, root, view);
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

            case Qt.Key_D:
                if ((mods & Qt.ControlModifier) && view.count > 0) {
                    view.currentIndex = Math.min(view.currentIndex + root._halfPageCount(), view.count - 1);
                    view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                    event.accepted = true;
                }
                break;

            case Qt.Key_U:
                if ((mods & Qt.ControlModifier) && view.count > 0) {
                    view.currentIndex = Math.max(view.currentIndex - root._halfPageCount(), 0);
                    view.positionViewAtIndex(view.currentIndex, ListView.Contain);
                    event.accepted = true;
                }
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

            case Qt.Key_Slash:
                if (root.windowState) {
                    root._preSearchIndex = view.currentIndex;
                    root.windowState.startSearch();
                    event.accepted = true;
                }
                break;

            case Qt.Key_S:
                if (root.windowState) {
                    root._preFlashIndex = view.currentIndex;
                    TreeFlashHandler.invalidateEntryCache();
                    root.windowState.startFlash();
                    event.accepted = true;
                }
                break;

            case Qt.Key_N:
                if (root.windowState && !root.windowState.searchActive && root.windowState.matchIndices.length > 0) {
                    if (mods & Qt.ShiftModifier) root.windowState.previousMatch();
                    else root.windowState.nextMatch();
                    event.accepted = true;
                }
                break;

            case Qt.Key_Period:
                root.respectGitignore = !root.respectGitignore;
                event.accepted = true;
                break;

            case Qt.Key_F:
                if (root.windowState) {
                    root.windowState.requestFuzzyFinder();
                    event.accepted = true;
                }
                break;
            }
        }
    }
}
