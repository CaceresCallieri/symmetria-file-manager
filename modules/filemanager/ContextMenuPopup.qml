import "../../components"
import "../../services"
import Symmetria.FileManager.Models
import Quickshell.Io
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    property WindowState windowState

    anchors.fill: parent

    opacity: windowState && windowState.contextMenuTargetPath !== "" ? 1 : 0
    active: windowState && !FileManagerService.pickerMode
        && windowState.contextMenuTargetPath !== ""
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
            isAudio = targetMimeType.startsWith("audio/") || targetMimeType === "application/ogg";
        }

        function _executeAction(actionId: string): void {
            if (actionId === "openWith") {
                viewMode = "openWith";
                if (targetMimeType !== "") {
                    mimeQueryProcess.command = ["gio", "mime", targetMimeType];
                    mimeQueryProcess.running = true;
                } else {
                    appList = [];
                    _updateFilteredApps();
                }
            } else if (actionId === "playToggle") {
                root.windowState.audioPlaybackToggle();
                root.windowState.cancelContextMenu();
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
                    apps.push({ desktopId: trimmed, name: _desktopIdToName(trimmed) });
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
            mkdirProcess.running = true;
        }

        function _handleActionsKeys(event): void {
            switch (event.key) {
            case Qt.Key_Escape:
                root.windowState.cancelContextMenu();
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
                    openWithProcess.running = true;
                    root.windowState.cancelContextMenu();
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
                root.windowState.cancelContextMenu();
            }
            event.accepted = true;
        }

        // Scrim backdrop — click to cancel (only when not extracting)
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            onClicked: {
                if (popupScope.viewMode !== "extracting" || popupScope.extractionDone || popupScope.extractionError !== "")
                    root.windowState.cancelContextMenu();
            }
        }

        StyledRect {
            anchors.fill: parent
            color: Qt.alpha(Theme.palette.m3shadow, 0.5)
        }

        // Dialog card
        StyledRect {
            id: dialog

            anchors.centerIn: parent
            radius: Theme.rounding.lg
            color: Theme.palette.m3surfaceContainerHigh

            width: Math.min(parent.width - Theme.padding.lg * 4, 400)
            implicitHeight: dialogContent.implicitHeight + Theme.padding.lg * 3

            scale: root.windowState && root.windowState.contextMenuTargetPath !== "" ? 1 : 0.1

            Behavior on scale {
                NumberAnimation {
                    duration: Theme.animDuration
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
                anchors.margins: Theme.padding.lg * 1.5
                spacing: Theme.spacing.md

                // Header: filename
                RowLayout {
                    spacing: Theme.spacing.sm

                    MaterialIcon {
                        text: "more_horiz"
                        color: Theme.palette.m3primary
                        font.pointSize: Theme.font.size.lg
                        font.weight: 500
                    }

                    StyledText {
                        text: popupScope.targetName
                        color: Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.md
                        font.weight: 600
                        elide: Text.ElideMiddle
                        Layout.fillWidth: true
                    }
                }

                // Separator
                Rectangle {
                    Layout.fillWidth: true
                    height: 1
                    color: Theme.overlay.subtle
                }

                // === View: Actions list ===
                Loader {
                    Layout.fillWidth: true
                    active: popupScope.viewMode === "actions"
                    visible: active

                    sourceComponent: ColumnLayout {
                        spacing: Theme.spacing.sm

                        Component.onCompleted: dialog.forceActiveFocus()

                        Repeater {
                            model: popupScope.actionItems

                            StyledRect {
                                Layout.fillWidth: true
                                radius: Theme.rounding.sm
                                color: index === popupScope.actionIndex
                                    ? Qt.alpha(Theme.palette.m3primary, 0.12)
                                    : "transparent"
                                implicitHeight: actionRow.implicitHeight + Theme.padding.md * 2

                                Behavior on color { CAnim {} }

                                RowLayout {
                                    id: actionRow

                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.leftMargin: Theme.padding.lg
                                    anchors.rightMargin: Theme.padding.lg
                                    spacing: Theme.spacing.md

                                    // Keycap badge — fixed-width column
                                    Rectangle {
                                        Layout.preferredWidth: 24
                                        Layout.preferredHeight: 24
                                        Layout.alignment: Qt.AlignVCenter
                                        radius: 6
                                        color: Theme.overlay.subtle
                                        border.color: Theme.overlay.emphasis
                                        border.width: 1

                                        StyledText {
                                            anchors.centerIn: parent
                                            text: modelData.key
                                            color: Theme.palette.m3onSurface
                                            font.family: Theme.font.family.mono
                                            font.pointSize: Theme.font.size.xs
                                            font.weight: 600
                                        }
                                    }

                                    // Icon — fixed-width column
                                    MaterialIcon {
                                        Layout.preferredWidth: 20
                                        Layout.alignment: Qt.AlignVCenter
                                        horizontalAlignment: Text.AlignHCenter
                                        text: modelData.icon
                                        color: Theme.palette.m3onSurfaceVariant
                                        font.pointSize: Theme.font.size.md
                                    }

                                    // Label — fills remaining space
                                    StyledText {
                                        Layout.fillWidth: true
                                        Layout.alignment: Qt.AlignVCenter
                                        text: modelData.label
                                        color: Theme.palette.m3onSurface
                                        font.pointSize: Theme.font.size.sm
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
                        spacing: Theme.spacing.sm

                        // Filter input
                        StyledRect {
                            Layout.fillWidth: true
                            radius: Theme.rounding.sm
                            color: Qt.alpha(Theme.palette.m3onSurface, 0.06)
                            implicitHeight: filterRow.implicitHeight + Theme.padding.md * 2

                            RowLayout {
                                id: filterRow

                                anchors.left: parent.left
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: Theme.padding.lg
                                anchors.rightMargin: Theme.padding.lg
                                spacing: Theme.spacing.sm

                                MaterialIcon {
                                    text: "search"
                                    color: Theme.palette.m3outline
                                    font.pointSize: Theme.font.size.sm
                                }

                                TextInput {
                                    id: filterInput

                                    Layout.fillWidth: true
                                    color: Theme.palette.m3onSurface
                                    font.pointSize: Theme.font.size.sm
                                    font.family: Theme.font.family.mono
                                    selectionColor: Theme.palette.m3primary
                                    selectedTextColor: Theme.palette.m3onPrimary
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
                            color: Theme.palette.m3outline
                            font.pointSize: Theme.font.size.sm
                        }

                        // No results
                        StyledText {
                            visible: !mimeQueryProcess.running && popupScope.filteredApps.length === 0
                            text: popupScope.appFilterQuery !== ""
                                ? "No matching applications"
                                : "No registered applications"
                            color: Theme.palette.m3outline
                            font.pointSize: Theme.font.size.sm
                        }

                        // App list
                        ListView {
                            id: appListView

                            Layout.fillWidth: true
                            Layout.preferredHeight: Math.min(contentHeight, 250)
                            clip: true
                            model: popupScope.filteredApps
                            currentIndex: popupScope.appIndex
                            boundsBehavior: Flickable.StopAtBounds

                            delegate: StyledRect {
                                width: appListView.width
                                radius: Theme.rounding.sm
                                color: index === popupScope.appIndex
                                    ? Qt.alpha(Theme.palette.m3primary, 0.12)
                                    : "transparent"
                                implicitHeight: appRow.implicitHeight + Theme.padding.sm * 2

                                Behavior on color { CAnim {} }

                                RowLayout {
                                    id: appRow

                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.leftMargin: Theme.padding.lg
                                    anchors.rightMargin: Theme.padding.lg
                                    spacing: Theme.spacing.sm

                                    MaterialIcon {
                                        text: "apps"
                                        color: Theme.palette.m3onSurfaceVariant
                                        font.pointSize: Theme.font.size.md
                                    }

                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 0

                                        StyledText {
                                            text: modelData.name
                                            color: Theme.palette.m3onSurface
                                            font.pointSize: Theme.font.size.sm
                                            font.weight: 500
                                        }

                                        StyledText {
                                            text: modelData.desktopId
                                            color: Theme.palette.m3onSurfaceVariant
                                            font.pointSize: Theme.font.size.xs
                                            font.family: Theme.font.family.mono
                                        }
                                    }
                                }

                                StateLayer {
                                    onClicked: {
                                        openWithProcess.command = ["gio", "launch", modelData.desktopId, popupScope.targetPath];
                                        openWithProcess.running = true;
                                        root.windowState.cancelContextMenu();
                                    }
                                }
                            }
                        }

                        // Back hint
                        StyledText {
                            text: "Esc to go back"
                            color: Theme.palette.m3outline
                            font.pointSize: Theme.font.size.xs
                        }
                    }
                }

                // === View: Extraction progress ===
                Loader {
                    Layout.fillWidth: true
                    active: popupScope.viewMode === "extracting"
                    visible: active

                    sourceComponent: ColumnLayout {
                        spacing: Theme.spacing.md

                        Component.onCompleted: dialog.forceActiveFocus()

                        MaterialIcon {
                            Layout.alignment: Qt.AlignHCenter
                            text: popupScope.extractionDone ? "check_circle" : "unarchive"
                            color: popupScope.extractionDone
                                ? Theme.palette.m3primary
                                : popupScope.extractionError !== ""
                                    ? Theme.palette.m3error
                                    : Theme.palette.m3onSurfaceVariant
                            font.pointSize: Theme.font.size.xxl
                            font.weight: 500
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
                                ? Theme.palette.m3error : Theme.palette.m3onSurface
                            font.pointSize: Theme.font.size.sm
                        }

                        // Progress bar
                        StyledRect {
                            Layout.fillWidth: true
                            height: 4
                            radius: 2
                            color: Qt.alpha(Theme.palette.m3onSurface, 0.06)

                            StyledRect {
                                height: parent.height
                                radius: parent.radius
                                color: popupScope.extractionError !== ""
                                    ? Theme.palette.m3error : Theme.palette.m3primary
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
                            color: Theme.palette.m3outline
                            font.pointSize: Theme.font.size.xs
                        }
                    }
                }
            }
        }

        // === Processes ===

        // Query registered applications for the MIME type
        Process {
            id: mimeQueryProcess
            stdout: StdioCollector {
                onStreamFinished: popupScope._parseMimeOutput(text)
            }
            onExited: (exitCode, exitStatus) => {
                if (exitCode !== 0)
                    console.warn("ContextMenuPopup: gio mime failed, exit code", exitCode);
            }
        }

        // Launch selected application
        Process {
            id: openWithProcess
            onExited: (exitCode, exitStatus) => {
                if (exitCode !== 0)
                    console.warn("ContextMenuPopup: gio launch failed, exit code", exitCode);
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
        Process {
            id: mkdirProcess
            property string destDir: ""
            onExited: (exitCode, exitStatus) => {
                if (exitCode === 0) {
                    extractProcess.command = ["bsdtar", "-xvf", popupScope.targetPath, "-C", destDir];
                    extractProcess.running = true;
                } else {
                    popupScope.extractionError = "Failed to create directory";
                }
            }
        }

        // Extraction process with line-by-line progress
        Process {
            id: extractProcess
            stderr: SplitParser {
                onRead: data => {
                    popupScope.extractedCount++;
                }
            }
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
