pragma Singleton

import Quickshell
import QtQuick

Singleton {
    id: root

    // === M3 Dark Palette (from Symmetria M3Palette defaults) ===
    readonly property QtObject palette: QtObject {
        readonly property color m3background: "#191114"
        readonly property color m3surface: "#191114"
        readonly property color m3surfaceContainerLowest: "#130c0e"
        readonly property color m3surfaceContainerLow: "#22191c"
        readonly property color m3surfaceContainer: "#261d20"
        readonly property color m3surfaceContainerHigh: "#31282a"
        readonly property color m3surfaceContainerHighest: "#3c3235"
        readonly property color m3onSurface: "#efdfe2"
        readonly property color m3onSurfaceVariant: "#d5c2c6"
        readonly property color m3primary: "#ffb0ca"
        readonly property color m3onPrimary: "#541d34"
        readonly property color m3outline: "#9e8c91"
        readonly property color m3outlineVariant: "#514347"
        readonly property color m3secondary: "#e2bdc7"
        readonly property color m3secondaryContainer: "#5a3f48"
        readonly property color m3onSecondaryContainer: "#ffd9e3"
        readonly property color m3error: "#ffb4ab"
        readonly property color m3shadow: "#000000"
    }

    // In Symmetria, tPalette applies transparency. Standalone has no transparency.
    readonly property alias tPalette: root.palette

    // === Typography ===
    readonly property QtObject font: QtObject {
        readonly property QtObject family: QtObject {
            readonly property string sans: "Rubik"
            readonly property string mono: "CaskaydiaCove NF"
            readonly property string material: "Material Symbols Rounded"
        }
        readonly property QtObject size: QtObject {
            readonly property int small: 11
            readonly property int smaller: 12
            readonly property int normal: 13
            readonly property int larger: 15
            readonly property int large: 18
            readonly property int extraLarge: 28
        }
    }

    // === Layout tokens ===
    readonly property QtObject rounding: QtObject {
        readonly property int small: 12
        readonly property int full: 1000
    }

    readonly property QtObject spacing: QtObject {
        readonly property int small: 7
        readonly property int normal: 12
    }

    readonly property QtObject padding: QtObject {
        readonly property int small: 5
        readonly property int normal: 10
        readonly property int large: 15
    }

    // === Animation tokens ===
    readonly property int animDuration: 400
    readonly property list<real> animCurveStandard: [0.2, 0, 0, 1, 1, 1]
    readonly property list<real> animCurveStandardAccel: [0.3, 0, 1, 1, 1, 1]
    readonly property list<real> animCurveStandardDecel: [0, 0, 0, 1, 1, 1]

    // === Misc ===
    readonly property bool light: false
}
