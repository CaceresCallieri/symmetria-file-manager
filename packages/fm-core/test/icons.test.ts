import { describe, expect, it } from "vitest";

import { chromeIconFor, extensionCandidates, iconTokenFor } from "../src/icons/resolve.ts";

/**
 * The cascade, and the one property that matters most: it never fails.
 *
 * A file manager that showed nothing for an unrecognised file would show
 * nothing for most of a source tree.
 */

describe("extensionCandidates", () => {
  it("lists every dot-suffix, longest first", () => {
    expect(extensionCandidates("component.spec.ts")).toEqual(["spec.ts", "ts"]);
  });

  it("treats a dotfile's leading dot as a hidden marker, not a separator", () => {
    // `.env.local` is an environment file. Splitting on the leading dot would
    // make the first candidate the empty string and lose the pairing.
    expect(extensionCandidates(".env.local")).toEqual(["env.local", "local"]);
  });

  it("has no candidates for a name with no dot", () => {
    expect(extensionCandidates("Makefile")).toEqual([]);
  });
});

describe("iconTokenFor", () => {
  it.each([
    ["main.rs", "rust"],
    ["App.tsx", "react"],
    ["index.js", "javascript"],
    ["style.scss", "sass"],
    ["photo.PNG", "image"],
    ["archive.tar.gz", "zip"],
  ])("resolves %s to %s", (name, token) => {
    expect(iconTokenFor(name)).toBe(token);
  });

  it("matches the LONGEST suffix, not the first one it finds", () => {
    // `component.spec.ts` is a test before it is TypeScript. Matching the
    // shortest suffix first resolves it to the wrong symbol.
    expect(iconTokenFor("component.spec.ts")).toBe("typescript");
    expect(iconTokenFor("Button.spec.tsx")).toBe("react");
  });

  it("prefers a whole name over its extension", () => {
    // `package.json` is npm's, not JSON's, and a reader scanning a directory
    // is helped more by the former.
    expect(iconTokenFor("package.json")).toBe("npm");
    expect(iconTokenFor("data.json")).toBe("json");
  });

  it("folds case, because an extension is not case-sensitive to a reader", () => {
    expect(iconTokenFor("README.MD")).toBe("markdown");
    expect(iconTokenFor("Dockerfile")).toBe("docker");
  });

  it("never fails: an unknown extension gets the default symbol", () => {
    expect(iconTokenFor("mystery.qqqq")).toBe("default");
    expect(iconTokenFor("no-extension-at-all")).toBe("default");
    expect(iconTokenFor("")).toBe("default");
  });
});

describe("chromeIconFor", () => {
  it("covers the gaps the borrowed set does not fill", () => {
    // Folder, video, audio and document have no drawing in the file-type set —
    // they are chrome, not file types.
    expect(chromeIconFor("directory", null)).toBe("folder");
    expect(chromeIconFor("file", "video/mp4")).toBe("video");
    expect(chromeIconFor("file", "audio/flac")).toBe("audio");
    expect(chromeIconFor("file", "application/pdf")).toBe("document");
    expect(chromeIconFor("other", null)).toBe("binary");
  });

  it("defers to the file-type set for everything it does cover", () => {
    expect(chromeIconFor("file", "text/plain")).toBeNull();
    expect(chromeIconFor("file", null)).toBeNull();
  });
});
