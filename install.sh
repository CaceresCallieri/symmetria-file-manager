#!/usr/bin/env bash
# Install yazi-frontend in standalone or Symmetria-integrated mode.
# Idempotent — safe to run multiple times.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYMMETRIA_DIR="$HOME/.config/quickshell/symmetria"
STANDALONE_DIR="$HOME/.config/quickshell/yazi-fm"

usage() {
    echo "Usage: $0 [--standalone | --symmetria]"
    echo
    echo "  --standalone   (default) Symlink project for 'qs -c yazi-fm'"
    echo "  --symmetria    Symlink into Symmetria shell for integrated mode"
    exit 1
}

MODE="${1:---standalone}"

case "$MODE" in
    --standalone)
        echo "Installing yazi-frontend in standalone mode..."
        echo "  Project:   $PROJECT_DIR"
        echo "  Target:    $STANDALONE_DIR"
        echo

        ln -sfn "$PROJECT_DIR" "$STANDALONE_DIR"
        echo "  Linked $STANDALONE_DIR → $PROJECT_DIR"

        echo
        echo "Done. Run with:"
        echo "  qs -c yazi-fm"
        echo
        echo "Or for development (clears QML cache):"
        echo "  ./run.sh"
        ;;

    --symmetria)
        if [[ ! -d "$SYMMETRIA_DIR" ]]; then
            echo "ERROR: Symmetria not found at $SYMMETRIA_DIR"
            exit 1
        fi

        echo "Installing yazi-frontend into Symmetria..."
        echo "  Project:   $PROJECT_DIR"
        echo "  Symmetria: $SYMMETRIA_DIR"
        echo

        # Module directory (entire dir as one symlink)
        ln -sfn "$PROJECT_DIR/modules/filemanager" "$SYMMETRIA_DIR/modules/filemanager"
        echo "  Linked modules/filemanager/"

        # Service singleton
        ln -sfn "$PROJECT_DIR/services/FileManagerService.qml" "$SYMMETRIA_DIR/services/FileManagerService.qml"
        echo "  Linked services/FileManagerService.qml"

        # Config object
        ln -sfn "$PROJECT_DIR/config/FileManagerConfig.qml" "$SYMMETRIA_DIR/config/FileManagerConfig.qml"
        echo "  Linked config/FileManagerConfig.qml"

        echo
        echo "Symlinks created. Now apply these manual edits:"
        echo
        echo "1. shell.qml — add import and component:"
        echo '   import "modules/filemanager"'
        echo '   // inside ShellRoot:'
        echo '   FileManagerModule {}'
        echo
        echo "2. config/Config.qml — register FileManagerConfig"
        echo
        echo "3. modules/Shortcuts.qml — add IPC handler"
        echo
        echo "4. Clear QML cache:"
        echo "   rm -rf ~/.cache/quickshell/qmlcache"
        echo
        echo "5. Test:"
        echo '   qs -c symmetria ipc call filemanager open'
        ;;

    *)
        usage
        ;;
esac
