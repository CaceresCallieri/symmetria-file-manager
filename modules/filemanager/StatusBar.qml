import "../../components"
import "../../services"
import "../../config"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState
    required property int fileCount
    required property var currentEntry

    implicitHeight: inner.implicitHeight + Theme.padding.sm * 4

    // Matte pill container with fully rounded corners
    StyledRect {
        id: pill

        anchors.fill: parent
        anchors.topMargin: Theme.padding.sm
        anchors.bottomMargin: Theme.padding.sm
        anchors.leftMargin: Theme.padding.md
        anchors.rightMargin: Theme.padding.md
        radius: Theme.rounding.full
        color: Theme.pillMedium.background
        border.color: Theme.pillMedium.border
        border.width: 1

        RowLayout {
            id: inner

            anchors.fill: parent
            anchors.leftMargin: Theme.padding.lg
            anchors.rightMargin: Theme.padding.lg
            anchors.topMargin: Theme.padding.sm
            anchors.bottomMargin: Theme.padding.sm

            spacing: Theme.spacing.md

            // Left: Accept button (picker mode) or file count (normal mode)
            // — hidden during search in both modes
            StyledRect {
                id: acceptBtn
                visible: FileManagerService.pickerMode && !(root.windowState && root.windowState.searchActive)
                color: _acceptEnabled ? Theme.palette.m3primary : Theme.palette.m3surfaceVariant
                radius: Theme.rounding.full
                implicitWidth: acceptLabel.implicitWidth + Theme.padding.lg * 2
                implicitHeight: acceptLabel.implicitHeight + Theme.padding.xs * 2

                readonly property bool _acceptEnabled: {
                    if (FileManagerService.pickerSaveMode)
                        return true;  // In save mode, always enabled (saves to current dir)
                    if (root.currentEntry === null)
                        return false;
                    if (FileManagerService.pickerDirectory)
                        return root.currentEntry.isDir;
                    return !root.currentEntry.isDir;
                }

                StyledText {
                    id: acceptLabel
                    anchors.centerIn: parent
                    text: FileManagerService.pickerAcceptLabel || (FileManagerService.pickerSaveMode ? "Save" : "Select")
                    color: acceptBtn._acceptEnabled ? Theme.palette.m3onPrimary : Theme.palette.m3onSurfaceVariant
                    font.pointSize: Theme.font.size.xs
                    font.weight: Font.Medium
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: acceptBtn._acceptEnabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: {
                        if (!acceptBtn._acceptEnabled)
                            return;
                        if (FileManagerService.pickerSaveMode) {
                            // Save mode: return current directory path
                            FileManagerService.completePickerMode([root.windowState.currentPath]);
                        } else if (root.currentEntry) {
                            FileManagerService.completePickerMode([root.currentEntry.path]);
                        }
                    }
                }

                Behavior on color { CAnim {} }
            }

            StyledText {
                visible: !(root.windowState && root.windowState.searchActive) && !FileManagerService.pickerMode
                text: root.fileCount + (root.fileCount === 1 ? " item" : " items")
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
            }

            Item {
                visible: !(root.windowState && root.windowState.searchActive)
                Layout.fillWidth: true
            }

            // Center: save filename (save mode) or current entry info (normal/open picker)
            StyledText {
                visible: !(root.windowState && root.windowState.searchActive) && FileManagerService.pickerSaveMode
                    && FileManagerService.pickerSuggestedName !== ""
                text: "Save as: " + FileManagerService.pickerSuggestedName
                color: Theme.palette.m3primary
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            StyledText {
                visible: !(root.windowState && root.windowState.searchActive) && !FileManagerService.pickerSaveMode
                    && root.currentEntry !== null
                text: {
                    if (root.currentEntry?.isDir)
                        return root.currentEntry.name + "/";
                    return (root.currentEntry?.name ?? "") + "  " + FileManagerService.formatSize(root.currentEntry?.size ?? 0);
                }
                color: Theme.palette.m3onSurface
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            Item {
                visible: !(root.windowState && root.windowState.searchActive)
                Layout.fillWidth: true
            }

            // Cancel button (picker mode only)
            StyledRect {
                visible: FileManagerService.pickerMode && !(root.windowState && root.windowState.searchActive)
                color: Theme.palette.m3surfaceVariant
                radius: Theme.rounding.full
                implicitWidth: cancelLabel.implicitWidth + Theme.padding.lg * 2
                implicitHeight: cancelLabel.implicitHeight + Theme.padding.xs * 2

                StyledText {
                    id: cancelLabel
                    anchors.centerIn: parent
                    text: "Cancel"
                    color: Theme.palette.m3onSurfaceVariant
                    font.pointSize: Theme.font.size.xs
                    font.weight: Font.Medium
                }

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: FileManagerService.cancelPickerMode()
                }

                Behavior on color { CAnim {} }
            }

            // Search input (visible during search)
            StyledText {
                visible: root.windowState && root.windowState.searchActive
                text: "/"
                color: Theme.palette.m3primary
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            TextInput {
                id: searchInput

                property bool _suppressTextSync: false

                visible: root.windowState && root.windowState.searchActive
                Layout.fillWidth: true
                color: Theme.palette.m3onSurface
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
                selectionColor: Theme.palette.m3primary
                selectedTextColor: Theme.palette.m3onPrimary
                clip: true

                onTextChanged: {
                    if (!_suppressTextSync && root.windowState)
                        root.windowState.searchQuery = text;
                }

                Keys.onPressed: function(event) {
                    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                        root.windowState.searchActive = false;
                        root.windowState.searchConfirmed();
                        event.accepted = true;
                    } else if (event.key === Qt.Key_Escape) {
                        root.windowState.searchCancelled();
                        root.windowState.clearSearch();
                        event.accepted = true;
                    } else if (event.key === Qt.Key_Down) {
                        root.windowState.nextMatch();
                        event.accepted = true;
                    } else if (event.key === Qt.Key_Up) {
                        root.windowState.previousMatch();
                        event.accepted = true;
                    }
                }

                // Grab focus when search activates
                Connections {
                    target: root.windowState

                    function onSearchActiveChanged() {
                        if (root.windowState.searchActive) {
                            searchInput._suppressTextSync = true;
                            searchInput.text = "";
                            searchInput._suppressTextSync = false;
                            searchInput.forceActiveFocus();
                        }
                    }
                }
            }

            // Match count indicator (visible during search)
            StyledText {
                visible: root.windowState && root.windowState.searchActive
                text: {
                    if (!root.windowState) return "";
                    const matches = root.windowState.matchIndices;
                    if (root.windowState.searchQuery === "")
                        return "";
                    if (matches.length === 0)
                        return "No matches";
                    return (root.windowState.currentMatchIndex + 1) + "/" + matches.length;
                }
                color: {
                    if (root.windowState && root.windowState.searchQuery !== "" && root.windowState.matchIndices.length === 0)
                        return Theme.palette.m3error;
                    return Theme.palette.m3onSurfaceVariant;
                }
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            // Right: abbreviated path (always visible)
            StyledText {
                text: root.windowState ? Paths.shortenHome(root.windowState.currentPath) : ""
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                elide: Text.ElideMiddle
                Layout.maximumWidth: root.width * 0.3
            }
        }
    }
}
