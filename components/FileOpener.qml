import "../services"
import Symmetria.FileManager.Models
import Quickshell.Io
import QtQuick

Item {
    id: root

    visible: false
    width: 0
    height: 0

    property string _pendingPath: ""

    function open(path: string, mimeType: string): void {
        const resolved = _previewHelper.resolvePathForOpen(path);
        root._pendingPath = resolved;
        // Check if the default handler is a terminal app (Terminal=true in .desktop).
        // Headless services can't attach a TTY, so terminal apps silently fail via xdg-open.
        _handlerCheck.command = ["sh", "-c",
            'handler=$(xdg-mime query default "$1"); ' +
            '[ -z "$handler" ] && case "$1" in text/*) handler=$(xdg-mime query default text/plain);; esac; ' +
            '[ -z "$handler" ] && exit 0; ' +
            'for dir in "$HOME/.local/share/applications" /usr/share/applications /usr/local/share/applications; do ' +
            'f="$dir/$handler"; if [ -f "$f" ]; then ' +
            'if grep -q "^Terminal=true" "$f"; then ' +
            'grep "^Exec=" "$f" | head -1 | sed "s/^Exec=//; s/ %[fFuUnNdDickvm]//g"; fi; ' +
            'exit 0; fi; done',
            "sh", mimeType
        ];
        _handlerCheck.running = true;
    }

    function execute(path: string): void {
        _terminalExec.command = ["xdg-terminal-exec", path];
        _terminalExec.running = true;
    }

    PreviewImageHelper {
        id: _previewHelper
    }

    // Step 1: check if the default handler needs a terminal
    Process {
        id: _handlerCheck

        stdout: StdioCollector {
            onStreamFinished: {
                const execLine = text.trim();
                if (execLine) {
                    // Terminal=true handler — launch via xdg-terminal-exec
                    const parts = execLine.split(/\s+/);
                    _terminalOpen.command = ["xdg-terminal-exec"].concat(parts).concat([root._pendingPath]);
                    _terminalOpen.running = true;
                } else {
                    // GUI handler — use xdg-open
                    _xdgOpen.command = ["xdg-open", root._pendingPath];
                    _xdgOpen.running = true;
                }
            }
        }

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0)
                Logger.warn("FileOpener", "handler check failed with code " + exitCode);
        }
    }

    // Step 2a: launch GUI app via xdg-open
    Process {
        id: _xdgOpen

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0 || exitStatus !== Process.NormalExit)
                Logger.warn("FileOpener", "xdg-open exited with code " + exitCode + " for: " + command[1]);
        }
    }

    // Step 2b: launch terminal app via xdg-terminal-exec
    Process {
        id: _terminalOpen

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0 || exitStatus !== Process.NormalExit)
                Logger.warn("FileOpener", "terminal open exited with code " + exitCode + " for: " + command.slice(1).join(" "));
        }
    }

    // Direct script execution (e.g. .sh files)
    Process {
        id: _terminalExec

        onExited: (exitCode, exitStatus) => {
            if (exitCode !== 0 || exitStatus !== Process.NormalExit)
                Logger.warn("FileOpener", "xdg-terminal-exec exited with code " + exitCode + " for: " + command[1]);
        }
    }
}
