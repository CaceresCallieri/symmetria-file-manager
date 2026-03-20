import "../../components"
import "../../services"
import Symmetria.Models
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: root

    required property var entry

    // Exposed for PreviewMetadata
    readonly property int sheetCount: spreadsheetModel.sheetCount
    readonly property int activeSheet: spreadsheetModel.activeSheet
    readonly property int totalRows: spreadsheetModel.totalRows
    readonly property int totalCols: spreadsheetModel.totalCols

    SpreadsheetPreviewModel {
        id: spreadsheetModel
        filePath: root.entry ? root.entry.path : ""
    }

    // Imperative update avoids binding loops — QML re-enters declarative bindings
    // when the C++ model emits multiple NOTIFY signals in the same batch
    property bool _isEmpty: false  // non-readonly: written imperatively by _updateEmpty to avoid binding loop re-entry

    function _updateEmpty() {
        _isEmpty = !spreadsheetModel.loading
            && spreadsheetModel.error === ""
            && spreadsheetModel.totalRows === 0
            && spreadsheetModel.filePath !== "";
    }

    // Each signal triggers re-evaluation of the empty-state condition
    Connections {
        target: spreadsheetModel
        function onLoadingChanged() { root._updateEmpty(); }
        function onErrorChanged() { root._updateEmpty(); }
        function onTotalRowsChanged() { root._updateEmpty(); }
        function onFilePathChanged() { root._updateEmpty(); }
    }

    Component.onCompleted: root._updateEmpty()

    readonly property int _colWidth: 120
    readonly property int _rowHeight: 28

    // Use explicit x/y/width/height to fill parent — this component is loaded as a
    // Loader sourceComponent, so anchors.margins on the root would be silently ignored
    // (QUIRKS.md §1). Explicit geometry bindings are not affected by that quirk.
    ColumnLayout {
        x: 0
        y: 0
        width: parent.width
        height: parent.height
        spacing: 0

        // Sheet tabs (only visible for multi-sheet workbooks)
        Row {
            id: sheetTabBar

            visible: spreadsheetModel.sheetCount > 1
            Layout.fillWidth: true
            Layout.leftMargin: Theme.padding.sm
            Layout.topMargin: Theme.padding.sm
            spacing: 2

            Repeater {
                model: spreadsheetModel.sheetNames

                delegate: Rectangle {
                    required property int index
                    required property string modelData

                    width: tabLabel.implicitWidth + Theme.padding.md * 2
                    height: tabLabel.implicitHeight + Theme.padding.sm * 2
                    radius: Theme.rounding.sm
                    color: (index === spreadsheetModel.activeSheet
                        ? Theme.palette.m3primaryContainer
                        : Theme.palette.m3surfaceContainer) ?? "transparent"

                    StyledText {
                        id: tabLabel

                        anchors.centerIn: parent
                        text: modelData
                        color: (index === spreadsheetModel.activeSheet
                            ? Theme.palette.m3onPrimaryContainer
                            : Theme.palette.m3onSurfaceVariant) ?? Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.sm
                        font.family: Theme.font.family.mono
                        font.weight: index === spreadsheetModel.activeSheet ? 600 : 400
                    }

                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: spreadsheetModel.activeSheet = index
                    }
                }
            }
        }

        // Table area
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            HorizontalHeaderView {
                id: headerView

                syncView: tableView
                anchors.left: parent.left
                anchors.top: parent.top
                clip: true

                delegate: Rectangle {
                    implicitWidth: root._colWidth
                    implicitHeight: 24
                    color: Theme.palette.m3surfaceContainerHigh

                    StyledText {
                        anchors.centerIn: parent
                        text: display ?? ""
                        color: Theme.palette.m3onSurfaceVariant
                        font.pointSize: Theme.font.size.sm
                        font.family: Theme.font.family.mono
                        font.weight: 600
                    }
                }
            }

            TableView {
                id: tableView

                anchors.top: headerView.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.leftMargin: Theme.padding.sm
                anchors.rightMargin: Theme.padding.sm
                anchors.bottomMargin: Theme.padding.sm
                clip: true
                focus: false
                interactive: false
                boundsBehavior: Flickable.StopAtBounds
                alternatingRows: true
                columnSpacing: 1
                rowSpacing: 0

                model: spreadsheetModel

                columnWidthProvider: function(column) { return root._colWidth; }
                rowHeightProvider: function(row) { return root._rowHeight; }

                delegate: Rectangle {
                    implicitWidth: root._colWidth
                    implicitHeight: root._rowHeight
                    color: row % 2 === 0
                        ? Theme.palette.m3surfaceContainerLowest
                        : Theme.palette.m3surfaceContainer

                    StyledText {
                        anchors.fill: parent
                        anchors.leftMargin: 6
                        anchors.rightMargin: 6
                        text: display ?? ""
                        elide: Text.ElideRight
                        verticalAlignment: Text.AlignVCenter
                        color: Theme.palette.m3onSurface
                        font.pointSize: Theme.font.size.xs
                        font.family: Theme.font.family.mono
                    }
                }

                opacity: spreadsheetModel.totalRows > 0 ? 1 : 0

                Behavior on opacity {
                    Anim {}
                }
            }
        }

        // Truncation indicator
        StyledText {
            visible: spreadsheetModel.truncatedRows || spreadsheetModel.truncatedCols
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: Theme.padding.sm
            text: {
                // rowCount()/columnCount() are method calls and are not tracked by the
                // QML binding engine on their own. They are safe here because this
                // binding already depends on truncatedRows/truncatedCols, which change
                // on the same dataReady signal that also updates the row/column counts.
                // The binding always re-evaluates with correct values.
                let parts = [];
                if (spreadsheetModel.truncatedRows)
                    parts.push(qsTr("Showing %1 of %2 rows").arg(spreadsheetModel.rowCount()).arg(spreadsheetModel.totalRows));
                if (spreadsheetModel.truncatedCols)
                    parts.push(qsTr("%1 of %2 columns").arg(spreadsheetModel.columnCount()).arg(spreadsheetModel.totalCols));
                return parts.join(", ");
            }
            color: Theme.palette.m3outline
            font.pointSize: Theme.font.size.sm
            font.family: Theme.font.family.mono
        }
    }

    // Loading indicator
    Loader {
        anchors.centerIn: parent
        active: spreadsheetModel.loading
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.sm

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "hourglass_empty"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Loading\u2026")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.md
            }
        }
    }

    // Error state
    Loader {
        anchors.centerIn: parent
        active: spreadsheetModel.error !== ""
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.md

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "block"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Cannot preview")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xl
                font.weight: 500
            }
        }
    }

    // Empty spreadsheet indicator
    Loader {
        anchors.centerIn: parent
        active: root._isEmpty
        asynchronous: true

        sourceComponent: ColumnLayout {
            spacing: Theme.spacing.md

            MaterialIcon {
                Layout.alignment: Qt.AlignHCenter
                text: "grid_off"
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xxl * 2
                font.weight: 500
            }

            StyledText {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Empty spreadsheet")
                color: Theme.palette.m3outline
                font.pointSize: Theme.font.size.xl
                font.weight: 500
            }
        }
    }
}
