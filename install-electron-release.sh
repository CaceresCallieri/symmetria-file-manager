#!/usr/bin/env bash
# Install a verified release without pointing desktop integration at a worktree.
# Usage: ./install-electron-release.sh /absolute/path/to/packaged-release
set -euo pipefail
source_release=$(realpath "${1:?Supply a packaged release directory}")
node "$source_release/app/scripts/verify-release.mjs"

installation="${XDG_DATA_HOME:-$HOME/.local/share}/symmetria-fm-electron"
applications="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
bindir="$HOME/.local/bin"
mkdir -p "$installation/releases" "$applications" "$icons" "$units" "$bindir"
# One installation at a time. Never mutate the active release in place.
exec 9>"$installation/install.lock"
flock 9
candidate=$(mktemp -d "$installation/releases/release-XXXXXXXX")
cp -a "$source_release/." "$candidate/"
# Resolve the icon directly so launchers do not depend on theme inheritance.
SYMMETRIA_ICON_PATH="$installation/current/assets/symmetria-fm.png" \
  awk '/^Icon=/ { print "Icon=" ENVIRON["SYMMETRIA_ICON_PATH"]; next } { print }' \
  "$candidate/symmetria-fm-electron.desktop" > "$candidate/symmetria-fm-electron.desktop.next"
mv "$candidate/symmetria-fm-electron.desktop.next" "$candidate/symmetria-fm-electron.desktop"
node "$candidate/app/scripts/verify-release.mjs"

backup=$(mktemp -d "$installation/install-backup-XXXXXXXX")
paths=("$installation/current" "$applications/symmetria-fm-electron.desktop" "$units/symmetria-fm-electron.service" "$bindir/symmetria-fm-electron" "$bindir/symmetria-fm-electron-cli" "$icons/symmetria-fm-electron.png")
for index in "${!paths[@]}"; do
  if [[ -e "${paths[$index]}" || -L "${paths[$index]}" ]]; then
    cp -a "${paths[$index]}" "$backup/$index"
  fi
done
was_active=$(systemctl --user is-active symmetria-fm-electron.service || true)
was_enabled=$(systemctl --user is-enabled symmetria-fm-electron.service 2>/dev/null || true)
rollback() {
  trap - ERR
  systemctl --user stop symmetria-fm-electron.service || true
  for index in "${!paths[@]}"; do
    rm -f "${paths[$index]}"
    if [[ -e "$backup/$index" || -L "$backup/$index" ]]; then
      cp -a "$backup/$index" "${paths[$index]}"
    fi
  done
  systemctl --user daemon-reload
  if [[ "$was_enabled" == enabled ]]; then
    systemctl --user enable --force symmetria-fm-electron.service || true
  else
    systemctl --user disable symmetria-fm-electron.service || true
  fi
  if [[ "$was_active" == active ]]; then
    systemctl --user start symmetria-fm-electron.service || true
  fi
  echo "Installation failed. Restored the previous installation. Backup: $backup" >&2
  exit 1
}
trap rollback ERR
ln -s "$candidate" "$installation/current.next"
mv -Tf "$installation/current.next" "$installation/current"
ln -sfn "$installation/current/symmetria-fm-electron.desktop" "$applications/symmetria-fm-electron.desktop"
ln -sfn "$installation/current/symmetria-fm-electron.service" "$units/symmetria-fm-electron.service"
ln -sfn "$installation/current/bin/symmetria-fm-electron" "$bindir/symmetria-fm-electron"
ln -sfn "$installation/current/app/bin/symmetria-fm-electron-cli.mjs" "$bindir/symmetria-fm-electron-cli"
ln -sfn "$installation/current/assets/symmetria-fm.png" "$icons/symmetria-fm-electron.png"
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$applications"
fi
if command -v gtk-update-icon-cache >/dev/null; then
  gtk-update-icon-cache -f -t "${icons%/256x256/apps}" || true
fi
systemctl --user daemon-reload
systemctl --user enable --force symmetria-fm-electron.service
systemctl --user restart symmetria-fm-electron.service
# The CLI confirms that the daemon owns its socket and accepts a real command.
for ((attempt=0; attempt<20; attempt++)); do
  if systemctl --user is-active --quiet symmetria-fm-electron.service && "$bindir/symmetria-fm-electron-cli" open "$HOME"; then
    trap - ERR
    echo "Installed and running: $candidate"
    echo "Previous installation backup: $backup"
    exit 0
  fi
  sleep 1
done
false
