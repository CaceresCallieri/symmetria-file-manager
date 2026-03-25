#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/plugin"
cmake -B build
cmake --build build
sudo cmake --install build
echo "Plugin installed. Restarting yazi-fm..."
systemctl --user restart yazi-fm
