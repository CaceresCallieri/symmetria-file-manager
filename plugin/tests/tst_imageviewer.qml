// Hermetic tests for ImageViewer.js — the pure folder-navigation helpers
// behind the in-app image viewer overlay (ImageViewerPopup). Like
// tst_chordbindings.qml, this imports ONLY the .js + QtQuick/QtTest, never the
// UI module, so it runs in CI where Symmetria.FileManager.UI is not installed.

import QtQuick
import QtTest
import "../../qml/Symmetria/FileManager/UI/modules/filemanager/handlers/ImageViewer.js" as ImageViewer

TestCase {
    name: "ImageViewer"

    // Stand-ins shaped like FileSystemEntry (only the fields the helpers read).
    function _entries() {
        return [
            { path: "/d/a.txt", isImage: false },
            { path: "/d/b.png", isImage: true },
            { path: "/d/sub", isImage: false },
            { path: "/d/c.jpg", isImage: true },
            { path: "/d/d.webp", isImage: true }
        ];
    }

    // --- imageEntries ---------------------------------------------------------

    function test_imageEntries_filtersToImagesPreservingOrder() {
        const images = ImageViewer.imageEntries(_entries());
        compare(images.length, 3);
        compare(images[0].path, "/d/b.png");
        compare(images[1].path, "/d/c.jpg");
        compare(images[2].path, "/d/d.webp");
    }

    function test_imageEntries_toleratesNullListAndNullSlots() {
        compare(ImageViewer.imageEntries(null).length, 0);
        compare(ImageViewer.imageEntries(undefined).length, 0);
        const withHoles = [null, { path: "/d/x.png", isImage: true }, undefined, {}];
        const images = ImageViewer.imageEntries(withHoles);
        compare(images.length, 1);
        compare(images[0].path, "/d/x.png");
    }

    // --- indexOfPath ----------------------------------------------------------

    function test_indexOfPath_findsAndMisses() {
        const images = ImageViewer.imageEntries(_entries());
        compare(ImageViewer.indexOfPath(images, "/d/c.jpg"), 1);
        compare(ImageViewer.indexOfPath(images, "/d/a.txt"), -1);
        compare(ImageViewer.indexOfPath(images, "/nope.png"), -1);
    }

    function test_indexOfPath_toleratesEmptyInputs() {
        compare(ImageViewer.indexOfPath([], "/d/b.png"), -1);
        compare(ImageViewer.indexOfPath(null, "/d/b.png"), -1);
        compare(ImageViewer.indexOfPath(ImageViewer.imageEntries(_entries()), ""), -1);
    }

    // --- stepIndex ------------------------------------------------------------

    function test_stepIndex_wrapsBothEnds() {
        compare(ImageViewer.stepIndex(2, 1, 3), 0);   // forward off the end
        compare(ImageViewer.stepIndex(0, -1, 3), 2);  // backward off the start
        compare(ImageViewer.stepIndex(1, 1, 3), 2);   // plain forward
        compare(ImageViewer.stepIndex(1, -1, 3), 0);  // plain backward
    }

    function test_stepIndex_missingAnchorLandsOnAnEnd() {
        compare(ImageViewer.stepIndex(-1, 1, 5), 0);   // deleted file, j → first
        compare(ImageViewer.stepIndex(-1, -1, 5), 4);  // deleted file, k → last
    }

    function test_stepIndex_emptyListIsDead() {
        compare(ImageViewer.stepIndex(0, 1, 0), -1);
        compare(ImageViewer.stepIndex(-1, -1, 0), -1);
    }

    // --- clampIndex -----------------------------------------------------------

    function test_clampIndex_boundsJumps() {
        compare(ImageViewer.clampIndex(0, 4), 0);
        compare(ImageViewer.clampIndex(3, 4), 3);
        compare(ImageViewer.clampIndex(99, 4), 3);
        compare(ImageViewer.clampIndex(-5, 4), 0);
        compare(ImageViewer.clampIndex(0, 0), -1);
    }
}
