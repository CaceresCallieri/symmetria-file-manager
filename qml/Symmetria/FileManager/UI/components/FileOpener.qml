pragma ComponentBehavior: Bound

import Symmetria.FileManager.UI
import Symmetria.FileManager.Models
import QtQuick

Item {
    id: root

    visible: false
    width: 0
    height: 0

    // Single-slot pending path — open() is called at most once per user keypress
    // (keyboard-first UI prevents rapid concurrent calls), so no queue is needed.
    property string _pendingPath: ""

    function open(path: string, mimeType: string): void {
        const resolved = _previewHelper.resolvePathForOpen(path);
        root._pendingPath = resolved;
        // _handlerCheck output contract (three cases):
        //   1. Terminal=true handler found  → prints the Exec line (non-empty stdout)
        //   2. Terminal=false handler found → prints nothing, exits 0
        //   3. No handler found             → prints nothing, exits 0
        // onExited routes to xdg-terminal-exec (case 1) or xdg-open (cases 2 & 3).
        _handlerCheck.command = ["sh", "-c",
            'handler=$(xdg-mime query default "$1"); ' +
            '[ -z "$handler" ] && case "$1" in text/*) handler=$(xdg-mime query default text/plain);; esac; ' +
            '[ -z "$handler" ] && exit 0; ' +
            'for dir in "$HOME/.local/share/applications" /usr/share/applications /usr/local/share/applications; do ' +
            'f="$dir/$handler"; if [ -f "$f" ]; then ' +
            'if grep -q "^Terminal=true" "$f"; then ' +
            'grep "^Exec=" "$f" | head -1 | sed "s/^Exec=//; s/%[fFuUnNdDick]//g; s/  */ /g; s/^ //; s/ $//"; fi; ' +
            'exit 0; fi; done; exit 0',
            "sh", mimeType
        ];
        _handlerCheck.start();
    }

    // Direct script execution (e.g. .sh files) — bypasses the handler-check
    // step below entirely and always launches via xdg-terminal-exec, since a
    // script has no MIME-type default-handler .desktop entry to look up.
    function execute(path: string): void {
        _launchDetached(["xdg-terminal-exec", path]);
    }

    // Launch the target app DETACHED (systemd-run transient unit, via
    // FileManagerService.detachedCommand). Two bugs lived here while launches
    // were plain tracked children of the daemon:
    //   - the spawned viewer died when the FM window closed (cgroup kill — see
    //     the GOTCHA on FileManagerService.detachedCommand), and
    //   - a second open was silently swallowed while the first viewer was still
    //     running, because the tracked ShellRunner stayed busy for the child's
    //     whole lifetime and start() ignores calls while running.
    // systemd-run returns as soon as the unit starts, so the runner frees in
    // milliseconds and the child outlives the FM.
    function _launchDetached(argv: var): void {
        _detachedLaunch.command = FileManagerService.detachedCommand(argv);
        _detachedLaunch.start();
    }

    PreviewImageHelper {
        id: _previewHelper
    }

    // Step 1: check if the default handler needs a terminal. Stays a TRACKED
    // child (not detached): it is a fast query whose stdout and exit code we
    // need, and it exits by itself in milliseconds.
    ShellRunner {
        id: _handlerCheck

        onExited: exitCode => {
            if (exitCode !== 0) {
                Logger.warn("FileOpener", "handler check failed with code " + exitCode);
                return;
            }
            const execLine = _handlerCheck.stdoutText.trim();
            if (execLine) {
                // Terminal=true handler — launch via xdg-terminal-exec.
                // Wrap the Exec line in `sh -c` and pass the path as $1, so the
                // shell handles any quoting in the Exec line correctly (e.g.,
                // arguments with embedded spaces like --profile="My Profile").
                root._launchDetached(["xdg-terminal-exec", "sh", "-c", execLine + ' "$@"', "sh", root._pendingPath]);
            } else {
                // GUI handler — use xdg-open
                root._launchDetached(["xdg-open", root._pendingPath]);
            }
        }
    }

    // Step 2: single fire-and-forget runner shared by every detached launch.
    // A non-zero exit here means systemd-run failed to START the unit (bad
    // binary, no user manager) — NOT that the launched app failed later: the
    // app lives in its own transient unit, invisible to this runner.
    ShellRunner {
        id: _detachedLaunch

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0 || exitStatus !== ShellRunner.NormalExit)
                Logger.warn("FileOpener", "detached launch failed (code " + exitCode + "): " + _detachedLaunch.command.join(" "));
        }
    }
}
