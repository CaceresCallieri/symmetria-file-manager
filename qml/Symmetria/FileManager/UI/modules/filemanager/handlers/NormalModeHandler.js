// Normal-mode key handling for the Miller-columns view: shared file-operation
// dispatch (FileOpsHandler) first, then the view-owned navigation switch.
//
// Non-library JS — shares the QML component scope of FileList.qml.
// Singletons accessed via scope: FileManagerService, Config, Paths, Logger.
// Sibling handlers accessed via scope: FileOpsHandler (operation keys —
// delete/rename/create/yank/cut/paste/select/chord-starts live THERE, not here).
// Component IDs accessed via scope: fsModel.

function handleKey(event, root, view, pasteProcess, clipboardCopyProcess) {
    var windowState = root.windowState;
    var key = event.key;
    var mods = event.modifiers;

    // Shared file operations + picker suppression — single source of truth
    // for both Miller and tree views. Consumes the event when it handles it.
    if (FileOpsHandler.tryHandle(event, root, view, pasteProcess))
        return;

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
        // Bare g (chord start) is handled by FileOpsHandler; only Shift+G lands here.
        if (mods & Qt.ShiftModifier) {
            // G — jump to last
            if (view.count > 0) {
                view.currentIndex = view.count - 1;
                view.positionViewAtIndex(view.count - 1, ListView.End);
            }
        }
        event.accepted = true;
        break;

    case Qt.Key_D:
        // Bare d (delete) is handled by FileOpsHandler; only modified forms land here.
        if (mods & Qt.ControlModifier) {
            // Ctrl+D — half-page down
            if (view.count > 0) {
                view.currentIndex = Math.min(view.currentIndex + _halfPageCount(view), view.count - 1);
                view.positionViewAtIndex(view.currentIndex, ListView.Contain);
            }
        } else if (mods & Qt.ShiftModifier) {
            // Shift+D — navigate history forward (mirrors the PathBar forward button)
            root._saveCursorAndNavigate(function() { windowState.forward(); });
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
        if (mods & Qt.ShiftModifier) {
            // Shift+S — navigate history back (mirrors the PathBar back button)
            root._saveCursorAndNavigate(function() { windowState.back(); });
        } else {
            Logger.info("Flash", "S pressed → entering flash mode (cursor at " + view.currentIndex + ")");
            root._preFlashIndex = view.currentIndex;
            // Invalidate before starting — preview column entries may have changed
            // since the last flash session (cursor moved to different directory entry).
            FlashHandler.invalidateEntryCache();
            windowState.startFlash();
        }
        event.accepted = true;
        break;

    case Qt.Key_P:
        // Bare p (paste) is handled by FileOpsHandler; only Ctrl+P lands here.
        if (mods & Qt.ControlModifier) {
            windowState.audioPlaybackToggle();
            event.accepted = true;
        }
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

    case Qt.Key_Escape:
        // Selection clearing is handled by FileOpsHandler; swallow the rest so
        // a stray Escape doesn't propagate beyond the file list.
        event.accepted = true;
        break;

    case Qt.Key_Z:
        windowState.saveCursor(windowState.currentPath, view.currentIndex);
        windowState.requestZoxide();
        event.accepted = true;
        break;

    case Qt.Key_F:
        windowState.saveCursor(windowState.currentPath, view.currentIndex);
        windowState.requestFuzzyFinder();
        event.accepted = true;
        break;

    case Qt.Key_R:
        // Bare r and picker Ctrl+R are handled by FileOpsHandler; Shift+R
        // (rename including extension) is the Miller-specific form.
        if ((mods & Qt.ShiftModifier) && root.currentEntry)
            windowState.requestRename(root.currentEntry.path, true);
        event.accepted = true;
        break;

    case Qt.Key_E:
        if (mods & Qt.ControlModifier) {
            // Ctrl+E — toggle between miller-columns and tree view.
            // The Loader in FileManager.qml swaps the visible component on
            // viewMode change, which destroys this FileList and lets the
            // tree view's own Keys.onPressed take over.
            windowState.toggleViewMode();
            event.accepted = true;
        }
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
    clipboardCopyProcess.command = FileManagerService.clipboardCopyCommand(text);
    clipboardCopyProcess.start();
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
