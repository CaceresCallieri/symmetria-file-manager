# QuickShell / QML Quirks

Known platform-specific behaviors encountered during development. These are
not bugs per se, but surprising interactions between QML, QuickShell, and
the Loader/component system that can waste significant debugging time.

---

## 1. Loader `anchors.margins` Silently Ignored on Loaded Components

**Symptom:** You set `anchors.fill: parent` + `anchors.margins: <value>` on an
item inside a Loader's `sourceComponent`, but no padding appears visually. No
error is logged — the margin is simply not applied.

**Root cause:** When a Loader has `anchors.fill: parent` (or explicit
width/height), it **force-sets** the loaded item's geometry, bypassing the
anchor system. Children of the loaded root that use `anchors.fill: parent` +
`anchors.margins` resolve against the parent's geometry, but the anchor chain
appears to be broken — margins evaluate to 0 or are silently dropped.

**Affected patterns (DO NOT USE inside sourceComponent):**
```qml
// These will NOT produce visible margins:
Flickable {
    anchors.fill: parent
    anchors.margins: 15          // ← silently ignored
}

Item {
    anchors.fill: parent
    anchors.margins: 15          // ← silently ignored
    Flickable { anchors.fill: parent }
}
```

**Working pattern (USE THIS):**
```qml
// Explicit x/y/width/height bypasses the anchor system entirely:
Flickable {
    x: 15
    y: 10
    width: parent.width - 30
    height: parent.height - 20
}
```

**Why explicit positioning works:** The `x`, `y`, `width`, `height` properties
are simple numeric bindings that don't depend on the anchor resolution system.
They evaluate against `parent.width`/`parent.height` which ARE correctly set
by the Loader's force-sizing.

**Discovered in:** `TextPreview.qml` — three different anchor-based approaches
(direct margins, wrapper Item, TextEdit padding) all failed before switching
to explicit positioning.

---

## 2. Missing `import "../../services"` — Theme Works by Accident

**Symptom:** A QML file uses `Theme.*` properties without importing the
services directory, and it appears to work — until it doesn't. Specifically,
properties bound via `anchors.*` or declarative bindings may resolve (through
scope inheritance from the parent Loader), but explicit `x`/`y`/`width`/
`height` bindings fail with `ReferenceError: Theme is not defined`.

**Root cause:** When a component is loaded via `sourceComponent:` in a Loader,
it can inherit the parent file's import scope. This is fragile — some binding
evaluation contexts (particularly eager property bindings like x/y/width/height)
may execute before scope inheritance is established, causing ReferenceErrors.

**Rule:** Always declare explicit imports in every QML file. Never rely on
scope inheritance from parent Loaders.

```qml
// ALWAYS include both imports in every file that uses Theme:
import "../../components"
import "../../services"
```

**Discovered in:** `TextPreview.qml` and `VideoPreview.qml` — both were
missing `import "../../services"` but appeared to work via scope inheritance
from `PreviewPanel.qml`.

---

## 3. QML Cache Must Be Cleared After C++ Plugin Changes

**Symptom:** After modifying and rebuilding the C++ plugin (Symmetria.Models,
Symmetria.Services, etc.), QML files that use the new/modified types fail to
load or show stale behavior.

**Fix:** The `run.sh` script already handles this:
```bash
rm -rf ~/.cache/quickshell/qmlcache
```

But if running the shell directly (not via `run.sh`), always clear the cache
manually after any C++ plugin rebuild + install.
