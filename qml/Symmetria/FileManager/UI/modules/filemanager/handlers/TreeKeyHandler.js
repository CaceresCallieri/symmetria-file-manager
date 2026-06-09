// FileTreeView keyboard dispatcher — the ListView's Keys.onPressed body.
//
// Non-library JS — shares the QML component scope of FileTreeView.qml (the sole
// importer). FileTreeView state is reached through `root`; the ListView through
// `view`; sibling handlers and component ids resolve via the importing file's
// scope (same mechanism as TreeFlashHandler reaching FlashLogic).
//
// Component IDs accessed via scope: ggTimer (the 500ms `gg`-chord timer).
// Sibling handlers accessed via scope: TreeModel (expand/collapse/toggle/
//   activate/jumpToParent/halfPageCount/refreshAll), TreeFlashHandler (handleKey).
// Singletons accessed via scope: Qt.

function handleKey(event, root, view) {
    var mods = event.modifiers;
    var key = event.key;

    // Swallow all keys while a modal is open. The popup is a sibling
    // Loader at FileManager scope, so without this guard a focus race
    // can leave keystrokes hitting the tree ListView instead of the
    // popup's TextInput — search input would stay empty and the
    // popup would appear "broken". Matches FileList.qml's first
    // guard in its Keys.onPressed.
    if (root.windowState && root.windowState.activeModal !== root.windowState.modalNone) {
        event.accepted = true;
        return;
    }

    if (key === Qt.Key_E && (mods & Qt.ControlModifier)) {
        if (root.windowState) root.windowState.toggleViewMode();
        event.accepted = true;
        return;
    }

    // Flash mode captures every key — labels jump, continuations
    // extend the query, Escape/Backspace exit.
    if (root.windowState && root.windowState.flashActive) {
        TreeFlashHandler.handleKey(event, root, view);
        return;
    }

    switch (key) {
    case Qt.Key_J:
    case Qt.Key_Down:
        if (view.currentIndex < view.count - 1) view.currentIndex++;
        event.accepted = true;
        break;

    case Qt.Key_K:
    case Qt.Key_Up:
        if (view.currentIndex > 0) view.currentIndex--;
        event.accepted = true;
        break;

    case Qt.Key_G:
        if (mods & Qt.ShiftModifier) {
            if (view.count > 0) view.currentIndex = view.count - 1;
            root._pendingG = false;
            ggTimer.stop();
        } else if (root._pendingG) {
            if (view.count > 0) view.currentIndex = 0;
            root._pendingG = false;
            ggTimer.stop();
        } else {
            root._pendingG = true;
            ggTimer.restart();
        }
        event.accepted = true;
        break;

    case Qt.Key_H:
        if (mods & Qt.ShiftModifier) {
            root.showHiddenToggleRequested();
        } else {
            var curH = root.currentRow;
            if (curH && curH.isDir && curH.expanded) TreeModel.collapse(root, curH.path);
            else TreeModel.jumpToParent(root);
        }
        event.accepted = true;
        break;

    case Qt.Key_Left: {
        var rowLeft = root.currentRow;
        if (rowLeft && rowLeft.isDir && rowLeft.expanded) TreeModel.collapse(root, rowLeft.path);
        else TreeModel.jumpToParent(root);
        event.accepted = true;
        break;
    }

    case Qt.Key_L:
    case Qt.Key_Right: {
        var rowRight = root.currentRow;
        if (!rowRight) { event.accepted = true; break; }
        if (rowRight.isDir) {
            if (!rowRight.expanded) TreeModel.expand(root, rowRight.path);
            else if (view.currentIndex + 1 < view.count) view.currentIndex++;
        } else {
            root.fileActivated(rowRight.path);
        }
        event.accepted = true;
        break;
    }

    case Qt.Key_Return:
    case Qt.Key_Enter:
        TreeModel.activate(root, root.currentRow);
        event.accepted = true;
        break;

    case Qt.Key_D:
        if ((mods & Qt.ControlModifier) && view.count > 0) {
            view.currentIndex = Math.min(view.currentIndex + TreeModel.halfPageCount(), view.count - 1);
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
            event.accepted = true;
        } else if ((mods & Qt.ShiftModifier) && root.windowState) {
            // Shift+D — navigate history forward (mirrors the PathBar forward button)
            root.windowState.forward();
            event.accepted = true;
        }
        break;

    case Qt.Key_U:
        if ((mods & Qt.ControlModifier) && view.count > 0) {
            view.currentIndex = Math.max(view.currentIndex - TreeModel.halfPageCount(), 0);
            view.positionViewAtIndex(view.currentIndex, ListView.Contain);
            event.accepted = true;
        }
        break;

    case Qt.Key_O: {
        var rowO = root.currentRow;
        if (rowO && rowO.isDir) TreeModel.toggle(root, rowO.path);
        event.accepted = true;
        break;
    }

    case Qt.Key_R:
        if (mods & Qt.ShiftModifier) {
            TreeModel.refreshAll(root);
            event.accepted = true;
        }
        break;

    case Qt.Key_Slash:
        if (root.windowState) {
            root._preSearchIndex = view.currentIndex;
            root.windowState.startSearch();
            event.accepted = true;
        }
        break;

    case Qt.Key_S:
        if (root.windowState) {
            if (mods & Qt.ShiftModifier) {
                // Shift+S — navigate history back (mirrors the PathBar back button)
                root.windowState.back();
            } else {
                root._preFlashIndex = view.currentIndex;
                TreeFlashHandler.invalidateEntryCache();
                root.windowState.startFlash();
            }
            event.accepted = true;
        }
        break;

    case Qt.Key_N:
        if (root.windowState && !root.windowState.searchActive && root.windowState.matchIndices.length > 0) {
            if (mods & Qt.ShiftModifier) root.windowState.previousMatch();
            else root.windowState.nextMatch();
            event.accepted = true;
        }
        break;

    case Qt.Key_Period:
        root.respectGitignore = !root.respectGitignore;
        event.accepted = true;
        break;

    case Qt.Key_F:
        if (root.windowState) {
            root.windowState.requestFuzzyFinder();
            event.accepted = true;
        }
        break;
    }
}
