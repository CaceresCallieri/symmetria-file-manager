#!/usr/bin/env bash
#
# Put the Electron file manager's desktop integration in place.
#
# ONE REAL FILE, NO COPIES. The desktop entry, the unit and the command-line
# tool are canonical in this repository — they name a binary this repository
# builds, so they version with it — and this script symlinks them into the
# places XDG and systemd read. Nothing is duplicated into the dotfiles.
#
# This installer enables the service without starting it. Apply the compositor
# rules before starting the daemon so its window opens on the intended workspace.
# A working tree uses user-level links so the integration follows that tree.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

applications="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
bindir="$HOME/.local/bin"
icon_theme="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
icons="$icon_theme/512x512/apps"
old_icon="$icon_theme/256x256/apps/symmetria-fm-electron.png"

mkdir -p "$applications" "$units" "$bindir" "$icons"

link() {
  # `-n` so a re-run replaces the link rather than creating one INSIDE the
  # directory the old link points at, which is what `ln -sf` does to an
  # existing symlink-to-a-directory and is a genuinely confusing failure.
  ln -sfn "$1" "$2"
  printf '  %s -> %s\n' "$2" "$1"
}

echo "Linking:"
link "$repo/symmetria-fm-electron.desktop" "$applications/symmetria-fm-electron.desktop"
link "$repo/symmetria-fm-electron.service" "$units/symmetria-fm-electron.service"
link "$repo/app/bin/symmetria-fm-electron-cli.mjs" "$bindir/symmetria-fm-electron-cli"
link "$repo/bin/symmetria-fm-electron" "$bindir/symmetria-fm-electron"

# Refresh the desktop database so the MimeType association is seen. Harmless
# where the tool is absent, which is why the failure is swallowed.
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications" 2>/dev/null || true
fi

echo
# The unit carries Restart=always, so enabling it against a missing binary
# would restart-loop forever at the next login with nothing pointing at the
# cause. Review found the ExecStart target used to live outside this
# repository entirely; it is linked above now, and this refuses to proceed if
# that ever stops being true.
if [ ! -x "$bindir/symmetria-fm-electron" ]; then
  echo "ERROR: $bindir/symmetria-fm-electron is missing or not executable." >&2
  echo "The unit would restart-loop. Not enabling it." >&2
  exit 1
fi

# The desktop entry runs the tool BY NAME, so the launcher directory has to be
# on the PATH a launcher hands it. A warning rather than an error: a portal or
# an application menu usually has a fuller PATH than this shell.
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "NOTE: $bindir is not on this shell's PATH; the .desktop entry needs it on the session PATH." >&2 ;;
esac

link "$repo/assets/symmetria-fm.png" "$icons/symmetria-fm-electron.png"
if [[ -L "$old_icon" && "$(readlink "$old_icon")" == "$repo/assets/symmetria-fm.png" ]]; then
  rm "$old_icon"
fi

echo "Registering the unit (this starts nothing):"
# Both of these are non-disruptive. `daemon-reload` re-reads unit files and
# restarts no running service; `enable` writes a wants-symlink and starts
# nothing. The daemon comes up at the next login.
systemctl --user daemon-reload
systemctl --user enable symmetria-fm-electron.service

cat <<'NEXT'

Done. Two things are left, and they are yours because they change the session:

  1. Add the Hyprland fragment from
     docs/electron-transition/22-desktop-integration.md
     to ~/.dotfiles/.config/hypr/, then reload the compositor.

  2. Log out and back in, or start the daemon by hand once the compositor
     knows where to put its window:
         systemctl --user start symmetria-fm-electron.service

  Check afterwards with:
         systemctl --user status symmetria-fm-electron.service
         systemctl --user show-environment | grep WAYLAND_DISPLAY
NEXT
