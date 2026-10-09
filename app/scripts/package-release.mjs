#!/usr/bin/env node
// Build first: NODE_ENV=production pnpm --filter @symmetria/fm-app build
// Then: node app/scripts/package-release.mjs /absolute/new/release-directory
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) {
  throw new Error("Supply an absolute path to a new release directory.");
}
// Refuse an existing directory so packaging cannot overwrite a running release.
await mkdir(destination);
const appDirectory = join(repository, "app");
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
  "install-electron-release.sh",
]) {
  await cp(join(repository, relative), join(destination, relative), { recursive: true });
}
await mkdir(join(destination, "bin"));
await writeFile(
  join(destination, "bin/symmetria-fm-electron"),
  '#!/bin/sh\nset -eu\nrelease=$(dirname "$(dirname "$(readlink -f "$0")")")\nexec /usr/bin/env -u ELECTRON_RUN_AS_NODE "$release/runtime/electron" "$release/app" "$@"\n',
  { mode: 0o755 },
);
await writeFile(
  join(destination, "release.json"),
  `${JSON.stringify({ revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(), platform: process.platform, architecture: process.arch, runtimePackages: Object.fromEntries(copiedPackages) }, null, 2)}\n`,
);
console.log(`Release: ${destination}`);
