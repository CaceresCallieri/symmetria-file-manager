#!/usr/bin/env bash
rm -rf ~/.cache/quickshell/qmlcache
exec qs -p "$(dirname "$(realpath "$0")")"
