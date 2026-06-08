pragma ComponentBehavior: Bound

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts

// FuzzyFinderInfoPanel — the right-hand File Info pane of the fuzzy finder.
//
// Purely a function of the highlighted row's `entry` (a plain object built from
// the FuzzyFinder model roles: name/fullPath/isDir/size/modified/gitStatus).
// Shows compact metadata (size/type/git/modified) and a full preview via the
// shared PreviewContent router — the same previews the normal pane renders.
// Extracted from FuzzyFinderPopup so that popup stays focused (and under the
// god-file threshold) and the info pane is reusable/testable on its own.
ColumnLayout {
    id: root

    required property var entry          // selected-row data | {} when none
    property WindowState windowState

    spacing: FmTheme.spacing.sm

    // Debounced path → FileInfo so arrowing with j/k doesn't build a
    // FileSystemEntry per keystroke (mirrors PreviewPanel's 150ms debounce).
    property string _previewPath: ""
    onEntryChanged: previewDebounce.restart()

    Timer {
        id: previewDebounce
        interval: 150
        repeat: false
        onTriggered: root._previewPath = root.entry?.fullPath ?? ""
    }

    // Path → FileSystemEntry, driving the SAME PreviewContent router the normal
    // preview pane uses (images, PDF, video, audio, text/code, archives,
    // spreadsheets, directories). Directories are included — FileInfo flags
    // isDir and PreviewContent lists their contents.
    FileInfo {
        id: selectedInfo
        path: root._previewPath
    }

    // Shared styles for the compact metadata pairs.
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

    // File name
    StyledText {
        Layout.fillWidth: true
        text: root.entry.name || ""
        color: FmTheme.palette.onSurface
        font.pointSize: FmTheme.font.size.sm
        font.weight: Font.DemiBold
        font.family: FmTheme.font.family.mono
        elide: Text.ElideMiddle
    }

    // Metadata — compact 2-up grid. Each cell is a space-between label/value
    // pair, two per row, so the four facts occupy two tight rows and leave the
    // preview more room.
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
                text: root.entry.isDir
                      ? qsTr("dir")
                      : FileManagerService.formatSize(root.entry.size || 0)
            }
        }
        // Type
        RowLayout {
            Layout.fillWidth: true
            spacing: FmTheme.spacing.sm
            MetaLabel { text: qsTr("Type") }
            Item { Layout.fillWidth: true }
            MetaValue { text: root._typeLabel(root.entry) }
        }
        // Git
        RowLayout {
            Layout.fillWidth: true
            spacing: FmTheme.spacing.sm
            // Compute the git status badge shape once and reuse it for both the
            // visible check and the status binding, avoiding a double call to
            // the _gitStatusObj switch statement.
            readonly property var _gitObj: root._gitStatusObj(root.entry.gitStatus)
            MetaLabel { text: qsTr("Git") }
            Item { Layout.fillWidth: true }
            GitStatusBadge {
                id: gitBadge
                visible: parent._gitObj !== null
                status: parent._gitObj || ({ char: "?", color: FmTheme.palette.outline })
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
                text: root.entry.modified
                      ? FileManagerService.formatDate(root.entry.modified)
                      : "—"
            }
        }
    }

    // Preview — fills ALL remaining panel height. The shared PreviewContent
    // router renders whatever type the highlighted file is. It is the only
    // fillHeight child, so it absorbs every pixel left below the metadata.
    StyledRect {
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.topMargin: FmTheme.spacing.sm
        radius: FmTheme.rounding.sm
        color: Qt.alpha(FmTheme.palette.onSurface, 0.04)
        clip: true

        PreviewContent {
            anchors.fill: parent
            entry: selectedInfo.entry
            windowState: root.windowState
        }
    }

    // === Functions ===

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
}
