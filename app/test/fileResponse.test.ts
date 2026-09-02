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
