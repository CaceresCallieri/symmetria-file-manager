# Project Standards — Quality Gate

> This file defines the **deterministic quality bar** for the Symmetria File
> Manager. The `/seal` pipeline, the `code-review` skill, and any commit workflow
> MUST enforce it. It is referenced from `CLAUDE.md` so in-repo agents discover it.

## The gate

For any change touching **QML**, run the project's QML quality checker on the
**changed** `.qml` files (scoped mode) and treat any finding as **blocking** —
fix it before the fixes-commit:

```bash
tools/quality/check-qml.sh <each changed .qml file>
```

For changes touching the **C++ plugin** (`plugin/`), the existing build + test
gate applies (see `CLAUDE.md` → Build & Run):

```bash
cd plugin && cmake -B build && cmake --build build --parallel "$(nproc)" \
  && QT_QPA_PLATFORM=offscreen ctest --test-dir build --output-on-failure
```

## What the QML checker enforces

`tools/quality/check-qml.sh` (the "Knip + ESLint for QML" — no extra deps,
just Qt's `qmllint`/`qmlformat` + bash/python3) runs four checks:

1. **qmllint** (bad practices) — uses the repo `.qmllint.ini`. Only `Warning`/`Error`
   lines count; `Info`-level (the intentionally-demoted `MissingProperty` false
   positives from `var`-typed singletons) is NOT a violation.
2. **God files** — `.qml` over `QML_GODFILE_LINES` (default 500).
3. **Dead components** — a `*.qml` component never referenced anywhere (qmldir
   exports + the `FileManager` entry are excluded as public API). Always scanned
   over the whole tree.
4. **Format drift** (`--format`, optional) — `qmlformat` consistency.

## Pass criteria (delta-based — this is important)

The repo carries a **pre-existing baseline** of warnings; do NOT gate on zero.
Gate on **not regressing**, and on the **changed files being clean**:

- **Changed `.qml` files MUST pass `check-qml.sh` in scoped mode** (no new
  `Warning`/`Error`, none turned into a god file).
- **No new dead components** introduced by the change.
- The full-tree counts MUST NOT increase. Reducing them is welcome.

### Baseline snapshot (full-tree, as of 2026-06-08)
- qmllint: **88** actionable warnings (mostly `Unqualified access`,
  `Quick.layout-positioning`; one `incompatible-type` at `WindowState.qml:170`).
- God files (>500 lines): **1** — `FileTreeView.qml` (1737).
- Dead components: **0**.

Re-measure with `tools/quality/check-qml.sh` (full tree) and update this snapshot
whenever the baseline is deliberately moved (e.g. after a cleanup pass).

## How `/seal` should apply this

During the review/fixes phase, after identifying the commit's changed `.qml`
files, run `tools/quality/check-qml.sh <those files>`. Any `Warning`/`Error`,
new god file, or new dead component is a **review finding to fix** before the
fixes-commit — the same status as a `code-reviewer` finding.

## Known gaps (not enforced — no QML tool covers them)
Unused *properties/functions within* a component, and cyclomatic complexity.
A future `ast-grep` rule set (needs a QML grammar) could add project-specific
structural rules (e.g. enforce the `CLAUDE.md` `Anim`-on-color ban).
