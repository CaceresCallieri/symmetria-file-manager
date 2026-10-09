#!/usr/bin/env node
// Run from the packaged release before replacing an installed release.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const release = fileURLToPath(new URL("../..", import.meta.url));
const metadata = JSON.parse(readFileSync(join(release, "release.json"), "utf8"));
if (metadata.platform !== process.platform || metadata.architecture !== process.arch) {
  throw new Error("The release does not match this machine's platform and architecture.");
}
const scratch = mkdtempSync(join(tmpdir(), "fm-release-check-"));
const environment = {
  ...process.env,
  SYMMETRIA_FM_SMOKE: "1",
  SYMMETRIA_FM_SOCKET: join(scratch, "daemon.sock"),
  SYMMETRIA_FM_FRECENCY_DIR: join(scratch, "frecency"),
  XDG_CONFIG_HOME: join(scratch, "config"),
};
delete environment.ELECTRON_RUN_AS_NODE;
try {
  // Test native dependencies under the shipped Electron ABI, not system Node.
  execFileSync(
    join(release, "runtime/electron"),
    [
      "--input-type=module",
      "-e",
      'const {binaryExists} = await import("@ff-labs/fff-node"); if (!binaryExists()) throw new Error("Missing finder binary");',
    ],
    {
      cwd: join(release, "app"),
      env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "pipe",
      timeout: 30_000,
    },
  );
  const output = execFileSync(
    "xvfb-run",
    [
      "-a",
      "--",
      join(release, "runtime/electron"),
      join(release, "app"),
      "--no-sandbox",
      "--ozone-platform=x11",
    ],
    {
      env: environment,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  const line = output.split("\n").find((value) => value.startsWith("SMOKE_REPORT "));
  const report = JSON.parse(line?.slice("SMOKE_REPORT ".length) ?? "null");
  if (
    report?.windowCount !== 1 ||
    !report.shownOnReadyToShow ||
    !(report.bridgeList > 0) ||
    !report.rendererBridgePresent ||
    report.rendererCanRequireFs !== false ||
    report.rendererCanFetchLocalFile !== false
  ) {
    throw new Error(`Release smoke check failed: ${line ?? output}`);
  }
  console.log(`Release verified: ${metadata.revision}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
