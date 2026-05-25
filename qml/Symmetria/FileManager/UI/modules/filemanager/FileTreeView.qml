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
//   - cascade-wide model ceiling 100 (stops fan-out once that many directories
//     are auto-expanded — the real cost driver is FileSystemModel +
//     QFileSystemWatcher per dir, not visible row count, so this caps I/O on
//     trees like $HOME where most subdirs are individually under the 200 cap)
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
    // depending on the other props). When set to a non-empty list of
    // absolute path strings, the mount cascade is REPLACED by a
    // depth-driven async chain that expands exactly those paths in
    // ancestor-first order, restoring the tree shape from a previous
    // session.
    //
    // Restore semantics:
    // - Paths not under `rootPath` are silently skipped (defensive: a
    //   stale cache pointing at a moved repo shouldn't blow up the mount).
    // - Each path is expanded only after its PARENT's model has settled
    //   (the existing `_expand` finish callback is the dispatch site).
    //   This is structurally required: a path's entry doesn't exist as
    //   a row until its parent is expanded, so naive synchronous
    //   replay would silently drop deep paths.
    // - `_expand(rootPath)` always runs first (the root's own entry
    //   doesn't depend on anything; subsequent paths chain off its
    //   finish).
    // - The restore cycle is mutually exclusive with `lazyExpand` and
    //   `initialExpandDepth` cascades for the duration of THIS mount.
    //   After the restore drains, `lazyExpand` re-arms naturally on
    //   the next scroll-driven viewport check (since `_lazyExpandActive`
    //   only gates the initial cascade, not user-driven expansion).
    // - `_generation` invalidates in-flight restore steps the same way
    //   it invalidates in-flight model creations — if rootPath changes
    //   mid-restore, the stale finish callbacks see a bumped generation
    //   and bail out, preventing cross-project leakage of expand calls.
    //
    // Restoring works against the same async machinery as user-driven
    // expansion; it does NOT call `_expand` synchronously in a loop.
    // The viewport-fill / mount-settled emit ordering is preserved
    // because the existing `_pendingEmpty` check below fires when the
    // last restore expansion lands.
    property var restoreExpandedPaths: null

    // Internal: queue of paths still waiting to be expanded during a
    // restore cycle. Populated from `restoreExpandedPaths` at mount
    // time; drained as parent models settle (see `_advanceRestoreFor`
    // in the `_expand` finish callback).
    property var _restorePending: []
    // True between the restore-start and the moment `_restorePending`
    // drains. Mutually exclusive with `_lazyExpandActive` and
    // `_autoExpandActive` for the lifetime of one mount.
    property bool _restoreActive: false

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
    // `git check-ignore --stdin` shell pipeline through `Gitignore.qml`.
    // When set to a `{absPath: true, ...}` map (e.g. produced by the IDE's
    // GitController in a single `git ls-files --others --ignored
    // --exclude-standard --directory` pass per scan), the per-directory
    // subprocess spawn is short-circuited entirely — we just consult the
    // map for each candidate. This is the dominant mount-time win for
    // medium-to-large repos: the Gitignore service serialises one shell
    // process per expanded directory, which on a 100-dir BFS cascade is
    // ~3–4 seconds of pure subprocess overhead, while the entire repo can
    // be enumerated by git in one ~7ms shot.
    //
    // The map is consulted only during fan-out gating + initial expansion;
    // there is no separate emit / signal hooked in here, so consumers
    // recompute and reassign the prop whenever their underlying set
    // changes. Compatible with `respectGitignore: true` — when both this
    // prop is set AND respectGitignore is true, the map wins.
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

    // Density multiplier applied to every size in the row delegate
    // (row height, indent, icon dimensions, font point sizes, leading
    // padding, inter-element spacing). Default 1.0 preserves the
    // standalone FM look; consumers wanting an IDE-style high-density
    // sidebar can pass values like 0.6–0.75 to fit more rows per
    // viewport. Single multiplier on purpose — keeps ratios intact so
    // small values still look proportionate (Material 3 "density"
    // pattern). Goes below ~0.5 risk illegible fonts; use judgement.
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
    // Path-keyed onChange handler functions, used by `_destroyModel` to
    // disconnect entriesChanged/loadingChanged before destroying a
    // FileSystemModel. Cannot live as a dynamic JS property on the model
    // itself (`m._scheduleOnChange = fn`) because `pragma ComponentBehavior:
    // Bound` puts QML in strict-property mode, which rejects assignment to
    // non-declared properties on C++ QObject types — the assignment emits a
    // QML warning and silently no-ops, leaving disconnect impossible. The
    // path key is stable because `m.path` matches `_models[path]`'s key,
    // and there is exactly one model per path (gotcha-grade: orphan races
    // are caught by the identity check inside the finish callback).
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

    // Auto-expand guardrails (failure-mode protection, NOT configuration).
    // Hidden behind the prop so callers can't accidentally raise them and
    // re-discover the failure modes the defaults protect against. Each
    // triggers a one-shot Logger.info on hit (not a warn — they're expected
    // outcomes on big trees, not bugs) so we can diagnose without UI feedback.
    readonly property int _autoExpandFanoutCap: 200
    // Cascade-wide cap on how many directories the auto-expand pass is allowed
    // to instantiate models for. Counted across _models (settled) + _pending
    // (in-flight) so a burst of synchronous _expand() calls within one fan-out
    // round is accounted for at the next round's gate, preventing overshoot.
    // 100 covers realistic project trees (typical: 30–50 dirs at depth 8) with
    // 2–3x headroom; stops $HOME-class trees cold within the first fan-out
    // round (where one level already exceeds the cap).
    readonly property int _autoExpandModelCeiling: 100
    readonly property int _autoExpandNodeCeiling: 10000
    readonly property var _autoExpandSkipNames: ({ ".git": true })

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
    // Overscroll headroom in row units. 8 rows is enough to hide a single
    // momentum-scroll flick worth of extension without re-triggering the
    // cycle mid-frame. Higher values trade more eager expansion at mount
    // for less work during scroll; lower values keep mount tighter but
    // make scroll-driven extension visible to the user.
    readonly property int _lazyExpandBufferRows: 8
    // Count of dirs the lazyExpand cycle has expanded since mount started —
    // diagnostic, dumped once in the `tree mount settled` line so we can
    // tell at a glance how aggressively viewport-fill ran on a given repo.
    property int _lazyExpandCount: 0
    // True between rootPath assignment and the first time _pending drains to
    // empty. Independent of _autoExpandActive so the terminal "tree mount
    // settled" Logger emission still fires when the model ceiling or fan-out
    // cap tripped early (in those cases _autoExpandActive flips to false
    // BEFORE the last in-flight model resolves, which suppressed the original
    // "auto-expand complete" emit and left the mount unobservable).
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
    // Emitted after every user-driven mutation of `_expanded` so an
    // outer consumer can persist the set. Carries the full current
    // path list (not a delta) — keeps the consumer's contract trivial
    // (just save the whole thing atomically). The restore cycle
    // deliberately SUPPRESSES this emit while `_restoreActive` is
    // true: a restore is replaying what the cache already holds, so
    // re-emitting would (a) churn the consumer's atomic-write path N
    // times for no information gain, and (b) risk a save-with-incomplete-set
    // race during the brief window where some paths have been replayed
    // but later ones in the queue haven't. The first post-restore
    // user toggle is what triggers the save of the now-canonical set.
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
        _resetTreeState();
        if (rootPath !== "") {
            // Compute the effective auto-expand depth BEFORE _expand() so the
            // rootPath's onChange callback can see _autoExpandActive on its
            // first emission. Order is critical: _expand() registers an async
            // entriesChanged handler that reads these flags when entries land.
            //
            // Priority ladder for this mount:
            //   1. restoreExpandedPaths (non-empty)  -> replay saved set
            //   2. lazyExpand                        -> viewport-driven cascade
            //   3. initialExpandDepth                -> BFS fan-out
            //
            // Each is mutually exclusive for the lifetime of one mount.
            // Restore is highest priority because it's the ONLY one that
            // reflects user intent from a prior session; the other two
            // are heuristic cascades for first-time / no-cache mounts.
            // Duck-typed check: a Python `list` arrives via PySide6 as a
            // QVariantList, which QML exposes as array-like (has `length`
            // and integer indexing) but does NOT pass `Array.isArray()`
            // — that returns false for QVariantList in Qt 6.11. Use the
            // weaker `cache != null` + `length > 0` form so both a true
            // JS Array and a QVariantList satisfy the gate.
            const cache = root.restoreExpandedPaths;
            const hasCache = cache != null && cache.length > 0;
            if (hasCache) {
                _autoExpandTargetDepth = 0;
                _autoExpandActive = false;
                _lazyExpandActive = false;
                _restoreActive = true;
                // Build the restore queue: filter to paths under rootPath
                // (skipping rootPath itself — it's expanded unconditionally
                // below) and sort shortest-first so each path's parent is
                // always expanded before the path itself reaches the front
                // of the queue.
                const prefix = rootPath === "/" ? "/" : rootPath + "/";
                const queue = [];
                for (let i = 0; i < cache.length; i++) {
                    const p = cache[i];
                    if (typeof p !== "string") continue;
                    if (p === rootPath) continue;
                    if (!p.startsWith(prefix)) continue;
                    queue.push(p);
                }
                queue.sort(function (a, b) { return a.length - b.length; });
                _restorePending = queue;
            } else if (lazyExpand) {
                _autoExpandTargetDepth = 0;
                _autoExpandActive = false;
                _lazyExpandActive = true;
            } else {
                const target = initialExpandDepth === -1
                    ? maxExpandDepth
                    : initialExpandDepth;
                _autoExpandTargetDepth = Math.max(0, target);
                _autoExpandActive = _autoExpandTargetDepth > 0;
            }
            _mountInFlight = true;
            _autoExpandCeilingLogged = false;
            _autoExpandFanoutLogged = false;
            _autoExpandModelCeilingLogged = false;
            _expand(rootPath);
            root.directoryChanged(rootPath);
        }
    }

    onShowHiddenChanged: _refreshAllExpanded()

    onRespectGitignoreChanged: {
        gitignoreSvc.clear();
        _refreshAllExpanded();
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
        _rebuildRows();
        // NOTE: the lazyExpand path is intentionally NOT re-armed here.
        // No current consumer combines lazyExpand:true with pathFilter — the
        // IDE's Active Changes panel uses pathFilter with initialExpandDepth:-1
        // (BFS path), and the main FileTreeView uses lazyExpand:true with no
        // pathFilter. If a future consumer combines both, add a
        // _kickLazyExpand() call here after _rebuildRows() so newly-visible
        // rows trigger a viewport-fill cycle.
        if (initialExpandDepth !== 0 && pathFilter) {
            _autoExpandActive = true;
            _autoExpandCeilingLogged = false;
            _autoExpandFanoutLogged = false;
            _autoExpandModelCeilingLogged = false;
            for (const parent in _models) {
                const taken = _autoExpandPending[parent] !== undefined
                    ? _autoExpandPending[parent]
                    : 0;
                _autoExpandChildrenOf(parent, taken);
            }
            if (Object.keys(_pending).length === 0) {
                _autoExpandActive = false;
            }
        }
    }

    // Disconnect onChange signal handlers before destroy to prevent a
    // deferred Qt.callLater invocation from accessing a destroyed C++ object.
    // Must be called instead of m.destroy() at every destroy site.
    //
    // The `path` arg is OPTIONAL — pass it for any model registered in
    // `_models`, since the entry in `_modelHandlers[path]` holds the
    // function we connected and we need it to disconnect cleanly. Pass
    // empty string (or omit) for orphan models that never made it into
    // `_models` — there's no handler entry to look up (the registered
    // model owns the map slot for that path), and Qt's destructor will
    // cascade-disconnect the orphan's signals anyway.
    //
    // REGRESSION NOTE: do NOT add a default value to the typed `path`
    // parameter (e.g. `path: string = ""`). Qt's QML grammar in 6.11
    // rejects default values on typed parameters with `Type annotations
    // are not supported (yet)`, which cascades to "Type FileTreeView
    // unavailable" and silently breaks every consumer of this component.
    // The empty-path branch below is reached when callers omit the arg
    // (JS passes `undefined`, the `path && path !== ""` guard treats it
    // as falsy and skips the disconnect). A 2026-05-23 review attempted
    // to add `= ""` for "type strictness" — that change ships green in
    // tests (which don't QQmlEngine.load) but fails at engine load in
    // the live IDE. Verified by running the IDE against the source-tree
    // FM and watching Main.qml fail to load.
    function _destroyModel(m: var, path: string): void {
        if (!m) return;
        if (path && path !== "") {
            const handler = root._modelHandlers[path];
            if (handler) {
                m.entriesChanged.disconnect(handler);
                m.loadingChanged.disconnect(handler);
                const cleared = Object.assign({}, root._modelHandlers);
                delete cleared[path];
                root._modelHandlers = cleared;
            }
        }
        if (m.destroy) m.destroy();
    }

    function _isHidden(name: string): bool {
        return name.length > 0 && name.charAt(0) === ".";
    }

    function _resetTreeState(): void {
        _generation++;
        const models = _models;
        for (const key in models) {
            const m = models[key];
            _destroyModel(m, key);
        }
        _models = ({});
        _modelHandlers = ({});
        _expanded = ({});
        _ignored = ({});
        _pending = ({});
        _autoExpandPending = ({});
        _mountInFlight = false;
        _lazyExpandActive = false;
        _lazyExpandCount = 0;
        _restoreActive = false;
        _restorePending = [];
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
                _emitExpandedState();
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
        // Single per-scan handler. Connected to BOTH `loadingChanged` and
        // `entriesChanged` via a `Qt.callLater` deferral:
        //   - `entriesChanged` fires when applyChanges() actually inserts /
        //     removes rows (non-empty scans, watcher-driven updates).
        //   - `loadingChanged` (the false transition) is the ONLY signal we
        //     get for EMPTY directory scans — applyChanges() does nothing
        //     when there are no adds and no removes, so `entriesChanged`
        //     never fires there. Without this second connection, empty
        //     directories leak their entry in `_pending` forever, blocking
        //     the BFS auto-expand from ever signalling completion.
        // Deferral rationale: the C++ FileSystemModel emits loadingChanged
        // BEFORE calling applyChanges() inside the same futureWatcher
        // ::finished handler, which means m.entries is still EMPTY at the
        // moment loadingChanged fires for a non-empty scan. Running the
        // finish path synchronously here would see no candidates, skip
        // fan-out, and settle the mount at 0 rows. `Qt.callLater` queues
        // onChange for the next event-loop tick, by which time the
        // synchronous applyChanges() (and any cascaded entriesChanged
        // emit) has completed and m.entries is populated. callLater also
        // COALESCES duplicate scheduling, so when both loadingChanged and
        // entriesChanged fire in the same tick (the normal non-empty
        // path), onChange runs exactly once.
        const onChange = function() {
            if (gen !== root._generation) return;
            // Skip the "loading just started" emission of loadingChanged.
            // We only act on the loading→false transition, which is when
            // the scan has settled and m.entries reflects the post-scan
            // state.
            if (m.loading) return;
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
                    root._destroyModel(m);
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
                root._emitExpandedState();

                // Expansion cycle drive — mutually exclusive: restore
                // queue, lazyExpand walker, or BFS fan-out. Each path
                // synchronously adds to `_pending` if it wants to keep
                // going, so the pendingEmpty check below sees the
                // post-recursion state correctly. Manual user toggles
                // after all three flags clear don't trigger further
                // recursion, preserving the user's expansion choices for
                // the rest of the session.
                if (root._restoreActive) {
                    root._advanceRestoreFor(path);
                } else if (root._lazyExpandActive) {
                    root._advanceLazyExpand();
                } else if (root._autoExpandActive) {
                    const expansionsTaken = root._autoExpandPending[path] !== undefined
                        ? root._autoExpandPending[path]
                        : 0;  // rootPath itself — implicit zero
                    const clearedPending = Object.assign({}, root._autoExpandPending);
                    delete clearedPending[path];
                    root._autoExpandPending = clearedPending;
                    root._autoExpandChildrenOf(path, expansionsTaken);
                }
                // Check pending once, after expansion-cycle drive — used by
                // the active-flag flips and the mount-settled emit below.
                const pendingEmpty = Object.keys(root._pending).length === 0;
                if (root._autoExpandActive && pendingEmpty) {
                    root._autoExpandActive = false;
                }
                // _lazyExpandActive normally clears inside _advanceLazyExpand
                // (when viewport is full or no more un-expanded dirs remain).
                // The pendingEmpty fallback handles a hypothetical race where
                // the flag's still true at this point but no new _expand was
                // queued — guarantees we never settle mount-in-flight without
                // also clearing the lazy gate.
                if (root._lazyExpandActive && pendingEmpty) {
                    root._lazyExpandActive = false;
                }
                // `_restoreActive` clears inside `_advanceRestoreFor` once
                // the queue drains. The pendingEmpty fallback mirrors the
                // lazyExpand one: if the queue is empty but the flag's
                // still set (e.g. all remaining queue paths were not
                // children of any settled model and got requeued
                // unsuccessfully), force-clear so the mount can settle.
                if (root._restoreActive && pendingEmpty) {
                    root._restoreActive = false;
                    root._restorePending = [];
                }

                // Terminal "tree mount settled" emit — fires on the first
                // pending-drained-to-empty transition after rootPath change,
                // regardless of whether auto-expand finished naturally, hit
                // the model ceiling, or was disabled (initialExpandDepth: 0).
                // Single deterministic ground-truth marker for "the tree is
                // now interactive"; consumers (incl. bench/measure_mount.py)
                // grep for this. Gated by _mountInFlight so subsequent
                // user-driven _expand cycles don't re-emit it.
                if (root._mountInFlight && pendingEmpty) {
                    root._mountInFlight = false;
                    const lazySuffix = root.lazyExpand
                        ? " (lazy: " + root._lazyExpandCount + " dirs)"
                        : "";
                    Logger.info(
                        "FileTreeView",
                        "tree mount settled: " + root._rows.length + " rows visible" + lazySuffix
                    );
                }
            };
            // Short-circuit: when the consumer supplies a precomputed
            // ignored-path map, do an O(n) membership filter against it
            // instead of spawning `git check-ignore --stdin` per dir
            // through gitignoreSvc. See `ignoredPathSet` prop docstring
            // for the rationale (the per-dir subprocess queue dominates
            // mount time on big repos by ~30–40ms per directory). When
            // the prop is null we fall back to the original gitignoreSvc
            // path so the standalone FM (which has no IDE-side
            // GitController) keeps working unchanged.
            if (root.ignoredPathSet && root.respectGitignore) {
                const dirIgnored = ({});
                for (let i = 0; i < candidates.length; i++) {
                    const c = candidates[i];
                    if (root.ignoredPathSet[c]) dirIgnored[c] = true;
                }
                finish(dirIgnored);
            } else if (root.respectGitignore && candidates.length > 0)
                gitignoreSvc.filter(path, candidates, finish);
            else
                finish({});
        };
        const scheduleOnChange = () => Qt.callLater(onChange);
        // Stash the handler in the path-keyed map (NOT on `m` — QML's
        // strict-property mode under `pragma ComponentBehavior: Bound`
        // silently rejects `m._scheduleOnChange = fn` assignments to
        // C++ QObject types like FileSystemModel; the warning emits to
        // the Qt log but the assignment no-ops, leaving disconnect
        // unable to find the function. Storing keyed on `path` works
        // because there is exactly one model per path at any time.
        const newHandlers = Object.assign({}, root._modelHandlers);
        newHandlers[path] = scheduleOnChange;
        root._modelHandlers = newHandlers;
        m.entriesChanged.connect(scheduleOnChange);
        m.loadingChanged.connect(scheduleOnChange);
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
        _destroyModel(cur, path);
        delete newModels[path];
        for (const key in _models) {
            if (key !== path && key.startsWith(prefix)) {
                const cm = newModels[key];
                _destroyModel(cm, key);
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
        _emitExpandedState();
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
        if (r !== "") {
            // Re-arm auto-expand state (same logic as onRootPathChanged) so
            // Shift-R respects initialExpandDepth / lazyExpand. Without this,
            // _refreshAll() would leave _autoExpandActive=false from the
            // previous mount and the tree would always reload collapsed.
            if (lazyExpand) {
                _autoExpandTargetDepth = 0;
                _autoExpandActive = false;
                _lazyExpandActive = true;
            } else {
                const target = initialExpandDepth === -1 ? maxExpandDepth : initialExpandDepth;
                _autoExpandTargetDepth = Math.max(0, target);
                _autoExpandActive = _autoExpandTargetDepth > 0;
            }
            _mountInFlight = true;
            _autoExpandCeilingLogged = false;
            _autoExpandFanoutLogged = false;
            _autoExpandModelCeilingLogged = false;
            _expand(r);
        }
    }

    // Auto-expand fan-out — invoked from the async _expand finish callback
    // for each directory whose entries just landed. `parentExpansions` is the
    // number of fan-out rounds taken from rootPath to reach `parentPath`;
    // rootPath itself = 0, its direct children = 1, etc.
    //
    // We stop recursion if any of these guardrails fire:
    //   1. _autoExpandActive went false (BFS settled or rootPath changed)
    //   2. parentExpansions >= _autoExpandTargetDepth (budget exhausted)
    //   3. models + pending >= _autoExpandModelCeiling (cascade-wide cap on
    //      directories instantiated — flips _autoExpandActive false to halt
    //      pending in-flight expansions from fanning out further)
    //   4. _rows.length >= _autoExpandNodeCeiling (last-resort backstop)
    //   5. The parent has > _autoExpandFanoutCap children (predictive skip
    //      — saves the I/O cost of expanding hundreds of siblings the user
    //      can't reasonably scan visually)
    function _autoExpandChildrenOf(parentPath: string, parentExpansions: int): void {
        if (!_autoExpandActive) return;
        if (parentExpansions >= _autoExpandTargetDepth) return;
        const modelCount = Object.keys(_models).length + Object.keys(_pending).length;
        if (modelCount >= _autoExpandModelCeiling) {
            if (!_autoExpandModelCeilingLogged) {
                Logger.info(
                    "FileTreeView",
                    "auto-expand: model ceiling reached (" + _autoExpandModelCeiling
                    + " directories instantiated), halting cascade"
                );
                _autoExpandModelCeilingLogged = true;
            }
            _autoExpandActive = false;
            return;
        }
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
            // pathFilter gate: skip dirs that aren't in the consumer's
            // membership set. This is the load-bearing perf win — a
            // changeset across 4 subtrees instantiates 4 FileSystemModel
            // + QFileSystemWatcher pairs, not the dozens a full
            // recursive expansion would otherwise spawn. The leaf-row
            // filter in _rebuildRows is the secondary gate.
            if (pathFilter && !pathFilter[e.path]) continue;
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

    // Lazy-expand cycle driver. Called from the _expand finish callback
    // when _lazyExpandActive is true. Synchronously decides whether to
    // expand one more directory: if the rendered row count is short of
    // the viewport (plus overscroll buffer) AND there's an un-expanded
    // directory in `_rows`, calls _expand on it. That `_expand` adds to
    // `_pending` synchronously, so the finish-callback's pendingEmpty
    // check sees we're still working and skips the mount-settle. When
    // viewport is full OR no more candidates remain, clears
    // _lazyExpandActive so the next pendingEmpty cycle settles the mount.
    //
    // Cycle re-arm from scroll/resize/density events comes through
    // `_kickLazyExpand` below — keep the two entry points distinct so
    // recursive re-entry can't loop on an already-active cycle.
    function _advanceLazyExpand(): void {
        if (!root._shouldExpandMore()) {
            root._lazyExpandActive = false;
            return;
        }
        const next = root._findNextUnExpandedDir();
        if (next === "") {
            root._lazyExpandActive = false;
            return;
        }
        root._lazyExpandCount = root._lazyExpandCount + 1;
        root._expand(next);
    }

    // Emit `expandedStateChanged` with the current `_expanded` keys as
    // a sorted list. Suppressed during a restore cycle to avoid churning
    // the consumer's save path while we're replaying their own saved
    // set back at them — see the signal docstring for the full rationale.
    // The sort keeps the emitted list stable across consumers that
    // diff it for change detection.
    function _emitExpandedState(): void {
        if (root._restoreActive) return;
        const keys = Object.keys(root._expanded);
        keys.sort();
        root.expandedStateChanged(keys);
    }

    // Restore-cycle advance: called from the `_expand` finish callback
    // whenever a model has just settled at `expandedPath`. Walks
    // `_restorePending` and dispatches `_expand` for every queued path
    // whose parent is exactly `expandedPath`. The "exact parent" check
    // matters: queue is sorted shortest-first, so all direct children
    // of a just-settled parent are clustered contiguously. We pop them
    // off in one pass, leaving deeper descendants in the queue until
    // their own parents settle.
    //
    // Termination: when the queue drains, clear `_restoreActive` so the
    // mount-settled emit in the `_expand` finish callback fires on the
    // next pendingEmpty cycle. If `expandedPath` has no matching
    // children in the queue (e.g. the saved set skipped over a level),
    // this is a no-op — the queue might still have entries whose
    // parents haven't been visited yet, in which case the eventual
    // pendingEmpty fallback in the finish callback clears the active
    // flag and force-empties the queue.
    function _advanceRestoreFor(expandedPath: string): void {
        if (!root._restoreActive) return;
        const queue = root._restorePending;
        if (!queue || queue.length === 0) {
            root._restoreActive = false;
            return;
        }
        const prefix = expandedPath === "/" ? "/" : expandedPath + "/";
        const remaining = [];
        const toExpand = [];
        for (let i = 0; i < queue.length; i++) {
            const p = queue[i];
            // Direct-child check: starts with parent's path-prefix AND
            // has no further `/` after that prefix (i.e. one level deeper).
            if (p.startsWith(prefix)) {
                const tail = p.substring(prefix.length);
                if (tail.length > 0 && tail.indexOf("/") < 0) {
                    toExpand.push(p);
                    continue;
                }
            }
            remaining.push(p);
        }
        root._restorePending = remaining;
        if (remaining.length === 0 && toExpand.length === 0) {
            root._restoreActive = false;
            return;
        }
        for (let i = 0; i < toExpand.length; i++) {
            root._expand(toExpand[i]);
        }
    }

    // External re-arm: called when the user scrolls, the viewport resizes,
    // or compactScale changes. No-op when:
    //   - lazyExpand isn't enabled,
    //   - a cycle is already in flight (_lazyExpandActive flag),
    //   - the initial mount is still draining its pending queue,
    //   - or there's other expansion work in flight from manual user toggles.
    // The order of guards matters: cheapest checks first so the typical
    // mid-scroll path (cycle already active OR plenty of buffer) bails
    // before we touch row-height math.
    function _kickLazyExpand(): void {
        if (!root.lazyExpand) return;
        if (root._lazyExpandActive) return;
        if (root._mountInFlight) return;
        if (Object.keys(root._pending).length > 0) return;
        if (!root._shouldExpandMore()) return;
        root._lazyExpandActive = true;
        root._advanceLazyExpand();
    }

    // Returns true when the rendered tree has fewer rows below the visible
    // viewport bottom than _lazyExpandBufferRows. Synchronous on `_rows`
    // length + cached row height — does NOT depend on `view.contentHeight`,
    // which lags `_rows` mutations by a layout cycle.
    function _shouldExpandMore(): bool {
        if (Object.keys(root._pending).length > 0) return false;
        const rowHeight = Config.fileManager.sizes.itemHeight * root.compactScale;
        if (rowHeight <= 0) return false;
        const visibleBottomRow = Math.ceil((view.contentY + view.height) / rowHeight);
        const rowsBeyond = root._rows.length - visibleBottomRow;
        return rowsBeyond < root._lazyExpandBufferRows;
    }

    // First-in-row-order un-expanded directory. We mirror the same skip
    // filters as `_autoExpandChildrenOf` — .git etc. — even though most of
    // them are also enforced by the FileSystemModel + _rebuildRows pipeline.
    // Belt-and-suspenders here is cheap and keeps the lazy path's behaviour
    // identical to the BFS path's when ambiguous.
    function _findNextUnExpandedDir(): string {
        const rows = root._rows;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!r.isDir) continue;
            if (r.expanded) continue;
            if (root._autoExpandSkipNames[r.name]) continue;
            // Hidden + ignored entries are already absent from `_rows` (they
            // get filtered in _rebuildRows), so no explicit check needed.
            return r.path;
        }
        return "";
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
                // pathFilter gate (leaf-row): hide entries not in the
                // consumer's set. Pairs with the same gate in
                // _autoExpandChildrenOf — this one catches mixed dirs
                // (some children in-set, some out-of-set) once they're
                // already expanded.
                if (root.pathFilter && !root.pathFilter[e.path]) continue;
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

    // Lazy-expand re-arm bridge. When the user scrolls or the viewport
    // height changes (window resize, panel toggle), the visible-bottom row
    // moves and the "rows beyond" budget may go negative — `_kickLazyExpand`
    // gates on that and expands one more directory if so. Connected to the
    // ListView's signals rather than autobinding on a property so we don't
    // pay the eval cost on every contentY tick when lazyExpand is off
    // (the function short-circuits on `lazyExpand: false` regardless).
    Connections {
        target: view
        function onContentYChanged(): void { root._kickLazyExpand(); }
        function onHeightChanged(): void { root._kickLazyExpand(); }
    }

    // compactScale changes the row pixel height, which moves the visible
    // bottom row in `_shouldExpandMore`. Re-evaluate after the change.
    onCompactScaleChanged: _kickLazyExpand()

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
            implicitHeight: Config.fileManager.sizes.itemHeight * root.compactScale

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
                    x: index * root.indentPixels + FmTheme.padding.lg * root.compactScale
                    color: FmTheme.palette.outlineVariant
                    opacity: 0.4
                }
            }

            Row {
                x: delegateRoot.rowDepth * root.indentPixels + FmTheme.padding.lg * root.compactScale
                anchors.verticalCenter: parent.verticalCenter
                spacing: FmTheme.spacing.md * root.compactScale

                // Dim non-matching rows during flash so labels stand out.
                opacity: root.windowState && root.windowState.flashActive && !delegateRoot._isFlashMatch ? 0.25 : 1.0
                Behavior on opacity { Anim {} }

                MaterialIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: delegateRoot.rowIsDir
                    text: delegateRoot.rowExpanded ? "expand_more" : "chevron_right"
                    color: FmTheme.palette.onSurfaceVariant
                    font.pointSize: FmTheme.font.size.md * root.compactScale
                }
                Item {
                    visible: !delegateRoot.rowIsDir
                    width: FmTheme.font.size.md * root.compactScale
                    height: 1
                }
                FileIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    width: FmTheme.font.size.xl * 1.5 * root.compactScale
                    height: FmTheme.font.size.xl * 1.5 * root.compactScale
                    materialPointSize: FmTheme.font.size.xl * root.compactScale
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
                    font.pointSize: FmTheme.font.size.md * root.compactScale
                }
                Loader {
                    id: statusBadgeLoader
                    anchors.verticalCenter: parent.verticalCenter
                    // Read _statusVersion to register the binding dependency —
                    // bumping the counter (via Connections.onStatusChanged) forces
                    // a re-query of the provider here. The void expression keeps
                    // the dependency live without affecting the returned value.
                    readonly property var _badge: {
                        const _tick = root._statusVersion;
                        void _tick;
                        if (!root.statusProvider) return null;
                        if (!delegateRoot.modelData) return null;
                        try {
                            return root.statusProvider.statusForPath(delegateRoot.modelData.path);
                        } catch (e) {
                            // Provider threw — degrade gracefully, no badge.
                            return null;
                        }
                    }
                    active: _badge !== null
                    sourceComponent: GitStatusBadge {
                        status: statusBadgeLoader._badge
                    }
                }
                // Optional inline `+adds -dels` accessory. Reads from the
                // SAME `_badge` object the badge Loader already computed
                // — no second `statusForPath` call. Active only when the
                // provider supplied at least one non-zero count, so the
                // standalone FM (whose provider doesn't set these
                // fields) renders nothing here at zero cost.
                Loader {
                    id: deltaLoader
                    anchors.verticalCenter: parent.verticalCenter
                    // Cache the badge snapshot on the Loader itself so the
                    // sourceComponent's bindings read a stable local property
                    // rather than traversing back to statusBadgeLoader._badge
                    // on every evaluation. This also eliminates the null-race
                    // window where active flips to true but _badge transitions
                    // to null before the inner bindings evaluate — the
                    // sourceComponent reads _delta which holds the snapshot
                    // captured at the same time active was computed.
                    readonly property var _delta: statusBadgeLoader._badge
                    active: _delta !== null && _delta !== undefined
                        && ((_delta.adds || 0) > 0
                            || (_delta.dels || 0) > 0)
                    sourceComponent: Row {
                        spacing: FmTheme.spacing.sm * root.compactScale
                        StyledText {
                            visible: (deltaLoader._delta ? deltaLoader._delta.adds : 0) > 0
                            text: "+" + (deltaLoader._delta ? deltaLoader._delta.adds : 0)
                            color: FmTheme.gitStatus.addsGreen
                            font.pointSize: FmTheme.font.size.sm * root.compactScale
                        }
                        StyledText {
                            visible: (deltaLoader._delta ? deltaLoader._delta.dels : 0) > 0
                            text: "-" + (deltaLoader._delta ? deltaLoader._delta.dels : 0)
                            color: FmTheme.gitStatus.delsRed
                            font.pointSize: FmTheme.font.size.sm * root.compactScale
                        }
                    }
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
                } else if ((mods & Qt.ShiftModifier) && root.windowState) {
                    // Shift+D — navigate history forward (mirrors the PathBar forward button)
                    root.windowState.forward();
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
                    if (mods & Qt.ShiftModifier) {
                        // Shift+S — navigate history back (mirrors the PathBar back button)
                        root.windowState.back();
                    } else {
                        root._preFlashIndex = view.currentIndex;
                        TreeFlashHandler.invalidateEntryCache();
                        root.windowState.startFlash();
                    }
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
