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

describe("the application boots", () => {
  const report = launchAndReport();

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
    expect(report.bridgeKeys).toBe(
      "cancel,list,onChanged,onListBatch,readText,unwatch,version,watch",
    );
  });

  it("exposes the bridge to the renderer and nothing besides", () => {
    expect(report.rendererBridgePresent).toBe(true);
    expect(report.rendererHasNodeProcess).toBe(false);
  });
});
