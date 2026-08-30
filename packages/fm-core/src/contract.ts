import type { FsEntry } from "./entry.ts";
import type { SortMode } from "./sort.ts";

/**
 * The wire contract between the two processes.
 *
 * Pure, and shared by both sides, so a change to a shape is a compile error in
 * the renderer and in the main process at once rather than a runtime surprise
 * in one of them.
 *
 * **Every failure is a value, never a thrown error.** An exception crossing the
 * IPC boundary arrives as an opaque string with no code, so the renderer cannot
 * branch on it and the user gets "something went wrong". A tagged result keeps
 * the reason.
 */

export interface Failure {
  readonly code: FailureCode;
  readonly message: string;
}

export type FailureCode =
  | "invalid_request"
  | "scan_failed"
  | "read_failed"
  | "watch_failed"
  | "cancelled"
  /**
   * A reply did not have the shape its channel promises.
   *
   * Distinct from `invalid_request`, which travels the other way. The renderer
   * cannot fix a malformed reply by asking differently, so conflating the two
   * would tell the user to correct input that was never theirs.
   */
  | "invalid_reply";

export interface Succeeded<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failed {
  readonly ok: false;
  readonly error: Failure;
}

/**
 * Named arms, not inline object types.
 *
 * `isFailure` could not narrow the negative branch while the arms were written
 * inline: `Exclude` needs the guard's type to be exactly a union member, and a
 * structurally identical anonymous type is not the same type. Every
 * `result.value` after a successful guard was a compile error.
 */
export type Result<T> = Succeeded<T> | Failed;

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure<T>(code: FailureCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

export function isFailure<T>(result: Result<T>): result is Failed {
  return !result.ok;
}

/** Decodes an untrusted payload, or explains why it will not. */
export type Decoder<T> = (raw: unknown) => Result<T>;

// ── requests ──────────────────────────────────────────────────────────────

export interface ListRequest {
  readonly path: string;
  readonly showHidden: boolean;
  readonly sort: SortMode;
  readonly stream: boolean;
  /**
   * The caller's name for this request, so it can cancel it.
   *
   * The first draft generated the id in the main process and returned it in the
   * reply — which arrives only once the scan has already finished. Per-request
   * cancellation was therefore structurally unreachable, and `"all"` was the
   * only lever that ever worked. The caller naming the stream up front is what
   * makes cancelling a running scan possible at all.
   */
  readonly streamId: string | null;
}

export interface WatchRequest {
  readonly path: string;
  readonly subscriptionId: string;
}

export interface ReadTextRequest {
  readonly path: string;
  readonly maxBytes: number;
}

export interface CancelRequest {
  readonly streamId: string;
}

/** Everything the preview router needs about one entry, in one round trip. */
export interface DescribeRequest {
  readonly path: string;
}

/** Ask for a URL the renderer may load this file from. */
export interface PreviewUrlRequest {
  readonly path: string;
}

/** `unwatch` needs only the id; requiring a path was an accident of reuse. */
export interface UnwatchRequest {
  readonly subscriptionId: string;
}

// ── replies ───────────────────────────────────────────────────────────────

export interface ListReply {
  readonly entries: readonly FsEntry[];
  readonly total: number;
  readonly streamId: string | null;
}

export interface ListBatch {
  readonly streamId: string;
  readonly entries: readonly FsEntry[];
  readonly done: boolean;
}

export interface ReadTextReply {
  readonly text: string;
  readonly bytesRead: number;
  /** The file is longer than what was read. */
  readonly truncated: boolean;
}

export interface DescribeReply {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  /** How many entries a directory holds. Zero for a file. */
  readonly entryCount: number;
  readonly size: number;
  readonly mime: string | null;
  /**
   * The first bytes, for the content sniff.
   *
   * Sent as a typed array rather than as a string: a UTF-8 decode of arbitrary
   * bytes is lossy, and the sniff is looking for a NUL that a lossy decode
   * would have replaced.
   */
  readonly head: Uint8Array;
}

export interface PreviewUrlReply {
  readonly url: string;
}

/**
 * Everything a handler may reply with.
 *
 * Named rather than `Result<unknown>`, because a boundary that returns
 * `unknown` hands its caller the parsing problem it was supposed to solve —
 * which is exactly what the type-evidence policy flags. `null` is the reply for
 * the channels whose whole answer is "it worked".
 */
export type IpcReply =
  | Result<ListReply>
  | Result<ReadTextReply>
  | Result<DescribeReply>
  | Result<PreviewUrlReply>
  | Result<null>;

// ── decoding ──────────────────────────────────────────────────────────────

const SORT_MODES = ["alphabetical", "modified", "size", "extension", "natural"] as const;

/**
 * A real narrowing, not an assertion.
 *
 * The first draft wrote `SORT_MODES.includes(sort as SortMode)` and then
 * `sort as SortMode` again — two assertions telling the compiler something
 * neither had checked. A predicate proves it instead, and both casts disappear.
 */
function isSortMode(value: string): value is SortMode {
  return (SORT_MODES as readonly string[]).includes(value);
}

/**
 * The largest read the renderer may ask for.
 *
 * A cap it can name is a cap it can abuse; this is the ceiling regardless.
 */
const MAX_READ_BYTES = 64 * 1024 * 1024;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * The longest path the renderer may name.
 *
 * Linux caps a path at 4096 bytes, so anything beyond it cannot name a real
 * file — but nothing stopped a multi-megabyte string reaching `readdir`, which
 * verification noticed. A boundary that accepts input no syscall could use is
 * not validating, it is forwarding.
 */
const MAX_PATH_LENGTH = 4096;

/**
 * An absolute path with no NUL byte.
 *
 * Relative is refused because the renderer never learns a working directory, so
 * a relative path can only be a mistake or an attempt to reach somewhere it was
 * not given. A NUL is refused because it terminates the path at the syscall
 * boundary — a string check can approve one thing and the kernel open another.
 */
function decodePath(raw: unknown): Result<string> {
  if (typeof raw !== "string") return failure("invalid_request", "path must be a string");
  if (raw === "") return failure("invalid_request", "path must not be empty");
  if (raw.length > MAX_PATH_LENGTH) {
    return failure("invalid_request", `path must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (raw.includes("\0")) return failure("invalid_request", "path must not contain a NUL byte");
  if (!raw.startsWith("/")) return failure("invalid_request", "path must be absolute");
  return success(raw);
}

export const decodeListRequest: Decoder<ListRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw.path);
  if (isFailure(path)) return path;

  const sort = raw.sort ?? "alphabetical";
  if (typeof sort !== "string" || !isSortMode(sort)) {
    return failure("invalid_request", `sort must be one of ${SORT_MODES.join(", ")}`);
  }

  const streamId = decodeStreamId(raw.streamId);
  if (isFailure(streamId)) return streamId;

  // Unknown keys are ignored rather than refused, so an older main process
  // survives a newer renderer sending a field it has never heard of.
  return success({
    path: path.value,
    showHidden: raw.showHidden === true,
    sort,
    stream: raw.stream === true,
    streamId: streamId.value,
  });
};

/** An optional caller-supplied identifier. Absent is fine; empty is not. */
function decodeStreamId(raw: unknown): Result<string | null> {
  if (raw === undefined || raw === null) return success(null);
  if (typeof raw !== "string" || raw === "") {
    return failure("invalid_request", "streamId must be a non-empty string when given");
  }
  return success(raw);
}

export const decodeWatchRequest: Decoder<WatchRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw.path);
  if (isFailure(path)) return path;

  if (typeof raw.subscriptionId !== "string" || raw.subscriptionId === "") {
    return failure("invalid_request", "subscriptionId is required to route events back");
  }

  return success({ path: path.value, subscriptionId: raw.subscriptionId });
};

export const decodeReadTextRequest: Decoder<ReadTextRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw.path);
  if (isFailure(path)) return path;

  const requested = raw.maxBytes ?? MAX_READ_BYTES;
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested <= 0) {
    return failure("invalid_request", "maxBytes must be a positive integer");
  }

  return success({ path: path.value, maxBytes: Math.min(requested, MAX_READ_BYTES) });
};

export const decodeDescribeRequest: Decoder<DescribeRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw["path"]);
  return isFailure(path) ? path : success({ path: path.value });
};

export const decodePreviewUrlRequest: Decoder<PreviewUrlRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw["path"]);
  return isFailure(path) ? path : success({ path: path.value });
};

export const decodeUnwatchRequest: Decoder<UnwatchRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");
  if (typeof raw.subscriptionId !== "string" || raw.subscriptionId === "") {
    return failure("invalid_request", "subscriptionId is required");
  }
  return success({ subscriptionId: raw.subscriptionId });
};

export const decodeCancelRequest: Decoder<CancelRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");
  if (typeof raw.streamId !== "string" || raw.streamId === "") {
    return failure("invalid_request", "streamId is required");
  }
  return success({ streamId: raw.streamId });
};

// ── decoding replies ──────────────────────────────────────────────────────

/**
 * The renderer parses what crosses the boundary too, not only the main process.
 *
 * The bridge hands page code `Result<unknown>`, and turning that into a typed
 * reply with an assertion would move the parsing problem rather than solve it:
 * a main process that changed its reply shape would then produce a `TypeError`
 * deep inside a React render, blaming the component instead of the boundary.
 * These decoders make a shape mismatch a value the interface can show.
 */

function stringField(raw: Record<string, unknown>, field: string): string | null {
  const value = raw[field];
  return typeof value === "string" ? value : null;
}

function finiteField(raw: Record<string, unknown>, field: string): number | null {
  const value = raw[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const ENTRY_KINDS = ["file", "directory", "other"] as const;

function isEntryKind(value: string): value is FsEntry["kind"] {
  return (ENTRY_KINDS as readonly string[]).includes(value);
}

export const decodeFsEntry: Decoder<FsEntry> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "entry must be an object");

  const name = stringField(raw, "name");
  if (name === null) return failure("invalid_reply", "entry.name must be a string");

  const kind = stringField(raw, "kind");
  if (kind === null || !isEntryKind(kind)) {
    return failure("invalid_reply", `entry.kind is not a kind: ${String(raw["kind"])}`);
  }

  const size = finiteField(raw, "size");
  const modifiedMs = finiteField(raw, "modifiedMs");
  if (size === null || modifiedMs === null) {
    return failure("invalid_reply", "entry.size and entry.modifiedMs must be finite numbers");
  }

  const entry: FsEntry = {
    name,
    kind,
    size,
    modifiedMs,
    isSymlink: raw["isSymlink"] === true,
    isHidden: raw["isHidden"] === true,
  };
  return success(raw["unreadable"] === true ? { ...entry, unreadable: true } : entry);
};

function decodeEntries(raw: unknown): Result<FsEntry[]> {
  if (!Array.isArray(raw)) return failure("invalid_reply", "entries must be an array");

  const entries: FsEntry[] = [];
  for (const item of raw) {
    const decoded = decodeFsEntry(item);
    // One bad entry fails the whole listing rather than being skipped. A
    // silently shortened directory is indistinguishable from a correct one, and
    // the user would act on a listing that is missing something.
    if (isFailure(decoded)) return decoded;
    entries.push(decoded.value);
  }
  return success(entries);
}

export const decodeListReply: Decoder<ListReply> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "reply must be an object");

  const entries = decodeEntries(raw["entries"]);
  if (isFailure(entries)) return entries;

  const total = finiteField(raw, "total");
  if (total === null) return failure("invalid_reply", "reply.total must be a finite number");

  const streamId = raw["streamId"];
  if (streamId !== null && typeof streamId !== "string") {
    return failure("invalid_reply", "reply.streamId must be a string or null");
  }

  return success({ entries: entries.value, total, streamId });
};

export const decodeListBatch: Decoder<ListBatch> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "batch must be an object");

  const streamId = stringField(raw, "streamId");
  if (streamId === null) return failure("invalid_reply", "batch.streamId must be a string");

  const entries = decodeEntries(raw["entries"]);
  if (isFailure(entries)) return entries;

  return success({ streamId, entries: entries.value, done: raw["done"] === true });
};

/** What a watched directory reports. The changed paths are not needed yet. */
export interface ChangedEvent {
  readonly subscriptionId: string;
}

export const decodeChangedEvent: Decoder<ChangedEvent> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "event must be an object");

  const subscriptionId = stringField(raw, "subscriptionId");
  if (subscriptionId === null) {
    return failure("invalid_reply", "event.subscriptionId must be a string");
  }
  return success({ subscriptionId });
};

export const decodeDescribeReply: Decoder<DescribeReply> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "reply must be an object");

  const name = stringField(raw, "name");
  const path = stringField(raw, "path");
  const size = finiteField(raw, "size");
  const entryCount = finiteField(raw, "entryCount");
  if (name === null || path === null || size === null || entryCount === null) {
    return failure("invalid_reply", "reply is missing a required field");
  }

  const mime = raw["mime"];
  if (mime !== null && typeof mime !== "string") {
    return failure("invalid_reply", "reply.mime must be a string or null");
  }

  const head = raw["head"];
  if (!(head instanceof Uint8Array)) {
    return failure("invalid_reply", "reply.head must be a byte array");
  }

  return success({
    name,
    path,
    isDirectory: raw["isDirectory"] === true,
    entryCount,
    size,
    mime,
    head,
  });
};

export const decodePreviewUrlReply: Decoder<PreviewUrlReply> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "reply must be an object");

  const url = stringField(raw, "url");
  return url === null ? failure("invalid_reply", "reply.url must be a string") : success({ url });
};

export const decodeReadTextReply: Decoder<ReadTextReply> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "reply must be an object");

  const text = stringField(raw, "text");
  const bytesRead = finiteField(raw, "bytesRead");
  if (text === null || bytesRead === null) {
    return failure("invalid_reply", "reply.text and reply.bytesRead are required");
  }
  return success({ text, bytesRead, truncated: raw["truncated"] === true });
};
