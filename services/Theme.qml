pragma Singleton

import Quickshell
import Quickshell.Io
import QtQuick

Singleton {
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
    property QtObject transparency: QtObject {
        property bool enabled: true
        property real base: 0.3
        property real layers: 0.25
    }

    // Simplified layer function matching Symmetria's approach:
    // layer 0 = base transparency (window background)
    // layer 1+ = container transparency (layers value is the target alpha)
    function layer(c: color, depth: int): color {
        if (!transparency.enabled)
            return c;
        return depth === 0
            ? Qt.alpha(c, transparency.base)
            : Qt.alpha(c, transparency.layers);
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

    // === Overlay tokens ===
    property QtObject overlay: QtObject {
        property color subtle: Qt.alpha("#ffffff", 0.06)
        property color emphasis: Qt.alpha("#ffffff", 0.10)
    }

    // === Misc ===
    property bool light: false

    // === Read theme directly from Symmetria config files ===
    // No IPC needed — works even when Symmetria Shell is not running.

    FileView {
        id: colorSchemeView
        path: "file://" + root._configDir + "/color-scheme.json"
        watchChanges: true
        onLoaded: root._applyColorScheme(text())
        onFileChanged: colorSchemeDebounce.restart()
    }

    FileView {
        id: shellConfigView
        path: "file://" + root._configDir + "/shell.json"
        watchChanges: true
        onLoaded: root._applyAppearance(text())
        onFileChanged: appearanceDebounce.restart()
    }

    Timer {
        id: colorSchemeDebounce
        interval: 100
        onTriggered: root._applyColorScheme(colorSchemeView.text())
    }

    Timer {
        id: appearanceDebounce
        interval: 100
        onTriggered: root._applyAppearance(shellConfigView.text())
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
            Logger.warn("Theme", "failed to parse color-scheme.json: " + e);
        }
    }

    // === Apply appearance tokens from shell.json ===
    // Only syncs transparency — layout tokens (rounding, spacing, padding,
    // fonts) are intentionally kept independent because the file manager
    // uses a denser layout than the shell.
    function _applyAppearance(json: string): void {
        try {
            const config = JSON.parse(json);
            const a = config.appearance;
            if (a?.transparency) _applyObject(root.transparency, a.transparency);
        } catch (e) {
            Logger.warn("Theme", "failed to parse shell.json: " + e);
        }
    }

    function _applyObject(target: QtObject, source: var): void {
        for (const [key, value] of Object.entries(source))
            if (target.hasOwnProperty(key))
                target[key] = value;
    }
}
