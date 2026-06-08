pragma ComponentBehavior: Bound

import Symmetria.FileManager.UI
import QtQuick
import QtQuick.Effects

// CLAYMORPHISM pill primitive — ported from Symmetria Shell's PillSurface so
// the file manager and the shell share one visual language ("clay" pills are
// everywhere in the shell's top bar). Use it wherever a matte capsule surface
// is wanted: the path breadcrumb, the status bar, the active tab.
//
// The recipe (what makes the "claymorphism" look):
//   - Two opposing OUTER shadows — dark SE + light NW — produce a convex,
//     extruded "raised chip" feel. Slightly asymmetric offsets (y > x on the
//     dark shadow) read as an overhead light source.
//   - A hairline 1px border — crisp edge definition that survives a busy /
//     transparent backdrop where the shadows alone would wash out.
//   - A top rim highlight (inner gradient) — the "polished, lit-from-above"
//     warmth that distinguishes clay from a flat matte rect.
//
// The matte FILL + border come from FmTheme.pillMedium, which is already a
// line-for-line port of the shell's mattePill() — so the only thing this
// component adds over the FM's previous inline StyledRect pills is the DEPTH
// (the two shadows + the rim highlight). Defaults match the FM's prior inline
// pills, so existing call sites can swap StyledRect -> PillSurface unchanged.
//
// Two usage patterns (same as the shell):
//   1. Content-inside — children declared inside PillSurface { ... } reparent
//      into the body and paint above the rim highlight:
//        PillSurface { RowLayout { anchors.fill: parent; ... } }
//   2. Background-only — give it no children and let siblings paint on top
//      (PillSurface declared first so it renders behind).
//
// Shadow infra is Qt6-native RectangularShadow (QtQuick.Effects) — no Qt5Compat
// GraphicalEffects, no custom shaders. Available since Qt 6.9 (CI floor).
//
// To retune the aesthetic for ALL pills at once, edit the property defaults
// here; consumers that override a property (e.g. TabBar driving the shadow
// alphas off the active state) keep working because the public API is stable.

Item {
    id: root

    // --- Fill --------------------------------------------------------------
    property color color: FmTheme.pillMedium.background
    property real radius: FmTheme.rounding.full

    // --- Border ------------------------------------------------------------
    // Flat props (not a `border` group) so consumers can bind/animate them
    // directly, matching the shell's PillSurface API.
    property color borderColor: FmTheme.pillMedium.border
    property real borderWidth: 1

    // Master on/off for the clay DEPTH (both shadows + the rim highlight).
    // The matte fill + border stay regardless. Lets a consumer present a flat
    // matte pill (e.g. an inactive tab) and raise it into full claymorphism on
    // a state change, without re-stating the per-shadow alpha constants.
    property bool elevated: true

    // --- Two-shadow convex depth (claymorphic) -----------------------------
    property real darkShadowOffsetX: 2
    property real darkShadowOffsetY: 3
    property real darkShadowBlur: 12
    property real darkShadowAlpha: 0.40

    property real lightShadowOffsetX: -2
    property real lightShadowOffsetY: -2
    property real lightShadowBlur: 8
    property real lightShadowAlpha: 0.10

    // --- Inner rim highlight (clay-derived) --------------------------------
    // Visible top rim by default; the bottom inner shadow stays off (heavy
    // bottom-inner shadow makes clay feel dated). Consumers wanting the full
    // "embedded panel" feel can raise innerShadowAlpha.
    property real highlightAlpha: 0.08
    property real innerShadowAlpha: 0.0

    // Default slot: children reparent into the body and clip-free overlay the
    // rim highlight (declared after it, so they paint on top).
    default property alias content: contentHolder.data

    // Dark shadow (bottom-right) — declared FIRST so it renders furthest back
    // (paint order is declaration order for items without explicit z).
    RectangularShadow {
        anchors.fill: pillBody
        radius: pillBody.radius
        blur: root.darkShadowBlur
        spread: 0
        offset.x: root.darkShadowOffsetX
        offset.y: root.darkShadowOffsetY
        color: Qt.rgba(0, 0, 0, root.elevated ? root.darkShadowAlpha : 0)

        Behavior on color {
            CAnim {}
        }
    }

    // Light shadow (top-left).
    RectangularShadow {
        anchors.fill: pillBody
        radius: pillBody.radius
        blur: root.lightShadowBlur
        spread: 0
        offset.x: root.lightShadowOffsetX
        offset.y: root.lightShadowOffsetY
        color: Qt.rgba(1, 1, 1, root.elevated ? root.lightShadowAlpha : 0)

        Behavior on color {
            CAnim {}
        }
    }

    StyledRect {
        id: pillBody

        anchors.fill: parent
        color: root.color
        radius: root.radius
        border.width: root.borderWidth
        border.color: root.borderColor

        // StyledRect already animates `color` via internal CAnim; add the
        // matching behavior for the border so active-state transitions ease.
        Behavior on border.color {
            CAnim {}
        }

        // Inner rim/contact gradient — top rim highlight by default; bottom
        // band off (innerShadowAlpha: 0). Always instantiated so per-instance
        // alpha changes take effect without a Loader.
        Rectangle {
            anchors.fill: parent
            radius: pillBody.radius
            color: "transparent"
            visible: root.elevated && (root.highlightAlpha > 0 || root.innerShadowAlpha > 0)

            gradient: Gradient {
                GradientStop { position: 0.00; color: Qt.rgba(1, 1, 1, root.highlightAlpha) }
                GradientStop { position: 0.45; color: Qt.rgba(1, 1, 1, 0.00) }
                GradientStop { position: 0.55; color: Qt.rgba(0, 0, 0, 0.00) }
                GradientStop { position: 1.00; color: Qt.rgba(0, 0, 0, root.innerShadowAlpha) }
            }
        }

        // Consumer content slot. anchors.fill so children naturally use
        // anchors.fill / anchors.centerIn against the pill bounds.
        Item {
            id: contentHolder
            anchors.fill: parent
        }
    }
}
