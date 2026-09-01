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

const RENDERER = join(import.meta.dirname, "..", "src");
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

/**
 * The scrollbars.
 *
 * Chromium draws a wide white scrollbar with arrow buttons by default, and over
 * a near-black window it is the loudest thing on screen. These assert the rules
 * exist and read from tokens; whether the result LOOKS right is a screenshot's
 * job, and this phase was verified with one.
 */
describe("the scrollbar", () => {
  async function sheet(): Promise<string> {
    return readFile(join(RENDERER, "styles.css"), "utf8");
  }

  it("declares its three tokens", async () => {
    const tokens = await readFile(TOKENS, "utf8");

    expect(tokens).toMatch(/^\s*--scrollbar-width:/m);
    expect(tokens).toMatch(/^\s*--scrollbar-thumb:/m);
    expect(tokens).toMatch(/^\s*--scrollbar-thumb-hover:/m);
  });

  it("sizes the bar from the width token", async () => {
    const rule = /::-webkit-scrollbar\s*\{[^}]*\}/.exec(await sheet())?.[0] ?? "";

    expect(rule).toContain("var(--scrollbar-width)");
  });

  it("paints the thumb from the token, and a different one on hover", async () => {
    const text = await sheet();
    const thumb = /::-webkit-scrollbar-thumb\s*\{[^}]*\}/.exec(text)?.[0] ?? "";
    const hover = /::-webkit-scrollbar-thumb:hover\s*\{[^}]*\}/.exec(text)?.[0] ?? "";

    expect(thumb).toContain("var(--scrollbar-thumb)");
    expect(hover).toContain("var(--scrollbar-thumb-hover)");
  });

  it("rounds the thumb", async () => {
    const thumb = /::-webkit-scrollbar-thumb\s*\{[^}]*\}/.exec(await sheet())?.[0] ?? "";

    expect(thumb).toMatch(/border-radius:/);
  });

  it("leaves the track transparent, so the surface shows through the lane", async () => {
    const track = /::-webkit-scrollbar-track\s*\{[^}]*\}/.exec(await sheet())?.[0] ?? "";

    expect(track).toContain("transparent");
  });

  it("draws no arrow buttons at the ends", async () => {
    // The usual reason a restyled scrollbar still looks wrong: the thumb and
    // the track are handled and the two little arrows are left alone.
    const button = /::-webkit-scrollbar-button\s*\{[^}]*\}/.exec(await sheet())?.[0] ?? "";

    expect(button).toMatch(/display:\s*none/);
  });

  it("styles every scrolling surface, not one class at a time", async () => {
    // Applied globally rather than per class. The surfaces that scroll today are
    // the three columns, a preview body, a directory listing and the modal
    // panel; a rule per class would need a seventh edit for the next one.
    //
    // A review read this as checking only that SOME rule is unscoped, and it
    // does not: `every` fails when any single prefix is non-empty. Measured —
    // re-scoping one of the six rules to `.list::-webkit-scrollbar-thumb` and
    // leaving the rest alone fails this test. Noted so the next reader does not
    // "tighten" it into something it already does.
    const selectors = [...(await sheet()).matchAll(/^([^\n{]*)::-webkit-scrollbar[^\n{]*\{/gm)].map(
      (match) => (match[1] ?? "").trim(),
    );

    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.every((prefix) => prefix === "" || prefix === "*")).toBe(true);
  });
});
