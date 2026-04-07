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

## Coding Conventions

### QML Property Ordering

Declare properties in this order within every QML component:

1. `id`
2. `required property` (mandatory parameters)
3. Regular `property` (mutable state)
4. `readonly property` (computed bindings)
5. Private `property` (prefix with `_`)
6. Signals
7. Implicit size / layout (`implicitHeight`, `anchors.*`)
8. `Behavior` animations
9. Event handlers (`onXxxChanged`)
10. Functions
11. Child components

### QML Pragmas

- Use `pragma ComponentBehavior: Bound` in all new QML files — enforces explicit scoping and prevents accidental access to parent properties
- Use `pragma Singleton` only for true singletons (`Singleton {}` root type)

### Naming Conventions

| Context | Convention | Example |
|---------|-----------|---------|
| QML files | PascalCase | `FileListItem.qml`, `DeleteConfirmPopup.qml` |
| QML root id | Always `root` | `id: root` |
| QML private properties | Underscore prefix | `property var _history: []` |
| QML signals | camelCase, past-tense or imperative | `closeRequested()`, `flashJump()` |
| QML functions | camelCase, private = underscore prefix | `navigate()`, `_resetState()` |
| C++ files | snake_case | `filesystemmodel.hpp` |
| C++ namespace | `symmetria::filemanager::models` | — |
| C++ member vars | `m_` prefix | `m_loading`, `m_entries` |
| C++ bool properties | Bare adjective (no `is`/`get` prefix) | `loading`, `truncated`, `error` |

### Imports

**Always declare explicit imports in every QML file.** Never rely on scope inheritance from parent Loaders — it is fragile and causes intermittent `ReferenceError` (see `QUIRKS.md` §2).

```qml
// Relative imports first, then Qt/framework modules
import "../../components"
import "../../services"
import "../../config"
import Symmetria.FileManager.Models
import Quickshell
import Quickshell.Io
import QtQuick
import QtQuick.Layouts
```

### Animation Rules

| Property type | Animation component | Example |
|--------------|-------------------|---------|
| Numeric (`width`, `height`, `opacity`, `scale`) | `Anim` (NumberAnimation) | `Behavior on opacity { Anim {} }` |
| Color (`color`, `border.color`) | `CAnim` (ColorAnimation) | `Behavior on border.color { CAnim {} }` |

- **Never use `Anim` on color properties** — produces `#000000` permanently (see `QUIRKS.md` §7)
- `StyledRect` and `StyledText` already have internal `Behavior on color { CAnim {} }` — do NOT add another
- Both `Anim` and `CAnim` use `Theme.animDuration` (400ms) and `Theme.animCurveStandard` easing

### State Management

**Immutable updates for binding reactivity:**
```qml
// WRONG — mutation does NOT trigger property bindings:
selectedPaths[path] = true;

// CORRECT — reassign triggers bindings:
const copy = Object.assign({}, selectedPaths);
copy[path] = true;
selectedPaths = copy;
```

**State ownership:**
- Per-window/tab state → `WindowState.qml` (navigation, search, chords, selection, modals)
- Shared global state → `FileManagerService.qml` (clipboard, picker mode)
- Tab collection → `TabManager.qml` (per-window instance)
- Do not create new singletons for small pieces of state — group related state together

**Singleton initialization:**
- QuickShell singletons are lazy — they don't exist until first referenced
- `shell.qml` must force-initialize singletons that register IPC handlers: `void WindowFactory;`

### Loader Patterns

- **Never use `anchors.margins` inside Loader `sourceComponent`** — silently ignored (see `QUIRKS.md` §1)
- Use explicit `x`/`y`/`width`/`height` positioning instead
- Always declare imports explicitly in loaded components
- Set dependent properties BEFORE the property that triggers Loader activation (e.g., set `mimeType` before `path` if the Loader's `active:` binding depends on `path`)

### Modal/Popup Pattern

All modals use `Loader` with `active` bound to the `activeModal` enum on `WindowState`. A single `activeModal` property gates visibility, preventing multiple modals from opening simultaneously:

```qml
Loader {
    anchors.fill: parent
    active: windowState && windowState.activeModal === windowState.modalDelete
    sourceComponent: DeleteConfirmPopup { ... }
}
```

### Keyboard Event Handling

- **Escape priority** (stack-based, last-entered-first-exited): chord → search → flash nav → picker → close window
- **Chord system**: Timer-based 500ms timeout, NOT Symmetria's KeyChords module
- All keyboard handling lives in `FileList.qml`'s `Keys.onPressed` handler
- Picker mode suppresses certain keys (Y/X/P/Space/T) to prevent clipboard operations

### C++ Plugin Patterns

- **Async I/O**: Use `QtConcurrent::run()` for all heavy operations (directory scans, file reads, image decoding)
- **Generation counters**: Discard stale async results when user navigates faster than I/O completes
- **Mutable lazy init**: Expensive properties (`mimeType`, `icon`) computed on first access with `mutable` backing fields
- **QML registration**: Use `QML_ELEMENT` macro; use `QML_UNCREATABLE("reason")` for types not instantiated directly from QML
- **Header guards**: `#pragma once` (no `#ifndef` guards)
- **No `using` directives in headers** — use full namespace paths

### Logging

Use the `Logger` singleton, not `console.log`:

```qml
Logger.debug("TabManager", "init with path: " + initialPath);
Logger.warn("FileManager", "Picker already active");
Logger.error("FileManager", "FIFO write failed");
```

Logs write to `~/.local/share/symmetria/logs/filemanager.log` with timestamps, levels, and component names.

### Path Utilities

Use `Paths.basename(path)` and `Paths.parentDir(path)` instead of inline `substring`/`replace` expressions. These are defined in `services/Paths.qml` and handle edge cases (root path, empty result) consistently.

### Theme & Typography

- All colors from `Theme.palette.*` (M3 design tokens, synced with Symmetria Shell via IPC)
- **Indicator colors** via `Theme.indicator.cut`, `.yank`, `.selection` — hardcoded deliberately because theme IPC overwrites M3 palette tokens with wallpaper-derived values
- **Overlay colors** via `Theme.overlay.subtle` (0.06 white), `.emphasis` (0.10 white) — for separators, keycap backgrounds, subtle highlights
- Sans: `Theme.font.family.sans` (Rubik), Mono: `Theme.font.family.mono` (CaskaydiaCove NF), Icons: `Theme.font.family.material`
- Spacing/padding/rounding accessed via `Theme.spacing.*`, `Theme.padding.*`, `Theme.rounding.*`

### SortBy Enum

Use `FileSystemModel.Alphabetical`, `.Modified`, `.Size`, `.Extension`, `.Natural` (Q_ENUM values) instead of magic integers in QML. WindowState stores `sortBy` as an `int` to avoid depending on the C++ plugin module.

## Critical Pitfalls

**QML cache after plugin rebuild** — The service clears cache on restart (`ExecStartPre`), but if you're running the file manager manually (not via systemd), you must clear it yourself: `rm -rf ~/.cache/quickshell/qmlcache`

**FloatingWindow keyboard focus** — Must use `WlrKeyboardFocus.Exclusive` to prevent Hyprland from consuming key events meant for the file manager.

**QML Loader quirks** — `anchors.margins` silently fails inside Loader `sourceComponent` blocks. Always use explicit x/y/width/height positioning and explicit imports inside Loaders. See `QUIRKS.md` for details.

**QML Singleton lazy-init** — QuickShell singletons don't initialize until first referenced. `shell.qml` must contain `void WindowFactory;` to force IpcHandler registration at startup.

**Vim chord detection** — Uses timer-based multi-key detection (500ms timeout), NOT Symmetria's KeyChords module (those are for global shell shortcuts).
