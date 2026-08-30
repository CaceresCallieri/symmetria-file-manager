import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const out = `${appDir}/dist-electron`;

await rm(out, { recursive: true, force: true });

/**
 * What must not be bundled.
 *
 * `electron` is supplied by the runtime. `@parcel/watcher` is a NATIVE module:
 * bundling its CommonJS entry into an ESM output turns its `require("path")`
 * into a dynamic require the ESM loader refuses, and the application dies at
 * load with "Dynamic require of \"path\" is not supported". A native module is
 * resolved from `node_modules` at runtime, never inlined.
 */
const EXTERNAL = ["electron", "@parcel/watcher"];

/**
 * The main process, as ESM.
 */
await esbuild({
  entryPoints: [`${appDir}/src/main/index.ts`],
  outfile: `${out}/main/index.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: EXTERNAL,
  sourcemap: true,
  logLevel: "info",
});

/**
 * The preload, as CommonJS with a `.cjs` extension.
 *
 * This is not a style choice. A preload script is loaded by Electron outside
 * the module graph of the page, and the ESM preload path carries restrictions
 * this project has no reason to take on. `window.ts` points at `index.cjs`, so
 * the extension here and the path there must move together.
 */
await esbuild({
  entryPoints: [`${appDir}/src/preload/index.ts`],
  outfile: `${out}/preload/index.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: EXTERNAL,
  sourcemap: true,
  logLevel: "info",
});
