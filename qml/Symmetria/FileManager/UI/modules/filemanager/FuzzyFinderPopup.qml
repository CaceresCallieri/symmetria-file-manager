pragma ComponentBehavior: Bound

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    property WindowState windowState

    anchors.fill: parent

    opacity: windowState && windowState.activeModal === windowState.modalFuzzyFinder ? 1 : 0
    // Drive active from the source property, not from animated opacity — avoids
    // a race where the Loader activates mid-fade-out with an already-closed state.
    active: windowState && windowState.activeModal === windowState.modalFuzzyFinder
    asynchronous: true

    sourceComponent: FocusScope {
        id: popupScope

        property int selectedIndex: 0

        Component.onCompleted: fuzzyModel.searchPath = root.windowState.currentPath;

        Component.onDestruction: fuzzyModel.clear()

        // === C++ fuzzy finder model ===
        FuzzyFinder {
            id: fuzzyModel
            showHidden: Config.fileManager.showHidden
        }

        // === Scrim backdrop — click to cancel ===
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            onClicked: root.windowState.closeModal()
        }

        StyledRect {
            anchors.fill: parent
            color: Qt.alpha(FmTheme.palette.shadow, 0.5)
        }

        // === Dialog card ===
        StyledRect {
            id: dialog

            anchors.centerIn: parent
            radius: FmTheme.rounding.lg
            color: FmTheme.palette.surfaceContainerHigh

            width: Math.min(parent.width - FmTheme.padding.lg * 4, 560)
            implicitHeight: Math.min(dialogLayout.implicitHeight + FmTheme.padding.lg * 3,
                                     parent.height - FmTheme.padding.lg * 4)

            scale: 0.1
            Component.onCompleted: scale = 1

            Behavior on scale {
                NumberAnimation {
                    duration: FmTheme.animDuration
                    easing.type: Easing.OutBack
                    easing.overshoot: 1.5
                }
            }

            // Block clicks from reaching the scrim MouseArea
            MouseArea {
                anchors.fill: parent
            }

            // Swallow all keys not handled by searchInput
            Keys.onPressed: function(event) {
                event.accepted = true;
            }

            ColumnLayout {
                id: dialogLayout

                anchors.fill: parent
                anchors.margins: FmTheme.padding.lg * 1.5
                spacing: FmTheme.spacing.md

                // Header row
                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: FmTheme.spacing.sm

                    MaterialIcon {
                        text: "search"
                        color: FmTheme.palette.primary
                        font.pointSize: FmTheme.font.size.lg
                    }

                    StyledText {
                        text: qsTr("Find file")
                        color: FmTheme.palette.onSurface
                        font.pointSize: FmTheme.font.size.md
                        font.weight: Font.DemiBold
                    }
                }

                // Search input container
                StyledRect {
                    Layout.fillWidth: true
                    radius: FmTheme.rounding.sm
                    color: Qt.alpha(FmTheme.palette.onSurface, 0.06)
                    implicitHeight: searchInput.implicitHeight + FmTheme.padding.md * 2

                    TextInput {
                        id: searchInput

                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: FmTheme.padding.lg
                        anchors.rightMargin: FmTheme.padding.lg

                        color: FmTheme.palette.onSurface
                        font.pointSize: FmTheme.font.size.sm
                        font.family: FmTheme.font.family.mono
                        selectionColor: FmTheme.palette.primary
                        selectedTextColor: FmTheme.palette.onPrimary
                        clip: true
                        focus: true

                        Component.onCompleted: forceActiveFocus()

                        onTextChanged: debounceTimer.restart()

                        Keys.onPressed: function(event) {
                            if (event.key === Qt.Key_Escape) {
                                root.windowState.closeModal();
                                event.accepted = true;
                            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                                popupScope._confirmSelection();
                                event.accepted = true;
                            } else if (event.key === Qt.Key_Down
                                       || (event.key === Qt.Key_J && (event.modifiers & Qt.ControlModifier))) {
                                if (popupScope.selectedIndex < fuzzyModel.resultCount - 1)
                                    popupScope.selectedIndex++;
                                resultsList.positionViewAtIndex(popupScope.selectedIndex, ListView.Contain);
                                event.accepted = true;
                            } else if (event.key === Qt.Key_Up
                                       || (event.key === Qt.Key_K && (event.modifiers & Qt.ControlModifier))) {
                                if (popupScope.selectedIndex > 0)
                                    popupScope.selectedIndex--;
                                resultsList.positionViewAtIndex(popupScope.selectedIndex, ListView.Contain);
                                event.accepted = true;
                            }
                        }
                    }
                }

                // Result count and scanning indicator
                RowLayout {
                    Layout.fillWidth: true
                    spacing: FmTheme.spacing.md

                    StyledText {
                        text: fuzzyModel.resultCount + " " + qsTr("results")
                        color: FmTheme.palette.onSurfaceVariant
                        font.pointSize: FmTheme.font.size.xs
                        font.family: FmTheme.font.family.mono
                        visible: fuzzyModel.resultCount > 0
                    }

                    StyledText {
                        text: qsTr("Scanning\u2026")
                        color: FmTheme.palette.primary
                        font.pointSize: FmTheme.font.size.xs
                        font.family: FmTheme.font.family.mono
                        visible: fuzzyModel.scanning
                    }

                    Item { Layout.fillWidth: true }
                }

                // Results ListView (virtualized — up to 200 items)
                ListView {
                    id: resultsList

                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.preferredHeight: Math.min(contentHeight, 350)
                    clip: true

                    model: fuzzyModel
                    boundsBehavior: Flickable.StopAtBounds

                    delegate: StyledRect {
                        id: resultDelegate

                        required property int index
                        required property string path
                        required property string name
                        required property bool isDir
                        required property string fullPath
                        required property var matchIndices

                        width: resultsList.width
                        radius: FmTheme.rounding.sm
                        color: resultDelegate.index === popupScope.selectedIndex
                            ? Qt.alpha(FmTheme.palette.primary, 0.15)
                            : "transparent"
                        implicitHeight: resultRow.implicitHeight + FmTheme.padding.sm * 2

                        Behavior on color {
                            CAnim {}
                        }

                        RowLayout {
                            id: resultRow

                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: FmTheme.padding.md
                            anchors.rightMargin: FmTheme.padding.md
                            spacing: FmTheme.spacing.md

                            // File/folder icon
                            MaterialIcon {
                                text: resultDelegate.isDir ? "folder" : "description"
                                color: resultDelegate.isDir
                                    ? FmTheme.palette.primary
                                    : FmTheme.palette.onSurfaceVariant
                                font.pointSize: FmTheme.font.size.md
                            }

                            // Relative path with highlighted match characters
                            StyledText {
                                Layout.fillWidth: true
                                text: popupScope._highlightPath(
                                    resultDelegate.path, resultDelegate.matchIndices)
                                textFormat: Text.RichText
                                color: resultDelegate.index === popupScope.selectedIndex
                                    ? FmTheme.palette.onSurface
                                    : FmTheme.palette.onSurfaceVariant
                                font.pointSize: FmTheme.font.size.sm
                                font.family: FmTheme.font.family.mono
                                clip: true
                            }
                        }

                        StateLayer {
                            onClicked: {
                                popupScope.selectedIndex = resultDelegate.index;
                                popupScope._confirmSelection();
                            }
                        }
                    }
                }

                // Empty state
                StyledText {
                    Layout.fillWidth: true
                    Layout.topMargin: FmTheme.spacing.md
                    visible: fuzzyModel.resultCount === 0
                             && !fuzzyModel.scanning
                             && !fuzzyModel.loading
                             && searchInput.text.length > 0
                    text: qsTr("No matches")
                    color: FmTheme.palette.onSurfaceVariant
                    font.pointSize: FmTheme.font.size.sm
                    horizontalAlignment: Text.AlignHCenter
                }

                // Walk-cap warning — shown when the walker hit MaxScanFiles.
                // Uses M3 `error` token (not `tertiary`) so it actually stands
                // out against the popup background; tertiary on this surface
                // rendered too dark to read. Wraps so the full guidance
                // ("open from a smaller subdir") stays legible at narrow widths.
                StyledText {
                    Layout.fillWidth: true
                    Layout.topMargin: FmTheme.spacing.sm
                    visible: fuzzyModel.error.length > 0
                    text: fuzzyModel.error
                    color: FmTheme.palette.error
                    font.pointSize: FmTheme.font.size.xs
                    horizontalAlignment: Text.AlignHCenter
                    wrapMode: Text.WordWrap
                }
            }
        }

        // === Functions ===

        function _confirmSelection(): void {
            if (fuzzyModel.resultCount === 0 || popupScope.selectedIndex < 0
                || popupScope.selectedIndex >= fuzzyModel.resultCount)
                return;

            // Read data BEFORE closing the modal — closeModal() deactivates the
            // Loader, which fires Component.onDestruction and clears fuzzyModel.
            const idx = fuzzyModel.index(popupScope.selectedIndex, 0);
            const targetFullPath = fuzzyModel.data(idx, FuzzyFinder.FullPathRole);
            const targetIsDir = fuzzyModel.data(idx, FuzzyFinder.IsDirRole);
            const targetName = fuzzyModel.data(idx, FuzzyFinder.NameRole);

            root.windowState.closeModal();

            if (targetIsDir) {
                root.windowState.navigate(targetFullPath);
            } else {
                // Navigate to the file's parent directory and focus the file.
                // Emit fuzzyFinderNavigated BEFORE navigate — this sets _pendingFocusName
                // in FileList so the cursor lands on the file after the path change.
                // For same-directory files, navigate() returns early, but the signal
                // handler in FileList handles immediate focus in that case.
                const parentPath = Paths.parentDir(targetFullPath);
                // INVARIANT: fuzzyFinderNavigated MUST be emitted BEFORE navigate().
                // FileTreeView._rebuildRows matches the pending file by depth=0,
                // relying on the tree's root already being the file's parent when
                // the rebuild fires. Swapping the order breaks cross-dir focus.
                root.windowState.fuzzyFinderNavigated(targetName);
                root.windowState.navigate(parentPath);
            }
        }

        function _highlightPath(path: string, indices: var): string {
            if (!indices || indices.length === 0)
                return _htmlEscape(path);

            const spanOpen = "<span style=\"background-color: " + FmTheme.palette.secondaryContainer
                           + "; color: " + FmTheme.palette.onSecondaryContainer + ";\">";
            const spanClose = "</span>";

            // Build a set of highlighted positions for O(1) lookup
            const highlighted = {};
            for (let i = 0; i < indices.length; i++)
                highlighted[indices[i]] = true;

            let result = "";
            let inSpan = false;
            for (let i = 0; i < path.length; i++) {
                if (highlighted[i] && !inSpan) {
                    result += spanOpen;
                    inSpan = true;
                } else if (!highlighted[i] && inSpan) {
                    result += spanClose;
                    inSpan = false;
                }
                result += _htmlEscape(path[i]);
            }
            if (inSpan)
                result += spanClose;

            return result;
        }

        function _htmlEscape(str: string): string {
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                       .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        }

        // === Debounce timer ===
        Timer {
            id: debounceTimer
            interval: 100
            repeat: false
            onTriggered: {
                fuzzyModel.query = searchInput.text;
                popupScope.selectedIndex = 0;
            }
        }

        // Reset selectedIndex when results change
        Connections {
            target: fuzzyModel
            function onResultCountChanged() {
                popupScope.selectedIndex = 0;
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
