#!/usr/bin/env bash
# Install the Electron FileChooser backend without changing portal routing.
# The virtualenv keeps dbus-fast separate from the system Python.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
venv="$HOME/.local/share/symmetria/portal-venv"

if ! "$venv/bin/python3" -c "import dbus_fast" 2>/dev/null; then
  python3 -m venv "$venv"
  "$venv/bin/python3" -m pip install dbus-fast
fi

sudo install -Dm755 "$here/symmetria_electron_portal.py" \
  /usr/lib/symmetria/symmetria_electron_portal.py
sudo install -Dm644 "$here/symmetria-electron.portal" \
  /usr/share/xdg-desktop-portal/portals/symmetria-electron.portal
sudo install -Dm644 "$here/org.freedesktop.impl.portal.desktop.symmetria-electron.service" \
  /usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.symmetria-electron.service
install -Dm644 "$here/xdg-desktop-portal-symmetria-electron.service" \
  "$units/xdg-desktop-portal-symmetria-electron.service"
systemctl --user daemon-reload

cat <<'NEXT'
Installed the Electron backend. This installer does not start services or change routing.

For FileChooser, set this in ~/.config/xdg-desktop-portal/portals.conf:

    [preferred]
    org.freedesktop.impl.portal.FileChooser=symmetria-electron

Start or restart the backend with:
    systemctl --user restart xdg-desktop-portal-symmetria-electron.service

If you changed routing, restart xdg-desktop-portal too.
NEXT
