pragma Singleton

import Quickshell
import Quickshell.Io
import QtQuick

Singleton {
    id: root

    // === Symmetria integration state ===
    property bool _pendingRequery: false
    readonly property string _configDir: Paths.home + "/.config/quickshell/symmetria/config"

    // === M3 Palette (defaults from Symmetria M3Palette; overwritten by IPC) ===
    property QtObject palette: QtObject {
        property color m3background: "#191114"
        property color m3surface: "#191114"
        property color m3surfaceContainerLowest: "#130c0e"
        property color m3surfaceContainerLow: "#22191c"
        property color m3surfaceContainer: "#261d20"
        property color m3surfaceContainerHigh: "#31282a"
        property color m3surfaceContainerHighest: "#3c3235"
        property color m3onSurface: "#efdfe2"
        property color m3onSurfaceVariant: "#d5c2c6"
        property color m3primary: "#ffb0ca"
        property color m3onPrimary: "#541d34"
        property color m3outline: "#9e8c91"
        property color m3outlineVariant: "#514347"
        property color m3secondary: "#e2bdc7"
        property color m3secondaryContainer: "#5a3f48"
        property color m3onSecondaryContainer: "#ffd9e3"
        property color m3error: "#ffb4ab"
        property color m3shadow: "#000000"
    }

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
    readonly property var pillMedium: _mattePill(palette.m3surfaceContainerHigh, matte.medium)
    readonly property var pillStrong: _mattePill(palette.m3surfaceContainerHigh, matte.strong)

    // === Misc ===
    property bool light: false

    // === Symmetria IPC: query theme on startup and on changes ===
    Process {
        id: themeQuery
        command: ["qs", "-c", "symmetria", "ipc", "call", "theme", "getTheme"]
        stdout: StdioCollector {
            onStreamFinished: root._applyTheme(text)
        }
        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0) {
                console.warn("Theme: Symmetria IPC unavailable, using defaults");
            }
            if (root._pendingRequery) {
                root._pendingRequery = false;
                themeQuery.running = true;
            }
        }
    }

    // file:// + absolute path = file:///path (triple-slash is correct per RFC 3986)
    // This FileView triggers the initial IPC query via onLoaded; the shell.json
    // watcher below only monitors for changes (appearance tokens update less often)
    FileView {
        path: "file://" + root._configDir + "/color-scheme.json"
        watchChanges: true
        onFileChanged: queryDebounce.restart()
        onLoaded: themeQuery.running = true
    }

    FileView {
        path: "file://" + root._configDir + "/shell.json"
        watchChanges: true
        onFileChanged: queryDebounce.restart()
    }

    Timer {
        id: queryDebounce
        interval: 100
        onTriggered: {
            if (themeQuery.running)
                root._pendingRequery = true;
            else
                themeQuery.running = true;
        }
    }

    // === Apply theme data from IPC JSON response ===
    function _applyTheme(json: string): void {
        try {
            const t = JSON.parse(json);
            root.light = t.meta.light;

            // Apply palette colors — only set properties that exist locally
            for (const [key, value] of Object.entries(t.palette))
                if (root.palette.hasOwnProperty(key))
                    root.palette[key] = value;

            // Apply appearance tokens
            const a = t.appearance;
            if (a?.rounding) _applyObject(root.rounding, a.rounding);
            if (a?.spacing) _applyObject(root.spacing, a.spacing);
            if (a?.padding) _applyObject(root.padding, a.padding);
            if (a?.font?.family) _applyObject(root.font.family, a.font.family);
            if (a?.font?.size) _applyObject(root.font.size, a.font.size);
            if (a?.anim?.duration !== undefined) root.animDuration = a.anim.duration;
            if (a?.anim?.curves?.standard) root.animCurveStandard = a.anim.curves.standard;
            if (a?.anim?.curves?.standardDecel) root.animCurveStandardDecel = a.anim.curves.standardDecel;
            if (a?.transparency) _applyObject(root.transparency, a.transparency);
        } catch (e) {
            console.warn("Theme: failed to parse IPC response:", e);
        }
    }

    function _applyObject(target: QtObject, source: var): void {
        for (const [key, value] of Object.entries(source))
            if (target.hasOwnProperty(key))
                target[key] = value;
    }
}
