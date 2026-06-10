# Symmetria File Manager — Project Memory

## ✅ Framework DECISION (2026-06-07): STAY ON QML — READ project_framework_evaluation FIRST after compaction
- [Framework evaluation + DECISION](project_framework_evaluation.md) — **Resolved: keep the mature native Qt6/QML FM.** Tauri 2 pivot ABANDONED (web/WebKitGTK abstraction not worth it). Slint evaluated with a *measured* POC on the real Hyprland box and DECLINED — QML felt slightly better AND is already feature-complete, so a rewrite isn't worth it. Zed/GPUI ruled out (Hyprland window-map + compositor-CPU blockers, GPL fork). Full measurements + reasoning there.
- [Tauri pivot (ARCHIVED)](project_tauri_pivot.md) — the now-abandoned Tauri experiment on the `tauri-pivot` branch / `app-tauri/` subdir. Reference only; NOT the active direction. Active FM work is the QML tree.
- [Tauri testing workflow](feedback_tauri_testing_workflow.md) — ws7-silent test scripts (test-fm.sh / screenshot-ws7.sh); patterns still useful, but app-tauri is archived.

## 🦀 Rust beachhead (2026-06-08): fuzzy finder now uses the `fff` engine
- [Rust fff finder](project_rust_fff_finder.md) — finder backend swapped to the MIT Rust `fff` engine (fff-c C ABI, vendored submodule) after a MEASURED 11–20× per-keystroke win + frecency/git/score data. The deliberate, surgical Rust beachhead (not a migration); shared with the future IDE via the Models plugin. First cut = engine + fff.nvim-style File Info panel. Gotchas in CLAUDE.md "Critical Pitfalls".

## Project Goal
Build a keyboard-first graphical file manager as a FloatingWindow
inside the Symmetria QuickShell desktop shell. Pure native Qt/QML/C++
implementation inspired by Yazi's UX philosophy — no Yazi runtime dependency.

## Architecture Decision: Pure Native (No Yazi Backend)
- **Browsing**: C++ `FileSystemModel` (async scanning, QFileSystemWatcher, zero latency)
- **Operations**: QML `Process` calling `gio trash`, `cp`, `mv`, `rm`, `xdg-open`
- **State**: Two-tier — `WindowState` per-window (navigation, search, chords, modals) + `FileManagerService` singleton (clipboard, picker, utilities)
- **Window**: `WindowFactory` Singleton creates FloatingWindow on demand (self-destructs)
- Rationale: DDS is push-only (no query), bridge adds complexity, native is instant

## Key Paths
- Project: `/home/jc/projects/symmetria-file-manager/` (renamed from yazi-frontend on 2026-03-24)
- PRD: `symmetria-file-manager/PRD.md` (authoritative spec, 10 sections)
- Research: `symmetria-file-manager/RESEARCH.md`
- C++ Plugin: `symmetria-file-manager/plugin/` (builds `Symmetria.FileManager.Models` QML module)
- FileSystemModel C++: `plugin/src/Symmetria/FileManager/Models/filesystemmodel.hpp`
- Preview models: `plugin/src/Symmetria/FileManager/Models/` (archive, spreadsheet, syntax, image)
- Plugin install path: `/usr/lib/qt6/qml/Symmetria/FileManager/Models/`
- Build script: `symmetria-file-manager/build-plugin.sh` (cmake build + install + restart service)
- Symmetria Shell root: `/home/jc/.config/quickshell/symmetria/`
- FileDialog reference: `symmetria/components/filedialog/FileDialog.qml`
- Config registration: `symmetria/config/Config.qml` (JsonAdapter at line ~567)
- Shell entry: `symmetria/shell.qml`
- Shortcuts/IPC: `symmetria/modules/Shortcuts.qml`

## C++ Plugin Architecture (Symmetria.FileManager.Models)
- Extracted from Symmetria Shell's plugin to decouple projects (2026-03-24)
- URI: `Symmetria.FileManager.Models` — imported by both the file manager and Symmetria Shell
- C++ namespace: `symmetria::filemanager::models`
- 5 classes: FileSystemModel, ArchivePreviewModel, SpreadsheetPreviewModel, SyntaxHighlightHelper, PreviewImageHelper
- Dependencies: Qt6 (Core/Qml/Gui/Concurrent/GuiPrivate), KF6::SyntaxHighlighting, libarchive, QXlsx, freexl
- CMake uses `CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT` guard to default to `/usr`
- Symmetria Shell depends on this plugin (one-sided: Shell → File Manager, not reverse)
- C++ changes: run `./build-plugin.sh` → only symmetria-fm restarts, Shell untouched

## Naming Convention (Symmetria Ecosystem)
- **Symmetria Shell** — desktop shell (`~/.config/quickshell/symmetria/`)
- **Symmetria File Manager** — this project (`symmetria-fm` service, `symmetria-file-manager` repo)
- Service name: `symmetria-fm.service`
- QuickShell config: `qs -c symmetria-fm` (symlink: `~/.config/quickshell/symmetria-fm/`)
- GitHub repo: `symmetria-file-manager`

## Install Strategy
- Symlinks from Symmetria dirs into project repo (modules/, services/, config/)
- QuickShell auto-maps `qs.*` imports from directory structure (no qmldir needed)
- Manual steps: add import + component to shell.qml, register config in Config.qml
- `install.sh` creates symlinks, prints manual integration steps

## Symmetria Patterns
- FloatingWindow: `WindowFactory` Singleton → `Component.createObject()` → `onVisibleChanged: destroy()`
- Modules: `import "modules/name"` in shell.qml, `qs.modules.name` elsewhere
- Config: `JsonObject` subclass → registered in `Config.qml`'s `JsonAdapter`
- Services: QML Singletons in `services/` dir, auto-available as `qs.services`
- IPC: `IpcHandler { target: "name" }` → `qs -c symmetria ipc call name method args`
- Shortcuts: `CustomShortcut { name: "x" }` bound to keybinds in shell.json
- Theming: `Colours.tPalette.m3*`, `Appearance.anim.durations.*`, `Appearance.rounding.*`
- Must clear QML cache after changes: `rm -rf ~/.cache/quickshell/qmlcache`
- QML changes require a shell restart to take effect (cache clear alone is not enough)
- C++ plugin changes require CMake rebuild + shell restart
- NEVER restart the shell process autonomously — the user may have windows/state open. Always inform the user that a restart is needed and let them do it manually

## XDG Desktop Portal Integration
- Custom portal backend: `portal/symmetria_portal.py` (Python, dbus-fast)
- Implements `org.freedesktop.impl.portal.FileChooser` (OpenFile, SaveFile, SaveFiles)
- Communication: Python → qs IPC → QML picker window → FIFO → Python → D-Bus response
- Registration: `portal/symmetria.portal` + D-Bus service + systemd service
- Install: `portal/install-portal.sh` (copies to /usr/lib/symmetria, /usr/share/...)
- FM runs as headless systemd service: `symmetria-fm.service` (auto-starts at login)
- Keybinding: `Super+E` → `qs ipc --any-display -c symmetria-fm call filemanager open ""`
- QML Singleton lazy-init gotcha: must `void WindowFactory;` in shell.qml to force IpcHandler registration
- Future: Rust migration roadmap in `FUTURE.md`

## Per-Window State Architecture (Resolved)
- `WindowState.qml` (non-singleton) owns: navigation, search, chords, modals — instantiated per FileManager
- `FileManagerService.qml` (singleton) owns: clipboard, picker mode, format utilities
- Threading: FileManager → MillerColumns/PathBar/StatusBar → FileList/ParentPanel/WhichKeyPopup/Popups
- WindowFactory passes `initialPath` to each window via `createObject(dummy, { "initialPath": path })`

## 🐛 Clipboard bug ROOT CAUSE FOUND (2026-06-09)
- [Clipboard bug root cause](project_clipboard_bug_root_cause.md) — "cc copies but paste fails": wl-copy's serving fork dies when the FM window closes (daemon quits by design → systemd kills the cgroup). Fix pending user decision; remove the DIAGNOSTIC logging once fixed.

## Workflow Feedback
- [Always clear QML cache after edits](feedback_clear_qml_cache.md) — run `rm -rf ~/.cache/quickshell/qmlcache` yourself after any QML edit, don't leave it to the user
- [Keyboard features can't be tested via synthetic input](feedback_keyboard_testing_synthetic_input.md) — hyprctl sendshortcut/wtype don't reach the Qt surface; verify chords/nav via real keyboard or QTest
- [QML dev tooling already verified complete](feedback_qml_dev_tooling_verified.md) — qmlls6 LSP + qmltypes + qmllint all working in Neovim; don't re-investigate; Qt's AI Assistant is Qt-Creator-only (irrelevant here)
- [Deploy new UI components before linting](feedback_ui_module_deploy_for_qmllint.md) — a NEW component in Symmetria.FileManager.UI fails the gate ("anchors unresolved" on consumers) until `sudo cmake --install plugin/build` refreshes the /usr/lib snapshot qmllint resolves from

## QML Quirks (see QUIRKS.md)
- [QML Loader quirks](feedback_qml_loader_quirks.md) — anchors.margins silently fails in Loader sourceComponents; always use explicit x/y/width/height and explicit imports

## Keyboard Architecture
- Vim-style modal: Normal / Visual / Command modes
- Multi-key chords (gg, yy, dd, pp) via timer-based detection (500ms timeout)
- NOT using Symmetria's KeyChords module (those are for global shell shortcuts)
- FloatingWindow needs `WlrKeyboardFocus.Exclusive` to prevent Hyprland key conflicts

## Additional Topic Files (absorbed from prior symmetria-file-manager memory)
- [feedback_restart_service.md](feedback_restart_service.md) — Check for open windows before restarting symmetria-fm service after QML changes
- [project_observability_vision.md](project_observability_vision.md) — Long-term plan for project-wide structured logging and automated monitoring across all Symmetria components
- [feedback_anim_vs_canim.md](feedback_anim_vs_canim.md) — Never use Anim (NumberAnimation) on color properties; use CAnim (ColorAnimation) instead
- [feedback_qtobject_no_children.md](feedback_qtobject_no_children.md) — QtObject has no default property; use Qt.createQmlObject() for child objects like Timer
