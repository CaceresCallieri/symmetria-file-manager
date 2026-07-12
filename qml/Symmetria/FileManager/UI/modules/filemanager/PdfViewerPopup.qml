pragma ComponentBehavior: Bound

// PdfViewerPopup — the in-app PDF viewer overlay. Opens via
// WindowState.requestPdfViewer(path) (FileOpener routes application/pdf here)
// and renders ABOVE the file manager as a modal, never as a separate OS
// window — same rationale as ImageViewerPopup (works in the IDE's embedded
// panel, where no window of our own exists).
//
// Rendering: PdfDocumentModel (poppler-qt6, async load) + one PdfPageItem per
// visible page in a virtualized ListView — pages rasterize lazily and
// re-rasterize crisply when the zoom (renderWidth) changes. A horizontal
// Flickable wraps the list so a page zoomed wider than the viewport pans with
// ←/→ (the ListView keeps vertical ownership).
//
// Keys: j/k scroll; Ctrl+D/U · PgDn/PgUp half/full viewport; n/p next/prev
// page; g/G first/last; +/- zoom; 0 fit width; h/l · ←/→ pan when zoomed;
// o open externally; Esc/q close. Modal gated on WindowState.modalPdfViewer,
// following the same Loader pattern as HelpPopup et al.

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts

Loader {
    id: root

    property WindowState windowState

    // Escalate to the external default app (the viewer's `o` key). Wired by
    // FileManager.qml to FileOpener.openExternal.
    signal openExternallyRequested(string path, string mimeType)

    anchors.fill: parent

    // Single source for visibility; `active` is driven from THIS (not the
    // animated opacity) to avoid a race where the Loader activates mid-fade-out
    // with an already-closed state.
    readonly property bool _shown: windowState && windowState.activeModal === windowState.modalPdfViewer

    opacity: _shown ? 1 : 0
    active: _shown
    asynchronous: true

    sourceComponent: FocusScope {
        id: viewerScope

        focus: true

        property real zoomFactor: 1

        readonly property real _zoomStep: 1.25
        // Fit-width base: the page fills most of the viewport at zoom 1, capped
        // so ultra-wide windows don't blow a Letter page up to wall size.
        readonly property real _pageBaseWidth: Math.min(width - FmTheme.padding.lg * 4, 1000)
        readonly property real pageWidth: _pageBaseWidth * zoomFactor
        // Page under the viewport's vertical center — drives the HUD.
        readonly property int currentPage: {
            const idx = pageList.indexAt(pageList.width / 2, pageList.contentY + pageList.height / 2);
            return idx >= 0 ? idx : (pageList.contentY <= 0 ? 0 : doc.pageCount - 1);
        }

        Keys.onPressed: function(event) {
            const key = event.key;
            const ctrl = event.modifiers & Qt.ControlModifier;
            if (key === Qt.Key_Escape || key === Qt.Key_Q)
                root.windowState.closeModal();
            else if (key === Qt.Key_J || key === Qt.Key_Down)
                viewerScope._scrollBy(pageList.height * 0.12);
            else if (key === Qt.Key_K || key === Qt.Key_Up)
                viewerScope._scrollBy(-pageList.height * 0.12);
            else if ((key === Qt.Key_D && ctrl) || key === Qt.Key_PageDown || key === Qt.Key_Space)
                viewerScope._scrollBy(pageList.height * (ctrl ? 0.5 : 0.9));
            else if ((key === Qt.Key_U && ctrl) || key === Qt.Key_PageUp || key === Qt.Key_Backspace)
                viewerScope._scrollBy(-pageList.height * (ctrl ? 0.5 : 0.9));
            else if (key === Qt.Key_N)
                viewerScope._gotoPage(viewerScope.currentPage + 1);
            else if (key === Qt.Key_P)
                viewerScope._gotoPage(viewerScope.currentPage - 1);
            else if (key === Qt.Key_G && (event.modifiers & Qt.ShiftModifier))
                pageList.positionViewAtEnd();
            else if (key === Qt.Key_G)
                pageList.positionViewAtBeginning();
            else if (key === Qt.Key_L || key === Qt.Key_Right)
                viewerScope._panBy(80);
            else if (key === Qt.Key_H || key === Qt.Key_Left)
                viewerScope._panBy(-80);
            // Zoom glyphs match on key only, ignoring modifiers — the modifier
            // that PRODUCES +/-/= is layout-dependent (see the symbol-keys note
            // in KeyRegistry.js).
            else if (key === Qt.Key_Plus || key === Qt.Key_Equal)
                viewerScope.zoomFactor = Math.min(viewerScope.zoomFactor * viewerScope._zoomStep, 4);
            else if (key === Qt.Key_Minus)
                viewerScope.zoomFactor = Math.max(viewerScope.zoomFactor / viewerScope._zoomStep, 0.4);
            else if (key === Qt.Key_0)
                viewerScope.zoomFactor = 1;
            else if (key === Qt.Key_O) {
                root.openExternallyRequested(doc.source, "application/pdf");
                root.windowState.closeModal();
            }
            // Swallow everything so keys don't leak past the overlay into the
            // file views (same contract as HelpPopup / ImageViewerPopup).
            event.accepted = true;
        }

        Component.onCompleted: forceActiveFocus()

        function _scrollBy(dy: real): void {
            const maxY = Math.max(0, pageList.contentHeight - pageList.height);
            pageList.contentY = Math.min(Math.max(pageList.contentY + dy, 0), maxY);
        }

        function _panBy(dx: real): void {
            const maxX = Math.max(0, hpan.contentWidth - hpan.width);
            hpan.contentX = Math.min(Math.max(hpan.contentX + dx, 0), maxX);
        }

        function _gotoPage(page: int): void {
            if (doc.pageCount <= 0)
                return;
            const clamped = Math.min(Math.max(page, 0), doc.pageCount - 1);
            pageList.positionViewAtIndex(clamped, ListView.Beginning);
        }

        PdfDocumentModel {
            id: doc
            source: root.windowState ? root.windowState.pdfViewerPath : ""
        }

        // Near-opaque backdrop so the document pops; the FM stays mounted
        // underneath — deliberately an overlay, not a window.
        StyledRect {
            anchors.fill: parent
            color: Qt.alpha(FmTheme.palette.shadow, 0.92)
        }

        // Horizontal pan layer: only wider than the viewport when zoomed past
        // fit width. The ListView owns vertical scrolling inside it.
        Flickable {
            id: hpan

            anchors.fill: parent
            contentWidth: Math.max(width, viewerScope.pageWidth + FmTheme.padding.lg * 2)
            contentHeight: height
            flickableDirection: Flickable.HorizontalFlick
            boundsBehavior: Flickable.StopAtBounds
            clip: true

            ListView {
                id: pageList

                width: hpan.contentWidth
                height: hpan.height
                model: doc.ready ? doc.pageCount : 0
                spacing: FmTheme.spacing.md
                boundsBehavior: Flickable.StopAtBounds
                // Rasterize one viewport ahead/behind so page turns feel
                // instant without keeping the whole document in memory.
                cacheBuffer: height

                delegate: Item {
                    id: pageDelegate

                    required property int index

                    // Aspect from the page box; pageCount>0 dependency makes the
                    // binding re-evaluate once the async load lands. 1.294 (≈
                    // Letter) is a harmless pre-load placeholder.
                    readonly property size _pageSize: doc.pageCount > 0 ? doc.pageSize(index) : Qt.size(0, 0)
                    readonly property real _aspect: _pageSize.width > 0 ? _pageSize.height / _pageSize.width : 1.294

                    width: pageList.width
                    height: pageItem.height

                    PdfPageItem {
                        id: pageItem

                        anchors.horizontalCenter: parent.horizontalCenter
                        width: viewerScope.pageWidth
                        height: width * pageDelegate._aspect
                        document: doc
                        pageIndex: pageDelegate.index
                        renderWidth: Math.round(width * Screen.devicePixelRatio)
                    }
                }
            }
        }

        Loader {
            anchors.centerIn: parent
            active: doc.loading
            asynchronous: true

            sourceComponent: PreviewLoadingIndicator {}
        }

        Loader {
            anchors.centerIn: parent
            active: !doc.loading && doc.errorString !== ""
            asynchronous: true

            sourceComponent: PreviewStateIndicator {
                iconName: "picture_as_pdf"
                message: doc.errorString
            }
        }

        // Bottom HUD: filename · page position · zoom.
        StyledRect {
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: FmTheme.padding.lg
            radius: FmTheme.rounding.lg
            color: Qt.alpha(FmTheme.palette.surfaceContainerLow, 0.92)
            border.color: FmTheme.overlay.subtle
            border.width: 1
            implicitWidth: hudRow.implicitWidth + FmTheme.padding.lg * 2
            implicitHeight: hudRow.implicitHeight + FmTheme.padding.sm * 2

            RowLayout {
                id: hudRow

                anchors.centerIn: parent
                spacing: FmTheme.spacing.sm

                StyledText {
                    Layout.maximumWidth: viewerScope.width * 0.5
                    text: Paths.basename(doc.source)
                    color: FmTheme.palette.onSurface
                    font.pointSize: FmTheme.font.size.xs
                    elide: Text.ElideMiddle
                }

                StyledText {
                    visible: doc.pageCount > 0
                    text: (viewerScope.currentPage + 1) + " / " + doc.pageCount
                    color: FmTheme.palette.onSurfaceVariant
                    font.pointSize: FmTheme.font.size.xs
                    font.family: FmTheme.font.family.mono
                }

                StyledText {
                    text: Math.round(viewerScope.zoomFactor * 100) + "%"
                    color: FmTheme.palette.onSurfaceVariant
                    font.pointSize: FmTheme.font.size.xs
                    font.family: FmTheme.font.family.mono
                }
            }
        }
    }

    Behavior on opacity {
        Anim {}
    }
}
