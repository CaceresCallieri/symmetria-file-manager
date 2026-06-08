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

        // Rich data for the highlighted row, populated from the model's roles.
        // QAbstractListModel.data() is not reactive on selectedIndex, so we read
        // it explicitly whenever the selection or the result set changes.
        property var selectedEntry: ({})

        Component.onCompleted: fuzzyModel.searchPath = root.windowState.currentPath;

        Component.onDestruction: fuzzyModel.clear()

        onSelectedIndexChanged: popupScope._refreshSelected()

        // === Rust fff file-search model ===
        FuzzyFinder {
            id: fuzzyModel
            showHidden: Config.fileManager.showHidden
        }

        // Syntax-highlighted preview of the highlighted file (text files only).
        SyntaxHighlightHelper {
            id: previewHelper
            filePath: (popupScope.selectedEntry && popupScope.selectedEntry.fullPath
                       && !popupScope.selectedEntry.isDir && !popupScope.selectedEntry.isBinary)
                      ? popupScope.selectedEntry.fullPath : ""
        }

        // Shared styles for the compact File Info metadata pairs.
        component MetaLabel: StyledText {
            color: FmTheme.palette.onSurfaceVariant
            font.pointSize: FmTheme.font.size.xs
        }
        component MetaValue: StyledText {
            color: FmTheme.palette.onSurface
            font.pointSize: FmTheme.font.size.xs
            font.family: FmTheme.font.family.mono
            elide: Text.ElideRight
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

        // === Dialog card — claymorphism (shared PillCard) ===
        PillCard {
            id: dialog

            anchors.centerIn: parent

            // Widen to make room for the File Info panel once there are results.
            width: Math.min(parent.width - FmTheme.padding.lg * 4,
                            fuzzyModel.resultCount > 0 ? 900 : 560)
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
                        text: qsTr("Scanning…")
                        color: FmTheme.palette.primary
                        font.pointSize: FmTheme.font.size.xs
                        font.family: FmTheme.font.family.mono
                        visible: fuzzyModel.scanning
                    }

                    Item { Layout.fillWidth: true }
                }

                // Results list (left) + File Info panel (right)
                RowLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: FmTheme.spacing.md

                    // === Results ListView (virtualized — up to 200 items) ===
                    ListView {
                        id: resultsList

                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        Layout.minimumWidth: 240
                        Layout.preferredHeight: 360
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

                    // === File Info panel ===
                    ColumnLayout {
                        id: infoPanel

                        // Hard-cap the width: without max/min, the long filename and
                        // wide preview blow this column out to full width and starve
                        // the results ListView (preferredWidth alone is only a hint).
                        Layout.preferredWidth: 360
                        Layout.minimumWidth: 360
                        Layout.maximumWidth: 360
                        Layout.fillWidth: false
                        Layout.fillHeight: true
                        visible: fuzzyModel.resultCount > 0
                        spacing: FmTheme.spacing.sm

                        // File name
                        StyledText {
                            Layout.fillWidth: true
                            text: popupScope.selectedEntry.name || ""
                            color: FmTheme.palette.onSurface
                            font.pointSize: FmTheme.font.size.sm
                            font.weight: Font.DemiBold
                            font.family: FmTheme.font.family.mono
                            elide: Text.ElideMiddle
                        }

                        // Metadata — compact 2-up grid. Each cell is a
                        // space-between label/value pair, two per row, so the four
                        // facts occupy two tight rows and leave the preview more room.
                        GridLayout {
                            Layout.fillWidth: true
                            columns: 2
                            columnSpacing: FmTheme.spacing.md * 2
                            rowSpacing: FmTheme.spacing.sm

                            // Size
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: FmTheme.spacing.sm
                                MetaLabel { text: qsTr("Size") }
                                Item { Layout.fillWidth: true }
                                MetaValue {
                                    text: popupScope.selectedEntry.isDir
                                          ? qsTr("dir")
                                          : FileManagerService.formatSize(popupScope.selectedEntry.size || 0)
                                }
                            }
                            // Type
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: FmTheme.spacing.sm
                                MetaLabel { text: qsTr("Type") }
                                Item { Layout.fillWidth: true }
                                MetaValue { text: popupScope._typeLabel(popupScope.selectedEntry) }
                            }
                            // Git
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: FmTheme.spacing.sm
                                MetaLabel { text: qsTr("Git") }
                                Item { Layout.fillWidth: true }
                                GitStatusBadge {
                                    id: gitBadge
                                    visible: popupScope._gitStatusObj(popupScope.selectedEntry.gitStatus) !== null
                                    status: popupScope._gitStatusObj(popupScope.selectedEntry.gitStatus) || ({ char: "?", color: FmTheme.palette.outline })
                                }
                                MetaValue { text: "—"; visible: !gitBadge.visible }
                            }
                            // Modified
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: FmTheme.spacing.sm
                                MetaLabel { text: qsTr("Modified") }
                                Item { Layout.fillWidth: true }
                                MetaValue {
                                    text: popupScope.selectedEntry.modified
                                          ? FileManagerService.formatDate(popupScope.selectedEntry.modified)
                                          : "—"
                                }
                            }
                        }

                        // Preview (text files) — fills ALL remaining panel height.
                        // It is the only fillHeight child, so it absorbs every pixel
                        // left below the compact metadata (no trailing spacer).
                        StyledRect {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            Layout.topMargin: FmTheme.spacing.sm
                            radius: FmTheme.rounding.sm
                            color: Qt.alpha(FmTheme.palette.onSurface, 0.04)
                            visible: previewHelper.hasContent
                            clip: true

                            Flickable {
                                anchors.fill: parent
                                anchors.margins: FmTheme.padding.sm
                                contentWidth: width
                                contentHeight: previewText.implicitHeight
                                boundsBehavior: Flickable.StopAtBounds
                                clip: true

                                TextEdit {
                                    id: previewText
                                    width: parent.width
                                    text: previewHelper.highlightedContent
                                    textFormat: Text.RichText
                                    readOnly: true
                                    selectByMouse: false
                                    wrapMode: TextEdit.NoWrap
                                    color: FmTheme.palette.onSurfaceVariant
                                    font.pointSize: FmTheme.font.size.xs
                                    font.family: FmTheme.font.family.mono
                                }
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

                // Engine/index error — shown when fff failed to create or index.
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

            // Record the open so fff's frecency ranking learns. Synchronous read
            // of the path happens inside recordOpen before the model is cleared.
            fuzzyModel.recordOpen(popupScope.selectedIndex, searchInput.text);

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

        // Read the highlighted row's roles into selectedEntry (data() is not a
        // reactive binding source, so this is called on selection/result changes).
        function _refreshSelected(): void {
            if (fuzzyModel.resultCount === 0 || popupScope.selectedIndex < 0
                || popupScope.selectedIndex >= fuzzyModel.resultCount) {
                popupScope.selectedEntry = ({});
                return;
            }
            const idx = fuzzyModel.index(popupScope.selectedIndex, 0);
            popupScope.selectedEntry = {
                name:      fuzzyModel.data(idx, FuzzyFinder.NameRole),
                fullPath:  fuzzyModel.data(idx, FuzzyFinder.FullPathRole),
                isDir:     fuzzyModel.data(idx, FuzzyFinder.IsDirRole),
                size:      fuzzyModel.data(idx, FuzzyFinder.SizeRole),
                modified:  fuzzyModel.data(idx, FuzzyFinder.ModifiedRole),
                gitStatus: fuzzyModel.data(idx, FuzzyFinder.GitStatusRole),
                isBinary:  fuzzyModel.data(idx, FuzzyFinder.IsBinaryRole),
            };
        }

        function _typeLabel(entry: var): string {
            if (!entry || entry.name === undefined)
                return "";
            if (entry.isDir)
                return qsTr("directory");
            const name = entry.name + "";
            const dot = name.lastIndexOf(".");
            return (dot > 0 && dot < name.length - 1) ? name.substring(dot + 1) : qsTr("file");
        }

        // Map fff's git status string (porcelain-ish, e.g. "M ", "??", "A ") to the
        // GitStatusBadge `{char, color, tooltip}` shape. Returns null when there is
        // no status (badge hidden).
        function _gitStatusObj(s: var): var {
            if (!s || (s + "").trim().length === 0)
                return null;
            const code = (s + "").trim().charAt(0);
            switch (code) {
            case "M": return { char: "M", color: FmTheme.indicator.cut,       tooltip: qsTr("Modified") };
            case "A": return { char: "A", color: FmTheme.indicator.selection, tooltip: qsTr("Added") };
            case "D": return { char: "D", color: FmTheme.palette.error,        tooltip: qsTr("Deleted") };
            case "R": return { char: "R", color: FmTheme.indicator.yank,       tooltip: qsTr("Renamed") };
            case "?": return { char: "?", color: FmTheme.palette.outline,      tooltip: qsTr("Untracked") };
            case "!": return { char: "!", color: FmTheme.palette.outline,      tooltip: qsTr("Ignored") };
            default:  return { char: code, color: FmTheme.palette.outline,     tooltip: s + "" };
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

        // Reset selection when results change, and refresh the File Info panel
        // (selectedIndex may stay 0 across a result reset, so refresh explicitly).
        Connections {
            target: fuzzyModel
            function onResultCountChanged() {
                popupScope.selectedIndex = 0;
                popupScope._refreshSelected();
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
