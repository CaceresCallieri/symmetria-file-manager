# AGENTS.md

This file is canonical. `CLAUDE.md` is a symlink to it. Edit `AGENTS.md` and preserve the symlink.

## Project constraints

Electron is the only file-manager implementation. The standalone host and the panel embedded in Mesura Code share the workspace packages. Mesura Code vendors `packages/` through a git subtree and does not vendor `app/`.

Symmetria Shell owns its filesystem model. Symmetria-IDE is retired and is not a supported embedding host.

Read `docs/electron-transition/35-laptop-release.md` before changing the laptop installation. The laptop runs an independent release. A development worktree must not replace its launcher or its integration links.

## Build and reload

### Electron Changes — Rebuild and Restart Before Reporting

An edit to anything bundled into `app/dist-electron/` — `app/src/**` and
`packages/fm-*/src/**` — is NOT live until the bundle is rebuilt and the daemon
restarts onto it. `symmetria-fm-electron.service` is resident and holds the old
code in memory, so the operator then tests the previous bundle and sees a fix
that did not work. A change confined to tests, docs or tooling needs no restart.

**This is the LAST command of the change — after the tests, after the gates.**
`pnpm -r test` rebuilds `app/dist-electron/` itself and leaves a DEVELOPMENT
bundle there, so anything that runs the suite must be followed by this again:

```bash
readlink -f ~/.local/bin/symmetria-fm-electron   # must resolve inside THIS tree
pnpm --filter @symmetria/fm-app build \
  && systemctl --user restart symmetria-fm-electron.service \
  && systemctl --user is-active symmetria-fm-electron.service
```

- **The `readlink` is not ceremony.** That launcher and the unit are symlinks
  into ONE tree, and this project is worked on in `t3` worktrees. From any other
  worktree the build succeeds and changes nothing the operator can see — the
  same silent-stale failure this rule exists to prevent. If it resolves
  elsewhere, say so instead of restarting.
- **A failed build must NOT be followed by a restart** — the old bundle is still
  serving the operator. Report the build output instead.
- If the service is not `active` afterwards, report
  `systemctl --user status symmetria-fm-electron.service`. Never `pkill`.

Then state in the final summary that the daemon was rebuilt and restarted, so
the operator knows the running window holds the new code.

Restarting this unit needs NO consent: the operator asked for the reload so they
can check the change, and accepts that it closes any open Electron FM window.
The permission covers `symmetria-fm-electron.service` only.

Why the unit does not rebuild, and why a test run poisons the bundle:
`docs/electron-transition/22-desktop-integration.md` → *Rebuilding before a
restart*.

## Deterministic Checks

Run these change-scoped checks during `/seal`, `/code-review`, and ad-hoc review. Substitute `<base>` with the commit the review target diffs against: the parent of one reviewed commit, or `<oldest>^` for a commit range.

```bash
{ git diff --name-only --diff-filter=ACMR <base>; git ls-files --others --exclude-standard; } | sort -u | xargs -r pnpm exec biome check --reporter=summary --no-errors-on-unmatched  # lint + format + a11y
git diff -z --name-only --diff-filter=ACMR <base> -- '*.js' '*.jsx' '*.mjs' '*.cjs' '*.ts' '*.tsx' '*.mts' '*.cts' | xargs -0 -r pnpm exec oxlint --config anti-slop.config.mjs --disable-nested-config --format agent --  # command-id: typescript.anti-slop.changed.v1; type-evidence policy; errors gate, pilot warnings advise
pnpm exec tsc -p packages/fm-core --noEmit --pretty false  # types — shared core: no environment at all
pnpm exec tsc -p packages/fm-main --noEmit --pretty false  # types — privileged half: Node, no DOM
pnpm exec tsc -p packages/fm-ui --noEmit --pretty false  # types — panel SOURCE: DOM, no Node
pnpm exec tsc -p packages/fm-search --noEmit --pretty false  # types — finder engine: Node, no DOM
pnpm exec tsc -p packages/fm-search/tsconfig.ui.json --noEmit --pretty false  # types — finder overlay: DOM, no Node
pnpm exec tsc -p packages/fm-search/tsconfig.test.json --noEmit --pretty false  # types — finder TESTS: both, they read the source tree
pnpm exec tsc -p packages/fm-ui/tsconfig.test.json --noEmit --pretty false  # types — panel TESTS: Node, they read the source tree
pnpm exec tsc -p app/tsconfig.main.json --noEmit --pretty false  # types — host main process: Node, no DOM
pnpm exec tsc -p app/tsconfig.renderer.json --noEmit --pretty false  # types — host renderer entry: DOM, no Node
pnpm exec fallow audit --changed-since <base> --format compact  # dead code, complexity, duplication; new findings gate
```

**Biome is given an explicit file list, and `--changed --since=<base>` is wrong here.** That flag reads COMMITTED state. `/code-review` and any ad-hoc review look at a working tree, where it reports `Checked 0 files` and exits 0 with eleven files modified — a silent pass, which is the worst shape a check can fail in. The list form above covers both cases, because `git diff --name-only <base>` against a working tree includes uncommitted edits.

**The `git ls-files --others` half is not optional.** `git diff` alone cannot see an untracked file, so a phase's brand-new source and test files are invisible to the formatter and the linter until the moment they are committed. That happened: two whole new test files went unchecked for a phase before anyone noticed.

Biome and `tsc` exit non-zero on findings. Anti-slop errors gate; listed pilot warnings remain advisory. Fallow uses the gating `audit` command.

**One `tsc` line per context, not one for the tree.** There are NINE and they must not share a `lib`. `packages/fm-core` is imported by everything and gets no environment at all; `packages/fm-main` — the privileged half — gets Node and no DOM; `packages/fm-ui` — the panel — gets DOM and no Node; the host's two halves get the same treatment as the packages they load. A shared `lib` would let a `window` reference type-check inside a main process and a `node:fs` import type-check inside a sandboxed renderer.

**`packages/fm-search` is THREE of the nine, because it spans the boundary.** It is the only package that ships code for both sides — an engine that runs in a utility process and an overlay that runs in the sandboxed renderer — so it carries the fm-main and fm-ui treatments in one package: `tsconfig.json` covers `src/main` with Node and no DOM, `tsconfig.ui.json` covers `src/ui` with DOM and no Node. One config for the package would defeat the split the package exists to hold, since a host must be able to mount the overlay alone. Its `tsconfig.test.json` is the third and gets BOTH, for the same reason `packages/fm-ui` needs one: the boundary test reads every source file under `src/ui` to prove that half never imports Node, so it needs a filesystem, and the standalone test mounts the overlay, so it needs a DOM. Neither permission may reach either source.

**`packages/fm-ui` has TWO configs and both are in the fence.** Its `tsconfig.json` covers `src` alone with `types: []`, which is the real contract: the panel is sandboxed and must not reach Node. Its tests DO need Node, because the invariant test reads every source file to prove that contract holds — so they live in `tsconfig.test.json`. One shared config would hand the source whatever the tests need, which is the whole thing this package exists to prevent. The rule earns its keep in practice, not only in principle: `packages/fm-core/src/windowUrl.ts` reaches for `URLSearchParams` and cannot have it, because that package compiles against no environment at all — which is what forced a hand-rolled parse, and the hand-rolled one turned out to be more correct anyway (`URLSearchParams` decodes `+` as a space, so a directory named `c++` would come back wrong).

**Advisory pilot — anti-slop: REVIEWED 2026-09-07.** Catalog revision `bc94865c5c4a2663b344cc7a9b6d755526fd5fca614618ff92761f4e2658e396` (profile `typescript.md`, no layers matched). Tool source revision `6d538555cb151d4121ed51a27db81890eacf8ae9`. **Next review due 2027-03-07**; on or after that date, report `pilot review overdue` and keep the rules still listed as advisory until a reviewed decision changes this contract. Command records: `typescript.anti-slop.changed.v1` = `5ac5cd1291b040b6294b8429d5ee68c8e05b1df27002d46c7b70fc732ef814a6`; `typescript.anti-slop.full.v1` = `758ba14767a3b44c4d51dd419b710c17bf41120e0c4705a94fede96ab5b9f884`. The review measured all seven rules against the whole tree and settled five of them; each decision and its evidence sits beside the rule in `anti-slop.config.mjs`, which is the place to read before changing one. **Promoted to blocking errors**, taking the error set from eight rules to ten: `anti-slop/no-module-mocking` and `anti-slop/require-safety-comment-for-type-assertion`. **Retired to `off`**: `anti-slop/no-runtime-typeof`, `anti-slop/no-unknown-parameters` and `anti-slop/no-unsafe-dictionary-type` — they assume a schema library parses at the I/O boundary, this project parses by hand in `packages/fm-core/src/contract.ts`, and so they fired 151 times on the decoders that implement the discipline they exist to advocate without one defect among them. Reinstate them only if this project adopts a schema library. **The two rule IDs that remain advisory are `anti-slop/no-conditional-empty-object-spread` and `anti-slop/no-shape-in-symbol-names`**, both on an inconclusive sample — one observation and zero. `require-safety-comment-for-type-assertion` is scoped `off` for test files by an `overrides` block; source is clean and gates. Promote a warning only with observed project evidence; keep it advisory when the sample is inconclusive.

This project prose is the runtime classification authority. A blocking finding prevents completion until it is fixed or suppressed narrowly with a reason. A listed advisory finding remains review evidence but does not prevent completion. A command that cannot execute is a tooling failure: report it and continue the review. Suppressions live in `biome.jsonc`, `anti-slop.config.mjs`, `.fallowrc.jsonc` and `knip.json`, each beside a reason.

**Tests never enter this section, tracked or not** — the catalog excludes them by contract. Vitest is a repository-gate concern only. Run them as their own invocation beside this fence; the command and the trap it hides are in *Full-Project Checks* below.

## Full-Project Checks

Run every command during `/tech-debt`, a full codebase audit, and CI. Run all lines even when one reports findings.

```bash
pnpm exec biome check . --reporter=summary  # lint + format + a11y — complete project
pnpm exec oxlint --config anti-slop.config.mjs --disable-nested-config --format stylish -- .  # command-id: typescript.anti-slop.full.v1; type-evidence policy; errors gate, pilot warnings feed tech debt
pnpm exec tsc -p packages/fm-core --noEmit --pretty false  # types — shared core: no environment at all
pnpm exec tsc -p packages/fm-main --noEmit --pretty false  # types — privileged half: Node, no DOM
pnpm exec tsc -p packages/fm-ui --noEmit --pretty false  # types — panel SOURCE: DOM, no Node
pnpm exec tsc -p packages/fm-search --noEmit --pretty false  # types — finder engine: Node, no DOM
pnpm exec tsc -p packages/fm-search/tsconfig.ui.json --noEmit --pretty false  # types — finder overlay: DOM, no Node
pnpm exec tsc -p packages/fm-search/tsconfig.test.json --noEmit --pretty false  # types — finder TESTS: both, they read the source tree
pnpm exec tsc -p packages/fm-ui/tsconfig.test.json --noEmit --pretty false  # types — panel TESTS: Node, they read the source tree
pnpm exec tsc -p app/tsconfig.main.json --noEmit --pretty false  # types — host main process: Node, no DOM
pnpm exec tsc -p app/tsconfig.renderer.json --noEmit --pretty false  # types — host renderer entry: DOM, no Node
pnpm -r test  # the whole suite, per package. NEVER `vitest` from the root — see below. Leaves a DEVELOPMENT bundle in app/dist-electron/: rebuild before any daemon restart (Build & Run → Electron Changes)
pnpm exec knip --reporter json  # files, exports, dependencies, and the workspace package graph
pnpm exec fallow dead-code --fail-on-issues  # whole-project dead code; any issue gates
pnpm exec fallow health --score --hotspots --fail-on-issues  # complexity, cycles, and health hotspots
pnpm exec fallow dupes --fail-on-issues  # whole-project duplication
```

**Advisory pilot — anti-slop: REVIEWED 2026-09-07.** Catalog revision `bc94865c5c4a2663b344cc7a9b6d755526fd5fca614618ff92761f4e2658e396` (profile `typescript.md`, no layers matched). Tool source revision `6d538555cb151d4121ed51a27db81890eacf8ae9`. **Next review due 2027-03-07**; on or after that date, report `pilot review overdue` and keep the rules still listed as advisory until a reviewed decision changes this contract. Command records: `typescript.anti-slop.changed.v1` = `5ac5cd1291b040b6294b8429d5ee68c8e05b1df27002d46c7b70fc732ef814a6`; `typescript.anti-slop.full.v1` = `758ba14767a3b44c4d51dd419b710c17bf41120e0c4705a94fede96ab5b9f884`. The review measured all seven rules against the whole tree and settled five of them; each decision and its evidence sits beside the rule in `anti-slop.config.mjs`, which is the place to read before changing one. **Promoted to blocking errors**, taking the error set from eight rules to ten: `anti-slop/no-module-mocking` and `anti-slop/require-safety-comment-for-type-assertion`. **Retired to `off`**: `anti-slop/no-runtime-typeof`, `anti-slop/no-unknown-parameters` and `anti-slop/no-unsafe-dictionary-type` — they assume a schema library parses at the I/O boundary, this project parses by hand in `packages/fm-core/src/contract.ts`, and so they fired 151 times on the decoders that implement the discipline they exist to advocate without one defect among them. Reinstate them only if this project adopts a schema library. **The two rule IDs that remain advisory are `anti-slop/no-conditional-empty-object-spread` and `anti-slop/no-shape-in-symbol-names`**, both on an inconclusive sample — one observation and zero. `require-safety-comment-for-type-assertion` is scoped `off` for test files by an `overrides` block; source is clean and gates. Promote a warning only with observed project evidence; keep it advisory when the sample is inconclusive.

This gate starts clean. Every blocking finding must be fixed or suppressed narrowly with a reason before setup is complete. Listed advisory findings remain visible for `/tech-debt` and do not prevent adoption. A command that cannot execute is a tooling failure and does not hide results from the remaining commands.

**Run the suite as `pnpm -r test`, and NEVER as `vitest` from the repository root.** There is no vitest config at the root. The app's lives at `app/vitest.config.ts`, and it carries two things that are silently lost when the root form is used:

- **`globalSetup`, which BUILDS the bundles the smoke test launches.** Without it the smoke test launches whatever `app/dist-electron/` happens to hold, so it asserts against a stale build and passes for code that is no longer there. It did exactly that for three phases before anyone noticed, and what caught it was a deliberate change to the bridge surface that should have failed and did not.
- **`fileParallelism: false`.** The smoke test spawns a real Electron under a virtual display and must never race a second copy of itself, and the renderer suites starve each other's `waitFor` timers when they run in parallel — which produced flakes in two different files that were mistaken for product bugs.

`pnpm -r test` runs each package under its own config, which is the only form that honours both.

## Architecture constraints

### The file finder: `packages/fm-search`

The finder ships as its own workspace package because a host must be able to
mount it **without** the file-manager panel — Mesura Code takes the finder, not
the file manager. Everything a consumer looks up lives in
`packages/fm-search/README.md`; what an agent has to know **before touching this
tree** is only this:

- **Two halves, two environments, and they must not cross.** `./main` is the
  engine and runs in a Node process; `./ui` is the overlay and runs in a
  sandboxed renderer. `test/boundary.test.ts` reads every source file under each
  and fails on a `node:` import in `src/ui` or an `@symmetria/fm-ui` import in
  either. The panel depends on this package, so an import back would also be a
  cycle.
- **One index per process, keyed by directory.** The engine's store refuses a
  second open inside one program. Do not "simplify" `main/pool` into a shared engine.
- **The overlay reaches the engine through the bridge global, not through the
  panel.** Its `onChoose` / `onClose` / `renderPreview` props are the activation
  seam; a host supplies all three, and the panel's own preview arrives through
  `renderPreview` rather than an import.

**Reader routing** (React renderer, `packages/fm-ui`) — The reader uses the ported cascade's single modal gate (`@symmetria/fm-core/keys/cascade`, gated by `cascadeModeFor` in `packages/fm-ui/src/App.tsx`) with its own Escape and Ctrl+Enter handler in `ReaderOverlay` (`packages/fm-ui/src/components/ReaderOverlay.tsx`). `useKeyDispatch` (`packages/fm-ui/src/hooks/useKeyDispatch.ts`) leaves browser scroll keys to the browser on a focused reader surface with `data-scrolls="true"` — but it asks AFTER the cascade and only when the cascade reports a `modal` outcome, never before it, because an early return would hand those keys to every surface that ever carries the attribute. The close handler lives on `window` and calls `stopImmediatePropagation()` (`useOverlayCloseKeys`) so an operation dialog behind the reader cannot also consume the key, and a `blur` listener (`useEmbedFocusGuard`) takes focus back when it leaves into an `<embed>` — Chromium's PDF plugin swallows every key it holds, so without both the reader could not be closed from inside a document. That guard is `<embed>` only, deliberately: the HTML preview's `<iframe>` is an in-process document that keeps its own keys. Rationale in both hooks' comments. Keep the reader a dialog because a separate view kind would bypass modal precedence and turn a transient overlay into navigation state.

**Reader remounting** (React renderer, `packages/fm-ui`) — When Ctrl+Enter expands the current preview into the reader (the same chord closes it), `previewPanesFor` in `packages/fm-ui/src/App.tsx` transfers preview ownership to the reader (the reader shows `Reading…` while `pane.path` differs from the cursor path, so it never displays a stale document), and `PreviewSlot` in `packages/fm-ui/src/components/MillerColumns.tsx` replaces the column preview with its reserved placeholder. Expect the document `<embed>` to lose its page position because React remounts it across these component trees instead of moving the same mounted node. This is accepted, not a defect: do NOT portal the preview or hoist it to a shared parent to preserve scroll state — the column and the reader are separate trees on purpose, and `previewPanesFor` guarantees only one of them mounts a preview.

**Two host profiles, two looks** (React renderer) — The standalone passes `chrome="atmosphere"` to `App` and imports `app/src/renderer/atmosphere.css` after the package sheets; Mesura Code passes neither, because it vendors `packages/` but not `app/` and its layer keeps a minimal look. So a style change for the standalone belongs in `atmosphere.css`, and a rule added to `styles.css` reaches Mesura Code at its next subtree pull. Markup only the standalone shows is hidden by default in `styles.css`. Rules and rationale: `docs/design/atmosphere-design-system.md` → *Host profiles*.

**Reader styling** (React renderer, `packages/fm-ui`) — The package's renderer styling lives in the one global `packages/fm-ui/src/styles.css` (the tree's `tree.css` is the one exception), so reader-only layout rules stay under `.reader` or `.preview-pane--reader`, while the global `object-fit: contain` image and video rules keep the column preview and the reader uncropped. Scope new reader adjustments the same way. An unscoped reader fix also changes the column preview. A global rule moved under a reader class stops applying to the column.
