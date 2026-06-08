#!/usr/bin/env bash
#
# check-qml.sh — deterministic QML code-quality gate for the Symmetria FM.
#
# QML has no single "Knip + ESLint" like the JS/TS world. This runner assembles
# an equivalent from the Qt tools plus two small heuristics that fill the gaps:
#
#   1. LINT (bad practices)      — qmllint, using the project .qmllint.ini
#                                  (unqualified access, unused IMPORTS, deprecations,
#                                  type errors, signal-handler mistakes, …).
#   2. GOD FILES (size)          — flag .qml files over a line threshold.
#   3. DEAD COMPONENTS (unused)  — flag *.qml components never referenced anywhere
#                                  else in the tree (the cross-file "unused code"
#                                  that qmllint cannot see). Public API exported
#                                  via qmldir + the FileManager entry are excluded.
#   4. FORMAT DRIFT (optional)   — `--format` adds a qmlformat consistency check.
#
# Usage:
#   tools/quality/check-qml.sh                       # full tree: lint + god files + dead code
#   tools/quality/check-qml.sh a.qml b.qml           # SCOPED: lint/god-check only these files
#                                                    #   (used by /seal on a commit's changed QML;
#                                                    #    dead-component scan stays full-tree)
#   tools/quality/check-qml.sh --format              # also report qmlformat drift
#   QML_GODFILE_LINES=400 tools/quality/check-qml.sh # stricter god-file bar
#
# Exit code is non-zero if any check finds a problem (suitable for CI / seal / pre-commit).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QML_DIR="$ROOT/qml"
QMLLINT="/usr/lib/qt6/bin/qmllint"
QMLFORMAT="/usr/lib/qt6/bin/qmlformat"
GODFILE_LINES="${QML_GODFILE_LINES:-500}"
DO_FORMAT=0
SCOPED_FILES=()
for arg in "$@"; do
  case "$arg" in
    --format) DO_FORMAT=1 ;;
    *.qml)
      if [ -f "$arg" ]; then
        SCOPED_FILES+=("$(cd "$(dirname "$arg")" && pwd)/$(basename "$arg")")
      else
        echo "warning: file not found, skipping: $arg" >&2
      fi ;;
    *) echo "warning: ignoring unknown arg: $arg" >&2 ;;
  esac
done

status=0
hr() { printf '\n\033[1m── %s ──\033[0m\n' "$1"; }

# Scoped mode (file args) lints/god-checks ONLY those files — how /seal isolates
# a change's new issues from the repo's pre-existing baseline. The dead-component
# scan always runs over the whole tree (orphaning can only be judged globally).
if [ ${#SCOPED_FILES[@]} -gt 0 ]; then
  QML_FILES=("${SCOPED_FILES[@]}")
  echo "Scanning ${#QML_FILES[@]} specified .qml file(s) [scoped mode]"
else
  mapfile -t QML_FILES < <(find "$QML_DIR" -name '*.qml' | sort)
  echo "Scanning ${#QML_FILES[@]} .qml files under qml/ [full tree]"
fi

# ── 1. LINT ────────────────────────────────────────────────────────────────
hr "1. qmllint (bad practices, unused imports, type errors)"
# Run from ROOT so qmllint auto-discovers .qmllint.ini (which sets the import path).
# Info-level output (the intentionally-demoted MissingProperty false positives
# from var-typed singletons — see .qmllint.ini) is NOISE for a gate; show and
# judge only Warning/Error lines.
lint_out="$( cd "$ROOT" && "$QMLLINT" "${QML_FILES[@]}" 2>&1 )"
lint_actionable="$(printf '%s\n' "$lint_out" | grep -E '^(Warning|Error):' || true)"
if [ -n "$lint_actionable" ]; then
  printf '%s\n' "$lint_actionable"
  echo "❌ qmllint: $(printf '%s\n' "$lint_actionable" | wc -l) warning/error line(s)"
  status=1
else
  info_n="$(printf '%s\n' "$lint_out" | grep -cE '^Info:' || true)"
  echo "✅ qmllint clean (no warnings/errors; ${info_n} demoted info notes hidden)"
fi

# ── 2. GOD FILES ───────────────────────────────────────────────────────────
hr "2. God files (> ${GODFILE_LINES} lines)"
god_found=0
while read -r n f; do
  if [ "$n" -gt "$GODFILE_LINES" ]; then
    printf '❌ %5d  %s\n' "$n" "${f#"$ROOT"/}"
    god_found=1
  fi
done < <(wc -l "${QML_FILES[@]}" | sed '$d' | sort -rn)
if [ "$god_found" -eq 0 ]; then
  echo "✅ no file over ${GODFILE_LINES} lines"
else
  echo "   → consider decomposing into smaller components."
  status=1
fi

# ── 3. DEAD COMPONENTS ─────────────────────────────────────────────────────
hr "3. Dead components (defined but never referenced)"
python3 - "$ROOT" "$QML_DIR" <<'PY'
import sys, re, pathlib
root, qml_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
qml_files = sorted(qml_dir.rglob("*.qml"))

# Public API is anything a qmldir exports (it can be used by an external host —
# e.g. the Symmetria IDE imports the UI module), plus the embeddable entry point.
public = {"FileManager"}
for qmldir in qml_dir.rglob("qmldir"):
    for line in qmldir.read_text(errors="ignore").splitlines():
        parts = line.split()
        if not parts or parts[0].startswith("#"):
            continue
        # forms:  Name <ver> File.qml   |   singleton Name <ver> File.qml
        toks = parts[1:] if parts[0] in ("singleton", "internal") else parts
        if toks and toks[0][:1].isupper():
            public.add(toks[0])

# Concatenate every QML + JS source once; a component is "used" if its name
# appears as a whole word in any file other than its own definition.
sources = {p: p.read_text(errors="ignore") for p in qml_files}
for js in qml_dir.rglob("*.js"):
    sources[js] = js.read_text(errors="ignore")

dead = []
for f in qml_files:
    name = f.stem
    if name in public:
        continue
    pat = re.compile(r"\b" + re.escape(name) + r"\b")
    used = any(pat.search(txt) for p, txt in sources.items() if p != f)
    if not used:
        dead.append(f.relative_to(root))

if dead:
    print("❌ candidates (verify — may be loaded dynamically via Qt.createComponent):")
    for d in dead:
        print(f"   {d}")
    sys.exit(1)
else:
    print("✅ every component is referenced somewhere")
PY
[ $? -ne 0 ] && status=1

# ── 4. FORMAT DRIFT (optional) ─────────────────────────────────────────────
if [ "$DO_FORMAT" -eq 1 ]; then
  hr "4. qmlformat drift (--format)"
  drift=0
  for f in "${QML_FILES[@]}"; do
    if ! "$QMLFORMAT" "$f" | diff -q - "$f" >/dev/null 2>&1; then
      echo "✎ not qmlformat-clean: ${f#"$ROOT"/}"
      drift=1
    fi
  done
  if [ "$drift" -eq 0 ]; then echo "✅ all files qmlformat-clean"; else
    echo "   → run: qmlformat -i <file>   (note: adopting qmlformat is a style decision)"
    status=1
  fi
fi

hr "Result"
[ "$status" -eq 0 ] && echo "✅ all QML quality checks passed" || echo "❌ issues found (exit $status)"
exit "$status"
