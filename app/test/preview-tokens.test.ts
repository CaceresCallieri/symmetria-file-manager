import { afterEach, describe, expect, it } from "vitest";

import { authorisePreview, forgetPreviewTokens, resolveToken } from "../src/main/previewTokens.ts";

/**
 * The capability registry behind the preview URLs.
 *
 * It exists because Chromium's PDF viewer refuses a blob URL whose origin is a
 * custom scheme; what it must get right is that only paths the main process
 * handed out are reachable, and that a resident session does not accumulate
 * them without bound.
 */

afterEach(forgetPreviewTokens);

describe("authorisePreview", () => {
  it("makes a path reachable by the token it returns", () => {
    const token = authorisePreview("/tmp/photo.png");

    expect(resolveToken(token)).toBe("/tmp/photo.png");
  });

  it("returns the same token for a path already authorised", () => {
    // A component that re-renders must not leak a token per render.
    expect(authorisePreview("/tmp/a.png")).toBe(authorisePreview("/tmp/a.png"));
  });

  it("gives different paths different tokens", () => {
    expect(authorisePreview("/tmp/a.png")).not.toBe(authorisePreview("/tmp/b.png"));
  });

  it("reaches nothing that was never authorised", () => {
    // The whole point: this route serves exactly what the main process handed
    // out, so a guessed token is not a way into the filesystem.
    expect(resolveToken("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("evicts the oldest rather than growing without bound", () => {
    // A resident application previews thousands of files in a session, and an
    // unbounded map would keep every one of them addressable for the lifetime
    // of the process.
    const first = authorisePreview("/tmp/file-0");
    for (let i = 1; i <= 64; i++) authorisePreview(`/tmp/file-${i}`);

    expect(resolveToken(first)).toBeNull();
  });

  it("keeps the most recent authorisations", () => {
    for (let i = 0; i <= 64; i++) authorisePreview(`/tmp/file-${i}`);

    expect(resolveToken(authorisePreview("/tmp/file-64"))).toBe("/tmp/file-64");
  });
});
