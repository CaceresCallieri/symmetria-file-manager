// wl-copy launcher shared by the Miller-columns and tree views (copy-path
// chord, picker Shift+Enter). Callers set `command` (via
// FileManagerService.clipboardCopyCommand) and start(); the optional
// `_pendingCallback` fires once the launcher exits so callers can sequence
// work after the clipboard write.

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models

ShellRunner {
    // Callback set by callers (e.g. NormalModeHandler._copyPickerPathToClipboard)
    // — called once the systemd-run launcher exits (the detached wl-copy unit is
    // started) so callers can safely proceed after the clipboard write.
    property var _pendingCallback: null

    // Monitors systemd-run launcher exit, not wl-copy's eventual exit —
    // exitCode=0 means the transient unit was created and wl-copy was started.
    onExited: (exitCode, exitStatus) => {
        if (exitCode !== 0 || exitStatus !== ShellRunner.NormalExit)
            Logger.warn("ClipboardCopyRunner", "clipboard copy launch failed — exitCode: " + exitCode + " exitStatus: " + exitStatus);
        const cb = _pendingCallback;
        _pendingCallback = null;
        if (cb)
            cb();
    }
}
