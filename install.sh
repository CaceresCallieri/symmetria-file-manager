#!/usr/bin/env bash
# Install Symmetria File Manager — Qt6-native standalone binary + QML modules.
# Idempotent — safe to run multiple times.
#
# What this installs:
#   /usr/lib/qt6/qml/Symmetria/FileManager/Models/  C++ plugin (FileSystemModel,
#                                                   ShellRunner, FileWatcher, …)
#   /usr/lib/qt6/qml/Symmetria/FileManager/UI/      panel QML module
#   /usr/bin/symmetria-fm                           daemon binary
#   /usr/bin/symmetria-fm-cli                       IPC sender CLI
#   ~/.local/share/icons/hicolor/512x512/apps/      app icon
#   ~/.local/share/applications/                    .desktop entry
#   ~/.config/systemd/user/symmetria-fm.service     systemd user unit
#
# After install:
#   systemctl --user enable --now symmetria-fm.service
#   symmetria-fm-cli open ~/Downloads
#
# Or run directly without the daemon:
#   /usr/bin/symmetria-fm

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Symmetria File Manager — Installation ==="
echo "  Project: $PROJECT_DIR"
echo

# 1. Build + install the C++ plugin and panel QML module.
echo "[1/4] Building plugin (C++ + QML module)…"
"$PROJECT_DIR/build-plugin.sh"

# 2. Build + install the standalone host binary and CLI sender.
echo
echo "[2/4] Building standalone host (symmetria-fm + symmetria-fm-cli)…"
cmake -S "$PROJECT_DIR/host/standalone" -B "$PROJECT_DIR/host/standalone/build" >/dev/null
cmake --build "$PROJECT_DIR/host/standalone/build" --parallel "$(nproc)"
sudo cmake --install "$PROJECT_DIR/host/standalone/build"

# 3. Install user-facing assets (icon, desktop entry).
echo
echo "[3/4] Installing user assets…"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$ICON_DIR" "$DESKTOP_DIR"
cp "$PROJECT_DIR/assets/symmetria-fm.png" "$ICON_DIR/"
cp "$PROJECT_DIR/symmetria-fm.desktop" "$DESKTOP_DIR/"
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "  Icon → $ICON_DIR/symmetria-fm.png"
echo "  Desktop entry → $DESKTOP_DIR/symmetria-fm.desktop"

# 4. Install the systemd user unit.
echo
echo "[4/4] Installing systemd user unit…"
mkdir -p "$HOME/.config/systemd/user"
cp "$PROJECT_DIR/symmetria-fm.service" "$HOME/.config/systemd/user/symmetria-fm.service"
systemctl --user daemon-reload
echo "  Unit → ~/.config/systemd/user/symmetria-fm.service"

echo
echo "=== Done ==="
echo
echo "Start the daemon (auto-starts at next login if you enable it):"
echo "  systemctl --user enable --now symmetria-fm.service"
echo
echo "Open a window:"
echo "  symmetria-fm-cli open ~/Downloads"
echo
echo "For the XDG portal integration (file picker for any GTK/Qt app),"
echo "see portal/install-portal.sh."
