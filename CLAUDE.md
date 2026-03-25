# CLAUDE.md

> **Principle: No duplicate sources of truth.** This document contains ONLY information that cannot be discovered by reading the codebase. For implementation details, read the actual source files.

## Project Overview

Symmetria File Manager is a keyboard-first graphical file manager built as a standalone QuickShell application. It runs as a headless systemd service (`symmetria-fm.service`) that spawns FloatingWindow instances on demand via IPC. Pure native Qt/QML/C++ inspired by Yazi's UX philosophy — no Yazi runtime dependency.

**Do NOT restart the shell (Symmetria) or kill the symmetria-fm service** without the user's consent — they may have open file manager or picker windows with unsaved state.

## Build & Run

### C++ Plugin (`Symmetria.FileManager.Models`)

The file manager's core data models live in `plugin/` as a standalone CMake project that builds a Qt6 QML plugin. This plugin is separate from Symmetria Shell's plugin build.

```bash
./build-plugin.sh              # Build + install (no restart)
./build-plugin.sh --restart    # Build + install + restart symmetria-fm
```

Or manually:
```bash
cd plugin
cmake -B build
cmake --build build --parallel $(nproc)
sudo cmake --install build
systemctl --user restart symmetria-fm
```

**Install path:** `/usr/lib/qt6/qml/Symmetria/FileManager/Models/` — Qt's QML engine discovers modules here automatically.

**CMake variables:**
- `CMAKE_INSTALL_PREFIX` defaults to `/usr` (via `CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT` guard) — combined with `INSTALL_QMLDIR=lib/qt6/qml`, the final path is `/usr/lib/qt6/qml/`
- Pass `-DCMAKE_INSTALL_PREFIX=/custom/path` to override if needed

**Build dependencies (Arch):** `qt6-base qt6-declarative syntax-highlighting libarchive qxlsx-qt6 freexl`

### QML Changes

No compilation needed — just restart the service:
```bash
systemctl --user restart symmetria-fm
```
The service's `ExecStartPre` automatically clears the QML cache before each start.

### Opening the File Manager

```bash
qs ipc --any-display -c symmetria-fm call filemanager open ""    # From terminal
# Or via Super+E keybinding (configured in Symmetria's Shortcuts.qml)
```

## Architecture

### Plugin: `Symmetria.FileManager.Models` (C++ → QML)

Five model classes in C++ namespace `symmetria::filemanager::models`:

| Class | Purpose |
|-------|---------|
| `FileSystemModel` + `FileSystemEntry` | Async directory listing with sorting, filtering, file watching |
| `ArchivePreviewModel` | Lists archive contents (zip, tar, 7z, rar) via libarchive |
| `SpreadsheetPreviewModel` | Reads .xlsx (QXlsx) and .xls (freexl) for preview |
| `SyntaxHighlightHelper` | Syntax-highlighted HTML for text file previews via KF6 |
| `PreviewImageHelper` | Image preview generation with background compositing + caching |

### Symmetria Shell Dependency (One-Sided)

Symmetria Shell imports `Symmetria.FileManager.Models` in 5 QML files (wallpaper grid, file dialog, etc.) — it depends on this plugin being installed. Symmetria File Manager does NOT depend on the shell.

If the plugin is not installed, Symmetria Shell's wallpaper picker and file dialog will fail to load. After any plugin API changes, verify the shell still works.

### State Architecture

- **`WindowState.qml`** (per-window) — navigation, search, chords, modals
- **`FileManagerService.qml`** (singleton) — clipboard, picker mode, format utilities
- **`WindowFactory.qml`** (singleton) — creates/manages windows, handles IPC

### Service & Portal

- `symmetria-fm.service` — headless systemd user service, `Restart=always`, auto-clears QML cache
- `portal/symmetria_portal.py` — XDG Desktop Portal backend for system file dialogs
- Communication: Portal → IPC → QML picker window → FIFO → Portal → D-Bus response

## Critical Pitfalls

**QML cache after plugin rebuild** — The service clears cache on restart (`ExecStartPre`), but if you're running the file manager manually (not via systemd), you must clear it yourself: `rm -rf ~/.cache/quickshell/qmlcache`

**FloatingWindow keyboard focus** — Must use `WlrKeyboardFocus.Exclusive` to prevent Hyprland from consuming key events meant for the file manager.

**QML Loader quirks** — `anchors.margins` silently fails inside Loader `sourceComponent` blocks. Always use explicit x/y/width/height positioning and explicit imports inside Loaders. See `QUIRKS.md` for details.

**QML Singleton lazy-init** — QuickShell singletons don't initialize until first referenced. `shell.qml` must contain `void WindowFactory;` to force IpcHandler registration at startup.

**Vim chord detection** — Uses timer-based multi-key detection (500ms timeout), NOT Symmetria's KeyChords module (those are for global shell shortcuts).
