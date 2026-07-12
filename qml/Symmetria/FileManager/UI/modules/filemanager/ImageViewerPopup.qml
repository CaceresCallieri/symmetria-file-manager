pragma ComponentBehavior: Bound

// ImageViewerPopup — the in-app image viewer overlay. Opens via
// WindowState.requestImageViewer(path) (FileOpener routes image/* here) and
// renders ABOVE the file manager as a modal, never as a separate OS window —
// that is what lets the same viewer work inside the IDE's embedded panel,
// where no window of our own exists (Wayland offers no cross-app embedding).
//
// The viewer owns its folder context: a private FileSystemModel lists the
// opened image's directory (mirroring the view's sort/hidden config) and
// ImageViewer.js filters it to images, giving j/k next/prev navigation with
// wrap-around. Display is driven by `currentPath` alone, so the target image
// shows immediately while the listing loads async.
//
// Keys: j/k · ←/→ · Space/Backspace step; g/G first/last; +/- zoom; 0 fit;
// 1 actual size; o reopen externally; Esc/q close. Modal gated on
// WindowState.modalImageViewer, following the same Loader pattern as
// HelpPopup et al.

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick
import QtQuick.Layouts
import "handlers/ImageViewer.js" as ImageViewer

Loader {
    id: root

    property WindowState windowState

    // Escalate to the external default app (the viewer's `o` key). Wired by
    // FileManager.qml to FileOpener.openExternal — the popup has no opener of
    // its own.
    signal openExternallyRequested(string path, string mimeType)

    anchors.fill: parent

    // Single source for visibility; `active` is driven from THIS (not the
    // animated opacity) to avoid a race where the Loader activates mid-fade-out
    // with an already-closed state.
    readonly property bool _shown: windowState && windowState.activeModal === windowState.modalImageViewer

    opacity: _shown ? 1 : 0
    active: _shown
    asynchronous: true

    sourceComponent: FocusScope {
        id: viewerScope

        focus: true

        // Path currently displayed. Seeded from the modal payload; j/k stepping
        // rewrites it. The index is DERIVED from it (not stored), so a listing
        // that changes mid-view (file added/deleted) re-anchors automatically.
        property string currentPath: root.windowState ? root.windowState.imageViewerPath : ""

        // Displayed scale, in displayed-px per decoded-px. Reset to fit on
        // every image load (see preview.onStatusChanged).
        property real imageScale: 1

        readonly property var images: ImageViewer.imageEntries(dirModel.entries)
        readonly property int currentIndex: ImageViewer.indexOfPath(images, currentPath)
        readonly property real _zoomStep: 1.25
        // Fit-to-viewport scale, capped at 1 so small images render 1:1
        // instead of blowing up blurry.
        readonly property real _fitScale: preview.implicitWidth > 0 && preview.implicitHeight > 0
            ? Math.min(flick.width / preview.implicitWidth, flick.height / preview.implicitHeight, 1)
            : 1

        Keys.onPressed: function(event) {
            const key = event.key;
            if (key === Qt.Key_Escape || key === Qt.Key_Q)
                root.windowState.closeModal();
            else if (key === Qt.Key_J || key === Qt.Key_Right || key === Qt.Key_Space)
                viewerScope._step(1);
            else if (key === Qt.Key_K || key === Qt.Key_Left || key === Qt.Key_Backspace)
                viewerScope._step(-1);
            else if (key === Qt.Key_G)
                viewerScope._jumpTo(event.modifiers & Qt.ShiftModifier ? viewerScope.images.length - 1 : 0);
            // Zoom glyphs match on key only, ignoring modifiers — the modifier
            // that PRODUCES +/-/= is layout-dependent (see the symbol-keys note
            // in KeyRegistry.js; on latam `=` is Shift+0).
            else if (key === Qt.Key_Plus || key === Qt.Key_Equal)
                viewerScope._zoomBy(viewerScope._zoomStep);
            else if (key === Qt.Key_Minus)
                viewerScope._zoomBy(1 / viewerScope._zoomStep);
            else if (key === Qt.Key_0)
                viewerScope.imageScale = viewerScope._fitScale;
            else if (key === Qt.Key_1)
                viewerScope.imageScale = 1;
            else if (key === Qt.Key_O) {
                const entry = viewerScope.currentIndex >= 0 ? viewerScope.images[viewerScope.currentIndex] : null;
                root.openExternallyRequested(viewerScope.currentPath, entry ? entry.mimeType : "");
                root.windowState.closeModal();
            }
            // Swallow everything so keys don't leak past the overlay into the
            // file views (same contract as HelpPopup).
            event.accepted = true;
        }

        Component.onCompleted: forceActiveFocus()

        function _step(delta: int): void {
            const next = ImageViewer.stepIndex(currentIndex, delta, images.length);
            if (next >= 0)
                currentPath = images[next].path;
        }

        function _jumpTo(index: int): void {
            const clamped = ImageViewer.clampIndex(index, images.length);
            if (clamped >= 0)
                currentPath = images[clamped].path;
        }

        // Zoom around the viewport center: capture the center as a content
        // fraction, rescale, then re-aim the viewport at the same fraction.
        function _zoomBy(factor: real): void {
            const cx = (flick.contentX + flick.width / 2) / flick.contentWidth;
            const cy = (flick.contentY + flick.height / 2) / flick.contentHeight;
            imageScale = Math.min(Math.max(imageScale * factor, 0.05), 10);
            flick.contentX = Math.min(Math.max(cx * flick.contentWidth - flick.width / 2, 0),
                                      Math.max(0, flick.contentWidth - flick.width));
            flick.contentY = Math.min(Math.max(cy * flick.contentHeight - flick.height / 2, 0),
                                      Math.max(0, flick.contentHeight - flick.height));
        }

        // Folder context for j/k: the opened image's directory, ordered like
        // the file views (same sort + hidden config), filtered to images by
        // ImageViewer.js. watchChanges stays on so a download landing mid-view
        // joins the strip.
        FileSystemModel {
            id: dirModel
            path: viewerScope.currentPath ? Paths.parentDir(viewerScope.currentPath) : ""
            showHidden: Config.fileManager.showHidden
            sortBy: root.windowState ? root.windowState.sortBy : FileSystemModel.Alphabetical
            sortReverse: root.windowState ? root.windowState.sortReverse : false
        }

        // Resolves formats needing cached decode (rpgmv, icns…) in C++; normal
        // images pass through untouched — same helper the preview pane uses.
        PreviewImageHelper {
            id: previewHelper
            source: viewerScope.currentPath
        }

        // Near-opaque backdrop so the image pops; the FM stays mounted (and
        // faintly visible) underneath — deliberately an overlay, not a window.
        StyledRect {
            anchors.fill: parent
            color: Qt.alpha(FmTheme.palette.shadow, 0.92)
        }

        Flickable {
            id: flick

            anchors.fill: parent
            contentWidth: Math.max(width, preview.width)
            contentHeight: Math.max(height, preview.height)
            boundsBehavior: Flickable.StopAtBounds
            clip: true

            Image {
                id: preview

                // Sized explicitly from the decoded size × zoom; centerIn the
                // contentItem keeps a smaller-than-viewport image centered.
                anchors.centerIn: parent
                width: implicitWidth * viewerScope.imageScale
                height: implicitHeight * viewerScope.imageScale

                source: previewHelper.resolvedUrl
                asynchronous: true
                fillMode: Image.PreserveAspectFit
                smooth: true
                mipmap: true

                // Cap decode for memory safety (a 4096² RGBA frame ≈ 67 MB).
                // Rasters are never upscaled by sourceSize, so images below the
                // cap decode at their natural size; beyond it, 100% zoom renders
                // from the capped decode (soft, but bounded).
                sourceSize.width: 4096
                sourceSize.height: 4096

                onStatusChanged: {
                    if (status === Image.Ready)
                        viewerScope.imageScale = viewerScope._fitScale;
                }
            }

            // Wheel zooms (viewer semantics, not scroll) — drag still pans via
            // the Flickable itself.
            WheelHandler {
                target: null
                onWheel: function(event) {
                    viewerScope._zoomBy(event.angleDelta.y > 0 ? viewerScope._zoomStep : 1 / viewerScope._zoomStep);
                    event.accepted = true;
                }
            }
        }

        Loader {
            anchors.centerIn: parent
            active: previewHelper.loading || preview.status === Image.Loading
            asynchronous: true

            sourceComponent: PreviewLoadingIndicator {}
        }

        Loader {
            anchors.centerIn: parent
            active: !previewHelper.loading && preview.status === Image.Error
            asynchronous: true

            sourceComponent: PreviewStateIndicator {
                iconName: "broken_image"
                message: qsTr("Cannot display image")
            }
        }

        // Bottom HUD: filename · position in the folder's images · zoom.
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
                    text: Paths.basename(viewerScope.currentPath)
                    color: FmTheme.palette.onSurface
                    font.pointSize: FmTheme.font.size.xs
                    elide: Text.ElideMiddle
                }

                StyledText {
                    visible: viewerScope.currentIndex >= 0
                    text: (viewerScope.currentIndex + 1) + " / " + viewerScope.images.length
                    color: FmTheme.palette.onSurfaceVariant
                    font.pointSize: FmTheme.font.size.xs
                    font.family: FmTheme.font.family.mono
                }

                StyledText {
                    text: Math.round(viewerScope.imageScale * 100) + "%"
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
