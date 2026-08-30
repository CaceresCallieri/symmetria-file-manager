import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every colour comes from a declared token.
 *
 * A literal colour in a component or in the stylesheet cannot be re-themed and
 * cannot be found: it does not appear in the token file, so a reader looking
 * for "where is that grey from" is left grepping. This test is what keeps the
 * palette a single place rather than a convention.
 *
 * `theme/tokens.css` is where the literals live, and is the one exemption.
 */

const RENDERER = join(import.meta.dirname, "..", "src", "renderer");
const TOKENS = join(RENDERER, "theme", "tokens.css");

/** Hex, `rgb()`, `hsl()` and `oklch()` — every way to write a colour. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor-mix\(/;

async function sourceFiles(dir: string, match: RegExp): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path, match)));
    else if (match.test(entry.name)) found.push(path);
  }
  return found;
}

/** Lines that write a colour, with their file and number, for a useful failure. */
async function colourLiterals(files: readonly string[]): Promise<string[]> {
  const offences: string[] = [];

  for (const file of files) {
    if (file === TOKENS) continue;

    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      // A comment may name a colour while describing why it is not written.
      const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
      if (COLOUR.test(code)) offences.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  return offences;
}

describe("colour inheritance", () => {
  it("puts the mark colour on the row, not on the name", async () => {
    // The regression this pins. With the colour on `.row__name`, the icon —
    // which is that element's SIBLING — resolved `currentColor` against `.row`
    // and stayed foreground-white beside a coloured name. A component test
    // cannot see it: a headless DOM has no cascade to compute.
    const sheet = await readFile(join(RENDERER, "styles.css"), "utf8");

    expect(sheet).toMatch(/^\.row--marked \{$/m);
    expect(sheet).not.toMatch(/\.row--marked \.row__name/);
  });

  it("lets icons take the surrounding colour rather than carrying their own", async () => {
    const sheet = await readFile(join(RENDERER, "styles.css"), "utf8");
    const rule = /\.file-icon \{[^}]*\}/.exec(sheet)?.[0] ?? "";

    expect(rule).toContain("currentcolor");
  });
});

describe("the palette", () => {
  it("has no colour literal in any component source", async () => {
    const components = await sourceFiles(RENDERER, /\.tsx?$/);

    expect(await colourLiterals(components)).toEqual([]);
  });

  it("has no colour literal in any stylesheet but the token file", async () => {
    // The generated syntax theme is the other exemption: it IS a palette, and
    // it is regenerated from the KDE theme the Qt build reads.
    const sheets = (await sourceFiles(RENDERER, /\.css$/)).filter(
      (file) => !file.endsWith("syntax-wine.css"),
    );

    expect(await colourLiterals(sheets)).toEqual([]);
  });

  it("declares every token the stylesheet reads", async () => {
    // A `var(--thing)` with no declaration renders as nothing at all, silently.
    const tokens = await readFile(TOKENS, "utf8");
    const declared = new Set([...tokens.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));

    const sheets = (await sourceFiles(RENDERER, /\.css$/)).filter((file) => file !== TOKENS);
    const used = new Set<string>();
    for (const sheet of sheets) {
      const text = await readFile(sheet, "utf8");
      for (const match of text.matchAll(/var\((--[\w-]+)\)/g)) used.add(match[1] ?? "");
    }

    expect([...used].filter((token) => !declared.has(token))).toEqual([]);
  });
});
