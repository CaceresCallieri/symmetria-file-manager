pragma Singleton

import Symmetria.FileManager.Models
import QtQuick

QtObject {
    id: root

    // === Symmetria config directory ===
    readonly property string _configDir: Paths.home + "/.config/quickshell/symmetria/config"

    // === Palette (defaults: warm-neutral monochrome; overwritten from color-scheme.json) ===
    // Stored as a plain JS object (not QtObject) because QML reserves
    // identifiers starting with "on" + uppercase for signal handlers,
    // which would clash with M3 names like onSurface, onPrimary, etc.
    // Use immutable reassignment (root.palette = {...}) to trigger bindings.
    property var palette: ({
        surface: "#1a1818",
        surfaceContainerLowest: "#141212",
        surfaceContainerLow: "#1c1a1a",
        surfaceContainer: "#262424",
        surfaceContainerHigh: "#302e2e",
        onSurface: "#eee5da",
        onSurfaceVariant: "#c8c4bc",
        primary: "#c8c4bc",
        onPrimary: "#333130",
        primaryContainer: "#887f74",
        onPrimaryContainer: "#eee5da",
        outline: "#8a8580",
        outlineVariant: "#484442",
        secondaryContainer: "#585350",
        onSecondaryContainer: "#c8c4bc",
        surfaceVariant: "#484442",
        error: "#ffb4ab",
        shadow: "#000000"
    })

    // === Typography ===
    property QtObject font: QtObject {
        property QtObject family: QtObject {
            property string sans: "Rubik"
            property string mono: "CaskaydiaCove NF"
            property string material: "Material Symbols Rounded"
        }
        property QtObject size: QtObject {
            property real xs: 8
            property real sm: 9
            property real md: 10
            property real lg: 11
            property real xl: 12
            property real xxl: 18
        }
    }

    // === Layout tokens ===
    property QtObject rounding: QtObject {
        property int sm: 6
        property int lg: 16
        property int full: 1000
    }

    property QtObject spacing: QtObject {
        property real sm: 3
        property real md: 6
        property real lg: 10
    }

    property QtObject padding: QtObject {
        property real sm: 2
        property real md: 4
        property real lg: 7
    }

    // === Animation tokens ===
    property int animDuration: 400
    property list<real> animCurveStandard: [0.2, 0, 0, 1, 1, 1]
    property list<real> animCurveStandardDecel: [0, 0, 0, 1, 1, 1]

    // === Transparency ===
    // Solid-body model (macOS-Tahoe / GNOME-Files style): the Miller columns are
    // SOLID rounded surfaces (built in MillerColumns.qml), so transparency
    // survives only in the CHROME — the empty areas of the top/bottom bars around
    // the clay pills and the gaps between cards, where the window backdrop shows
    // through. The backdrop is pure black at 0.6 alpha — identical to Ghostty's
    // `background = #000000` + `background-opacity = 0.6`
    // (~/.config/ghostty/config) — so the FM's transparent regions and the
    // terminal look the same wallpaper-darkness side by side. The solid column
    // surfaces sit opaque on top; only the chrome and gaps reveal this backdrop.
    //
    // _transparencyLayers stays 0.0: the panels' internal backgrounds
    // (ParentPanel / FileList / PreviewPanel each call
    // FmTheme.layer(surfaceContainerLow)) remain fully transparent and let the
    // MillerColumns surface behind them show. Do NOT raise it to tint panels —
    // the solid fill is owned by the column surfaces, and a layer tint would
    // compound with the backdrop in the chrome gaps. See CLAUDE.md
    // "Transparency model" for the full rationale.
    //
    // Decoupled from shell.json — Symmetria Shell's transparency is governed
    // by its own logic and should not propagate here.
    readonly property color windowBackdrop: Qt.rgba(0, 0, 0, 0.6)
    readonly property real _transparencyLayers: 0.0

    // Returns `c` tinted with the panel-layer alpha (currently 0.0 = fully
    // transparent passthrough). The window backdrop is served by
    // `windowBackdrop` directly, so this function is only for panel surfaces.
    function layer(c: color): color {
        return Qt.alpha(c, root._transparencyLayers);
    }

    // === Matte pill effect ===
    // Opaque dark charcoal background with subtle white edge — ported from Symmetria

    // Intensity presets (0 = deep black, 1 = slightly lighter charcoal)
    readonly property QtObject matte: QtObject {
        readonly property real medium: 0.5
        readonly property real strong: 0.7
    }

    function _mattePill(baseColor: color, intensity: real): var {
        const clampedIntensity = Math.max(0, Math.min(1, intensity));
        const lightness = 0.10 + clampedIntensity * 0.08;

        const background = Qt.hsla(
            baseColor.hslHue,
            baseColor.hslSaturation * 0.12,
            lightness,
            1.0
        );
        const border = Qt.alpha("#ffffff", 0.12);

        return { background: background, border: border };
    }

    // Precomputed matte styles for current consumers
    readonly property var pillMedium: _mattePill(palette.surfaceContainerHigh, matte.medium)
    readonly property var pillStrong: _mattePill(palette.surfaceContainerHigh, matte.strong)

    // === Fixed indicator colors ===
    // Hardcoded deliberately: palette tokens change with wallpaper-derived
    // color schemes, so indicators must stay fixed to remain visually
    // distinguishable.
    property QtObject indicator: QtObject {
        property color cut: "#e57373"
        property color yank: "#4caf7d"
        property color selection: "#f0c674"
    }

    // === Git status badge colors ===
    // Named palette consumed by GitStatusBadge. Intentionally NOT palette-derived
    // for the same reason as `indicator`: badge semantics must be stable across
    // wallpaper changes — a learned colour convention shouldn't shift because the
    // desktop tint changed.
    //
    // OPERATION-based grammar (NOT index-state): colour encodes the KIND of change
    // (added / modified / deleted / renamed / …), keyed on the porcelain status
    // CHAR by the statusProvider, NOT whether the change is staged. This matches
    // VS Code / GitHub and — the reason for the 2026-06-27 switch from the old
    // staged-green/unstaged-red scheme — keeps modified (amber) visually distinct
    // from deleted (red), which the index-state scheme collapsed into one red. The
    // staged/unstaged axis, when it matters, is carried by a separate surface (the
    // IDE's Active Changes summary groups by side via dot icons, not badge colour).
    //
    // The FM does NOT decide which badge corresponds to which color — that's the
    // statusProvider's job (IDE: Main.qml `_colorForOperation`; FM standalone:
    // FuzzyFinderInfoPanel `_gitStatusObj` — both key on the char and resolve to
    // these slots, so the two surfaces render git status identically). The FM just
    // exposes named slots so providers avoid inventing hex literals.
    property QtObject gitStatus: QtObject {
        property color addedGreen: "#98c379"        // added (A) — new tracked content
        property color modifiedAmber: "#e0a93a"     // modified (M/T) — golden amber; deeper/warmer
                                                    // than One-Dark's pale yellow (#e5c07b) so it
                                                    // reads clearly as "amber" and stays distinct
                                                    // from renamedOrange and the neutral fallback.
        property color deletedRed: "#e06c75"        // deleted (D) — removed content
        property color untrackedBlue: "#61afef"     // untracked (?) — not tracked yet
        property color renamedOrange: "#d19a66"     // renamed/copied (R/C) — moved content
        property color conflictedMagenta: "#c678dd" // conflicted (U) — merge conflicts
        property color ignoredGray: "#5c6370"       // ignored (!) — rarely rendered
        property color badgeText: "#1a1818"         // text on saturated background
        // Inline line-delta text colors. Distinct from staged/unstaged
        // badge fills (which are saturated for use as backgrounds) —
        // these are slightly muted so they read cleanly as TEXT on the
        // surface background. Used by FileTreeView's row delegate when
        // statusProvider returns {adds, dels} on the status object.
        property color addsGreen: "#7eb777"        // line-additions ('+N')
        property color delsRed:   "#d76060"        // line-deletions ('-N')
    }

    // === Overlay tokens ===
    property QtObject overlay: QtObject {
        property color subtle: Qt.alpha("#ffffff", 0.06)
        property color emphasis: Qt.alpha("#ffffff", 0.10)
    }

    // === Misc ===
    property bool light: false

    // === Read theme directly from Symmetria config files ===
    // No IPC needed — works even when Symmetria Shell is not running.

    // QtObject has no default property — children declared as named properties.
    property FileWatcher _colorSchemeView: FileWatcher {
        id: colorSchemeView
        path: root._configDir + "/color-scheme.json"
        watchChanges: true
        onLoadedChanged: if (loaded) root._applyColorScheme(text)
        onFileChanged: colorSchemeDebounce.restart()
    }

    property Timer _colorSchemeDebounce: Timer {
        id: colorSchemeDebounce
        interval: 100
        onTriggered: root._applyColorScheme(colorSchemeView.text)
    }

    // === Apply palette from color-scheme.json ===
    // The JSON stores colors without "#" prefix (e.g., "surface": "1a1818").
    // Uses immutable reassignment to trigger QML bindings on the var palette.
    function _applyColorScheme(json: string): void {
        try {
            const scheme = JSON.parse(json);
            root.light = scheme.mode === "light";

            if (!scheme.colours) return;
            const colours = scheme.colours;
            const updated = Object.assign({}, root.palette);
            for (const [key, value] of Object.entries(colours))
                if (key in updated)
                    updated[key] = "#" + value;
            root.palette = updated;
        } catch (e) {
            Logger.warn("FmTheme", "failed to parse color-scheme.json: " + e);
        }
    }

}
