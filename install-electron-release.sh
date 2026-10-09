#!/usr/bin/env bash
# Install a verified release without pointing desktop integration at a worktree.
# Usage: ./install-electron-release.sh /absolute/path/to/packaged-release
set -euo pipefail
source_release=$(realpath "${1:?Supply a packaged release directory}")
installation="${XDG_DATA_HOME:-$HOME/.local/share}/symmetria-fm-electron"
applications="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
legacy_icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
runtime_units="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/systemd/user"
bindir="$HOME/.local/bin"
mkdir -p "$installation/releases" "$applications" "$icons" "$units" "$bindir"
# One installation at a time. Never mutate the active release in place.
exec 9>"$installation/install.lock"
flock 9
candidate=$(mktemp -d "$installation/releases/release-XXXXXXXX")
cleanup_candidate() {
  # Keep a candidate if an incomplete rollback still points current at it.
  if [[ "$(readlink -f "$installation/current" || true)" != "$candidate" ]]; then
    rm -rf "$candidate"
  fi
  rm -f "$installation/current.next"
}
trap cleanup_candidate EXIT
trap 'exit 1' INT TERM HUP
cp -a "$source_release/." "$candidate/"
# Use the shipped runtime for installer tools as well as the installed CLI.
ELECTRON_RUN_AS_NODE=1 "$candidate/runtime/electron" \
  "$candidate/app/scripts/release-desktop-entry.mjs" \
  "$candidate/symmetria-fm-electron.desktop" "$installation/current"
ELECTRON_RUN_AS_NODE=1 "$candidate/runtime/electron" \
  "$candidate/app/scripts/verify-release.mjs"

backup=$(mktemp -d "$installation/install-backup-XXXXXXXX")
paths=(
  "$installation/current"
  "$applications/symmetria-fm-electron.desktop"
  "$units/symmetria-fm-electron.service"
  "$bindir/symmetria-fm-electron"
  "$bindir/symmetria-fm-electron-cli"
  "$icons/symmetria-fm-electron.png"
  "$legacy_icons/symmetria-fm-electron.png"
  "$units/graphical-session.target.wants/symmetria-fm-electron.service"
  "$runtime_units/graphical-session.target.wants/symmetria-fm-electron.service"
)
for index in "${!paths[@]}"; do
  if [[ -e "${paths[$index]}" || -L "${paths[$index]}" ]]; then
    cp -a "${paths[$index]}" "$backup/$index"
  fi
done
was_active=$(systemctl --user is-active symmetria-fm-electron.service || true)
rollback() {
  trap - ERR INT TERM HUP
  set +e
  rollback_failed=0
  systemctl --user stop symmetria-fm-electron.service || rollback_failed=1
  for index in "${!paths[@]}"; do
    rm -f "${paths[$index]}" || rollback_failed=1
    if [[ -e "$backup/$index" || -L "$backup/$index" ]]; then
      cp -a "$backup/$index" "${paths[$index]}" || rollback_failed=1
    fi
  done
  # Restoring the enable symlinks preserves persistent and runtime enable states.
  systemctl --user daemon-reload || rollback_failed=1
  if [[ "$was_active" == active ]]; then
    systemctl --user start symmetria-fm-electron.service || rollback_failed=1
  fi
  if [[ "$rollback_failed" == 0 ]]; then
    echo "Installation failed. Restored the previous installation. Backup: $backup" >&2
  else
    echo "Installation failed. Some recovery steps failed. Recovery backup: $backup" >&2
  fi
  exit 1
}
trap rollback ERR INT TERM HUP
ln -sfn "$candidate" "$installation/current.next"
mv -Tf "$installation/current.next" "$installation/current"
ln -sfn "$installation/current/symmetria-fm-electron.desktop" "$applications/symmetria-fm-electron.desktop"
ln -sfn "$installation/current/symmetria-fm-electron.service" "$units/symmetria-fm-electron.service"
ln -sfn "$installation/current/bin/symmetria-fm-electron" "$bindir/symmetria-fm-electron"
ln -sfn "$installation/current/bin/symmetria-fm-electron-cli" "$bindir/symmetria-fm-electron-cli"
ln -sfn "$installation/current/assets/symmetria-fm.png" "$icons/symmetria-fm-electron.png"
if [[ -L "$legacy_icons/symmetria-fm-electron.png" && \
      "$(readlink "$legacy_icons/symmetria-fm-electron.png")" == "$installation/current/assets/symmetria-fm.png" ]]; then
  rm -f "$legacy_icons/symmetria-fm-electron.png"
fi
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "$applications"
fi
if command -v gtk-update-icon-cache >/dev/null; then
  gtk-update-icon-cache -f -t "${icons%/512x512/apps}" || true
fi
systemctl --user daemon-reload
systemctl --user enable --force symmetria-fm-electron.service
systemctl --user restart symmetria-fm-electron.service
# The CLI confirms that the daemon owns its socket and accepts a real command.
for ((attempt=0; attempt<20; attempt++)); do
  if systemctl --user is-active --quiet symmetria-fm-electron.service && "$bindir/symmetria-fm-electron-cli" open "$HOME"; then
    trap - ERR INT TERM HUP
    echo "Installed and running: $candidate"
    echo "Previous installation backup: $backup"
    exit 0
  fi
  sleep 1
done
false
