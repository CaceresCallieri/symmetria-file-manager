#!/bin/bash
# Install the Symmetria XDG Desktop Portal FileChooser backend.
# This replaces the GTK file dialog with the Symmetria file manager
# for all applications that use the portal (browsers, Electron, etc.).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Symmetria Portal FileChooser — Installation ==="
echo ""

# 1. Check dbus-fast is available for python3.12 (matches service ExecStart)
if ! python3.12 -c "import dbus_fast" 2>/dev/null; then
    echo "Installing dbus-fast for python3.12..."
    python3.12 -m pip install --break-system-packages dbus-fast
fi

# 2. Install portal Python backend to a fixed system path (not dev repo path)
#    Service files reference /usr/lib/symmetria/ so the portal works for any user.
echo "Installing portal backend..."
sudo -A mkdir -p /usr/lib/symmetria
sudo -A cp "$SCRIPT_DIR/symmetria_portal.py" /usr/lib/symmetria/symmetria_portal.py
sudo -A chmod 755 /usr/lib/symmetria/symmetria_portal.py

# 3. Install portal definition
echo "Installing portal definition..."
sudo -A cp "$SCRIPT_DIR/symmetria.portal" /usr/share/xdg-desktop-portal/portals/symmetria.portal

# 4. Install D-Bus service file
echo "Installing D-Bus service file..."
sudo -A cp "$SCRIPT_DIR/org.freedesktop.impl.portal.desktop.symmetria.service" \
    /usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.symmetria.service

# 5. Install systemd user services
echo "Installing systemd user services..."
mkdir -p ~/.config/systemd/user
cp "$SCRIPT_DIR/xdg-desktop-portal-symmetria.service" ~/.config/systemd/user/
cp "$SCRIPT_DIR/../symmetria-fm.service" ~/.config/systemd/user/

# 6. Update portals.conf to route FileChooser to our backend
PORTALS_CONF="$HOME/.config/xdg-desktop-portal/portals.conf"
echo "Updating $PORTALS_CONF..."
mkdir -p "$(dirname "$PORTALS_CONF")"
# Back up existing config before overwriting to preserve custom settings
if [ -f "$PORTALS_CONF" ]; then
    cp "$PORTALS_CONF" "${PORTALS_CONF}.bak"
    echo "Backed up existing portals.conf to ${PORTALS_CONF}.bak"
fi
cat > "$PORTALS_CONF" << 'EOF'
[preferred]
default=hyprland;gtk
org.freedesktop.impl.portal.FileChooser=symmetria
org.freedesktop.impl.portal.Settings=gtk
EOF

# 7. Reload and restart
echo "Reloading systemd and restarting services..."
systemctl --user daemon-reload
systemctl --user enable --now symmetria-fm.service
systemctl --user enable --now xdg-desktop-portal-symmetria.service
systemctl --user restart xdg-desktop-portal

echo ""
echo "=== Installation complete ==="
echo ""
echo "IMPORTANT: Restart your browsers and Electron apps to use the new file picker."
echo "To test: open any file upload dialog in Firefox or Chrome."
echo ""
echo "To uninstall:"
echo "  sudo -A rm /usr/lib/symmetria/symmetria_portal.py"
echo "  sudo -A rm /usr/share/xdg-desktop-portal/portals/symmetria.portal"
echo "  sudo -A rm /usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.symmetria.service"
echo "  rm ~/.config/systemd/user/xdg-desktop-portal-symmetria.service"
echo "  # Restore portals.conf from backup: cp ~/.config/xdg-desktop-portal/portals.conf.bak ~/.config/xdg-desktop-portal/portals.conf"
