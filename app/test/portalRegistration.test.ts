import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const read = (relative: string) => readFileSync(`${repoRoot}${relative}`, "utf8");
const busName = "org.freedesktop.impl.portal.desktop.symmetria-electron";
const scriptName = "symmetria_electron_portal.py";

// Read assignments through Python's AST without importing the backend's D-Bus dependency.
const defaults = execFileSync(
  "python3",
  [
    "-c",
    `import ast, pathlib, sys
module = ast.parse(pathlib.Path(sys.argv[1]).read_text())
for statement in module.body:
    if isinstance(statement, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id in {"FM_CLI", "BUS_NAME"}
        for target in statement.targets
    ):
        print(ast.literal_eval(statement.value.args[1]))
`,
    `${repoRoot}/portal/${scriptName}`,
  ],
  { encoding: "utf8" },
).trim();

const unit = read("/portal/xdg-desktop-portal-symmetria-electron.service");
const installer = read("/portal/install-portal-electron.sh");

describe("the Electron portal registration", () => {
  it("defaults to the Electron CLI and bus name", () => {
    expect(defaults.split("\n")).toEqual(["symmetria-fm-electron-cli", busName]);
  });

  it("uses the same bus name in the portal, activation file and unit", () => {
    expect(read("/portal/symmetria-electron.portal")).toContain(`DBusName=${busName}`);
    expect(
      read("/portal/org.freedesktop.impl.portal.desktop.symmetria-electron.service"),
    ).toContain(`Name=${busName}`);
    expect(unit).toContain(`BusName=${busName}`);
    expect(unit).toContain(`SYMMETRIA_PORTAL_BUS_NAME=${busName}`);
  });

  it("advertises FileChooser and activates the installed unit", () => {
    expect(read("/portal/symmetria-electron.portal")).toContain(
      "Interfaces=org.freedesktop.impl.portal.FileChooser",
    );
    expect(
      read("/portal/org.freedesktop.impl.portal.desktop.symmetria-electron.service"),
    ).toContain("SystemdService=xdg-desktop-portal-symmetria-electron.service");
    expect(installer).toContain('"$units/xdg-desktop-portal-symmetria-electron.service"');
  });

  it("installs the script that the activation file and unit execute", () => {
    const installedScript = `/usr/lib/symmetria/${scriptName}`;
    expect(installer).toContain(installedScript);
    expect(unit).toContain(installedScript);
    expect(
      read("/portal/org.freedesktop.impl.portal.desktop.symmetria-electron.service"),
    ).toContain(installedScript);
    expect(unit).toContain("SYMMETRIA_PORTAL_FM_CLI=%h/.local/bin/symmetria-fm-electron-cli");
  });

  it("creates its own virtualenv when dbus-fast is missing", () => {
    expect(installer).toContain('python3 -m venv "$venv"');
    expect(installer).toContain('"$venv/bin/python3" -m pip install dbus-fast');
    expect(unit).toContain("%h/.local/share/symmetria/portal-venv/bin/python3");
  });

  it("leaves portal routing to the operator", () => {
    const writesToRouting = installer
      .split("\n")
      .filter((line) => line.includes("portals.conf"))
      .filter((line) => /(^|\s)(cp|mv|tee|install)\s|>>?\s|sed\s+-i/.test(line));
    expect(writesToRouting).toEqual([]);
    expect(installer).toContain("org.freedesktop.impl.portal.FileChooser=symmetria-electron");
  });
});
