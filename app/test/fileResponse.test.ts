import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fileResponse } from "../src/main/fileResponse.ts";

/**
 * Serving a real file, against real bytes.
 *
 * `protocol.ts` imports `electron` at module scope and so cannot be reached
 * from a test at all. That is why the response building lives in its own
 * module: everything below runs against a temporary file on disk, which is the
 * only way the range arithmetic gets checked rather than asserted.
 *
 * What this cannot show is the thing that started it — whether Chromium's media
 * pipeline accepts the result. That was measured directly (a real H.264 file
 * played to `readyState 4` once these headers were present, and raised
 * `MEDIA_ELEMENT_ERROR: Format error` without them) and belongs to the
 * verifier, which drives a real Electron.
 */

let directory: string;
let path: string;
let empty: string;

/** Distinct bytes, so a wrong slice is a wrong VALUE and not merely a wrong length. */
const CONTENT = "0123456789abcdefghij";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "fm-file-response-"));
  path = join(directory, "clip.mp4");
  empty = join(directory, "empty.mp4");
  writeFileSync(path, CONTENT);
  writeFileSync(empty, "");
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("a whole-file answer", () => {
  it("declares its length and that it may be seeked", async () => {
    // The two headers whose absence made a valid video unplayable.
    const response = fileResponse(path, CONTENT.length, "video/mp4", null);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("20");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(await response.text()).toBe(CONTENT);
  });

  it("serves an empty file as an empty body rather than as the whole file", async () => {
    // `createReadStream` given an `end` of -1 reads to the END of the file, so
    // the naive expression turns a zero-byte file into a whole-file read. Here
    // that is invisible; on a real empty file it is a body that should not
    // exist.
    const response = fileResponse(empty, 0, "video/mp4", null);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
  });
});

describe("a partial answer", () => {
  it("returns exactly the bytes asked for", async () => {
    const response = fileResponse(path, CONTENT.length, "video/mp4", "bytes=5-9");

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("56789");
    expect(response.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(response.headers.get("content-length")).toBe("5");
  });

  it("answers the opening request a media element makes", async () => {
    // `bytes=0-` names no end, and it is the first thing Chromium sends.
    const response = fileResponse(path, CONTENT.length, "video/mp4", "bytes=0-");

    expect(response.status).toBe(206);
    expect(await response.text()).toBe(CONTENT);
    expect(response.headers.get("content-range")).toBe("bytes 0-19/20");
  });

  it("returns the LAST bytes for a suffix range", async () => {
    // The direction that is easy to get backwards, and the one that decides
    // whether a container's index is found.
    const response = fileResponse(path, CONTENT.length, "video/mp4", "bytes=-4");

    expect(await response.text()).toBe("ghij");
    expect(response.headers.get("content-range")).toBe("bytes 16-19/20");
  });

  it("returns one byte for a one-byte range", async () => {
    const response = fileResponse(path, CONTENT.length, "video/mp4", "bytes=7-7");

    expect(await response.text()).toBe("7");
    expect(response.headers.get("content-length")).toBe("1");
  });
});

describe("a refusal", () => {
  it("answers 416 with no body and the real length", async () => {
    const response = fileResponse(path, CONTENT.length, "video/mp4", "bytes=99-");

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */20");
    expect(await response.text()).toBe("");
  });
});

/**
 * The content policy a served DOCUMENT carries.
 *
 * The Qt build reaches "it cannot phone home" by turning off remote URL access
 * in its browser engine. There is no engine to configure here: the frame is an
 * ordinary one, so the lock has to travel with the response. A page served
 * without this header could fetch a tracker, a remote font or a remote script
 * the moment it is framed.
 *
 * It is decided from the content type rather than passed in by the caller,
 * because `protocol.ts` imports `electron` at module scope and cannot be
 * reached from any test. A policy chosen there would be a security rule nobody
 * could check.
 */
describe("the document content policy", () => {
  const policyOf = (response: Response) => response.headers.get("content-security-policy");

  it.each([["text/html"], ["application/xhtml+xml"]])(
    "locks a %s response down to its own origin",
    (contentType) => {
      const policy = policyOf(fileResponse(path, CONTENT.length, contentType, null));

      expect(policy).not.toBeNull();
      // `default-src 'none'` is the whole of it: everything a page might reach
      // for is denied unless a later directive opens it, and none of them
      // names a remote origin.
      expect(policy).toContain("default-src 'none'");
      expect(policy).not.toMatch(/https?:/);
      expect(policy).not.toContain("*");
    },
  );

  it("permits a sibling stylesheet and a sibling image, and nothing further", () => {
    const policy = policyOf(fileResponse(path, CONTENT.length, "text/html", null)) ?? "";

    // A page whose own stylesheet is blocked renders unstyled, which is not a
    // faithful render. `'self'` is the document's own grant and reaches no
    // further than the directory it was issued for.
    expect(policy).toContain("img-src 'self'");
    expect(policy).toContain("style-src 'self'");
    // Scripts are refused twice over: the frame withholds the permission AND
    // the policy denies the source. Neither alone is stated anywhere a reader
    // of the other would see it.
    expect(policy).not.toContain("script-src");
  });

  it("names the two directives that do NOT fall back to default-src", () => {
    // A GUARD on a real finding. `img-src`, `style-src`, `font-src`,
    // `media-src`, `object-src` and `frame-src` all inherit from
    // `default-src`; `form-action` and `base-uri` do not. Without them
    // `default-src 'none'` still leaves a previewed page able to submit a form
    // to a remote host on a plain click, with no script involved.
    const policy = policyOf(fileResponse(path, CONTENT.length, "text/html", null)) ?? "";

    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'none'");
  });

  it.each([["image/png"], ["video/mp4"], ["application/pdf"], ["text/plain"]])(
    "leaves a %s response exactly as it was",
    (contentType) => {
      expect(policyOf(fileResponse(path, CONTENT.length, contentType, null))).toBeNull();
    },
  );

  it("carries the policy on a partial response too", () => {
    // A framed document CAN be fetched by range. A policy applied only to the
    // 200 would be a lock on the front door with the window left open.
    const partial = fileResponse(path, CONTENT.length, "text/html", "bytes=0-4");

    expect(partial.status).toBe(206);
    expect(policyOf(partial)).toContain("default-src 'none'");
  });
});
