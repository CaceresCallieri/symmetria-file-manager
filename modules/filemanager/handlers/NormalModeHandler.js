// Normal-mode key handling: picker suppression + main switch + helpers.
//
// Non-library JS — shares the QML component scope of FileList.qml.
// Singletons accessed via scope: FileManagerService, Config, Paths, Logger.
// Component IDs accessed via scope: fsModel.

// Keys suppressed in picker mode (clipboard operations don't belong in a file chooser).
// Note: Key_C is intentionally absent — it starts the harmless "copy path" chord.
// Note: Key_V (Ctrl+V paste) is suppressed separately below — only the Ctrl-modified form
// is blocked; bare V is unbound, so it cannot live in this array alongside modifier-agnostic keys.
// Create (A), Rename (R), and Delete (D) are allowed — common workflows in file dialogs.
var _PICKER_SUPPRESSED_KEYS = [Qt.Key_Y, Qt.Key_X, Qt.Key_P, Qt.Key_Space,
    Qt.Key_T, Qt.Key_BracketLeft, Qt.Key_BracketRight];

function handleKey(event, root, view, pasteProcess, clipboardCopyProcess) {
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
            return;
        }
        // Suppress clipboard operations — they don't belong in a picker.
        // Space is exempt when multi-select is active (marking files before confirm).
        if (_PICKER_SUPPRESSED_KEYS.indexOf(key) !== -1
                && !(key === Qt.Key_Space && FileManagerService.pickerMultiple)
                && !(key === Qt.Key_P && (mods & Qt.ControlModifier))) {
            event.accepted = true;
            return;
        }
        // Suppress Ctrl+V (paste) in picker mode
        if (key === Qt.Key_V && (mods & Qt.ControlModifier)) {
            event.accepted = true;
            return;
        }
    }

    switch (key) {
    case Qt.Key_J:
    case Qt.Key_Down:
        if (view.currentIndex < view.count - 1)
            view.currentIndex++;
        event.accepted = true;
        break;

    case Qt.Key_K:
    case Qt.Key_Up:
        if (view.currentIndex > 0)
            view.currentIndex--;
        event.accepted = true;
        break;

    case Qt.Key_H:
    case Qt.Key_Left:
        root._saveCursorAndNavigate(function() { windowState.goUp(); });
        event.accepted = true;
        break;

    case Qt.Key_L:
    case Qt.Key_Right:
        root._navigateIntoCurrentItem();
        event.accepted = true;
        break;

    case Qt.Key_Return:
    case Qt.Key_Enter:
        if (mods & Qt.ControlModifier) {
            // Ctrl+Enter: open context menu for current file (not directories)
            if (root.currentEntry && !root.currentEntry.isDir) {
                windowState.requestContextMenu(
                    root.currentEntry.path,
                    root.currentEntry.mimeType
                );
            }
        } else if ((mods & Qt.ShiftModifier) && FileManagerService.pickerMode) {
            // Shift+Enter in picker: copy path to clipboard, then confirm + close.
            // _activateCurrentItem is called inside the wl-copy exit callback so
            // the picker window stays open until the clipboard write completes.
            _copyPickerPathToClipboard(root, clipboardCopyProcess, function() { root._activateCurrentItem(); });
        } else {
            root._activateCurrentItem();
        }
        event.accepted = true;
        break;

    case Qt.Key_G:
        if (mods & Qt.ShiftModifier) {
            // G — jump to last
            if (view.count > 0) {
                view.currentIndex = view.count - 1;
                view.positionViewAtIndex(view.count - 1, ListView.End);
            }
        } else {
            // g — start "go to" chord, show which-key popup
            windowState.activeChordPrefix = "g";
        }
        event.accepted = true;
        break;

    case Qt.Key_C:
        // c — start "copy to clipboard" chord
        windowState.activeChordPrefix = "c";
        event.accepted = true;
        break;

    case Qt.Key_D:
        if (mods & Qt.ControlModifier) {
            // Ctrl+D — half-page down
            if (view.count > 0) {
                view.currentIndex = Math.min(view.currentIndex + _halfPageCount(view), view.count - 1);
                view.positionViewAtIndex(view.currentIndex, ListView.Contain);
            }
        } else {
            // D — trash file(s) (request confirmation)
            if (windowState.selectedCount > 0) {
                windowState.requestDelete(windowState.getSelectedPathsArray());
                windowState.clearSelection();
            } else if (root.currentEntry) {
                windowState.requestDelete([root.currentEntry.path]);
            }
        }
        event.accepted = true;
        break;

    case Qt.Key_U:
        if ((mods & Qt.ControlModifier) && view.count > 0) {
            view.currentIndex = Math.max(view.currentIndex - _halfPageCount(view), 0);
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
        }
        event.accepted = true;
        break;

    case Qt.Key_Period:
        Config.fileManager.showHidden = !Config.fileManager.showHidden;
        Config.save();
        event.accepted = true;
        break;

    case Qt.Key_AsciiTilde:
        root._saveCursorAndNavigate(function() { windowState.navigate(Paths.home); });
        event.accepted = true;
        break;

    case Qt.Key_Minus:
        root._saveCursorAndNavigate(function() { windowState.back(); });
        event.accepted = true;
        break;

    case Qt.Key_Equal:
        root._saveCursorAndNavigate(function() { windowState.forward(); });
        event.accepted = true;
        break;

    case Qt.Key_Tab:
        if ((mods & Qt.ControlModifier) && root.tabManager) {
            // Ctrl+Tab — next tab
            root.tabManager.nextTab();
        } else {
            // Bare Tab — jump between dirs block and files block
            _jumpToDirFileBoundary(root, view);
        }
        event.accepted = true;
        break;

    case Qt.Key_Backtab:
        // Ctrl+Shift+Tab — previous tab
        if ((mods & Qt.ControlModifier) && root.tabManager)
            root.tabManager.prevTab();
        event.accepted = true;
        break;

    case Qt.Key_Slash:
        root._preSearchIndex = view.currentIndex;
        windowState.startSearch();
        event.accepted = true;
        break;

    case Qt.Key_S:
        Logger.info("Flash", "S pressed → entering flash mode (cursor at " + view.currentIndex + ")");
        root._preFlashIndex = view.currentIndex;
        // Invalidate before starting — preview column entries may have changed
        // since the last flash session (cursor moved to different directory entry).
        FlashHandler.invalidateEntryCache();
        windowState.startFlash();
        event.accepted = true;
        break;

    case Qt.Key_Y:
        if (windowState.selectedCount > 0) {
            FileManagerService.yank(windowState.getSelectedPathsArray());
            windowState.clearSelection();
        } else if (root.currentEntry) {
            FileManagerService.yank([root.currentEntry.path]);
        }
        event.accepted = true;
        break;

    case Qt.Key_X:
        if (windowState.selectedCount > 0) {
            FileManagerService.cut(windowState.getSelectedPathsArray());
            windowState.clearSelection();
        } else if (root.currentEntry) {
            FileManagerService.cut([root.currentEntry.path]);
        }
        event.accepted = true;
        break;

    case Qt.Key_P:
        if (mods & Qt.ControlModifier) {
            windowState.audioPlaybackToggle();
        } else {
            _executePaste(root, pasteProcess);
        }
        event.accepted = true;
        break;

    case Qt.Key_V:
        if (mods & Qt.ControlModifier) {
            _executePaste(root, pasteProcess);
            event.accepted = true;
        }
        // bare V is unbound — let event propagate
        break;

    case Qt.Key_N:
        if (!windowState.searchActive && windowState.matchIndices.length > 0) {
            if (mods & Qt.ShiftModifier)
                windowState.previousMatch();
            else
                windowState.nextMatch();
            event.accepted = true;
        }
        break;

    case Qt.Key_Space:
        if (root.currentEntry) {
            // In picker mode, only allow selecting the correct type:
            // directory picker → dirs only, file picker → files only.
            if (FileManagerService.pickerMode && !FileManagerService.pickerSaveMode) {
                if (FileManagerService.pickerDirectory && !root.currentEntry.isDir)
                    break;
                if (!FileManagerService.pickerDirectory && root.currentEntry.isDir)
                    break;
            }
            windowState.toggleSelection(root.currentEntry.path);
            // Advance cursor after toggling, like Yazi
            if (view.currentIndex < view.count - 1)
                view.currentIndex++;
        }
        event.accepted = true;
        break;

    case Qt.Key_Escape:
        if (windowState.selectedCount > 0)
            windowState.clearSelection();
        event.accepted = true;
        break;

    case Qt.Key_Z:
        windowState.saveCursor(windowState.currentPath, view.currentIndex);
        windowState.requestZoxide();
        event.accepted = true;
        break;

    case Qt.Key_A:
        windowState.requestCreate();
        event.accepted = true;
        break;

    case Qt.Key_R:
        if (root.currentEntry) {
            var includeExt = (mods & Qt.ShiftModifier) !== 0;
            windowState.requestRename(root.currentEntry.path, includeExt);
        }
        event.accepted = true;
        break;

    case Qt.Key_Comma:
        windowState.activeChordPrefix = ",";
        event.accepted = true;
        break;

    // === Tab management ===
    case Qt.Key_T:
        if (root.tabManager)
            root.tabManager.createTab(windowState.currentPath);
        event.accepted = true;
        break;

    case Qt.Key_Q:
        if ((mods & Qt.ControlModifier) && root.tabManager) {
            // Ctrl+Q — close current tab; last tab closes the window
            windowState.saveCursor(windowState.currentPath, view.currentIndex);
            if (!root.tabManager.closeTab(root.tabManager.activeIndex))
                root.closeRequested();
            event.accepted = true;
        }
        break;

    case Qt.Key_BracketLeft:
        if (root.tabManager)
            root.tabManager.prevTab();
        event.accepted = true;
        break;

    case Qt.Key_BracketRight:
        if (root.tabManager)
            root.tabManager.nextTab();
        event.accepted = true;
        break;
    }
}

// --- Internal helpers (not exported, only called within this handler) ---

// Returns the clipboard-preview path for the current picker state, or "" if
// the current state has no selectable target.
function _resolvePickerPath(root) {
    if (FileManagerService.pickerSaveMode) {
        var dir = root.windowState.currentPath;
        var name = FileManagerService.pickerSuggestedName;
        if (name) {
            return dir.endsWith("/") ? dir + name : dir + "/" + name;
        }
        return dir;
    } else if (FileManagerService.pickerDirectory) {
        if (root.currentEntry && root.currentEntry.isDir)
            return root.currentEntry.path;
    } else {
        if (root.currentEntry && !root.currentEntry.isDir)
            return root.currentEntry.path;
    }
    return "";
}

// Copies picker path(s) to system clipboard, then invokes onDone() once wl-copy exits.
function _copyPickerPathToClipboard(root, clipboardCopyProcess, onDone) {
    if (clipboardCopyProcess.running)
        return;
    var text;
    if (FileManagerService.pickerMultiple && root.windowState.selectedCount > 0) {
        text = root.windowState.getSelectedPathsArray().join("\n");
    } else {
        text = _resolvePickerPath(root);
    }
    if (!text)
        return;
    clipboardCopyProcess._pendingCallback = onDone;
    clipboardCopyProcess.command = ["wl-copy", "--", text];
    clipboardCopyProcess.running = true;
}

function _executePaste(root, pasteProcess) {
    if (FileManagerService.clipboardPaths.length === 0 || pasteProcess.running)
        return;

    var paths = FileManagerService.clipboardPaths;
    var destDir = root.windowState.currentPath;

    // Focus the first pasted item after model refreshes
    root._pendingFocusName = Paths.basename(paths[0]);

    // cp and mv both accept multiple source args before a single destination
    if (FileManagerService.clipboardMode === "yank")
        pasteProcess.command = ["cp", "-r", "--"].concat(paths).concat([destDir]);
    else
        pasteProcess.command = ["mv", "--"].concat(paths).concat([destDir]);

    pasteProcess.running = true;
}

function _halfPageCount(view) {
    return Math.max(1, Math.floor(view.height / Config.fileManager.sizes.itemHeight / 2));
}

function _findFirstEntryOfType(targetIsDir) {
    var entries = fsModel.entries;
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].isDir === targetIsDir)
            return i;
    }
    return -1;
}

function _jumpToDirFileBoundary(root, view) {
    if (!root.currentEntry) return;
    var target = _findFirstEntryOfType(!root.currentEntry.isDir);
    if (target < 0) return;

    view.currentIndex = target;
    view.positionViewAtIndex(target, ListView.Contain);
}
