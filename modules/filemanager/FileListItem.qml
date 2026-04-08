import "../../components"
import "../../services"
import "../../config"
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
        const spanOpen = "<span style=\"background-color: " + Theme.palette.secondaryContainer
                       + "; color: " + Theme.palette.onSecondaryContainer + ";\">";
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

        const querySpan = "<span style=\"background-color: " + Theme.palette.secondaryContainer
                        + "; color: " + Theme.palette.onSecondaryContainer + ";\">"
                        + root._htmlEscape(match) + "</span>";

        const labelSpan = "<span style=\"background-color: " + Theme.palette.primary
                        + "; color: " + Theme.palette.onPrimary
                        + "; font-weight: 700; font-family: " + Theme.font.family.mono + ";\">"
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

    implicitHeight: Config.fileManager.sizes.itemHeight

    // Search match highlight — subtle gray tint behind matching rows
    Rectangle {
        anchors.fill: parent
        anchors.leftMargin: Theme.padding.sm
        anchors.rightMargin: Theme.padding.sm
        radius: Theme.rounding.full
        color: Theme.palette.onSurface
        opacity: root.isSearchMatch ? 0.06 : 0
        Behavior on opacity { Anim {} }
    }

    // Selection highlight — matte pill for active item
    // Separate Rectangle avoids StyledRect's color animation
    // which would cause visible stutter during rapid j/k navigation
    Rectangle {
        id: selectionHighlight

        anchors.fill: parent
        anchors.leftMargin: Theme.padding.sm
        anchors.rightMargin: Theme.padding.sm
        radius: Theme.rounding.full
        color: Theme.pillStrong.background
        border.color: Theme.pillStrong.border
        border.width: root.ListView.isCurrentItem ? 1 : 0
        opacity: root.ListView.isCurrentItem ? 1 : 0
    }

    // Clipboard indicator strip — left edge, above selection highlight.
    // Colors are hardcoded instead of using Theme palette tokens because
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
            width: parent.width + Theme.rounding.sm
            radius: Theme.rounding.sm
            color: FileManagerService.clipboardMode === "cut" ? Theme.indicator.cut : Theme.indicator.yank
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
            width: parent.width + Theme.rounding.sm
            radius: Theme.rounding.sm
            color: Theme.indicator.selection
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
        anchors.leftMargin: Theme.padding.lg
        anchors.rightMargin: Theme.padding.lg
        spacing: Theme.spacing.md
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
            materialColor: root.modelData?.isDir ? Theme.palette.primary : Theme.palette.onSurfaceVariant
            materialFill: root.modelData?.isDir ? 1 : 0
            Layout.preferredWidth: implicitWidth
            Layout.preferredHeight: implicitHeight
        }

        // Remote mount indicator — inline network icon for SSHFS/NFS/FUSE mount points
        MaterialIcon {
            visible: root.modelData.isRemoteMount
            text: "lan"
            color: Theme.palette.primary
            font.pointSize: Theme.font.size.xs
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
            color: Theme.palette.onSurface
            font.pointSize: Theme.font.size.md
        }

        // Symlink target indicator
        StyledText {
            visible: root.modelData?.isSymlink ?? false
            Layout.fillWidth: true
            text: "→ " + Paths.shortenHomeBare(root.modelData?.symlinkTarget ?? "")
            color: Theme.palette.outline
            font.pointSize: Theme.font.size.xs
            elide: Text.ElideMiddle
        }

        // File size (hidden for directories)
        StyledText {
            visible: !(root.modelData?.isDir ?? true)
            text: root.modelData ? FileManagerService.formatSize(root.modelData.size) : ""
            color: Theme.palette.onSurfaceVariant
            font.pointSize: Theme.font.size.xs
            font.family: Theme.font.family.mono
            horizontalAlignment: Text.AlignRight
            Layout.minimumWidth: 50
        }
    }

}
