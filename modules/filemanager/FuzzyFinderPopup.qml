pragma ComponentBehavior: Bound

import "../../components"
import "../../services"
import "../../config"
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
            color: Qt.alpha(Theme.palette.shadow, 0.5)
        }

        // === Dialog card ===
        StyledRect {
            id: dialog

            anchors.centerIn: parent
            radius: Theme.rounding.lg
            color: Theme.palette.surfaceContainerHigh

            width: Math.min(parent.width - Theme.padding.lg * 4, 560)
            implicitHeight: Math.min(dialogLayout.implicitHeight + Theme.padding.lg * 3,
                                     parent.height - Theme.padding.lg * 4)

            scale: 0.1
            Component.onCompleted: scale = 1

            Behavior on scale {
                NumberAnimation {
                    duration: Theme.animDuration
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
                anchors.margins: Theme.padding.lg * 1.5
                spacing: Theme.spacing.md

                // Header row
                RowLayout {
                    Layout.alignment: Qt.AlignHCenter
                    spacing: Theme.spacing.sm

                    MaterialIcon {
                        text: "search"
                        color: Theme.palette.primary
                        font.pointSize: Theme.font.size.lg
                    }

                    StyledText {
                        text: qsTr("Find file")
                        color: Theme.palette.onSurface
                        font.pointSize: Theme.font.size.md
                        font.weight: Font.DemiBold
                    }
                }

                // Search input container
                StyledRect {
                    Layout.fillWidth: true
                    radius: Theme.rounding.sm
                    color: Qt.alpha(Theme.palette.onSurface, 0.06)
                    implicitHeight: searchInput.implicitHeight + Theme.padding.md * 2

                    TextInput {
                        id: searchInput

                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: Theme.padding.lg
                        anchors.rightMargin: Theme.padding.lg

                        color: Theme.palette.onSurface
                        font.pointSize: Theme.font.size.sm
                        font.family: Theme.font.family.mono
                        selectionColor: Theme.palette.primary
                        selectedTextColor: Theme.palette.onPrimary
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
                    spacing: Theme.spacing.md

                    StyledText {
                        text: fuzzyModel.resultCount + " " + qsTr("results")
                        color: Theme.palette.onSurfaceVariant
                        font.pointSize: Theme.font.size.xs
                        font.family: Theme.font.family.mono
                        visible: fuzzyModel.resultCount > 0
                    }

                    StyledText {
                        text: qsTr("Scanning\u2026")
                        color: Theme.palette.primary
                        font.pointSize: Theme.font.size.xs
                        font.family: Theme.font.family.mono
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
                        radius: Theme.rounding.sm
                        color: resultDelegate.index === popupScope.selectedIndex
                            ? Qt.alpha(Theme.palette.primary, 0.15)
                            : "transparent"
                        implicitHeight: resultRow.implicitHeight + Theme.padding.sm * 2

                        Behavior on color {
                            CAnim {}
                        }

                        RowLayout {
                            id: resultRow

                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.leftMargin: Theme.padding.md
                            anchors.rightMargin: Theme.padding.md
                            spacing: Theme.spacing.md

                            // File/folder icon
                            MaterialIcon {
                                text: resultDelegate.isDir ? "folder" : "description"
                                color: resultDelegate.isDir
                                    ? Theme.palette.primary
                                    : Theme.palette.onSurfaceVariant
                                font.pointSize: Theme.font.size.md
                            }

                            // Relative path with highlighted match characters
                            StyledText {
                                Layout.fillWidth: true
                                text: popupScope._highlightPath(
                                    resultDelegate.path, resultDelegate.matchIndices)
                                textFormat: Text.RichText
                                color: resultDelegate.index === popupScope.selectedIndex
                                    ? Theme.palette.onSurface
                                    : Theme.palette.onSurfaceVariant
                                font.pointSize: Theme.font.size.sm
                                font.family: Theme.font.family.mono
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
                    Layout.topMargin: Theme.spacing.md
                    visible: fuzzyModel.resultCount === 0
                             && !fuzzyModel.scanning
                             && !fuzzyModel.loading
                             && searchInput.text.length > 0
                    text: qsTr("No matches")
                    color: Theme.palette.onSurfaceVariant
                    font.pointSize: Theme.font.size.sm
                    horizontalAlignment: Text.AlignHCenter
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
                root.windowState.fuzzyFinderNavigated(targetName);
                root.windowState.navigate(parentPath);
            }
        }

        function _highlightPath(path: string, indices: var): string {
            if (!indices || indices.length === 0)
                return _htmlEscape(path);

            const spanOpen = "<span style=\"background-color: " + Theme.palette.secondaryContainer
                           + "; color: " + Theme.palette.onSecondaryContainer + ";\">";
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
