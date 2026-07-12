// Pure helpers for the in-app image viewer overlay (ImageViewerPopup).
//
// Owns the "which images live in this folder / what's next-prev" math so it is
// hermetically testable (tst_imageviewer.qml imports this file directly — no
// UI-module load), the same testability pattern ImageChord.js and
// KeyRegistry.js follow. `.pragma library` keeps it stateless: every function
// is pure, taking plain data and returning plain data with no QML-scope or
// singleton access.
.pragma library

// Filter a directory listing down to its image entries, preserving order.
// Accepts any array-like of FileSystemEntry-shaped objects (a
// QQmlListProperty indexes like a JS array); defensive against null/undefined
// slots and a missing isImage prop so callers can pass a model's raw entries.
// Returns a plain JS array (the same entry references, not copies).
function imageEntries(entries) {
    const out = [];
    if (!entries)
        return out;
    for (let i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].isImage)
            out.push(entries[i]);
    }
    return out;
}

// Index of the entry whose .path equals `path`, or -1 when absent (path not
// an image, file deleted mid-view, listing not loaded yet).
function indexOfPath(images, path) {
    if (!images || !path)
        return -1;
    for (let i = 0; i < images.length; i++) {
        if (images[i].path === path)
            return i;
    }
    return -1;
}

// Step from `current` by `delta` (±1 in practice), wrapping around both ends
// so the viewer cycles through the folder like swayimg. Returns -1 when the
// list is empty. A missing anchor (current === -1, e.g. the viewed file was
// deleted or the listing just arrived) lands on the first image for a forward
// step and the last for a backward step, so navigation stays usable instead
// of dead-ending.
function stepIndex(current, delta, count) {
    if (count <= 0)
        return -1;
    if (current < 0)
        return delta >= 0 ? 0 : count - 1;
    return ((current + delta) % count + count) % count;
}

// Clamp an absolute jump target (g / G) into the list's bounds; -1 when empty.
function clampIndex(index, count) {
    if (count <= 0)
        return -1;
    return Math.min(Math.max(index, 0), count - 1);
}
