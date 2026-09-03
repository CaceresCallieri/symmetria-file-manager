import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { parseRange, partialHeaders, unsatisfiableHeaders, wholeHeaders } from "./fileRange.ts";

/**
 * A file on disk, as a `Response` a browser will accept for media.
 *
 * Node but **not Electron**, and that line is the whole reason this is its own
 * module: `protocol.ts` imports `electron` at module scope, so nothing in it
 * can be reached from a test. Everything here can, against real temporary
 * files — which is what turns the range grammar from a claim into a check.
 *
 * See `fileRange.ts` for why any of this is needed. In short: a media element
 * refuses a resource whose length and seekability are not declared, and it
 * refuses it with the same error a corrupt file produces.
 */

/**
 * A file, as a byte stream the platform consumes lazily.
 *
 * A stream rather than a buffer because a preview may be a gigabyte of video,
 * and answering a range by first reading the whole file would give up the only
 * thing the range was for.
 *
 * **`Readable.toWeb` rather than hand-wired `data` events, and the difference is
 * backpressure.** Attaching a `data` listener puts a Node stream into flowing
 * mode, which reads at disk speed no matter how slowly the consumer drains it —
 * so a seek Chromium is slow to read would buffer an unbounded share of that
 * gigabyte in this process. `toWeb` translates the web stream's `desiredSize`
 * into pauses on the Node one, and destroys the handle on cancel, which is the
 * whole of what the hand-written version was trying to do.
 */
function fileStream(path: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path, { start, end }));
}

/** Serve `path`, honouring `rangeHeader` when it names one satisfiable range. */
export function fileResponse(
  path: string,
  size: number,
  contentType: string,
  rangeHeader: string | null,
): Response {
  const asked = parseRange(rangeHeader, size);

  if (asked.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: unsatisfiableHeaders(size) });
  }

  if (asked.kind === "partial") {
    return new Response(fileStream(path, asked.range.start, asked.range.end), {
      status: 206,
      headers: partialHeaders(asked.range, size, contentType),
    });
  }

  // An empty file has no byte to stream, and `createReadStream` given an `end`
  // of -1 reads to the end of the file rather than reading nothing.
  const body = size === 0 ? null : fileStream(path, 0, size - 1);
  return new Response(body, { status: 200, headers: wholeHeaders(size, contentType) });
}
