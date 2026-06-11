// Shared file-operation key dispatch — the single source of truth for the
// operation keybindings (delete/rename/create/yank/cut/paste/select + chord
// starts) so the Miller-columns view and the tree view stay at feature parity.
// A new operation added here appears in BOTH views automatically; do NOT add
// operation keys to a view's own switch.
//
// Non-library JS — imported by BOTH FileList.qml and FileTreeView.qml, so each
// importer gets its own instance sharing that file's component scope.
// Singletons accessed via scope: FileManagerService, Paths, Qt.
//
// Contract for the `root` argument (the importing view's root item):
//   windowState                — WindowState instance (callers must not invoke
//                                tryHandle with a null windowState)
//   currentEntry               — FileSystemEntry under the cursor, or null
//   fileOpsTargetDir()         — absolute dir paste/create lands in
//                                (Miller: currentPath; tree: hovered dir, or
//                                the hovered file's parent)
//   setPendingPasteFocus(name) — request cursor focus on `name` after the
//                                model refreshes (no-op where unsupported)
//
// Key-ownership split: this handler claims only the UNMODIFIED operation keys
// (plus Ctrl+V paste and the picker-specific Ctrl+R). Modified forms stay
// view-owned because their meaning legitimately differs per view — Ctrl+D /
// Shift+D are half-page / history in both, but Shift+R is rename-with-extension
// in Miller and refresh-all in the tree. Returning false hands the key back to
// the view's own switch.

// Keys suppressed in picker mode (clipboard operations don't belong in a file chooser).
// Note: Key_C is intentionally absent — it starts the harmless "copy path" chord.
// Note: Key_V (Ctrl+V paste) is suppressed separately below — only the Ctrl-modified form
// is blocked; bare V is unbound, so it cannot live in this array alongside modifier-agnostic keys.
// Create (A), Rename (R), and Delete (D) are allowed — common workflows in file dialogs.
var _PICKER_SUPPRESSED_KEYS = [Qt.Key_Y, Qt.Key_X, Qt.Key_P, Qt.Key_Space,
    Qt.Key_T, Qt.Key_BracketLeft, Qt.Key_BracketRight];

// Returns true when the event was consumed (operation dispatched or key
// suppressed); false hands the key back to the calling view's own switch.
function tryHandle(event, root, view, pasteProcess) {
    var windowState = root.windowState;
    var key = event.key;
    var mods = event.modifiers;

    // Picker mode: Escape cancels, suppress clipboard operations
    if (FileManagerService.pickerMode) {
        if (key === Qt.Key_Escape) {
            // Multi-select: first Escape clears marks, second cancels picker
            if (FileManagerService.pickerMultiple && windowState.selectedCount > 0)
                windowState.clearSelection();
            else
                FileManagerService.cancelPickerMode();
            event.accepted = true;
            return true;
        }
        // Suppress clipboard operations — they don't belong in a picker.
        // Space is exempt when multi-select is active (marking files before confirm).
        if (_PICKER_SUPPRESSED_KEYS.indexOf(key) !== -1
                && !(key === Qt.Key_Space && FileManagerService.pickerMultiple)
                && !(key === Qt.Key_P && (mods & Qt.ControlModifier))) {
            event.accepted = true;
            return true;
        }
        // Suppress Ctrl+V (paste) in picker mode
        if (key === Qt.Key_V && (mods & Qt.ControlModifier)) {
            event.accepted = true;
            return true;
        }
    }

    switch (key) {
    case Qt.Key_D:
        // Ctrl+D (half-page) / Shift+D (history forward) are view-owned
        if (mods & (Qt.ControlModifier | Qt.ShiftModifier))
            return false;
        // d — trash file(s) (request confirmation)
        if (windowState.selectedCount > 0) {
            windowState.requestDelete(windowState.getSelectedPathsArray());
            windowState.clearSelection();
        } else if (root.currentEntry) {
            windowState.requestDelete([root.currentEntry.path]);
        }
        event.accepted = true;
        return true;

    case Qt.Key_R:
        if ((mods & Qt.ControlModifier) && FileManagerService.pickerSaveMode) {
            // Ctrl+R in save mode: activate inline save-name editing in status bar
            FileManagerService.saveNameEditing = true;
            event.accepted = true;
            return true;
        }
        // Shift+R is view-owned: rename-with-extension in Miller, refresh-all
        // in the tree. (Rename's popup toggles extension selection via Tab, so
        // the tree loses nothing.)
        if (mods & (Qt.ControlModifier | Qt.ShiftModifier))
            return false;
        if (root.currentEntry)
            windowState.requestRename(root.currentEntry.path, false);
        event.accepted = true;
        return true;

    case Qt.Key_A:
        if (mods & (Qt.ControlModifier | Qt.ShiftModifier))
            return false;
        windowState.requestCreate(root.fileOpsTargetDir());
        event.accepted = true;
        return true;

    case Qt.Key_Y:
        if (mods & Qt.ControlModifier)
            return false;
        if (windowState.selectedCount > 0) {
            FileManagerService.yank(windowState.getSelectedPathsArray());
            windowState.clearSelection();
        } else if (root.currentEntry) {
            FileManagerService.yank([root.currentEntry.path]);
        }
        event.accepted = true;
        return true;

    case Qt.Key_X:
        if (mods & Qt.ControlModifier)
            return false;
        if (windowState.selectedCount > 0) {
            FileManagerService.cut(windowState.getSelectedPathsArray());
            windowState.clearSelection();
        } else if (root.currentEntry) {
            FileManagerService.cut([root.currentEntry.path]);
        }
        event.accepted = true;
        return true;

    case Qt.Key_P:
        // Ctrl+P (audio playback toggle) is view-owned
        if (mods & Qt.ControlModifier)
            return false;
        _executePaste(root, pasteProcess);
        event.accepted = true;
        return true;

    case Qt.Key_V:
        if (mods & Qt.ControlModifier) {
            _executePaste(root, pasteProcess);
            event.accepted = true;
            return true;
        }
        // bare V is unbound — let event propagate
        return false;

    case Qt.Key_Space:
        if (root.currentEntry) {
            // In picker mode, only allow selecting the correct type:
            // directory picker → dirs only, file picker → files only.
            if (FileManagerService.pickerMode && !FileManagerService.pickerSaveMode
                    && FileManagerService.pickerDirectory !== root.currentEntry.isDir) {
                event.accepted = true;
                return true;
            }
            windowState.toggleSelection(root.currentEntry.path);
            // Advance cursor after toggling, like Yazi
            if (view.currentIndex < view.count - 1)
                view.currentIndex++;
        }
        event.accepted = true;
        return true;

    case Qt.Key_Escape:
        if (windowState.selectedCount > 0) {
            windowState.clearSelection();
            event.accepted = true;
            return true;
        }
        return false;

    // --- Chord starts (resolution lives in ChordHandler.resolveChord,
    //     invoked from each view's Keys.onPressed while a prefix is active) ---
    case Qt.Key_G:
        // Shift+G (jump to bottom) is view-owned
        if (mods & (Qt.ControlModifier | Qt.ShiftModifier))
            return false;
        windowState.activeChordPrefix = "g";
        event.accepted = true;
        return true;

    case Qt.Key_C:
        if (mods & (Qt.ControlModifier | Qt.ShiftModifier))
            return false;
        windowState.activeChordPrefix = "c";
        event.accepted = true;
        return true;

    case Qt.Key_Comma:
        windowState.activeChordPrefix = ",";
        event.accepted = true;
        return true;
    }

    return false;
}

function _executePaste(root, pasteProcess) {
    if (FileManagerService.clipboardPaths.length === 0 || pasteProcess.running)
        return;

    var paths = FileManagerService.clipboardPaths;
    var destDir = root.fileOpsTargetDir();

    // Focus the first pasted item after the model refreshes
    root.setPendingPasteFocus(Paths.basename(paths[0]));

    // cp and mv both accept multiple source args before a single destination
    if (FileManagerService.clipboardMode === "yank")
        pasteProcess.command = ["cp", "-r", "--"].concat(paths).concat([destDir]);
    else
        pasteProcess.command = ["mv", "--"].concat(paths).concat([destDir]);

    pasteProcess.start();
}
