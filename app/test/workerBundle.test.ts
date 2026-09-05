/**
 * The built search worker must be able to load what it does not bundle.
 *
 * This exists because of a defect that every other test was structurally blind
 * to. `@ff-labs/fff-node` is a native module, so `build.mjs` marks it EXTERNAL —
 * correct, a `.node` binary cannot be bundled into JavaScript. But pnpm's
 * `node_modules` is strict: a package is linked only into the workspace package
 * that DECLARES it. `@ff-labs/fff-node` was declared by `packages/fm-search`
 * alone, and Node resolves from the importing FILE's location — so the bundle
 * at `app/dist-electron/main/` walked up through `app/` and the repository root
 * and found nothing.
 *
 * Every unit test passed throughout, because they import the TypeScript source
 * from inside `packages/fm-search`, where resolution has always worked. Only
 * the built artefact, run from where it ships, was broken. Independent
 * verification found it by forking the real bundle; nothing in the suite could.
 *
 * The check is a real resolution from the real directory, in a real process.
 * `createRequire(...).resolve` is NOT usable here: the package is
 * ESM-exports-only, so a CommonJS resolve reports `ERR_PACKAGE_PATH_NOT_EXPORTED`
 * for a package it found perfectly well — an error that has to be told apart
 * from a genuine miss, which is precisely the distinction worth not guessing at.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const bundleDir = fileURLToPath(new URL("../dist-electron/main", import.meta.url));
const bundle = `${bundleDir}/searchWorker.js`;

/** Every bare specifier the bundle imports, builtins excluded. */
function externalImports(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/^import\s[^;]*?\sfrom\s"([^"]+)";$/gm)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    if (specifier.startsWith("node:") || specifier.startsWith(".")) continue;
    found.add(specifier);
  }
  return [...found];
}

/** Whether `specifier` resolves as ESM from the bundle's own directory. */
function resolvesFromBundleDir(specifier: string): boolean {
  try {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)})`],
      { cwd: bundleDir, stdio: "pipe", timeout: 30_000 },
    );
    return true;
  } catch {
    return false;
  }
}

describe("the built search worker", () => {
  it("leaves the native engine external rather than bundling a .node binary", () => {
    // The premise of the test below. If this ever stops holding, the resolution
    // check underneath it would pass for the uninteresting reason.
    expect(externalImports(readFileSync(bundle, "utf8"))).toContain("@ff-labs/fff-node");
  });

  it("can load every package it left external, from where it ships", () => {
    const specifiers = externalImports(readFileSync(bundle, "utf8"));
    const unresolvable = specifiers.filter((specifier) => !resolvesFromBundleDir(specifier));
    expect(unresolvable).toEqual([]);
  });

  it("reports a package that genuinely is not there", () => {
    // Paired with the assertion above so a resolver that answered "yes" to
    // everything could not pass it for free.
    expect(resolvesFromBundleDir("@ff-labs/not-a-real-package")).toBe(false);
  });
});
