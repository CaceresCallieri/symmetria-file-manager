#!/usr/bin/env node
// Run from the packaged release before replacing an installed release.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  SYMMETRIA_FM_VERIFY_DIR: scratch,
  SYMMETRIA_FM_BOOKMARKS: join(scratch, "bookmarks.json"),
  SYMMETRIA_FM_LISTING: join(scratch, "listing.json"),
  XDG_CONFIG_HOME: join(scratch, "config"),
};
delete environment.ELECTRON_RUN_AS_NODE;
try {
  // Create, scan and search a real index under the shipped Electron ABI.
  writeFileSync(join(scratch, "release-check.txt"), "release finder probe\n");
  execFileSync(
    join(release, "runtime/electron"),
    [
      "--input-type=module",
      "-e",
      `import {FileFinder} from "@ff-labs/fff-node";
const base = process.env.SYMMETRIA_FM_VERIFY_DIR;
const created = FileFinder.create({basePath: base,
  frecencyDbPath: base + "/native-frecency", historyDbPath: base + "/native-history"});
if (!created.ok) throw new Error(String(created.error));
const finder = created.value;
try {
  const scan = await finder.waitForScan(5000);
  if (!scan.ok || !scan.value) throw new Error("Native finder scan failed");
  const result = finder.fileSearch("release-check.txt");
  if (!result.ok || !result.value.items.some(item => item.relativePath === "release-check.txt")) {
    throw new Error("Native finder search failed");
  }
} finally { finder.destroy(); }`,
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
    ["-a", "--", join(release, "runtime/electron"), join(release, "app"), "--ozone-platform=x11"],
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
    report.rendererCanFetchLocalFile !== false ||
    report.residency?.reopenedViaCommand !== true ||
    report.residency.destroyedAfterClose !== false ||
    report.residency.survivedRendererClose !== true
  ) {
    throw new Error(`Release smoke check failed: ${line ?? output}`);
  }
  console.log(
    `Release verified: ${metadata.revision}${metadata.dirty ? " (working tree modified)" : ""}`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
