#!/usr/bin/env node
// Render the release desktop entry from the canonical development template.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [entry, installation] = process.argv.slice(2);
if (!entry || !installation)
  throw new Error("Supply the desktop entry and installation directory.");

function desktopValue(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}

function executableValue(value) {
  // Exec quoting is parsed after desktop-value unescaping. Escape both layers.
  const quoted = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll("%", "%%");
  return desktopValue(`"${quoted}"`);
}

const executable = join(installation, "bin/symmetria-fm-electron-cli");
const values = {
  Icon: desktopValue(join(installation, "assets/symmetria-fm.png")),
  TryExec: desktopValue(executable),
  Exec: `${executableValue(executable)} open %f`,
};
const source = readFileSync(entry, "utf8");
writeFileSync(
  entry,
  source.replace(/^(Icon|TryExec|Exec)=.*$/gm, (_line, key) => `${key}=${values[key]}`),
);
