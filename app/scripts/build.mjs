import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const out = `${appDir}/dist-electron`;

await rm(out, { recursive: true, force: true });

/**
 * The main process, as ESM.
 *
 * `electron` is external because it is supplied by the runtime, not bundled.
 * Node built-ins likewise.
 */
await esbuild({
  entryPoints: [`${appDir}/src/main/index.ts`],
  outfile: `${out}/main/index.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["electron"],
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
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});
