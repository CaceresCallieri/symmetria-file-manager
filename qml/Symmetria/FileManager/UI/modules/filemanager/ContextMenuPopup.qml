import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    property WindowState windowState

    anchors.fill: parent

    opacity: windowState && windowState.activeModal === windowState.modalContextMenu ? 1 : 0
    active: windowState && !FileManagerService.pickerMode
        && windowState.activeModal === windowState.modalContextMenu
    sourceComponent: FocusScope {
        id: popupScope

        // --- Snapshotted data ---
        property string targetPath: ""
        property string targetName: ""
        property string targetMimeType: ""
        property bool isArchive: false
        property bool isAudio: false

        // --- Internal state machine: "actions" | "openWith" | "extracting" ---
        property string viewMode: "actions"

        // --- Action list ---
        // Force unconditional reads so the QML binding engine registers
        // both properties as dependencies even when their initial value is false.
        readonly property var actionItems: {
            const _audio = isAudio;
            const _archive = isArchive;
            let items = [
                { actionId: "openWith", icon: "open_in_new", label: "Open with\u2026", key: "o" }
            ];
            if (_audio)
                items.push({ actionId: "playToggle", icon: "play_arrow", label: "Play / Pause", key: "p" });
            if (_archive)
                items.push({ actionId: "extract", icon: "unarchive", label: "Extract here", key: "e" });
            return items;
        }
        property int actionIndex: 0

        // --- Open With data ---
        property var appList: []
        property string appFilterQuery: ""
        property var filteredApps: []
        property int appIndex: 0

        // --- Extraction progress ---
        property int extractedCount: 0
        property int extractTotalCount: 0
        property bool extractionDone: false
        property string extractionError: ""

        Component.onCompleted: {
            targetPath = root.windowState.contextMenuTargetPath;
            targetMimeType = root.windowState.contextMenuTargetMimeType;
            targetName = Paths.basename(targetPath);
            isArchive = FileManagerService.isArchiveFile(targetMimeType);
            isAudio = FileManagerService.isAudioFile(targetMimeType);
        }

        function _executeAction(actionId: string): void {
            if (actionId === "openWith") {
                viewMode = "openWith";
                if (targetMimeType !== "") {
                    mimeQueryProcess.command = ["gio", "mime", targetMimeType];
                    mimeQueryProcess.start();
                } else {
                    appList = [];
                    _updateFilteredApps();
                }
            } else if (actionId === "playToggle") {
                root.windowState.audioPlaybackToggle();
                root.windowState.closeModal();
            } else if (actionId === "extract") {
                viewMode = "extracting";
                extractionError = "";
                archiveCounter.filePath = targetPath;
            }
        }

        // --- Open With: application discovery ---
        function _parseMimeOutput(output: string): void {
            const lines = output.split("\n");
            const seen = {};
            const apps = [];
            for (const line of lines) {
                const trimmed = line.trim();
                // Reject header lines like "Registered associations:" which contain spaces
                if (trimmed.endsWith(".desktop") && !trimmed.includes(" ") && !seen[trimmed]) {
                    seen[trimmed] = true;
                    // Resolve the real themed app icon once, here, rather than in the
                    // delegate binding (the list is small and AppIconProvider caches).
                    apps.push({
                        desktopId: trimmed,
                        name: _desktopIdToName(trimmed),
                        iconPath: AppIconProvider.iconForDesktopId(trimmed)
                    });
                }
            }
            appList = apps;
            _updateFilteredApps();
        }

        function _desktopIdToName(desktopId: string): string {
            let name = desktopId.replace(/\.desktop$/, "");
            const parts = name.split(".");
            name = parts[parts.length - 1];
            // Capitalize and replace hyphens/underscores with spaces
            name = name.replace(/[-_]/g, " ");
            return name.charAt(0).toUpperCase() + name.substring(1);
        }

        function _updateFilteredApps(): void {
            if (appFilterQuery === "") {
                filteredApps = appList.slice();
                return;
            }
            const q = appFilterQuery.toLowerCase();
            filteredApps = appList.filter(app =>
                app.name.toLowerCase().includes(q)
                || app.desktopId.toLowerCase().includes(q)
            );
            // Clamp index
            if (appIndex >= filteredApps.length)
                appIndex = Math.max(0, filteredApps.length - 1);
        }

        // --- Extraction ---
        function _startExtraction(): void {
            const dotIndex = targetName.lastIndexOf(".");
            // Handle double extensions like .tar.gz, .tar.bz2, etc.
            const tarMatch = /\.tar\.[^.]+$/.exec(targetName);
            const stripIndex = tarMatch ? tarMatch.index : (dotIndex > 0 ? dotIndex : -1);
            const baseName = stripIndex >= 0 ? targetName.substring(0, stripIndex) : "";
            const folderName = baseName !== "" ? baseName : targetName;
            const parentDir = Paths.parentDir(targetPath);
            const destDir = parentDir + "/" + folderName;

            mkdirProcess.destDir = destDir;
            mkdirProcess.command = ["mkdir", "-p", "--", destDir];
            mkdirProcess.start();
        }

        function _handleActionsKeys(event): void {
            switch (event.key) {
            case Qt.Key_Escape:
                root.windowState.closeModal();
                event.accepted = true;
                break;
            case Qt.Key_J:
            case Qt.Key_Down:
                if (actionIndex < actionItems.length - 1)
                    actionIndex++;
                event.accepted = true;
                break;
            case Qt.Key_K:
            case Qt.Key_Up:
                if (actionIndex > 0)
                    actionIndex--;
                event.accepted = true;
                break;
            case Qt.Key_Return:
            case Qt.Key_Enter:
                _executeAction(actionItems[actionIndex].actionId);
                event.accepted = true;
                break;
            case Qt.Key_O:
                _executeAction("openWith");
                event.accepted = true;
                break;
            case Qt.Key_P:
                if (isAudio)
                    _executeAction("playToggle");
                event.accepted = true;
                break;
            case Qt.Key_E:
                if (isArchive)
                    _executeAction("extract");
                event.accepted = true;
                break;
            default:
                // Only consume bare letter keys to prevent them reaching the file list;
                // let modifier+key combinations (e.g. Ctrl+W) bubble through.
                if (!event.modifiers || event.modifiers === Qt.ShiftModifier)
                    event.accepted = true;
                break;
            }
        }

        function _handleOpenWithKeys(event): void {
            switch (event.key) {
            case Qt.Key_Escape:
                // Go back to actions list
                viewMode = "actions";
                appFilterQuery = "";
                appIndex = 0;
                dialog.forceActiveFocus();
                event.accepted = true;
                break;
            case Qt.Key_Down:
                if (appIndex < filteredApps.length - 1)
                    appIndex++;
                event.accepted = true;
                break;
            case Qt.Key_Up:
                if (appIndex > 0)
                    appIndex--;
                event.accepted = true;
                break;
            case Qt.Key_Return:
            case Qt.Key_Enter:
                if (filteredApps.length > 0) {
                    const app = filteredApps[appIndex];
                    openWithProcess.command = ["gio", "launch", app.desktopId, targetPath];
                    openWithProcess.start();
                    root.windowState.closeModal();
                }
                event.accepted = true;
                break;
            default:
                // J/K intentionally absent — alphabetic keys feed the search filter.
                // Only arrow keys navigate the list; all other keys pass to TextInput.
                break;
            }
        }

        function _handleExtractingKeys(event): void {
            if ((event.key === Qt.Key_Escape || event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                && (extractionDone || extractionError !== "")) {
                root.windowState.closeModal();
            }
            event.accepted = true;
        }

        // Scrim backdrop — click to cancel (only when not extracting)
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            onClicked: {
                if (popupScope.viewMode !== "extracting" || popupScope.extractionDone || popupScope.extractionError !== "")
                    root.windowState.closeModal();
            }
        }

        StyledRect {
            anchors.fill: parent
            color: Qt.alpha(FmTheme.palette.shadow, 0.5)
        }

        // Dialog card — claymorphism (shared PillCard)
        PillCard {
            id: dialog

            anchors.centerIn: parent

            width: Math.min(parent.width - FmTheme.padding.lg * 4, 400)
            implicitHeight: dialogContent.implicitHeight + FmTheme.padding.lg * 3

            scale: 0.1
            Component.onCompleted: scale = 1

            Behavior on scale {
                NumberAnimation {
                    duration: FmTheme.animDuration
                    easing.type: Easing.OutBack
                    easing.overshoot: 1.5
                }
            }

            // Prevent clicks on card from reaching scrim
            MouseArea {
                anchors.fill: parent
            }

            Keys.onPressed: function(event) {
                if (popupScope.viewMode === "actions")
                    popupScope._handleActionsKeys(event);
                else if (popupScope.viewMode === "openWith")
                    popupScope._handleOpenWithKeys(event);
                else if (popupScope.viewMode === "extracting")
                    popupScope._handleExtractingKeys(event);
            }

            ColumnLayout {
                id: dialogContent

                anchors.fill: parent
                anchors.margins: FmTheme.padding.lg * 1.5
                spacing: FmTheme.spacing.md

                // Header: filename
                RowLayout {
                    spacing: FmTheme.spacing.sm

                    MaterialIcon {
                        text: "more_horiz"
                        color: FmTheme.palette.primary
                        font.pointSize: FmTheme.font.size.lg
                        font.weight: Font.Medium
                    }

                    StyledText {
                        text: popupScope.targetName
                        color: FmTheme.palette.onSurface
                        font.pointSize: FmTheme.font.size.md
                        font.weight: Font.DemiBold
                        elide: Text.ElideMiddle
                        Layout.fillWidth: true
                    }
                }

                // Separator
                Rectangle {
                    Layout.fillWidth: true
                    height: 1
                    color: FmTheme.overlay.subtle
                }

                // === View: Actions list ===
                Loader {
                    Layout.fillWidth: true
                    active: popupScope.viewMode === "actions"
                    visible: active

                    sourceComponent: ColumnLayout {
                        spacing: FmTheme.spacing.sm

                        Component.onCompleted: dialog.forceActiveFocus()

                        Repeater {
                            model: popupScope.actionItems

                            StyledRect {
                                Layout.fillWidth: true
                                radius: FmTheme.rounding.sm
                                color: index === popupScope.actionIndex
                                    ? Qt.alpha(FmTheme.palette.primary, 0.12)
                                    : "transparent"
                                implicitHeight: actionRow.implicitHeight + FmTheme.padding.md * 2

                                Behavior on color { CAnim {} }

                                RowLayout {
                                    id: actionRow

                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.leftMargin: FmTheme.padding.lg
                                    anchors.rightMargin: FmTheme.padding.lg
                                    spacing: FmTheme.spacing.md

                                    // Keycap badge — fixed-width column
                                    Rectangle {
                                        Layout.preferredWidth: 24
                                        Layout.preferredHeight: 24
                                        Layout.alignment: Qt.AlignVCenter
                                        radius: 6
                                        color: FmTheme.overlay.subtle
                                        border.color: FmTheme.overlay.emphasis
                                        border.width: 1

                                        StyledText {
                                            anchors.centerIn: parent
                                            text: modelData.key
                                            color: FmTheme.palette.onSurface
                                            font.family: FmTheme.font.family.mono
                                            font.pointSize: FmTheme.font.size.xs
                                            font.weight: Font.DemiBold
                                        }
                                    }

                                    // Icon — fixed-width column
                                    MaterialIcon {
                                        Layout.preferredWidth: 20
                                        Layout.alignment: Qt.AlignVCenter
                                        horizontalAlignment: Text.AlignHCenter
                                        text: modelData.icon
                                        color: FmTheme.palette.onSurfaceVariant
                                        font.pointSize: FmTheme.font.size.md
                                    }

                                    // Label — fills remaining space
                                    StyledText {
                                        Layout.fillWidth: true
                                        Layout.alignment: Qt.AlignVCenter
                                        text: modelData.label
                                        color: FmTheme.palette.onSurface
                                        font.pointSize: FmTheme.font.size.sm
                                    }
                                }

                                StateLayer {
                                    onClicked: popupScope._executeAction(modelData.actionId)
                                }
                            }
                        }
                    }
                }

                // === View: Open With ===
                Loader {
                    Layout.fillWidth: true
                    active: popupScope.viewMode === "openWith"
                    visible: active

                    sourceComponent: ColumnLayout {
                        spacing: FmTheme.spacing.sm

                        // Filter input
                        StyledRect {
                            Layout.fillWidth: true
                            radius: FmTheme.rounding.sm
                            color: Qt.alpha(FmTheme.palette.onSurface, 0.06)
                            implicitHeight: filterRow.implicitHeight + FmTheme.padding.md * 2

                            RowLayout {
                                id: filterRow

                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: FmTheme.padding.lg
                                anchors.rightMargin: FmTheme.padding.lg
                                spacing: FmTheme.spacing.sm

                                MaterialIcon {
                                    text: "search"
                                    color: FmTheme.palette.outline
                                    font.pointSize: FmTheme.font.size.sm
                                }

                                TextInput {
                                    id: filterInput

                                    Layout.fillWidth: true
                                    color: FmTheme.palette.onSurface
                                    font.pointSize: FmTheme.font.size.sm
                                    font.family: FmTheme.font.family.mono
                                    selectionColor: FmTheme.palette.primary
                                    selectedTextColor: FmTheme.palette.onPrimary
                                    clip: true
                                    Component.onCompleted: forceActiveFocus()

                                    onTextChanged: {
                                        popupScope.appFilterQuery = text;
                                        popupScope._updateFilteredApps();
                                    }

                                    // Let navigation keys bubble up to the dialog handler
                                    Keys.onPressed: function(event) {
                                        if (event.key === Qt.Key_Down || event.key === Qt.Key_Up
                                            || event.key === Qt.Key_Return || event.key === Qt.Key_Enter
                                            || event.key === Qt.Key_Escape) {
                                            event.accepted = false;
                                        }
                                    }
                                }
                            }
                        }

                        // Loading indicator
                        StyledText {
                            visible: mimeQueryProcess.running
                            text: "Loading applications\u2026"
                            color: FmTheme.palette.outline
                            font.pointSize: FmTheme.font.size.sm
                        }

                        // No results
                        StyledText {
                            visible: !mimeQueryProcess.running && popupScope.filteredApps.length === 0
                            text: popupScope.appFilterQuery !== ""
                                ? "No matching applications"
                                : "No registered applications"
                            color: FmTheme.palette.outline
                            font.pointSize: FmTheme.font.size.sm
                        }

                        // App list
                        ListView {
                            id: appListView

                            Layout.fillWidth: true
                            Layout.preferredHeight: Math.min(contentHeight, 250)
                            clip: true
                            spacing: FmTheme.spacing.sm
                            model: popupScope.filteredApps
                            currentIndex: popupScope.appIndex
                            boundsBehavior: Flickable.StopAtBounds

                            delegate: StyledRect {
                                id: appDelegate

                                // Read the per-row model data once, here, into qualified
                                // properties — children reference appDelegate.* instead of
                                // the unqualified context `modelData` (no ComponentBehavior:
                                // Bound on this delegate, so a bare modelData is unresolvable).
                                readonly property string appName: modelData.name ?? ""
                                readonly property string appDesktopId: modelData.desktopId ?? ""
                                readonly property string appIconPath: modelData.iconPath ?? ""

                                width: appListView.width
                                radius: FmTheme.rounding.sm
                                color: index === popupScope.appIndex
                                    ? Qt.alpha(FmTheme.palette.primary, 0.12)
                                    : "transparent"
                                implicitHeight: appRow.implicitHeight + FmTheme.padding.md * 2

                                Behavior on color { CAnim {} }

                                RowLayout {
                                    id: appRow

                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.leftMargin: FmTheme.padding.lg
                                    anchors.rightMargin: FmTheme.padding.lg
                                    spacing: FmTheme.spacing.lg

                                    // Fixed-size icon cell — a real themed app icon when
                                    // resolved, the generic "apps" glyph otherwise. The cell
                                    // is HARD-pinned (min == preferred == max) so the layout
                                    // cannot grow it toward a child's implicit size; that
                                    // pinning is what keeps every app name's left edge aligned
                                    // regardless of icon/glyph natural dimensions.
                                    Item {
                                        readonly property real cellSize: Math.round(FmTheme.font.size.md * 1.6)

                                        Layout.minimumWidth: cellSize
                                        Layout.preferredWidth: cellSize
                                        Layout.maximumWidth: cellSize
                                        Layout.minimumHeight: cellSize
                                        Layout.preferredHeight: cellSize
                                        Layout.maximumHeight: cellSize
                                        Layout.alignment: Qt.AlignVCenter

                                        Image {
                                            anchors.fill: parent
                                            source: appDelegate.appIconPath !== ""
                                                ? "file://" + appDelegate.appIconPath
                                                : ""
                                            visible: appDelegate.appIconPath !== ""
                                            sourceSize: Qt.size(width * 2, height * 2)
                                            fillMode: Image.PreserveAspectFit
                                            asynchronous: true
                                            smooth: true
                                        }

                                        MaterialIcon {
                                            anchors.centerIn: parent
                                            visible: appDelegate.appIconPath === ""
                                            text: "apps"
                                            color: FmTheme.palette.onSurfaceVariant
                                            font.pointSize: FmTheme.font.size.md
                                        }
                                    }

                                    // Plain Column (not ColumnLayout): a nested ColumnLayout
                                    // here was NOT being stretched by the RowLayout — it
                                    // collapsed to its widest child (the desktopId) and the
                                    // row's slack was distributed around it, centering the
                                    // block so each row's name started at a different x. A
                                    // plain Column is a regular Item, so `Layout.fillWidth`
                                    // stretches it (exactly like the fillWidth StyledText in
                                    // the actions delegate above) and it left-packs both lines
                                    // at a constant x.
                                    Column {
                                        Layout.fillWidth: true
                                        Layout.alignment: Qt.AlignVCenter
                                        spacing: 1

                                        StyledText {
                                            width: parent.width
                                            elide: Text.ElideRight
                                            text: appDelegate.appName
                                            color: FmTheme.palette.onSurface
                                            font.pointSize: FmTheme.font.size.sm
                                            font.weight: Font.Medium
                                        }

                                        StyledText {
                                            width: parent.width
                                            elide: Text.ElideRight
                                            text: appDelegate.appDesktopId
                                            color: FmTheme.palette.onSurfaceVariant
                                            font.pointSize: FmTheme.font.size.xs
                                            font.family: FmTheme.font.family.mono
                                        }
                                    }
                                }

                                StateLayer {
                                    onClicked: {
                                        openWithProcess.command = ["gio", "launch", appDelegate.appDesktopId, popupScope.targetPath];
                                        openWithProcess.start();
                                        root.windowState.closeModal();
                                    }
                                }
                            }
                        }

                        // Back hint
                        StyledText {
                            text: "Esc to go back"
                            color: FmTheme.palette.outline
                            font.pointSize: FmTheme.font.size.xs
                        }
                    }
                }

                // === View: Extraction progress ===
                Loader {
                    Layout.fillWidth: true
                    active: popupScope.viewMode === "extracting"
                    visible: active

                    sourceComponent: ColumnLayout {
                        spacing: FmTheme.spacing.md

                        Component.onCompleted: dialog.forceActiveFocus()

                        MaterialIcon {
                            Layout.alignment: Qt.AlignHCenter
                            text: popupScope.extractionDone ? "check_circle" : "unarchive"
                            color: popupScope.extractionDone
                                ? FmTheme.palette.primary
                                : popupScope.extractionError !== ""
                                    ? FmTheme.palette.error
                                    : FmTheme.palette.onSurfaceVariant
                            font.pointSize: FmTheme.font.size.xxl
                            font.weight: Font.Medium
                        }

                        StyledText {
                            Layout.alignment: Qt.AlignHCenter
                            text: {
                                if (popupScope.extractionError !== "")
                                    return popupScope.extractionError;
                                if (popupScope.extractionDone)
                                    return "Extraction complete";
                                if (popupScope.extractTotalCount > 0)
                                    return "Extracting\u2026 " + popupScope.extractedCount
                                        + " / " + popupScope.extractTotalCount;
                                return "Preparing\u2026";
                            }
                            color: popupScope.extractionError !== ""
                                ? FmTheme.palette.error : FmTheme.palette.onSurface
                            font.pointSize: FmTheme.font.size.sm
                        }

                        // Progress bar
                        StyledRect {
                            Layout.fillWidth: true
                            height: 4
                            radius: 2
                            color: Qt.alpha(FmTheme.palette.onSurface, 0.06)

                            StyledRect {
                                height: parent.height
                                radius: parent.radius
                                color: popupScope.extractionError !== ""
                                    ? FmTheme.palette.error : FmTheme.palette.primary
                                width: popupScope.extractTotalCount > 0
                                    ? parent.width * Math.min(popupScope.extractedCount / popupScope.extractTotalCount, 1)
                                    : 0

                                Behavior on width { Anim {} }
                            }
                        }

                        StyledText {
                            Layout.alignment: Qt.AlignHCenter
                            visible: popupScope.extractionDone || popupScope.extractionError !== ""
                            text: "Press Enter or Escape to close"
                            color: FmTheme.palette.outline
                            font.pointSize: FmTheme.font.size.xs
                        }
                    }
                }
            }
        }

        // === Processes ===

        // Query registered applications for the MIME type
        ShellRunner {
            id: mimeQueryProcess
            onExited: (exitCode, exitStatus) => {
                if (exitCode !== 0) {
                    Logger.warn("ContextMenuPopup", "gio mime failed, exit code " + exitCode);
                    return;
                }
                popupScope._parseMimeOutput(stdoutText);
            }
        }

        // Launch selected application
        ShellRunner {
            id: openWithProcess
            onExited: (exitCode, exitStatus) => {
                if (exitCode !== 0)
                    Logger.warn("ContextMenuPopup", "gio launch failed, exit code " + exitCode);
            }
        }

        // Count archive entries for progress denominator
        ArchivePreviewModel {
            id: archiveCounter
            onDataReady: {
                popupScope.extractTotalCount = archiveCounter.totalEntries;
                popupScope._startExtraction();
            }
            onErrorChanged: {
                if (archiveCounter.error !== "") {
                    popupScope.extractionError = "Failed to read archive";
                }
            }
        }

        // Create destination subfolder
        ShellRunner {
            id: mkdirProcess
            property string destDir: ""
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    extractProcess.command = ["bsdtar", "-xvf", popupScope.targetPath, "-C", destDir];
                    extractProcess.start();
                } else {
                    popupScope.extractionError = "Failed to create directory";
                }
            }
        }

        // Extraction process with line-by-line progress (one stderr line per entry).
        ShellRunner {
            id: extractProcess
            onStderrLine: popupScope.extractedCount++
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    popupScope.extractionDone = true;
                } else {
                    popupScope.extractionError = "Extraction failed (exit code " + exitCode + ")";
                }
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
