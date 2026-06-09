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
// Guardrails are intentionally NOT props — they're failure-mode protection, not
// configuration (skip .git, skip huge dirs, cap instantiated models + total
// rows). The values and rationale live in TreeModel.js; each hit emits one
// Logger.info so we can diagnose without exposing knobs.
//
// Out of scope for v1: drag-drop, inline rename/create/delete, multi-select,
// right-click menu, persistent expansion across restarts (the expandedPaths
// prop is reserved for v2).
//
// IMPLEMENTATION NOTE: the expansion state machine lives in TreeModel.js, the
// keyboard dispatcher in TreeKeyHandler.js, the row delegate in FileTreeRow.qml.
// Those JS handlers reach this file's singletons, component ids (view,
// fsModelComponent, gitignoreSvc, ggTimer) and sibling handlers through this
// file's import scope — same mechanism TreeFlashHandler.js uses for FlashLogic.

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
// FlashLogic + TreeFlashHandler are imported here purely so the JS handlers
// (TreeModel.js, TreeKeyHandler.js) can resolve them through this file's scope.
// They are not referenced by this file's QML directly, so qmllint's
// unused-imports check is disabled for these two lines.
import "FlashLogic.js" as FlashLogic // qmllint disable unused-imports
import "handlers/TreeFlashHandler.js" as TreeFlashHandler // qmllint disable unused-imports
import "handlers/TreeModel.js" as TreeModel
import "handlers/TreeKeyHandler.js" as TreeKeyHandler
import "handlers/SearchHandler.js" as SearchHandler
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
    // Ignored when `lazyExpand` is true.
    property int initialExpandDepth: 0

    // Hard cap when `initialExpandDepth: -1`. 8 covers realistic repo nesting;
    // deeper than that the row indentation is unreadable anyway. Exposed as a
    // prop so consumers with deeper projects can tune it.
    property int maxExpandDepth: 8

    // Viewport-driven (lazy) auto-expand. When true, `initialExpandDepth` is
    // ignored: at mount we expand only the root, then walk the row list
    // expanding one un-expanded directory at a time, re-checking after each
    // settle, until the rendered row count covers the viewport (plus an
    // overscroll buffer of `_lazyExpandBufferRows` rows). After mount, when
    // the user scrolls within `_lazyExpandBufferRows` of the rendered
    // content's tail, we expand one more directory; same handler also fires
    // on viewport-height + compactScale changes.
    //
    // Win vs `initialExpandDepth: -1`: the eager cascade instantiates one
    // `FileSystemModel` + `QFileSystemWatcher` per expanded directory — on
    // medium-to-large repos (bambin: ~480 dirs) it cap-trips at the
    // `_autoExpandModelCeiling` of 100 dirs whose visible-row payoff is
    // small (~30 rows fit in the IDE sidebar). Lazy expand follows the
    // user's attention instead of fanning out blindly.
    //
    // Single-shot diagnostic emit per mount logs the count of directories
    // actually expanded so we can tell at a glance whether option 4 is
    // pulling its weight on a given repo.
    property bool lazyExpand: false

    // Optional restore-on-mount expanded-path list. `null` / empty array
    // (default) preserves existing behaviour (lazyExpand or BFS cascade
    // depending on the other props). When set to a non-empty list of absolute
    // path strings, the mount cascade is REPLACED by a depth-driven async chain
    // that expands exactly those paths in ancestor-first order, restoring the
    // tree shape from a previous session. Paths not under `rootPath` are
    // silently skipped (a stale cache pointing at a moved repo must not blow up
    // the mount). Mutually exclusive with `lazyExpand` and `initialExpandDepth`
    // for the duration of THIS mount; afterwards `lazyExpand` re-arms naturally
    // on the next scroll. The replay mechanics — parent-settled dispatch,
    // `_generation` invalidation, the skipped-level rescue, and mount-settle
    // ordering — live in TreeModel.beginMount / advanceRestoreFor.
    property var restoreExpandedPaths: null

    // Optional per-row badge data source. The FM stays git-agnostic — this is
    // a duck-typed extension point. Consumers (e.g. Symmetria-IDE) supply an
    // object with `statusForPath(path) -> {char, color, textColor?, tooltip?,
    // adds?, dels?}` or null, plus a `statusChanged()` signal that fires
    // whenever any path's status changes. Set to null (default) renders no
    // badges and has zero overhead — every status binding short-circuits on
    // the null check. The optional `adds` / `dels` integers, when either is ≥1,
    // render as a small `+N -M` accessory after the badge — used by IDE-side
    // consumers to surface per-file line-change counts inline.
    //
    // The same provider object is intended to answer for both files and
    // directories — directories get aggregate status (e.g. "·" if any
    // descendant has changes), letting the user see active subtrees at a
    // glance without expanding them.
    property var statusProvider: null

    // Optional absolute-path membership map of pre-computed ignored entries.
    // `null` (default) means the FM falls back to its per-directory
    // `git check-ignore --stdin` shell pipeline through `Gitignore.qml`. When
    // set to a `{absPath: true, ...}` map (e.g. the IDE's GitController computing
    // the whole repo in one `git ls-files` pass), the per-directory subprocess
    // spawn is short-circuited entirely — we just consult the map. This is the
    // dominant mount-time win on medium-to-large repos: the Gitignore service
    // serialises one shell process per expanded directory (~30–40ms each), which
    // a single repo-wide git pass replaces. Consulted only during fan-out gating
    // + initial expansion; consumers reassign the prop when their set changes.
    // Compatible with `respectGitignore: true` — when both are set, the map wins.
    property var ignoredPathSet: null

    // Optional absolute-path membership filter. `null` (default) preserves
    // existing behaviour (full tree visible). When set to a JS map of the
    // shape `{absPath: true, ...}`, rows whose `entry.path` is NOT in the
    // map are hidden, AND the auto-expand fan-out skips directories absent
    // from the map. The filter map MUST include rootPath itself, every
    // leaf path the consumer wants visible, AND every ancestor up to
    // rootPath — the FM does NOT compute ancestor closure (keeps the gate
    // O(1) per row). Consumers fold ancestors in at build time.
    //
    // Intentionally NOT git-specific: any consumer wanting to narrow the
    // tree by an arbitrary path set (search results, tag-filtered views,
    // fuzzy-finder previews) reuses the same prop.
    property var pathFilter: null

    // Density multiplier applied to every size in the row delegate (row height,
    // indent, icon dimensions, font sizes, padding, spacing). Default 1.0 is the
    // standalone FM look; an IDE-style high-density sidebar passes ~0.6–0.75 to
    // fit more rows. Single multiplier on purpose — keeps ratios intact (Material
    // 3 "density"); below ~0.5 risks illegible fonts.
    property real compactScale: 1.0

    readonly property int indentPixels: Math.round(16 * compactScale)
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
    // Path-keyed onChange handler functions, used by TreeModel.destroyModel to
    // disconnect entriesChanged/loadingChanged before destroying a
    // FileSystemModel. Keyed on path (not stashed on the model object) because
    // Bound-mode strict properties reject dynamic JS props on C++ QObjects —
    // full rationale at the stash site in TreeModel.expand.
    property var _modelHandlers: ({})
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

    // Auto-expand guardrails (failure-mode protection) — the constant values and
    // their rationale live in TreeModel.js (FANOUT_CAP / MODEL_CEILING /
    // NODE_CEILING / SKIP_NAMES / LAZY_BUFFER_ROWS), next to the fan-out logic
    // that enforces them. The mutable per-mount state below stays here because
    // it is reset on every mount and read by the pathFilter re-arm handler.

    // True between the initial _expand(rootPath) and the last pending model
    // settling. Gates the recursive fan-out so manual expansion after mount
    // doesn't trigger further auto-expansion.
    property bool _autoExpandActive: false
    // Independent gate for the lazyExpand cycle. Mutually exclusive with
    // `_autoExpandActive` per mount: lazyExpand bypasses the BFS fan-out
    // entirely and walks `_rows` instead. Set true at mount AND on scroll-
    // driven re-trigger; cleared in `_advanceLazyExpand` when the viewport
    // is filled or no more un-expanded dirs remain.
    property bool _lazyExpandActive: false
    // Count of dirs the lazyExpand cycle has expanded since mount started —
    // diagnostic, dumped once in the `tree mount settled` line so we can
    // tell at a glance how aggressively viewport-fill ran on a given repo.
    property int _lazyExpandCount: 0

    // Restore-cycle state (mutually exclusive with _autoExpandActive and
    // _lazyExpandActive per mount).
    // Queue of paths still waiting to be expanded during a restore cycle.
    // Populated from `restoreExpandedPaths` at mount time; drained as
    // parent models settle (see `_advanceRestoreFor` in the _expand finish
    // callback).
    property var _restorePending: []
    // True between the restore-start and the moment `_restorePending` drains.
    property bool _restoreActive: false

    // True between rootPath assignment and the first time _pending drains to
    // empty. Independent of _autoExpandActive so the terminal "tree mount
    // settled" Logger emission still fires when a guardrail tripped early (the
    // ceiling flips _autoExpandActive false before the last model resolves).
    property bool _mountInFlight: false
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
    property bool _autoExpandModelCeilingLogged: false

    // Monotonic counter incremented when statusProvider.statusChanged() fires.
    // Each row delegate's badge binding reads this as a fake dependency, so
    // bumping it triggers re-evaluation of every visible row's status lookup
    // in a single pass — no per-delegate Connections object required.
    property int _statusVersion: 0

    signal fileActivated(string path)
    signal directoryChanged(string path)
    signal showHiddenToggleRequested()
    // Emitted after every user-driven mutation of `_expanded` so an outer
    // consumer can persist the set. Carries the full current path list (not a
    // delta) — the consumer just saves the whole thing atomically. Suppressed
    // during the restore cycle and the initial mount cascade (see the
    // _restoreActive / _mountInFlight rationale in TreeModel.emitExpandedState)
    // so consumers don't receive partial-set saves.
    signal expandedStateChanged(var paths)

    // Public focus-routing surface. Delegates `forceActiveFocus()` to the
    // internal `view` ListView, which is the item that actually owns the
    // `Keys.onPressed` handler (j/k/h/l/Ctrl+D/Ctrl+U/Return/...). The
    // FileTreeView's outer root is a plain Item, NOT a FocusScope, so
    // calling `forceActiveFocus()` on it from a consumer only makes the
    // outer Item the activeFocusItem — keystrokes never reach the
    // ListView and the nav keys appear dead.
    //
    // Consumers (e.g. the IDE's `onFocusTreeRequested` slot, and the
    // Active Changes panel's `focusInternal()` proxy) call this instead
    // of walking descendants by hand. Symmetric across all FileTreeView
    // instances — a consumer holding any FileTreeView reference can hand
    // it focus without needing to know about the internal `view` id.
    function focusInternal(): void {
        view.forceActiveFocus();
    }

    implicitWidth: 280
    // Honest height: report the visible content's actual height so
    // layouts that don't `fillHeight` can grow this component to its
    // natural size. Adding `FmTheme.padding.sm * 2` to account for the
    // ListView's symmetric `anchors.margins: FmTheme.padding.sm`. Consumers that DO `fillHeight: true`
    // (the standalone FM, the main FileTreeView in symmetria-ide) are
    // unaffected — Layouts override implicit height when fillHeight is
    // set. The path-filtered IDE consumer (Active Changes panel) sets
    // no fillHeight and relies on this to size to its changeset rather
    // than scrolling internally.
    implicitHeight: view.contentHeight + FmTheme.padding.sm * 2

    onRootPathChanged: {
        TreeModel.resetTreeState(root);
        if (rootPath !== "") {
            // The auto-expand priority ladder (restoreExpandedPaths >
            // lazyExpand > initialExpandDepth) and the async kickoff live in
            // TreeModel.beginMount — see its docstring for why depth must be
            // computed before the first _expand.
            TreeModel.beginMount(root);
            root.directoryChanged(rootPath);
        }
    }

    onShowHiddenChanged: TreeModel.refreshAllExpanded(root)

    onRespectGitignoreChanged: {
        gitignoreSvc.clear();
        TreeModel.refreshAllExpanded(root);
    }

    // pathFilter changes are expected to be frequent (e.g. a git-status
    // watcher emitting a new filter map every time the working tree
    // changes). Two-pass rebuild: (1) refresh visible rows against the
    // new set — cheap, only touches what's already expanded; (2) if
    // auto-expand is configured AND we still have a filter, re-arm the
    // cascade against every settled model so newly-arrived in-set paths
    // under unexplored dirs become reachable. The existing
    // _autoExpandModelCeiling + _autoExpandFanoutCap still bound the
    // worst case, so a pathological filter can't blow up I/O.
    //
    // We do NOT touch _expanded / _models / _pending — paths already
    // expanded stay expanded; paths the user manually collapsed stay
    // collapsed; in-flight expansions race to completion. Each is the
    // correct behaviour individually.
    onPathFilterChanged: {
        TreeModel.rebuildRows(root);
        // NOTE: the lazyExpand path is intentionally NOT re-armed here — no
        // current consumer combines lazyExpand:true with pathFilter. If one
        // does, add a TreeModel.kickLazyExpand(root) call after rebuildRows().
        if (initialExpandDepth !== 0 && pathFilter) {
            root._autoExpandActive = true;
            root._autoExpandCeilingLogged = false;
            root._autoExpandFanoutLogged = false;
            root._autoExpandModelCeilingLogged = false;
            for (const parent in root._models) {
                const taken = root._autoExpandPending[parent] !== undefined
                    ? root._autoExpandPending[parent]
                    : 0;
                TreeModel.autoExpandChildrenOf(root, parent, taken);
            }
            if (Object.keys(root._pending).length === 0) {
                root._autoExpandActive = false;
            }
        }
    }

    // compactScale changes the row pixel height, which moves the visible
    // bottom row in `_shouldExpandMore`. Re-evaluate after the change.
    onCompactScaleChanged: TreeModel.kickLazyExpand(root)

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

        function onSearchQueryChanged(): void { TreeModel.computeMatches(root, false); }
        function onCurrentMatchIndexChanged(): void { SearchHandler.jumpToCurrentMatch(root, view); }
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

    // Lazy-expand re-arm bridge. When the user scrolls or the viewport
    // height changes (window resize, panel toggle), the visible-bottom row
    // moves and the "rows beyond" budget may go negative — `_kickLazyExpand`
    // gates on that and expands one more directory if so. Connected to the
    // ListView's signals rather than autobinding on a property so we don't
    // pay the eval cost on every contentY tick when lazyExpand is off
    // (the function short-circuits on `lazyExpand: false` regardless).
    Connections {
        target: view
        function onContentYChanged(): void { TreeModel.kickLazyExpand(root); }
        function onHeightChanged(): void { TreeModel.kickLazyExpand(root); }
    }

    // Status-provider live-update bridge. Target null (no provider attached)
    // is fine — Connections silently ignores it. When the provider signals
    // statusChanged(), bumping _statusVersion invalidates every visible row's
    // badge binding in one pass.
    Connections {
        target: root.statusProvider
        ignoreUnknownSignals: true
        function onStatusChanged(): void {
            root._statusVersion = root._statusVersion + 1;
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
            // Explicit overflow gate. `AsNeeded` controls when the thumb
            // is shown, but a custom contentItem with a constant
            // opacity (0.4 below) renders independently — so the track
            // would paint as a faint 6px gutter even when the
            // flickable has no overflow. Gating the entire ScrollBar's
            // visibility on real overflow makes the gutter disappear
            // for content-fit consumers (e.g. the IDE's Active Changes
            // pane, whose enclosing FileTreeView sizes to its content
            // via the root `implicitHeight: view.contentHeight + …`).
            // 0.5px epsilon absorbs subpixel rounding from
            // compactScale row-height multiplications.
            visible: view.contentHeight > view.height + 0.5
            contentItem: Rectangle {
                implicitWidth: 6
                radius: width / 2
                color: FmTheme.palette.onSurfaceVariant
                opacity: 0.4
            }
        }

        delegate: FileTreeRow {
            windowState: root.windowState
            compactScale: root.compactScale
            indentPixels: root.indentPixels
            statusProvider: root.statusProvider
            statusVersion: root._statusVersion
            // Single-click already set view.currentIndex to this row (the
            // StateLayer in FileTreeRow), so activating the current row is the
            // same row that was double-clicked — mirrors FileList.qml.
            onActivated: TreeModel.activate(root, root.currentRow)
        }

        Keys.onPressed: function(event) {
            TreeKeyHandler.handleKey(event, root, view);
        }
    }
}
