import { describe, expect, it } from "vitest";

import type { MimeTables } from "../src/mime.ts";
import { languageFor, type PreviewTarget, routePreview } from "../src/preview/route.ts";

/**
 * The branch order, and what reaches each branch.
 *
 * The order is the whole point of having one router: a consumer that
 * re-implemented it would get the SVG case wrong, because an SVG genuinely is
 * text under the MIME inheritance rules.
 */

const tables: MimeTables = {
  globs: [],
  subclasses: new Map([
    ["image/svg+xml", ["application/xml"]],
    ["application/xml", ["text/plain"]],
    ["text/markdown", ["text/plain"]],
    ["application/json", ["application/javascript"]],
    ["application/javascript", ["text/plain"]],
    ["application/x-compressed-tar", ["application/x-tar"]],
  ]),
  aliases: new Map(),
};

/**
 * Built from character codes, not from `TextEncoder`.
 *
 * `fm-core` compiles with no environment at all — no DOM, no Node — precisely
 * so a `window` or a `node:fs` cannot creep into a package both processes
 * import. A test that reached for `TextEncoder` would be relying on an
 * environment the package does not have.
 */
const TEXT_HEAD = Uint8Array.from("hello, this is text\n", (c) => c.charCodeAt(0));
const BINARY_HEAD = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]);

function target(over: Partial<PreviewTarget>): PreviewTarget {
  return {
    name: "file.txt",
    path: "/tmp/file.txt",
    isDirectory: false,
    entryCount: 0,
    size: 12,
    mime: "text/plain",
    head: TEXT_HEAD,
    ...over,
  };
}

describe("the branch order", () => {
  it("routes an SVG to the image branch, not the text branch", () => {
    // The case the order exists for. `image/svg+xml` inherits from
    // `application/xml`, which inherits from `text/plain`, so an SVG IS text
    // under the inheritance rules. Test text first and every SVG previews as
    // source code.
    const route = routePreview(tables, target({ name: "logo.svg", mime: "image/svg+xml" }));

    expect(route.kind).toBe("image");
  });

  it("shows nothing when there is nothing under the cursor", () => {
    expect(routePreview(tables, null).kind).toBe("none");
  });

  it("counts a directory's entries rather than trying to preview it", () => {
    const route = routePreview(tables, target({ isDirectory: true, entryCount: 42 }));

    expect(route).toEqual({ kind: "directory", entryCount: 42 });
  });

  it("prefers the directory branch even for a directory with a known type", () => {
    // A `.app` or a `.git` directory still has a name an extension table would
    // happily claim.
    const route = routePreview(
      tables,
      target({ name: "bundle.json", mime: "application/json", isDirectory: true, entryCount: 3 }),
    );

    expect(route.kind).toBe("directory");
  });
});

describe("images and documents", () => {
  it.each(["image/png", "image/gif", "image/avif", "image/webp"])(
    "routes %s to the image branch",
    (mime) => {
      expect(routePreview(tables, target({ name: "a", mime })).kind).toBe("image");
    },
  );

  it("routes a PDF to the document branch, for Chromium's own viewer", () => {
    const route = routePreview(tables, target({ name: "paper.pdf", mime: "application/pdf" }));

    expect(route).toEqual({ kind: "document", mime: "application/pdf" });
  });
});

describe("branches this cycle keeps but does not build", () => {
  it.each([
    ["video/mp4", "video"],
    ["audio/flac", "audio"],
    ["application/zip", "archive"],
    ["application/x-compressed-tar", "archive"],
    ["text/csv", "spreadsheet"],
    ["application/vnd.ms-excel", "spreadsheet"],
  ])("names %s as %s rather than falling through", (mime, what) => {
    // Saying "no video preview yet" is a different statement from showing a
    // file's size and hoping. Keeping the branch keeps the shape.
    const route = routePreview(tables, target({ name: "thing", mime }));

    expect(route).toEqual({ kind: "unbuilt", what, mime });
  });
});

describe("text and code", () => {
  it("renders a known language as code", () => {
    const route = routePreview(tables, target({ name: "main.rs", mime: "text/plain" }));

    expect(route).toEqual({ kind: "code", language: "rust" });
  });

  it("renders an unknown language as plain text rather than failing", () => {
    // A guess that is wrong is worse than no highlighting. Automatic detection
    // was measured at 35 times the explicit cost and misread JavaScript as a
    // DNS zone file.
    const route = routePreview(tables, target({ name: "notes.qqq", mime: "text/plain" }));

    expect(route.kind).toBe("text");
  });

  it("previews an extensionless config through the content sniff", () => {
    // No extension and no registered type: the content is the only evidence,
    // and it says text.
    const route = routePreview(tables, target({ name: "hostname", mime: null }));

    expect(route.kind).toBe("text");
  });

  it("falls back for a binary with no branch of its own", () => {
    const route = routePreview(tables, target({ name: "a.out", mime: null, head: BINARY_HEAD }));

    expect(route).toEqual({ kind: "fallback", mime: null });
  });
});

describe("languageFor", () => {
  it.each([
    ["App.tsx", "typescript"],
    ["main.rs", "rust"],
    ["build.gradle.kts", null],
    ["index.html", "xml"],
    ["config.toml", "ini"],
    ["README.md", "markdown"],
  ])("maps %s", (name, language) => {
    expect(languageFor(name)).toBe(language);
  });

  it("matches whole names that carry a language but no extension", () => {
    expect(languageFor("Makefile")).toBe("makefile");
    expect(languageFor("CMakeLists.txt")).toBe("cmake");
    expect(languageFor("PKGBUILD")).toBe("bash");
  });

  it("folds case, because an extension is not case-sensitive to a reader", () => {
    expect(languageFor("SCRIPT.PY")).toBe("python");
  });

  it("returns null for a dotfile with no extension of its own", () => {
    // `.gitignore` has one dot, at position zero, which is not an extension.
    expect(languageFor(".gitignore")).toBeNull();
  });
});
