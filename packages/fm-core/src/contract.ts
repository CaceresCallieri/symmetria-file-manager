import type { EntrySummary, FsEntry } from "./entry.ts";
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
  /** The operation would have destroyed something that is already there. */
  | "conflict"
  /** A mutation the filesystem refused: permission, a read-only mount, ENOSPC. */
  | "write_failed"
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

/** What a paste does with what it took. */
export type TransferMode = "copy" | "move";

export interface TransferRequest {
  readonly sources: readonly string[];
  /** The directory the sources land in. */
  readonly destination: string;
  readonly mode: TransferMode;
  /**
   * Replace what is already there.
   *
   * False on the first attempt, always. The reply then names the collisions and
   * the caller asks — silently overwriting is how a file manager loses work.
   */
  readonly overwrite: boolean;
  /** The caller's name for this transfer, so it can cancel it and follow it. */
  readonly transferId: string;
}

export interface CreateRequest {
  readonly path: string;
  readonly kind: "file" | "directory";
}

export interface RenameRequest {
  readonly path: string;
  /** The new NAME, not a path. Renaming never moves an entry. */
  readonly name: string;
}

export interface TrashRequest {
  readonly paths: readonly string[];
}

export interface OpenRequest {
  readonly path: string;
}

export interface CancelTransferRequest {
  readonly transferId: string;
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
  /**
   * The first entries, capped. Empty for a file.
   *
   * Capped rather than complete, and reported beside the true `entryCount`
   * rather than instead of it: a directory of ten thousand names would
   * otherwise cross the boundary in full every time the cursor settled on it.
   * The difference between the two numbers is what lets the pane say how many
   * it is not showing.
   */
  readonly entries: readonly EntrySummary[];
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

export interface TransferReply {
  /** How many top-level sources landed. */
  readonly moved: number;
  /**
   * The names already present at the destination.
   *
   * Non-empty means NOTHING was transferred: the whole operation stops before
   * it starts rather than doing half of it and asking about the rest.
   */
  readonly conflicts: readonly string[];
}

export interface RenameReply {
  readonly path: string;
}

/** How far a transfer has got. Pushed, not polled. */
export interface TransferProgress {
  readonly transferId: string;
  readonly done: number;
  readonly total: number;
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
  | Result<TransferReply>
  | Result<RenameReply>
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

/**
 * A request whose whole content is one path.
 *
 * Three channels ask exactly this — describe, preview-url and open — and they
 * had three identical decoders. One definition means a rule added to path
 * validation reaches all of them, which is the point: the next rule will be a
 * security rule.
 */
const decodePathOnly: Decoder<{ readonly path: string }> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw["path"]);
  return isFailure(path) ? path : success({ path: path.value });
};

export const decodeDescribeRequest: Decoder<DescribeRequest> = decodePathOnly;

export const decodePreviewUrlRequest: Decoder<PreviewUrlRequest> = decodePathOnly;

function decodePathList(raw: unknown): Result<string[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return failure("invalid_request", "sources must be a non-empty array");
  }

  const paths: string[] = [];
  for (const item of raw) {
    const path = decodePath(item);
    if (isFailure(path)) return path;
    paths.push(path.value);
  }
  return success(paths);
}

export const decodeTransferRequest: Decoder<TransferRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const sources = decodePathList(raw["sources"]);
  if (isFailure(sources)) return sources;

  const destination = decodePath(raw["destination"]);
  if (isFailure(destination)) return destination;

  const mode = raw["mode"];
  if (mode !== "copy" && mode !== "move") {
    return failure("invalid_request", "mode must be copy or move");
  }

  const transferId = stringField(raw, "transferId");
  if (transferId === null) return failure("invalid_request", "transferId must be a string");

  return success({
    sources: sources.value,
    destination: destination.value,
    mode,
    overwrite: raw["overwrite"] === true,
    transferId,
  });
};

export const decodeCreateRequest: Decoder<CreateRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw["path"]);
  if (isFailure(path)) return path;

  const kind = raw["kind"];
  if (kind !== "file" && kind !== "directory") {
    return failure("invalid_request", "kind must be file or directory");
  }
  return success({ path: path.value, kind });
};

export const decodeRenameRequest: Decoder<RenameRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const path = decodePath(raw["path"]);
  if (isFailure(path)) return path;

  const name = stringField(raw, "name");
  if (name === null || name === "") return failure("invalid_request", "name must be a string");

  // A rename takes a NAME. A separator would move the entry somewhere else
  // while calling itself a rename, and `..` would move it somewhere the user
  // cannot see from here.
  if (name.includes("/") || name === "." || name === "..") {
    return failure("invalid_request", "a name may not contain a path separator");
  }
  return success({ path: path.value, name });
};

export const decodeTrashRequest: Decoder<TrashRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const paths = decodePathList(raw["paths"]);
  return isFailure(paths) ? paths : success({ paths: paths.value });
};

export const decodeOpenRequest: Decoder<OpenRequest> = decodePathOnly;

export const decodeCancelTransferRequest: Decoder<CancelTransferRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");

  const transferId = stringField(raw, "transferId");
  return transferId === null
    ? failure("invalid_request", "transferId must be a string")
    : success({ transferId });
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

/**
 * One listed entry, decoded.
 *
 * Reuses `isEntryKind`, the same predicate `decodeFsEntry` validates a full
 * entry with — one definition of what a kind is, so the two decoders cannot
 * come to disagree about `other`.
 *
 * Returns `null` for anything malformed rather than dropping it, so a single
 * bad element fails the whole reply. Dropping would leave the pane rendering a
 * listing shorter than the one the main process sent, with nothing saying so.
 */
function entrySummary(raw: unknown): EntrySummary | null {
  if (!isRecord(raw)) return null;

  const name = stringField(raw, "name");
  const kind = stringField(raw, "kind");
  if (name === null || kind === null || !isEntryKind(kind)) return null;

  return { name, kind };
}

export const decodeDescribeReply: Decoder<DescribeReply> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "reply must be an object");

  const name = stringField(raw, "name");
  const path = stringField(raw, "path");
  const size = finiteField(raw, "size");
  const entryCount = finiteField(raw, "entryCount");
  if (name === null || path === null || size === null || entryCount === null) {
    return failure("invalid_reply", "reply is missing a required field");
  }

  const rawEntries = raw["entries"];
  if (!Array.isArray(rawEntries)) {
    return failure("invalid_reply", "reply.entries must be an array");
  }
  const entries: EntrySummary[] = [];
  for (const element of rawEntries) {
    const summary = entrySummary(element);
    if (summary === null) {
      return failure("invalid_reply", "reply.entries holds a malformed entry");
    }
    entries.push(summary);
  }

  // The listing is a capped PREFIX of the directory, so it can never be longer
  // than the count. Without this the pane computes `count - listed` for its
  // "and N more" line and would render "and -3 more" — a broken invariant
  // presented as a fact, rather than a failure at the boundary that exists to
  // catch one.
  if (entries.length > entryCount) {
    return failure("invalid_reply", "reply.entries is longer than reply.entryCount");
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
    entries,
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

export const decodeTransferReply: Decoder<TransferReply> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "reply must be an object");

  const moved = finiteField(raw, "moved");
  const conflicts = raw["conflicts"];
  if (moved === null || !Array.isArray(conflicts)) {
    return failure("invalid_reply", "reply.moved and reply.conflicts are required");
  }
  return success({ moved, conflicts: conflicts.map(String) });
};

export const decodeRenameReply: Decoder<RenameReply> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "reply must be an object");

  const path = stringField(raw, "path");
  return path === null
    ? failure("invalid_reply", "reply.path must be a string")
    : success({ path });
};

export const decodeTransferProgress: Decoder<TransferProgress> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_reply", "event must be an object");

  const transferId = stringField(raw, "transferId");
  const done = finiteField(raw, "done");
  const total = finiteField(raw, "total");
  if (transferId === null || done === null || total === null) {
    return failure("invalid_reply", "progress is missing a required field");
  }
  return success({ transferId, done, total });
};
