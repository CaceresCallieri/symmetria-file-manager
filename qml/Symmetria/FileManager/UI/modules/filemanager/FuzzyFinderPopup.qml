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

            Behavior on width {
                Anim {}
            }

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
                            required property string iconPath

                            // Path with any trailing dir-slash removed, plus the
                            // index at which the filename segment begins — the
                            // single split point both label halves are sliced at.
                            readonly property string _trimmedPath:
                                popupScope._trimTrailingSlash(resultDelegate.path, resultDelegate.isDir)
                            readonly property int _nameStart:
                                Math.max(0, _trimmedPath.length - resultDelegate.name.length)

                            // Highlighting forces RichText, which Qt's Text cannot
                            // reliably elide — so the two labels switch between
                            // RichText+clip (matches) and PlainText+elide (no match),
                            // mirroring FileListItem. Raw substrings feed the plain
                            // case (the highlighter HTML-escapes, which would leak
                            // literal &amp; into un-highlighted text).
                            readonly property bool _hasMatch:
                                resultDelegate.matchIndices && resultDelegate.matchIndices.length > 0
                            readonly property string _nameText: _trimmedPath.substring(_nameStart)
                            readonly property string _prefixText: _trimmedPath.substring(0, _nameStart)

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

                                // Themed file/folder icon (real Symmetria icon when
                                // iconMode is "system"; Material glyph otherwise).
                                FileIcon {
                                    iconPath: resultDelegate.iconPath
                                    materialIconName: resultDelegate.isDir ? "folder" : "description"
                                    materialColor: resultDelegate.isDir
                                        ? FmTheme.palette.primary
                                        : FmTheme.palette.onSurfaceVariant
                                    materialFill: resultDelegate.isDir ? 1 : 0
                                    materialPointSize: FmTheme.font.size.md
                                    Layout.preferredWidth: implicitWidth
                                    Layout.preferredHeight: implicitHeight
                                }

                                // Filename — emphasised (bold, full-contrast). Capped
                                // so a pathological name can't crowd out the parent
                                // path; clip (match) or ElideRight (no match) keeps it
                                // strictly inside that cap — never painting over the path.
                                StyledText {
                                    Layout.fillWidth: false
                                    Layout.maximumWidth: resultRow.width * 0.55
                                    text: resultDelegate._hasMatch
                                        ? popupScope._highlightRange(
                                            resultDelegate._trimmedPath, resultDelegate.matchIndices,
                                            resultDelegate._nameStart, resultDelegate._trimmedPath.length)
                                        : resultDelegate._nameText
                                    textFormat: resultDelegate._hasMatch ? Text.RichText : Text.PlainText
                                    clip: resultDelegate._hasMatch
                                    elide: resultDelegate._hasMatch ? Text.ElideNone : Text.ElideRight
                                    color: resultDelegate.index === popupScope.selectedIndex
                                        ? FmTheme.palette.onSurface
                                        : FmTheme.palette.onSurfaceVariant
                                    font.pointSize: FmTheme.font.size.sm
                                    font.family: FmTheme.font.family.mono
                                    font.weight: Font.DemiBold
                                }

                                // Parent path — de-emphasised (smaller, dim, italic).
                                // No match → ElideLeft (keeps the directories nearest
                                // the file). Match → RichText can't elide, so clip; the
                                // fillWidth box bounds it so it can't overflow either.
                                StyledText {
                                    // MUST stay visible even when empty (root-level
                                    // files have no parent path). It is the row's only
                                    // Layout.fillWidth item; hiding it removes the slack
                                    // consumer, and QtQuick.Layouts then floats the
                                    // (fillWidth:false) filename to CENTER instead of
                                    // left. Empty text renders nothing but keeps the row
                                    // left-packed. See the FileIcon-era layout fix.
                                    Layout.fillWidth: true
                                    text: resultDelegate._hasMatch
                                        ? popupScope._highlightRange(
                                            resultDelegate._trimmedPath, resultDelegate.matchIndices,
                                            0, resultDelegate._nameStart)
                                        : resultDelegate._prefixText
                                    textFormat: resultDelegate._hasMatch ? Text.RichText : Text.PlainText
                                    clip: resultDelegate._hasMatch
                                    elide: resultDelegate._hasMatch ? Text.ElideNone : Text.ElideLeft
                                    color: FmTheme.palette.onSurfaceVariant
                                    font.pointSize: FmTheme.font.size.xs
                                    font.family: FmTheme.font.family.mono
                                    font.italic: true
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

                    // === File Info panel (size/type/git/modified + shared preview) ===
                    FuzzyFinderInfoPanel {
                        // Hard-cap the width: without max/min, the long filename and
                        // wide preview blow this column out to full width and starve
                        // the results ListView (preferredWidth alone is only a hint).
                        Layout.preferredWidth: 360
                        Layout.minimumWidth: 360
                        Layout.maximumWidth: 360
                        Layout.fillWidth: false
                        Layout.fillHeight: true
                        visible: fuzzyModel.resultCount > 0

                        entry: popupScope.selectedEntry
                        windowState: root.windowState
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

        // A directory's path/fullPath carries a trailing "/" (fff convention);
        // its name role is the bare last segment. Strip the slash so the name
        // split lines up — for files the path is returned unchanged.
        function _trimTrailingSlash(path: string, isDir: bool): string {
            return (isDir && path.endsWith("/")) ? path.slice(0, -1) : path;
        }

        // Emit highlighted HTML for the slice text[start, end). `indices` are
        // absolute character positions into `text` (the fuzzy-match positions),
        // so the same index set drives both the filename and parent-path halves
        // without re-basing — each call just renders its own range.
        function _highlightRange(text: string, indices: var, start: int, end: int): string {
            const hasIndices = indices && indices.length > 0;

            // Build a set of highlighted positions for O(1) lookup.
            const highlighted = {};
            if (hasIndices)
                for (let i = 0; i < indices.length; i++)
                    highlighted[indices[i]] = true;

            const spanOpen = "<span style=\"background-color: " + FmTheme.palette.secondaryContainer
                           + "; color: " + FmTheme.palette.onSecondaryContainer + ";\">";
            const spanClose = "</span>";

            let result = "";
            let inSpan = false;
            for (let i = start; i < end; i++) {
                const on = hasIndices && highlighted[i] === true;
                if (on && !inSpan) {
                    result += spanOpen;
                    inSpan = true;
                } else if (!on && inSpan) {
                    result += spanClose;
                    inSpan = false;
                }
                result += _htmlEscape(text[i]);
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
