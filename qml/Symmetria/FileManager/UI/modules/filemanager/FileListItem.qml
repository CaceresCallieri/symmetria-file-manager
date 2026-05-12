import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts

Item {
    id: root

    required property int index
    required property FileSystemEntry modelData
    property string searchQuery: ""

    signal activated()

    function _highlightMatches(name: string, query: string): string {
        if (query === "")
            return name;

        const lowerName = name.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const qLen = query.length;
        const spanOpen = "<span style=\"background-color: " + FmTheme.palette.secondaryContainer
                       + "; color: " + FmTheme.palette.onSecondaryContainer + ";\">";
        const spanClose = "</span>";

        let result = "";
        let pos = 0;
        let matchPos;
        while ((matchPos = lowerName.indexOf(lowerQuery, pos)) !== -1) {
            result += root._htmlEscape(name.substring(pos, matchPos));
            result += spanOpen + root._htmlEscape(name.substring(matchPos, matchPos + qLen)) + spanClose;
            pos = matchPos + qLen;
        }
        result += root._htmlEscape(name.substring(pos));
        return result;
    }

    function _htmlEscape(str: string): string {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function _highlightFlash(name: string, query: string, label: string, matchStart: int): string {
        if (matchStart < 0 || query === "" || label === "")
            return root._htmlEscape(name);

        const before = name.substring(0, matchStart);
        const match = name.substring(matchStart, matchStart + query.length);
        const afterMatchStart = matchStart + query.length;
        const replacedEnd = Math.min(afterMatchStart + label.length, name.length);
        const after = name.substring(replacedEnd);

        const querySpan = "<span style=\"background-color: " + FmTheme.palette.secondaryContainer
                        + "; color: " + FmTheme.palette.onSecondaryContainer + ";\">"
                        + root._htmlEscape(match) + "</span>";

        const labelSpan = "<span style=\"background-color: " + FmTheme.palette.primary
                        + "; color: " + FmTheme.palette.onPrimary
                        + "; font-weight: 700; font-family: " + FmTheme.font.family.mono + ";\">"
                        + root._htmlEscape(label) + "</span>";

        return root._htmlEscape(before) + querySpan + labelSpan + root._htmlEscape(after);
    }

    property bool isSearchMatch: false
    property bool isSelected: false

    // Flash navigation
    property bool flashActive: false
    property string flashQuery: ""
    property string flashLabel: ""
    property int flashMatchStart: -1
    readonly property bool isFlashMatch: flashActive && flashLabel !== ""

    // Optional per-row badge data. The list owns the version counter and bumps
    // it whenever the provider emits statusChanged; this delegate reads both
    // statusProvider AND statusVersion so the binding re-evaluates on every
    // update. Null provider (default) renders no badge.
    property var statusProvider: null
    property int statusVersion: 0

    implicitHeight: Config.fileManager.sizes.itemHeight

    // Search match highlight — subtle gray tint behind matching rows
    Rectangle {
        anchors.fill: parent
        anchors.leftMargin: FmTheme.padding.sm
        anchors.rightMargin: FmTheme.padding.sm
        radius: FmTheme.rounding.full
        color: FmTheme.palette.onSurface
        opacity: root.isSearchMatch ? 0.06 : 0
        Behavior on opacity { Anim {} }
    }

    // Selection highlight — matte pill for active item
    // Separate Rectangle avoids StyledRect's color animation
    // which would cause visible stutter during rapid j/k navigation
    Rectangle {
        id: selectionHighlight

        anchors.fill: parent
        anchors.leftMargin: FmTheme.padding.sm
        anchors.rightMargin: FmTheme.padding.sm
        radius: FmTheme.rounding.full
        color: FmTheme.pillStrong.background
        border.color: FmTheme.pillStrong.border
        border.width: root.ListView.isCurrentItem ? 1 : 0
        opacity: root.ListView.isCurrentItem ? 1 : 0
    }

    // Clipboard indicator strip — left edge, above selection highlight.
    // Colors are hardcoded instead of using FmTheme palette tokens because
    // palette tokens change with wallpaper-derived color schemes, so
    // indicator colors must stay fixed to remain visually distinguishable.
    Item {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 5
        clip: true

        Rectangle {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: parent.width + FmTheme.rounding.sm
            radius: FmTheme.rounding.sm
            color: FileManagerService.clipboardMode === "cut" ? FmTheme.indicator.cut : FmTheme.indicator.yank
            // Read _clipboardSet directly so QML tracks the dependency and
            // re-evaluates when the set object reference changes.
            opacity: FileManagerService._clipboardSet[root.modelData?.path ?? ""]
                     ? 0.85 : 0

            Behavior on opacity { Anim {} }
        }
    }

    // Selection indicator strip — left edge, yellow.
    // Same visual pattern as the clipboard strip but takes precedence visually
    // when both are present (selection is the active user intent).
    // Hardcoded color for the same reason as clipboard: palette tokens change
    // with wallpaper-derived color schemes, so this must stay fixed.
    Item {
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: 5
        clip: true

        Rectangle {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: parent.width + FmTheme.rounding.sm
            radius: FmTheme.rounding.sm
            color: FmTheme.indicator.selection
            opacity: root.isSelected ? 0.85 : 0

            Behavior on opacity { Anim {} }
        }
    }

    StateLayer {
        onClicked: root.ListView.view.currentIndex = root.index

        onDoubleClicked: root.activated()
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: FmTheme.padding.lg
        anchors.rightMargin: FmTheme.padding.lg
        spacing: FmTheme.spacing.md
        opacity: root.flashActive && !root.isFlashMatch ? 0.25 : 1.0
        Behavior on opacity { Anim {} }

        // File/folder icon
        FileIcon {
            entry: root.modelData
            materialIconName: {
                if (!root.modelData)
                    return "description";
                if (root.modelData.isDir)
                    return "folder";
                if (root.modelData.isImage)
                    return "image";
                return FileManagerService.iconNameForMime(root.modelData.mimeType);
            }
            materialColor: root.modelData?.isDir ? FmTheme.palette.primary : FmTheme.palette.onSurfaceVariant
            materialFill: root.modelData?.isDir ? 1 : 0
            Layout.preferredWidth: implicitWidth
            Layout.preferredHeight: implicitHeight
        }

        // Remote mount indicator — inline network icon for SSHFS/NFS/FUSE mount points
        MaterialIcon {
            visible: root.modelData.isRemoteMount
            text: "lan"
            color: FmTheme.palette.primary
            font.pointSize: FmTheme.font.size.xs
        }

        // File name
        StyledText {
            Layout.fillWidth: !(root.modelData?.isSymlink ?? false)
            clip: root.isSearchMatch || root.isFlashMatch
            textFormat: (root.isSearchMatch || root.isFlashMatch) ? Text.RichText : Text.PlainText
            elide: (root.isSearchMatch || root.isFlashMatch) ? Text.ElideNone : Text.ElideRight
            text: {
                const name = root.modelData?.name ?? "";
                if (root.isFlashMatch)
                    return root._highlightFlash(name, root.flashQuery, root.flashLabel, root.flashMatchStart);
                if (root.isSearchMatch)
                    return root._highlightMatches(name, root.searchQuery);
                return name;
            }
            color: FmTheme.palette.onSurface
            font.pointSize: FmTheme.font.size.md
        }

        // Symlink target indicator
        StyledText {
            visible: root.modelData?.isSymlink ?? false
            Layout.fillWidth: true
            text: "→ " + Paths.shortenHomeBare(root.modelData?.symlinkTarget ?? "")
            color: FmTheme.palette.outline
            font.pointSize: FmTheme.font.size.xs
            elide: Text.ElideMiddle
        }

        // Git status badge — populated when statusProvider is wired and
        // returns non-null for this row's path. Placed before the size column
        // so it sits at the right edge of the name region for both files
        // (which have a size column) and directories (which don't).
        Loader {
            id: statusBadgeLoader
            readonly property var _badge: {
                const _tick = root.statusVersion;
                void _tick;
                if (!root.statusProvider) return null;
                if (!root.modelData) return null;
                try {
                    return root.statusProvider.statusForPath(root.modelData.path);
                } catch (e) {
                    // Provider threw — degrade gracefully, no badge.
                    return null;
                }
            }
            active: _badge !== null
            Layout.alignment: Qt.AlignVCenter
            sourceComponent: GitStatusBadge {
                status: statusBadgeLoader._badge
            }
        }

        // File size (hidden for directories)
        StyledText {
            visible: !(root.modelData?.isDir ?? true)
            text: root.modelData ? FileManagerService.formatSize(root.modelData.size) : ""
            color: FmTheme.palette.onSurfaceVariant
            font.pointSize: FmTheme.font.size.xs
            font.family: FmTheme.font.family.mono
            horizontalAlignment: Text.AlignRight
            Layout.minimumWidth: 50
        }
    }

}
