# CLAUDE.md

> **Principle: No duplicate sources of truth.** This document contains ONLY information that cannot be discovered by reading the codebase. For implementation details, read the actual source files.

## Project Overview

Symmetria File Manager is a keyboard-first graphical file manager built as a standalone Qt6 application. It runs as a headless systemd user service (`symmetria-fm.service`) that listens on `$XDG_RUNTIME_DIR/symmetria-fm.sock` and spawns Qt windows on demand via IPC. Pure native Qt/QML/C++ inspired by Yazi's UX philosophy — no Yazi or QuickShell runtime dependency.

The same QML panel is also embeddable in any Qt6 host: Symmetria-IDE imports `Symmetria.FileManager.UI` and renders it as a Telescope-style toggle-overlay above NeoVim.

**Do NOT kill the symmetria-fm service** without the user's consent — they may have open file manager or picker windows with unsaved state.

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

**Build dependencies (Arch):** `qt6-base qt6-declarative syntax-highlighting libarchive qxlsx-qt6 freexl qt6-imageformats`

### Running Tests

The plugin includes a QTest-based test suite. Tests are built by default (`BUILD_TESTING=ON`):

```bash
cd plugin
cmake -B build
cmake --build build --parallel $(nproc)
QT_QPA_PLATFORM=offscreen ctest --test-dir build --output-on-failure
```

Three test executables cover the async model classes: `FileSystemModelTest` (sorting, filtering, file watcher diffs), `ArchivePreviewModelTest` (entry caps, truncation, corruption handling), `SyntaxHighlightHelperTest` (highlighting output, binary detection, truncation). `QT_QPA_PLATFORM=offscreen` is required because `QTextDocument` and `QImageReader` need `QGuiApplication`.

To skip tests when doing a production build: `cmake -B build -DBUILD_TESTING=OFF`

### CI

GitHub Actions runs on every push/PR to `main` (`.github/workflows/ci.yml`). The workflow builds the C++ plugin and runs the QTest suite on Ubuntu 24.04. Qt 6.9 is installed via `jurplel/install-qt-action`; KF6SyntaxHighlighting and QXlsx are built from source and cached.

### QML Changes

No compilation needed — just restart the service:
```bash
systemctl --user restart symmetria-fm
```
The service's `ExecStartPre` automatically clears the QML cache before each start.

### QML Linting

```bash
/usr/lib/qt6/bin/qmllint qml/Symmetria/FileManager/UI/modules/filemanager/*.qml \
                         qml/Symmetria/FileManager/UI/services/*.qml \
                         qml/Symmetria/FileManager/UI/components/*.qml \
                         qml/Symmetria/FileManager/UI/config/*.qml
```

Uses `.qmllint.ini` at the project root. The Qt6 qmllint is at `/usr/lib/qt6/bin/qmllint` (not `/usr/bin/qmllint`, which is the Qt5 version). Configuration notes:
- `MissingProperty` is demoted to `info` — most hits are false positives from `var`-typed singletons (`FmTheme.palette` is a plain JS object) whose keys aren't visible to static analysis
- `UnqualifiedAccess` and `UnusedImports` are the primary actionable warning categories
- `AdditionalQmlImportPaths=/usr/lib/qt6/qml` resolves `Symmetria.FileManager.Models` and `Symmetria.FileManager.UI` imports

### Opening the File Manager

```bash
# Standalone (talks to the symmetria-fm.service daemon)
symmetria-fm-cli open ~/Downloads

# Or directly without the daemon (for one-off invocations)
/usr/bin/symmetria-fm

# Inside Symmetria-IDE: <leader>e toggles the embedded overlay
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

Symmetria Shell imports `Symmetria.FileManager.Models` in 5 QML files (wallpaper grid, file dialog, etc.) — it depends on this plugin being installed. Symmetria File Manager does NOT depend on the shell at runtime — it reads theme data directly from config files on disk (`color-scheme.json`, `shell.json`), not via IPC.

If the plugin is not installed, Symmetria Shell's wallpaper picker and file dialog will fail to load. After any plugin API changes, verify the shell still works.

### State Architecture

- **`WindowState.qml`** (per-window) — navigation, search, chords, modals
- **`FileManagerService.qml`** (singleton) — clipboard, picker mode, format utilities
- **`HostController` (C++, in `host/standalone/server.cpp`)** — owns the QLocalServer, validates incoming IPC commands, emits Qt signals that the host's `main.qml` listens to in order to spawn windows. Replaces the old QuickShell `WindowFactory.qml` which folded windowing + IPC into one QML singleton.

### Service & Portal

- `symmetria-fm.service` — headless systemd user service, `ExecStart=/usr/bin/symmetria-fm`, `Restart=always`. The binary owns a `QLocalServer` at `$XDG_RUNTIME_DIR/symmetria-fm.sock`.
- `portal/symmetria_portal.py` — XDG Desktop Portal backend for system file dialogs.
- Communication: Portal → `symmetria-fm-cli createPicker '<json>'` → QLocalSocket → daemon → QML picker window → FIFO → Portal → D-Bus response.

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
// All panel-tier QML accesses singletons + types via the unified module URI.
// The single qmldir at qml/Symmetria/FileManager/UI/qmldir declares
// FileManager (entry), FmTheme/Logger/FileManagerService/etc. (singletons),
// and per-instance / component types — all under one module URI.
import Symmetria.FileManager.UI
import Symmetria.FileManager.Models  // for ShellRunner, FileWatcher, FileSystemModel
import QtQuick
import QtQuick.Layouts
```

External hosts that embed the panel use `import Symmetria.FileManager.UI as FmUi` to avoid colliding with their own `Theme` singleton (e.g. Symmetria-IDE's `qml/design/Theme.qml`).

### Animation Rules

| Property type | Animation component | Example |
|--------------|-------------------|---------|
| Numeric (`width`, `height`, `opacity`, `scale`) | `Anim` (NumberAnimation) | `Behavior on opacity { Anim {} }` |
| Color (`color`, `border.color`) | `CAnim` (ColorAnimation) | `Behavior on border.color { CAnim {} }` |

- **Never use `Anim` on color properties** — produces `#000000` permanently (see `QUIRKS.md` §7)
- `StyledRect` and `StyledText` already have internal `Behavior on color { CAnim {} }` — do NOT add another
- Both `Anim` and `CAnim` use `FmTheme.animDuration` (400ms) and `FmTheme.animCurveStandard` easing

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
- QML singletons are lazy — they don't exist until first referenced. The standalone host's `main.qml` references the singletons it uses (Logger, FmTheme, FileManagerService) at startup so they instantiate before the first IPC arrives.
- `pragma Singleton` files use `QtObject` as their root (not `Item`); since QtObject has no default property, child elements (Timer, ShellRunner, FileWatcher) are declared as named properties (`property Timer _foo: Timer { id: foo }`).

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

- All colors from `FmTheme.palette.*` — property names match `color-scheme.json` keys directly (e.g., `FmTheme.palette.surface`, `FmTheme.palette.onSurface`, `FmTheme.palette.primary`)
- **Theme source**: Reads palette from `~/.config/quickshell/symmetria/config/color-scheme.json` directly (no IPC — works without Symmetria Shell running). Reads transparency from `shell.json`. Layout tokens (rounding, spacing, padding, fonts) are file-manager-specific and NOT synced from the shell. The path is historically named after Symmetria Shell's config dir; the file manager uses it as a convenient theme source, not a runtime dependency.
- **Indicator colors** via `FmTheme.indicator.cut`, `.yank`, `.selection` — hardcoded deliberately because palette tokens change with wallpaper-derived color schemes
- **Overlay colors** via `FmTheme.overlay.subtle` (0.06 white), `.emphasis` (0.10 white) — for separators, keycap backgrounds, subtle highlights
- Sans: `FmTheme.font.family.sans` (Rubik), Mono: `FmTheme.font.family.mono` (CaskaydiaCove NF), Icons: `FmTheme.font.family.material`
- Spacing/padding/rounding accessed via `FmTheme.spacing.*`, `FmTheme.padding.*`, `FmTheme.rounding.*`

### SortBy Enum

Use `FileSystemModel.Alphabetical`, `.Modified`, `.Size`, `.Extension`, `.Natural` (Q_ENUM values) instead of magic integers in QML. WindowState stores `sortBy` as an `int` to avoid depending on the C++ plugin module.

## Critical Pitfalls

**QFileSystemWatcher atomic-replace** — The watcher silently drops a watch when the watched path is unlinked then renamed-into-place (the typical pattern for `:w` in nvim, git checkout, atomic JSON saves). `FileWatcher` mitigates this by watching both the file AND its parent directory and re-arming via `removePath; addPath` on every change signal, with a 100ms QTimer retry fallback. The `atomicReplaceTenTimes` test asserts this holds across 10 consecutive replacements. If hot-reload of bookmarks.json or color-scheme.json starts breaking, this is where to look.

**Wayland focus on Hyprland** — Without `WlrKeyboardFocus.Exclusive` (which only existed under QuickShell's wlr-layer-shell), the picker window relies on `Qt.Dialog | Qt.WindowStaysOnTopHint + requestActivate()` to claim focus. If Hyprland's bindings still swallow keys destined for the picker, ship a `windowrulev2 = float, class:^(symmetria-fm)$` rule.

**QML Loader quirks** — `anchors.margins` silently fails inside Loader `sourceComponent` blocks. Always use explicit x/y/width/height positioning and explicit imports inside Loaders. See `QUIRKS.md` for details.

**QtObject has no default property** — `pragma Singleton` files and the host's `main.qml` use `QtObject` as their root; child elements (Timer, ShellRunner, FileWatcher, Component, Connections) must be declared as named properties (`property Timer _foo: Timer { id: foo }`). The `id: foo` form remains accessible from the rest of the scope.

**Two `Theme` singletons in one engine** — When the panel is embedded in Symmetria-IDE, both modules (`Symmetria.FileManager.UI` and the IDE's `design`) define `Theme`. The FM's singleton is renamed to `FmTheme` to remove the collision; external hosts that import via `import Symmetria.FileManager.UI as FmUi` get the alias-prefixed namespace.

**QML `on` prefix restriction** — QML reserves identifiers starting with `on` + uppercase letter for signal handlers. The palette uses `property var` (plain JS object) instead of `QtObject` because M3 token names like `onSurface`, `onPrimary`, `onSecondaryContainer` would clash with signal handler syntax inside `QtObject`. This means palette updates must use immutable reassignment (`root.palette = {...}`) to trigger bindings — do NOT mutate individual keys.

**Vim chord detection** — Uses timer-based multi-key detection (500ms timeout), implemented in `qml/Symmetria/FileManager/UI/modules/filemanager/handlers/ChordHandler.js`.
