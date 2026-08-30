/**
 * `@symmetria/fm-core` — the framework-free half of the file manager.
 *
 * Everything here is a pure function of data, so it is testable without a
 * window and extractable into a published package later without a rewrite.
 * Both the main process and the renderer import from it; neither owns it.
 *
 * This file is the scaffold placeholder. Real modules arrive per phase, each
 * one added to the `exports` map in `package.json` as its own subpath rather
 * than re-exported from here — a barrel would defeat the tree-shaking the
 * consuming host relies on.
 *
 * Planned subpaths, from `docs/electron-transition/` and the approved plan:
 *
 * - `./entry`  — the entry model              (phase 3)
 * - `./mime`   — MIME resolution, inheritance (phase 3)
 * - `./sort`   — the five sort comparators    (phase 3)
 * - `./filter` — hidden and ignored filtering (phase 3)
 * - `./keys/*` — the keybinding registry      (phase 6)
 * - `./preview/route` — the preview router    (phase 8)
 * - `./icons/resolve` — the icon resolver     (phase 10)
 */

export {};
