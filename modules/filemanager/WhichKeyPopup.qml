import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState

    readonly property var _binds: {
        if (!windowState) return [];

        // Bookmark delete sub-mode: show only user-defined bookmarks
        if (windowState.bookmarkSubMode === "delete") {
            const bms = BookmarkService.bookmarks;
            return Object.entries(bms).map(([key, bm]) => ({
                key: key, label: bm.label, icon: BookmarkService.iconForPath(bm.path), isUser: true
            })).sort((a, b) => a.key.localeCompare(b.key));
        }

        // Bookmark create sub-mode: show no binds (just the prompt header)
        if (windowState.bookmarkSubMode === "create")
            return [];

        // Normal chord mode
        const prefix = windowState.activeChordPrefix;
        if (prefix === "")
            return [];
        const bindings = windowState.chordBindings;
        return bindings.hasOwnProperty(prefix) ? bindings[prefix].binds : [];
    }

    visible: opacity > 0
    opacity: windowState && (windowState.chordActive || windowState.bookmarkSubModeActive) ? 1 : 0

    Behavior on opacity {
        Anim {}
    }

    // Matte pill background
    Rectangle {
        anchors.fill: parent
        radius: Theme.rounding.sm
        color: Theme.pillMedium.background
        border.color: Theme.pillMedium.border
        border.width: 1
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.padding.md
        spacing: Theme.spacing.sm

        // Header: prefix key badge + group label
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spacing.sm

            Rectangle {
                width: root.windowState && root.windowState.bookmarkSubModeActive ? 32 : 22
                height: 22
                radius: 6
                color: Qt.alpha(Theme.palette.m3primary, 0.18)

                StyledText {
                    anchors.centerIn: parent
                    text: {
                        if (!root.windowState) return "";
                        if (root.windowState.bookmarkSubMode === "create") return "gn";
                        if (root.windowState.bookmarkSubMode === "delete") return "gx";
                        return root.windowState.activeChordPrefix;
                    }
                    color: Theme.palette.m3primary
                    font.family: Theme.font.family.mono
                    font.pointSize: Theme.font.size.sm
                    font.weight: Font.Bold
                }
            }

            StyledText {
                text: {
                    if (!root.windowState) return "";
                    if (root.windowState.bookmarkSubMode === "create")
                        return "assign letter for " + Paths.shortenHome(root.windowState.currentPath);
                    if (root.windowState.bookmarkSubMode === "delete")
                        return "delete bookmark";
                    const prefix = root.windowState.activeChordPrefix;
                    if (prefix === "") return "";
                    const bindings = root.windowState.chordBindings;
                    return bindings.hasOwnProperty(prefix) ? bindings[prefix].label : "";
                }
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.sm
                font.weight: Font.Medium
            }
        }

        // Thin separator
        Rectangle {
            Layout.fillWidth: true
            height: 1
            color: Theme.overlay.subtle
        }

        // Binding rows
        Repeater {
            model: root._binds

            // Separator or keybind row — chosen by visibility, no Loader needed
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 0

                // Thin separator (only for separator entries)
                Rectangle {
                    Layout.fillWidth: true
                    height: 1
                    visible: modelData.isSeparator === true
                    color: Theme.overlay.subtle
                }

                // Keybind row (hidden for separator entries)
                RowLayout {
                    Layout.fillWidth: true
                    visible: modelData.isSeparator !== true
                    spacing: Theme.spacing.sm

                    // Keycap badge — user bookmarks get a primary tint
                    Rectangle {
                        width: 22
                        height: 22
                        radius: 6
                        color: modelData.isUser ? Qt.alpha(Theme.palette.m3primary, 0.15)
                                                : Qt.alpha("#ffffff", 0.06)
                        border.color: modelData.isUser ? Qt.alpha(Theme.palette.m3primary, 0.30)
                                                       : Theme.overlay.emphasis
                        border.width: 1

                        StyledText {
                            anchors.centerIn: parent
                            text: modelData.key ?? ""
                            color: modelData.isUser ? Theme.palette.m3primary
                                                    : Theme.palette.m3onSurface
                            font.family: Theme.font.family.mono
                            font.pointSize: Theme.font.size.xs
                            font.weight: Font.DemiBold
                        }
                    }

                    // Icon
                    MaterialIcon {
                        text: modelData.icon ?? ""
                        color: modelData.isAction ? Qt.alpha(Theme.palette.m3onSurfaceVariant, 0.6)
                                                  : Theme.palette.m3onSurfaceVariant
                        font.pointSize: Theme.font.size.md
                    }

                    // Label
                    StyledText {
                        text: modelData.label ?? ""
                        color: modelData.isAction ? Qt.alpha(Theme.palette.m3onSurface, 0.6)
                                                  : Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.sm
                    }
                }
            }
        }

        // Push bindings to top
        Item {
            Layout.fillHeight: true
        }
    }
}
