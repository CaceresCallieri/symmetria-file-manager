import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("..", import.meta.url));

/**
 * Acceptance criteria 1, 3 and 5 of phase 2.
 *
 * The application is launched for real and asked to report on itself, then
 * exits. Two rules make this safe to run on a machine somebody is using:
 *
 * 1. **`xvfb-run` always.** The window opens on a virtual display, never on the
 *    operator's session.
 * 2. **`ELECTRON_RUN_AS_NODE` must be cleared.** It is set in this environment.
 *    With it set the Electron binary runs as plain Node: `require("electron")`
 *    fails with MODULE_NOT_FOUND and Chromium flags are rejected as
 *    `bad option`, which reads as a broken app rather than a broken harness.
 */
function launchAndReport(): Record<string, unknown> {
  const env: NodeJS.ProcessEnv = { ...process.env, SYMMETRIA_FM_SMOKE: "1" };
  delete env.ELECTRON_RUN_AS_NODE;

  const stdout = execFileSync(
    "xvfb-run",
    ["-a", "--", electronBinary(), ".", "--no-sandbox", "--ozone-platform=x11"],
    { cwd: appDir, env, encoding: "utf8", timeout: 45_000 },
  );

  const line = stdout.split("\n").find((l) => l.startsWith("SMOKE_REPORT "));
  expect(line, `no SMOKE_REPORT in output:\n${stdout}`).toBeTypeOf("string");
  return JSON.parse((line as string).slice("SMOKE_REPORT ".length));
}

function electronBinary(): string {
  const local = fileURLToPath(new URL("../node_modules/electron/dist/electron", import.meta.url));
  if (existsSync(local)) return local;
  const root = fileURLToPath(new URL("../../node_modules/electron/dist/electron", import.meta.url));
  return root;
}

/**
 * One launch for every suite in this file.
 *
 * It was declared inside the first `describe`, which was fine while there was
 * only one. A second suite reading it would either not see it at all or, if
 * each declared its own, boot a whole second Electron process to ask the same
 * running application the same questions.
 */
const report = launchAndReport();

describe("the application boots", () => {
  it("creates exactly one window", () => {
    expect(report.windowCount).toBe(1);
  });

  it("gives that window a title", () => {
    expect(report.title).toBeTypeOf("string");
    expect(report.title).not.toBe("");
  });

  it("shows the window only after it is ready to paint", () => {
    expect(report.shownOnReadyToShow).toBe(true);
  });

  it("denies the renderer any access to the filesystem", () => {
    // The renderer is sandboxed, so `require("node:fs")` must not resolve.
    // This is the criterion the whole architecture rests on: if it ever passes,
    // every filesystem call in every later phase can quietly move to the wrong
    // side of the bridge.
    expect(report.rendererCanRequireFs).toBe(false);
  });

  it("denies the renderer any local file over the web APIs either", () => {
    // Found by verification, not by the first draft of this suite. A page on a
    // `file://` origin may `fetch` any other `file://` resource, so blocking
    // `require("node:fs")` alone left the disk wide open. The renderer is now
    // served from its own scheme, which removes that privilege.
    expect(report.rendererCanFetchLocalFile).toBe(false);
    expect(report.rendererOrigin).toBe("symmetria-fm:");
  });

  it("lists a real directory through the bridge, from sandboxed page code", () => {
    // The whole point of phase 4. The renderer cannot reach the filesystem,
    // so a listing it can produce proves the bridge is the route and that the
    // route works from inside the sandbox.
    expect(report.bridgeList).toBeTypeOf("number");
    expect(report.bridgeList as number).toBeGreaterThan(0);
  });

  it("refuses a malformed request at the boundary, as a value", () => {
    expect(report.bridgeRejectsBadInput).toBe(true);
  });

  it("exposes only the declared bridge methods", () => {
    // An exact string, so a method added to the privileged surface is a
    // deliberate edit here rather than something that slips in. `bookmarksRead`
    // and `bookmarksWrite` joined it when the bookmark store landed;
    // `clipboard` when the copy chord did, and `frecent` when the zoxide jump
    // did.
    //
    // RUN THIS SUITE WITH `pnpm -r test`, never with `vitest` from the
    // repository root. The root has no vitest config, so the app's own
    // `globalSetup` — which BUILDS the bundles this test launches — does not
    // run, and this assertion then reads a stale build and passes against code
    // that is no longer there. It did exactly that for three phases.
    expect(report.bridgeKeys).toBe(
      "bookmarksRead,bookmarksWrite,cancel,cancelTransfer,clipboard,create,describe,frecent,list,onChanged,onListBatch,onTransferProgress,open,previewUrl,readText,rename,transfer,trash,unwatch,version,watch",
    );
  });

  it("exposes the bridge to the renderer and nothing besides", () => {
    expect(report.rendererBridgePresent).toBe(true);
    expect(report.rendererHasNodeProcess).toBe(false);
  });
});

/**
 * Phase 1 of run 3 — a row whose name overflows its column.
 *
 * These five assertions cannot live in the renderer suite. It runs under
 * happy-dom, which has no layout engine and computes no cascade, so every
 * measurement below would read zero there whatever the stylesheet said. This
 * project has already paid for that blind spot once: a marked row's icon stayed
 * foreground-white beside its coloured name, because the icon is the name's
 * sibling rather than its child, and only a real browser could see it.
 *
 * The numbers come from the probe in `main/index.ts`, which lengthens a REAL
 * row's name in place rather than building a row of its own.
 */
interface RowLayout {
  readonly fittingIconLeft: number;
  readonly overflowingIconLeft: number;
  readonly overflowingMarkWidth: number;
  readonly overflowingLinkWidth: number;
  readonly overflowingLinkText: string;
  readonly nameClipped: boolean;
  readonly rowRestored: boolean;
}

describe("a row whose name is too wide for its column", () => {
  // SAFETY: the probe returns either this exact shape or one of two string
  // sentinels, `"no-row"` and `"row-missing-parts"`. The first assertion below
  // rejects a sentinel before any other test reads a field, so every field
  // access under this cast runs only where the shape held.
  const layout = report.rowLayout as RowLayout;

  it("was measured at all", () => {
    // A string here is the probe reporting it found no row to measure, which
    // would make every assertion below vacuously true.
    expect(report.rowLayout, `probe said: ${JSON.stringify(report.rowLayout)}`).toBeTypeOf(
      "object",
    );
    expect(layout.fittingIconLeft).toBeTypeOf("number");
    expect(layout.overflowingIconLeft).toBeTypeOf("number");
  });

  it("starts its icon where a row that fits starts its icon", () => {
    // The defect this phase exists to fix. Measured at 8 CSS pixels: the
    // eight-pixel mark box was the only shrinkable item in the row, so the flex
    // algorithm recovered the overflow by collapsing it, dragging the icon and
    // the name left with it.
    expect(layout.overflowingIconLeft).toBe(layout.fittingIconLeft);
  });

  it("clips the name, which is what an ellipsis needs", () => {
    expect(layout.nameClipped).toBe(true);
  });

  it("keeps the eight pixels of the leading mark", () => {
    expect(layout.overflowingMarkWidth).toBe(8);
  });

  it("still draws the trailing symlink arrow", () => {
    expect(layout.overflowingLinkWidth).toBeGreaterThan(0);
    // A width alone does not prove it is an arrow. The string crosses two
    // levels of escaping to reach the page, and a broken escape would arrive
    // as six literal characters that measure wider than the glyph, not
    // narrower — so the width assertion above would pass on it.
    expect(layout.overflowingLinkText).toBe("→");
  });

  it("puts the row back exactly as it found it", () => {
    // The probe rewrites a live row to force the overflow. Review found the
    // restore was not in a `finally`: a measurement that threw would escape
    // `reportAndQuit`, `app.exit(0)` would never run, and the launch would hang
    // until the harness's 45-second timeout — a probe bug arriving disguised as
    // a timeout, which is the hardest kind of failure to read.
    expect(layout.rowRestored).toBe(true);
  });
});
