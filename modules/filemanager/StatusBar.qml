import "../../components"
import "../../services"
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    property WindowState windowState
    required property int fileCount
    required property var currentEntry

    // Horizontal inset matching PathBar pill spacing in PathBar and StatusBar
    readonly property real _barHorizontalMargin: Theme.padding.lg + Theme.padding.md

    // Collapses the repeated null-guard pattern used throughout this file.
    readonly property bool _searchActive: windowState ? windowState.searchActive : false
    readonly property bool _flashActive: windowState ? windowState.flashActive : false
    readonly property int _selectedCount: windowState ? windowState.selectedCount : 0
    readonly property string _transientMessage: windowState ? windowState.transientMessage : ""
    // True when normal status bar content should be visible (no search, flash, or transient message)
    readonly property bool _normalVisible: !_searchActive && !_flashActive && _transientMessage === ""

    implicitHeight: inner.implicitHeight + Theme.padding.sm * 4

    // Matte pill container with fully rounded corners
    StyledRect {
        id: pill

        anchors.fill: parent
        anchors.topMargin: Theme.padding.sm
        anchors.bottomMargin: Theme.padding.sm
        anchors.leftMargin: root._barHorizontalMargin
        anchors.rightMargin: root._barHorizontalMargin
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

            // Transient bookmark feedback — overlays normal content when active
            StyledText {
                visible: root._transientMessage !== "" && !root._searchActive && !root._flashActive
                text: root._transientMessage
                color: Theme.palette.m3primary
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
                Layout.fillWidth: true
            }

            // Left: Accept button (picker mode) or file count (normal mode)
            // — hidden during search in both modes
            StyledRect {
                id: acceptBtn
                visible: FileManagerService.pickerMode && root._normalVisible
                color: _acceptEnabled ? Theme.palette.m3primary : Theme.palette.m3surfaceVariant
                radius: Theme.rounding.full
                implicitWidth: acceptLabel.implicitWidth + Theme.padding.lg * 2
                implicitHeight: acceptLabel.implicitHeight + Theme.padding.xs * 2

                readonly property bool _acceptEnabled: {
                    if (FileManagerService.pickerSaveMode)
                        return true;  // In save mode, always enabled (confirms save to current directory)
                    if (FileManagerService.pickerMultiple && root._selectedCount > 0)
                        return true;  // Multi-select with marks is always valid (type-filtered at mark time)
                    if (root.currentEntry === null)
                        return false;
                    if (FileManagerService.pickerDirectory)
                        return root.currentEntry.isDir;
                    return !root.currentEntry.isDir;
                }

                StyledText {
                    id: acceptLabel
                    anchors.centerIn: parent
                    text: {
                        if (FileManagerService.pickerAcceptLabel)
                            return FileManagerService.pickerAcceptLabel;
                        if (FileManagerService.pickerSaveMode)
                            return "Save";
                        if (FileManagerService.pickerMultiple && root._selectedCount > 0)
                            return "Select (" + root._selectedCount + ")";
                        return "Select";
                    }
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
                        // Auto-confirm any in-progress save name edit before completing
                        if (FileManagerService.saveNameEditing)
                            saveNameInput._confirmEdit(false);
                        FileManagerService.confirmPickerSelection(root.currentEntry, root.windowState);
                    }
                }

                Behavior on color { CAnim {} }
            }

            StyledText {
                visible: root._normalVisible && (!FileManagerService.pickerMode || FileManagerService.pickerMultiple)
                text: {
                    const count = root.fileCount + (root.fileCount === 1 ? " item" : " items");
                    if (root._selectedCount > 0)
                        return count + "  ·  " + root._selectedCount + " selected";
                    return count;
                }
                color: {
                    if (root._selectedCount > 0)
                        return Theme.indicator.selection;
                    return Theme.palette.m3onSurfaceVariant;
                }
                font.pointSize: Theme.font.size.xs
            }

            // Sort mode indicator
            StyledText {
                visible: root._normalVisible && !FileManagerService.pickerMode
                text: {
                    if (!root.windowState) return "";
                    const arrow = root.windowState.sortReverse ? " ↓" : " ↑";
                    return root.windowState.sortLabel + arrow;
                }
                color: Theme.palette.m3onSurfaceVariant
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            Item {
                visible: root._normalVisible
                Layout.fillWidth: true
            }

            // Center: save filename (save mode) — inline-editable via Ctrl+R
            StyledText {
                visible: root._normalVisible && FileManagerService.pickerSaveMode
                    && (FileManagerService.pickerSuggestedName !== "" || FileManagerService.saveNameEditing)
                text: "Save as:"
                color: Theme.palette.m3primary
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            TextInput {
                id: saveNameInput

                visible: root._normalVisible && FileManagerService.pickerSaveMode
                    && (FileManagerService.pickerSuggestedName !== "" || FileManagerService.saveNameEditing)
                text: FileManagerService.pickerSuggestedName
                color: FileManagerService.saveNameEditing ? Theme.palette.m3onSurface : Theme.palette.m3primary
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
                selectionColor: Theme.palette.m3primary
                selectedTextColor: Theme.palette.m3onPrimary
                readOnly: !FileManagerService.saveNameEditing
                activeFocusOnPress: false
                clip: true
                Layout.maximumWidth: root.width * 0.4

                // Smart text selection: select basename without extension
                function _selectBasename(): void {
                    const dotIndex = text.lastIndexOf(".");
                    if (dotIndex > 0)
                        select(0, dotIndex);
                    else
                        selectAll();
                }

                function _confirmEdit(andSave: bool): void {
                    // Reject empty names — revert to the original name instead of saving ""
                    const trimmed = text.trim();
                    if (trimmed === "") {
                        _cancelEdit();
                        return;
                    }
                    FileManagerService.pickerSuggestedName = trimmed;
                    FileManagerService.saveNameEditing = false;
                    if (andSave)
                        FileManagerService.confirmPickerSelection(root.currentEntry, root.windowState);
                }

                function _cancelEdit(): void {
                    // Revert to the service's current suggested name (the last committed value)
                    text = FileManagerService.pickerSuggestedName;
                    FileManagerService.saveNameEditing = false;
                }

                Keys.onPressed: function(event) {
                    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                        _confirmEdit(true);
                        event.accepted = true;
                    } else if (event.key === Qt.Key_Escape) {
                        _cancelEdit();
                        event.accepted = true;
                    } else if (event.key === Qt.Key_Tab) {
                        // Toggle between basename-only and full-name selection
                        const dotIndex = text.lastIndexOf(".");
                        if (dotIndex > 0 && selectionEnd === dotIndex)
                            selectAll();
                        else
                            _selectBasename();
                        event.accepted = true;
                    }
                }

                // Double-click to enter edit mode; disabled while editing so
                // the TextInput receives normal cursor-positioning clicks.
                MouseArea {
                    anchors.fill: parent
                    enabled: !FileManagerService.saveNameEditing
                    cursorShape: Qt.PointingHandCursor
                    onDoubleClicked: FileManagerService.saveNameEditing = true
                }

                Connections {
                    target: FileManagerService

                    function onSaveNameEditingChanged() {
                        if (FileManagerService.saveNameEditing) {
                            saveNameInput.forceActiveFocus();
                            saveNameInput._selectBasename();
                        }
                    }
                }
            }

            // Center: current entry info (normal mode or open picker)
            StyledText {
                visible: root._normalVisible && !FileManagerService.pickerSaveMode
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
                visible: root._normalVisible
                Layout.fillWidth: true
            }

            // Cancel button (picker mode only)
            StyledRect {
                visible: FileManagerService.pickerMode && root._normalVisible
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
                visible: root._searchActive
                text: "/"
                color: Theme.palette.m3primary
                font.pointSize: Theme.font.size.xs
                font.family: Theme.font.family.mono
            }

            TextInput {
                id: searchInput

                property bool _suppressTextSync: false

                visible: root._searchActive
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
                visible: root._searchActive
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

            // Flash navigation indicator (visible during flash mode)
            RowLayout {
                visible: root._flashActive
                spacing: Theme.spacing.md

                StyledText {
                    text: "S"
                    color: Theme.palette.m3primary
                    font.pointSize: Theme.font.size.xs
                    font.family: Theme.font.family.mono
                    font.weight: Font.Bold
                }

                StyledText {
                    text: root.windowState ? root.windowState.flashQuery : ""
                    color: Theme.palette.m3onSurface
                    font.pointSize: Theme.font.size.xs
                    font.family: Theme.font.family.mono
                    Layout.fillWidth: true
                }

                StyledText {
                    text: {
                        if (!root.windowState) return "";
                        const query = root.windowState.flashQuery;
                        if (query === "") return "";
                        const matches = root.windowState.flashMatches;
                        if (matches.length === 0) return "No matches";
                        return matches.length + (matches.length === 1 ? " match" : " matches");
                    }
                    color: {
                        if (root.windowState && root.windowState.flashQuery !== ""
                            && root.windowState.flashMatches.length === 0)
                            return Theme.palette.m3error;
                        return Theme.palette.m3onSurfaceVariant;
                    }
                    font.pointSize: Theme.font.size.xs
                    font.family: Theme.font.family.mono
                }
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
