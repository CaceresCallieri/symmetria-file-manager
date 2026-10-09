#!/usr/bin/env node
// Build and package: node app/scripts/package-release.mjs /absolute/new/release-directory
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) {
  throw new Error("Supply an absolute path to a new release directory.");
}
// Validate before building so an invalid destination cannot replace the bundle.
const existingDestination = await lstat(destination).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
if (existingDestination) throw new Error("The release destination must not exist.");
if (!(await stat(dirname(destination))).isDirectory()) {
  throw new Error("The release destination's parent must be an existing directory.");
}
const appDirectory = join(repository, "app");
execFileSync("pnpm", ["run", "build"], {
  cwd: appDirectory,
  env: { ...process.env, NODE_ENV: "production" },
  timeout: 180_000,
  stdio: "inherit",
});
// Keep mkdir exclusive if another caller creates the destination during the build.
await mkdir(destination);
const appRequire = createRequire(join(appDirectory, "package.json"));
const manifest = JSON.parse(await readFile(join(appDirectory, "package.json"), "utf8"));
const copiedPackages = new Map();

async function packageDirectory(name, resolver) {
  const candidate = resolver.resolve
    .paths(name)
    ?.map((directory) => join(directory, name))
    .find((directory) => existsSync(join(directory, "package.json")));
  return candidate ? await realpath(candidate) : null;
}

function alreadyCopied(name, version) {
  const previousVersion = copiedPackages.get(name);
  if (!previousVersion) return false;
  if (previousVersion !== version) throw new Error(`Conflicting versions of ${name}`);
  return true;
}

async function copyDependencyGroup(resolver, optional, dependencies = {}) {
  for (const dependency of Object.keys(dependencies)) {
    await copyRuntimePackage(dependency, resolver, optional);
  }
}

async function copyRuntimePackage(name, resolver, optional = false) {
  const source = await packageDirectory(name, resolver);
  if (!source) {
    if (optional) return;
    throw new Error(`Missing runtime dependency: ${name}`);
  }
  const metadata = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  if (alreadyCopied(name, metadata.version)) return;
  copiedPackages.set(name, metadata.version);
  // Dereference pnpm links. A release must carry no links into the source tree.
  await cp(source, join(destination, "app/node_modules", name), {
    recursive: true,
    dereference: true,
    filter: (path) => path !== join(source, "node_modules"),
  });
  const dependencyRequire = createRequire(join(source, "package.json"));
  await copyDependencyGroup(dependencyRequire, false, metadata.dependencies);
  await copyDependencyGroup(dependencyRequire, true, metadata.optionalDependencies);
}

function releaseLauncher(checks, command) {
  return `#!/bin/sh
set -eu
release=$(dirname "$(dirname "$(readlink -f "$0")")")
require_release_path() {
  if ! test "$1" "$release/$2"; then
    printf 'ERROR: Release %s is missing or invalid: %s\\n' "$3" "$release/$2" >&2
    exit 78
  fi
}
require_release_path -x runtime/electron 'Electron runtime'
${checks}
exec /usr/bin/env ${command} "$@"
`;
}

await cp(join(appDirectory, "dist-electron"), join(destination, "app/dist-electron"), {
  recursive: true,
  dereference: true,
});
await writeFile(
  join(destination, "app/package.json"),
  `${JSON.stringify({ name: manifest.name, version: manifest.version, type: manifest.type, main: manifest.main, desktopName: manifest.desktopName }, null, 2)}\n`,
);
const electronDirectory = dirname(appRequire.resolve("electron"));
await cp(join(electronDirectory, "dist"), join(destination, "runtime"), {
  recursive: true,
  dereference: true,
});
await copyRuntimePackage("@ff-labs/fff-node", appRequire);
for (const relative of [
  "symmetria-fm-electron.service",
  "symmetria-fm-electron.desktop",
  "assets/symmetria-fm.png",
  "app/bin/symmetria-fm-electron-cli.mjs",
  "app/scripts/verify-release.mjs",
  "app/scripts/release-desktop-entry.mjs",
  "install-electron-release.sh",
]) {
  await cp(join(repository, relative), join(destination, relative), { recursive: true });
}
await mkdir(join(destination, "bin"));
await writeFile(
  join(destination, "bin/symmetria-fm-electron"),
  releaseLauncher(
    "require_release_path -d app 'application directory'\nrequire_release_path -f app/dist-electron/main/index.js 'main bundle'",
    '-u ELECTRON_RUN_AS_NODE "$release/runtime/electron" "$release/app"',
  ),
  { mode: 0o755 },
);
await writeFile(
  join(destination, "bin/symmetria-fm-electron-cli"),
  releaseLauncher(
    "require_release_path -f app/bin/symmetria-fm-electron-cli.mjs 'CLI script'",
    'ELECTRON_RUN_AS_NODE=1 "$release/runtime/electron" "$release/app/bin/symmetria-fm-electron-cli.mjs"',
  ),
  { mode: 0o755 },
);
await writeFile(
  join(destination, "release.json"),
  `${JSON.stringify({ revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(), dirty: execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }).trim().length > 0, platform: process.platform, architecture: process.arch, runtimePackages: Object.fromEntries(copiedPackages) }, null, 2)}\n`,
);
console.log(`Release: ${destination}`);
