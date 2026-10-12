#!/usr/bin/env bash
# Install org.freedesktop.FileManager1 for the Electron file manager, so that
# "Show in folder" in a browser opens it instead of Nautilus.
#
# Per-user and without sudo: the script, its systemd unit and its D-Bus
# activation file all go under $HOME. A D-Bus service file in
# $XDG_DATA_HOME/dbus-1/services takes precedence over Nautilus's in
# /usr/share, so the bus activates this service once the name is free.
#
# The script and the virtualenv sit at the FIXED ~/.local/share paths the unit
# names (%h/.local/share) and install-portal-electron.sh creates. Only the D-Bus file
# follows $XDG_DATA_HOME, because that is where the bus looks for it.
#
# It shares the portal's virtualenv (dbus-fast); run install-portal-electron.sh once
# first if that does not exist.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
share="$HOME/.local/share"
dbus_services="${XDG_DATA_HOME:-$HOME/.local/share}/dbus-1/services"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
venv="$share/symmetria/portal-venv"

if ! "$venv/bin/python3" -c "import dbus_fast" 2>/dev/null; then
  echo "Missing $venv with dbus-fast. Run portal/install-portal-electron.sh once first." >&2
  exit 1
fi

install -Dm755 "$here/symmetria_filemanager1.py" "$share/symmetria/symmetria_filemanager1.py"
install -Dm644 "$here/symmetria-fm-filemanager1.service" "$units/symmetria-fm-filemanager1.service"
install -Dm644 "$here/org.freedesktop.FileManager1.service" \
  "$dbus_services/org.freedesktop.FileManager1.service"
systemctl --user daemon-reload

echo "Installed:"
echo "  $share/symmetria/symmetria_filemanager1.py"
echo "  $units/symmetria-fm-filemanager1.service"
echo "  $dbus_services/org.freedesktop.FileManager1.service"

owner=$(busctl --user status org.freedesktop.FileManager1 2>/dev/null | sed -n 's/^Comm=//p' || true)
case "$owner" in
  "" | python3*)
    systemctl --user restart symmetria-fm-filemanager1.service
    echo "Answering org.freedesktop.FileManager1."
    ;;
  *)
    echo
    echo "org.freedesktop.FileManager1 is held by '$owner'. Quit it (for Nautilus:"
    echo "nautilus -q), then: systemctl --user restart symmetria-fm-filemanager1.service"
    ;;
esac

cat <<'UNDO'

To undo: systemctl --user stop symmetria-fm-filemanager1.service, then delete
the three files above and run systemctl --user daemon-reload.
UNDO
