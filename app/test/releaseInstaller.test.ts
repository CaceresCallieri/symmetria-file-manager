import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "fm-release-install-"));
  scratchDirectories.push(root);
  const home = join(root, "home with spaces");
  const source = join(root, "source");
  const commands = join(root, "commands");
  const installation = join(home, ".local/share/symmetria-fm-electron");
  const previous = join(installation, "releases/previous");
  const unitDirectory = join(home, ".config/systemd/user");
  const wantedUnit = join(
    unitDirectory,
    "graphical-session.target.wants/symmetria-fm-electron.service",
  );
  const runtimeDirectory = join(root, "runtime");
  for (const directory of [
    join(source, "app/scripts"),
    join(source, "bin"),
    join(source, "runtime"),
    join(source, "assets"),
    commands,
    previous,
    join(home, ".local/bin"),
    join(home, ".local/share/applications"),
    join(unitDirectory, "graphical-session.target.wants"),
    runtimeDirectory,
  ])
    mkdirSync(directory, { recursive: true });
  for (const file of [
    "symmetria-fm-electron.service",
    "symmetria-fm-electron.desktop",
    "app/scripts/release-desktop-entry.mjs",
  ]) {
    writeFileSync(join(source, file), readFileSync(join(repository, file)));
  }
  writeFileSync(join(source, "assets/symmetria-fm.png"), "fixture icon");
  writeFileSync(join(source, "bin/symmetria-fm-electron"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(source, "bin/symmetria-fm-electron-cli"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  // Simulate only the shipped runtime and systemd boundaries. The installer,
  // desktop renderer, filesystem operations and rollback all execute for real.
  writeFileSync(
    join(source, "runtime/electron"),
    `#!/bin/sh
case "$1" in
  */release-desktop-entry.mjs) exec "$FIXTURE_NODE" "$@" ;;
  */verify-release.mjs) [ "$INSTALL_MODE" != precheck ] ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(commands, "systemctl"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$INSTALL_LOG"
case "$*" in
  *is-active*) echo active ;;
  *enable*)
    case "$INSTALL_MODE" in
      signal) kill -TERM "$PPID" ;;
      activate|recovery) touch "$RECOVERY_MARKER"; exit 1 ;;
    esac ;;
  *daemon-reload*)
    if [ "$INSTALL_MODE" = recovery ] && [ -f "$RECOVERY_MARKER" ]; then exit 1; fi ;;
esac
`,
    { mode: 0o755 },
  );
  for (const command of ["update-desktop-database", "gtk-update-icon-cache"]) {
    writeFileSync(join(commands, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  symlinkSync(previous, join(installation, "current"));
  symlinkSync(join(previous, "service"), wantedUnit);
  const environment = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_RUNTIME_DIR: runtimeDirectory,
    PATH: `${commands}:${process.env.PATH}`,
    FIXTURE_NODE: process.execPath,
    INSTALL_MODE: mode,
    INSTALL_LOG: join(root, "systemctl.log"),
    RECOVERY_MARKER: join(root, "recovering"),
  };
  return { root, home, source, installation, previous, wantedUnit, environment };
}

function install(target: ReturnType<typeof fixture>) {
  return spawnSync("bash", [join(repository, "install-electron-release.sh"), target.source], {
    env: target.environment,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function releases(target: ReturnType<typeof fixture>) {
  return readdirSync(join(target.installation, "releases")).map((name) =>
    join(target.installation, "releases", name),
  );
}

describe("release installation", () => {
  it.each(["activate", "signal", "recovery"])(
    "restores the previous release after %s fails",
    (mode) => {
      const target = fixture(mode);
      const result = install(target);
      expect(result.status, result.stderr).toBe(1);
      expect(readFileSync(join(target.root, "systemctl.log"), "utf8")).toContain(
        "--user start symmetria-fm-electron.service",
      );
      expect(readlinkSync(join(target.installation, "current"))).toBe(target.previous);
      expect(readlinkSync(target.wantedUnit)).toBe(join(target.previous, "service"));
      expect(releases(target)).toEqual([target.previous]);
      if (mode === "recovery") expect(result.stderr).toContain("Some recovery steps failed");
    },
  );

  it("cleans up an invalid candidate before changing the current release", () => {
    const target = fixture("precheck");
    expect(install(target).status).toBe(1);
    expect(releases(target)).toEqual([target.previous]);
    expect(readlinkSync(join(target.installation, "current"))).toBe(target.previous);
  });

  it("replaces a stale switch link and renders absolute launcher paths with spaces", () => {
    const target = fixture("success");
    symlinkSync("/missing/candidate", join(target.installation, "current.next"));
    const result = install(target);
    expect(result.status, result.stderr).toBe(0);
    const entry = readFileSync(
      join(target.home, ".local/share/applications/symmetria-fm-electron.desktop"),
      "utf8",
    );
    const cli = join(target.installation, "current/bin/symmetria-fm-electron-cli");
    expect(entry).toContain(`TryExec=${cli}`);
    expect(entry).toContain(`Exec="${cli}" open %f`);
    expect(entry).toContain(`Icon=${target.installation}/current/assets/symmetria-fm.png`);
    expect(releases(target)).toHaveLength(2);
  });
});
