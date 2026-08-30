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
  | "cancelled";

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
}

/**
 * Everything a handler may reply with.
 *
 * Named rather than `Result<unknown>`, because a boundary that returns
 * `unknown` hands its caller the parsing problem it was supposed to solve —
 * which is exactly what the type-evidence policy flags. `null` is the reply for
 * the channels whose whole answer is "it worked".
 */
export type IpcReply = Result<ListReply> | Result<ReadTextReply> | Result<null>;

// ── decoding ──────────────────────────────────────────────────────────────

const SORT_MODES: readonly SortMode[] = [
  "alphabetical",
  "modified",
  "size",
  "extension",
  "natural",
];

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
 * An absolute path with no NUL byte.
 *
 * Relative is refused because the renderer never learns a working directory, so
 * a relative path can only be a mistake or an attempt to reach somewhere it was
 * not given. A NUL is refused because it terminates the path at the syscall
 * boundary — a string check can approve one thing and the kernel open another.
 */
/**
 * The longest path the renderer may name.
 *
 * Linux caps a path at 4096 bytes, so anything beyond it cannot name a real
 * file — but nothing stopped a multi-megabyte string reaching `readdir`, which
 * verification noticed. A boundary that accepts input no syscall could use is
 * not validating, it is forwarding.
 */
const MAX_PATH_LENGTH = 4096;

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
  if (typeof sort !== "string" || !SORT_MODES.includes(sort as SortMode)) {
    return failure("invalid_request", `sort must be one of ${SORT_MODES.join(", ")}`);
  }

  // Unknown keys are ignored rather than refused, so an older main process
  // survives a newer renderer sending a field it has never heard of.
  return success({
    path: path.value,
    showHidden: raw.showHidden === true,
    sort: sort as SortMode,
    stream: raw.stream === true,
  });
};

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

export const decodeCancelRequest: Decoder<CancelRequest> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");
  if (typeof raw.streamId !== "string" || raw.streamId === "") {
    return failure("invalid_request", "streamId is required");
  }
  return success({ streamId: raw.streamId });
};
