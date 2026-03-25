#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/plugin"
cmake -B build
cmake --build build --parallel $(nproc)
sudo cmake --install build
echo "Plugin installed."
if [[ "${1:-}" == "--restart" ]]; then
    echo "Restarting yazi-fm..."
    systemctl --user restart yazi-fm
    sleep 2
    systemctl --user status yazi-fm --no-pager || true
else
    echo "Note: yazi-fm was NOT restarted. Close any open picker/FM windows first, then run:"
    echo "  systemctl --user restart yazi-fm"
fi
