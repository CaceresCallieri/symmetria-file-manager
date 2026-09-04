import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { FOREIGN_DOCUMENT_STYLE } from "@symmetria/fm-core/scrollbar";

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

/**
 * The types that get framed and rendered as a document.
 *
 * Exactly the two the preview router calls renderable HTML. A type not on this
 * list is served as it always was, which is what keeps every existing preview
 * — image, video, document, audio — byte-identical.
 */
const FRAMED_DOCUMENT_TYPES: readonly string[] = ["text/html", "application/xhtml+xml"];

/**
 * What a framed document may reach.
 *
 * ── This is the lock that replaces a browser engine setting ─────────────────
 * The Qt build gets "it cannot phone home" from
 * `localContentCanAccessRemoteUrls: false` on its WebEngine view. There is no
 * engine to configure here — the frame is an ordinary one — so the lock has to
 * travel with the response, and this header is it. Without it a previewed page
 * fetches a tracker, a remote font or a remote stylesheet the moment it is
 * framed, and the user's cursor passing over a file is enough to do it.
 *
 * `default-src 'none'` denies everything, and each directive below opens
 * exactly one thing back up. **No directive names a remote origin**, so there
 * is no host a page can reach.
 *
 * `'self'` is the grant the document was served under, which reaches its own
 * directory and no further. That is what lets a page's sibling stylesheet and
 * its sibling images load while nothing else does — a page rendered without
 * its own stylesheet is not a faithful render, which is the whole point of
 * showing it as a page rather than as source.
 *
 * **There is deliberately no `script-src`.** `default-src 'none'` already
 * denies scripts, and the frame withholds the permission to run them at all.
 * Naming a script source here could only ever widen that.
 *
 * `'unsafe-inline'` for styles alone: a page's own `<style>` block and its
 * `style=` attributes are most of what makes it look like itself, and a style
 * cannot exfiltrate anything when no remote origin is reachable to send it to.
 *
 * ── `form-action` and `base-uri` are named because they DO NOT inherit ──────
 * Almost every fetch directive falls back to `default-src` when absent —
 * `img-src`, `style-src`, `font-src`, `media-src`, `object-src`, `frame-src`
 * all do. **`form-action` and `base-uri` do not.** So `default-src 'none'`
 * alone leaves a previewed page able to submit `<form action="https://…">` to
 * a remote host on a plain click, with no script involved at all, and able to
 * change where every relative URL resolves with a single `<base href>`.
 *
 * Both are set to `'none'` rather than `'self'`: this is a preview and not a
 * browser, so a form must never submit anywhere, which is the same decision
 * the Qt build made when it ignored every navigation that was not the initial
 * load. The frame's own permission list withholds forms as well — this is the
 * second lock, and neither one is stated where a reader of the other would
 * see it.
 */
const DOCUMENT_POLICY =
  "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "font-src 'self'; media-src 'self'; form-action 'none'; base-uri 'none'";

/**
 * The policy header for a content type, or nothing.
 *
 * Decided HERE rather than passed in by the caller, and that is deliberate:
 * `protocol.ts` imports `electron` at module scope and cannot be reached from
 * any test, so a security rule chosen there would be one nobody could check.
 * This module runs against real files in plain Node.
 */
function documentPolicy(
  contentType: string,
): { readonly "content-security-policy": string } | null {
  return FRAMED_DOCUMENT_TYPES.includes(contentType)
    ? { "content-security-policy": DOCUMENT_POLICY }
    : null;
}

/**
 * The type whose scrollbars this process restyles, and it is only the one.
 *
 * `text/html` is parsed by the HTML parser, which reparents stray content at
 * the end of the document back into the body — so a `<style>` appended after
 * `</html>` is picked up and applied. **`application/xhtml+xml` is parsed as
 * XML**, where anything after the root element is a fatal "junk after document
 * element" error and Chromium shows a parse failure instead of the page. So an
 * XHTML preview keeps Chromium's default scrollbars, deliberately: a wrong
 * scrollbar is a blemish, and a document that will not parse is a broken
 * feature.
 */
const STYLED_DOCUMENT_TYPE = "text/html";

/** The panel's scrollbar, as bytes to append to a document. */
const SCROLLBAR_STYLE = Buffer.from(FOREIGN_DOCUMENT_STYLE, "utf8");

/**
 * Does this document announce itself as UTF-16?
 *
 * A byte order mark takes precedence over every other encoding signal, so a
 * document that carries one is decoded as UTF-16 whatever the response says.
 * Appending UTF-8 bytes to it would decode as a line of CJK-looking rubbish at
 * the foot of the page — visible, unexplained, and worse than the default
 * scrollbar it was trying to replace. Such a file keeps its own scrollbars.
 */
function hasUtf16Mark(chunk: Uint8Array): boolean {
  const first = chunk[0];
  const second = chunk[1];
  return (first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff);
}

/**
 * The document, with the panel's scrollbar rules appended.
 *
 * ── Appended rather than spliced into the head, and that is the safe end ────
 * Inserting near the top means finding a place that is not before the doctype
 * — anything ahead of it puts the page into quirks mode and changes its
 * layout — which means matching tags in bytes whose encoding is not yet known.
 * The end of the document needs no parsing at all, and the cascade is
 * unaffected: CSS applies wherever it is declared.
 *
 * Being last also decides the one real conflict. A page that styles its own
 * scrollbars loses, because these rules come after its own at equal
 * specificity — which is what was asked for. The panel's scrollbar is meant to
 * be the scrollbar everywhere, including over a page that had opinions.
 *
 * The stream is wrapped rather than the file being read into memory: a
 * previewed document can be large, and the whole point of the streaming path
 * is that nothing here holds a file.
 */
function withScrollbarStyle(body: ReadableStream<Uint8Array> | null): ReadableStream<Uint8Array> {
  const reader = body?.getReader() ?? null;
  let seenFirstChunk = false;
  let append = true;

  return new ReadableStream({
    async pull(controller) {
      if (reader !== null) {
        const { done, value } = await reader.read();
        if (!done) {
          if (!seenFirstChunk) {
            seenFirstChunk = true;
            append = !hasUtf16Mark(value);
          }
          controller.enqueue(value);
          return;
        }
      }

      if (append) controller.enqueue(SCROLLBAR_STYLE);
      controller.close();
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
}

/**
 * A framed document, restyled.
 *
 * **It declares no `content-length`, and that is required rather than lazy.**
 * The appended bytes are decided inside the stream, from the first chunk, so
 * the final length is not known when the headers are written. A length that
 * was wrong by 400 bytes would leave Chromium waiting for a body that never
 * finishes. A document needs no length — only a media element does, which is
 * what `wholeHeaders` exists for — so the honest answer is to omit it and say
 * that ranges are not on offer.
 */
function documentResponse(
  body: ReadableStream<Uint8Array> | null,
  contentType: string,
  policy: { readonly "content-security-policy": string } | null,
): Response {
  return new Response(withScrollbarStyle(body), {
    status: 200,
    headers: { "content-type": contentType, "accept-ranges": "none", ...policy },
  });
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

  // A framed document CAN be fetched by range, so the policy goes on BOTH
  // answers. On the 200 alone it would be a lock on the front door with the
  // window left open.
  const policy = documentPolicy(contentType);

  if (asked.kind === "partial") {
    return new Response(fileStream(path, asked.range.start, asked.range.end), {
      status: 206,
      headers: { ...partialHeaders(asked.range, size, contentType), ...policy },
    });
  }

  // An empty file has no byte to stream, and `createReadStream` given an `end`
  // of -1 reads to the end of the file rather than reading nothing.
  const body = size === 0 ? null : fileStream(path, 0, size - 1);

  if (contentType === STYLED_DOCUMENT_TYPE) return documentResponse(body, contentType, policy);

  return new Response(body, {
    status: 200,
    headers: { ...wholeHeaders(size, contentType), ...policy },
  });
}
