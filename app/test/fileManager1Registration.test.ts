import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decodeDaemonCommand } from "@symmetria/fm-core/command";
import { isFailure } from "@symmetria/fm-core/contract";
import { describe, expect, it } from "vitest";

/**
 * "Show in folder": the `org.freedesktop.FileManager1` service.
 *
 * Four files have to agree, and each disagreement fails silently — the bus
 * just keeps activating Nautilus, or activates a unit that never takes the
 * name. This is a static consistency check. The behaviour itself was driven
 * on a private session bus with `gdbus`; see `docs/electron-transition/22-desktop-integration.md`.
 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (relative: string) => readFileSync(`${repoRoot}${relative}`, "utf8");

const BUS_NAME = "org.freedesktop.FileManager1";
const script = read("portal/symmetria_filemanager1.py");
const unit = read("portal/symmetria-fm-filemanager1.service");
const activation = read("portal/org.freedesktop.FileManager1.service");
const installer = read("portal/install-filemanager1.sh");

/** The value of `key=` on its own line in an ini-style file. */
function field(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
}

describe("the FileManager1 registration", () => {
  it("names the same bus name in the script, the unit and the activation file", () => {
    expect(script).toContain(`BUS_NAME = "${BUS_NAME}"`);
    expect(field(unit, "BusName")).toBe(BUS_NAME);
    expect(field(activation, "Name")).toBe(BUS_NAME);
  });

  it("activates the unit the installer installs", () => {
    expect(field(activation, "SystemdService")).toBe("symmetria-fm-filemanager1.service");
    expect(installer).toContain('"$units/symmetria-fm-filemanager1.service"');
    expect(installer).toContain('"$dbus_services/org.freedesktop.FileManager1.service"');
  });

  it("runs the script from where the installer puts it, with the portal's virtualenv", () => {
    expect(field(unit, "ExecStart")).toBe(
      "%h/.local/share/symmetria/portal-venv/bin/python3 %h/.local/share/symmetria/symmetria_filemanager1.py",
    );
    // The unit's %h/.local/share is fixed, so the installer's must be too —
    // not $XDG_DATA_HOME, which review found would split them apart.
    expect(installer).toContain('share="$HOME/.local/share"');
    expect(installer).toContain('"$share/symmetria/symmetria_filemanager1.py"');
    expect(installer).toContain('venv="$share/symmetria/portal-venv"');
  });

  it("points the script at the Electron build's command-line tool, by absolute path", () => {
    // A service's PATH need not contain ~/.local/bin, so the unit names the
    // tool outright.
    expect(field(unit, "Environment")).toBe(
      "SYMMETRIA_FILEMANAGER1_CLI=%h/.local/bin/symmetria-fm-electron-cli",
    );
    expect(script).toContain('"SYMMETRIA_FILEMANAGER1_CLI", "symmetria-fm-electron-cli"');
  });

  it("maps each method onto a command the daemon accepts", () => {
    // ShowItems is "Show in folder": the item inside its parent. ShowFolders
    // opens the folder itself. A command the decoder refused would make every
    // call fail with nothing on screen.
    expect(script).toMatch(/name="ShowItems"\)\n.*\n\s+await self\._show\("reveal"/);
    expect(script).toMatch(/name="ShowItemProperties"\)\n.*\n\s+await self\._show\("reveal"/);
    expect(script).toMatch(/name="ShowFolders"\)\n.*\n\s+await self\._show\("open"/);
    for (const cmd of ["reveal", "open"]) {
      expect(isFailure(decodeDaemonCommand({ cmd, path: "/home/jc/x" }))).toBe(false);
    }
  });

  it("does not restart while another file manager holds the name", () => {
    expect(script).toContain("EX_UNAVAILABLE = 69");
    expect(field(unit, "RestartPreventExitStatus")).toBe("69");
  });
});
