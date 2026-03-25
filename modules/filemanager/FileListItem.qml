import "../../components"
import "../../services"
import "../../config"
import YaziFM.Models
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
        const spanOpen = "<span style=\"background-color: " + Theme.palette.m3secondaryContainer
                       + "; color: " + Theme.palette.m3onSecondaryContainer + ";\">";
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

    property bool isSearchMatch: false
    property bool isSelected: false

    implicitHeight: Config.fileManager.sizes.itemHeight

    // Search match highlight — subtle gray tint behind matching rows
    Rectangle {
        anchors.fill: parent
        radius: Theme.rounding.sm
        color: Theme.palette.m3onSurface
        opacity: root.isSearchMatch ? 0.06 : 0
        Behavior on opacity { Anim {} }
    }

    // Selection highlight — matte pill for active item
    // Separate Rectangle avoids StyledRect's color animation
    // which would cause visible stutter during rapid j/k navigation
    Rectangle {
        id: selectionHighlight

        anchors.fill: parent
        radius: Theme.rounding.sm
        color: Theme.pillStrong.background
        border.color: Theme.pillStrong.border
        border.width: root.ListView.isCurrentItem ? 1 : 0
        opacity: root.ListView.isCurrentItem ? 1 : 0
    }

    // Clipboard indicator strip — left edge, above selection highlight.
    // Colors are hardcoded instead of using Theme palette tokens because
    // Symmetria's _applyTheme IPC loop overwrites any m3* property with
    // wallpaper-derived values, clobbering our chosen indicator colors.
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
            color: FileManagerService.clipboardMode === "cut" ? "#e57373" : "#4caf7d"
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
    // Hardcoded color for the same reason as clipboard: Symmetria's _applyTheme
    // IPC loop overwrites m3* palette tokens with wallpaper-derived values.
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
            color: "#f0c674"
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

        // File/folder icon
        MaterialIcon {
            text: {
                if (!root.modelData)
                    return "description";
                if (root.modelData.isDir)
                    return "folder";
                if (root.modelData.isImage)
                    return "image";
                const mime = root.modelData.mimeType;
                if (mime.startsWith("text/"))
                    return "article";
                if (mime.startsWith("video/"))
                    return "movie";
                if (mime.startsWith("audio/"))
                    return "music_note";
                return "description";
            }
            color: root.modelData?.isDir ? Theme.palette.m3primary : Theme.palette.m3onSurfaceVariant
            fill: root.modelData?.isDir ? 1 : 0
            font.pointSize: Theme.font.size.xl
        }

        // File name
        StyledText {
            Layout.fillWidth: true
            clip: root.isSearchMatch
            textFormat: root.isSearchMatch ? Text.RichText : Text.PlainText
            elide: root.isSearchMatch ? Text.ElideNone : Text.ElideRight
            text: {
                const name = root.modelData?.name ?? "";
                if (root.isSearchMatch)
                    return root._highlightMatches(name, root.searchQuery);
                return name;
            }
            color: Theme.palette.m3onSurface
            font.pointSize: Theme.font.size.md
        }

        // File size (hidden for directories)
        StyledText {
            visible: !(root.modelData?.isDir ?? true)
            text: root.modelData ? FileManagerService.formatSize(root.modelData.size) : ""
            color: Theme.palette.m3onSurfaceVariant
            font.pointSize: Theme.font.size.xs
            font.family: Theme.font.family.mono
            horizontalAlignment: Text.AlignRight
            Layout.minimumWidth: 60
        }
    }

}
