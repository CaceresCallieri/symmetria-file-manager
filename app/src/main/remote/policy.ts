import { failure, isRecord, type Result, success } from "@symmetria/fm-core/contract";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";

/** An allowlist keeps new registry capabilities private until this host opts in. */
const READ_CHANNELS: ReadonlySet<string> = new Set([
  REQUEST_CHANNELS.list,
  REQUEST_CHANNELS.overview,
  REQUEST_CHANNELS.watch,
  REQUEST_CHANNELS.unwatch,
  REQUEST_CHANNELS.cancel,
  REQUEST_CHANNELS.describe,
  REQUEST_CHANNELS.readText,
  REQUEST_CHANNELS.previewUrl,
  REQUEST_CHANNELS.previewDirectoryUrl,
  REQUEST_CHANNELS.diskUsage,
  REQUEST_CHANNELS.places,
]);

export interface RemoteRequest {
  readonly sessionId: string;
  readonly channel: string;
  readonly payload: unknown;
}

export function isSessionId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[a-f0-9-]{36}$/.test(raw);
}

function isReadChannel(raw: unknown): raw is string {
  return typeof raw === "string" && READ_CHANNELS.has(raw);
}

export function decodeRemoteRequest(raw: unknown): Result<RemoteRequest> {
  if (!isRecord(raw)) return failure("invalid_request", "request must be an object");
  const { sessionId, channel, payload } = raw;
  if (!isSessionId(sessionId)) {
    return failure("invalid_request", "invalid session id");
  }
  if (!isReadChannel(channel)) {
    return failure("invalid_request", "Home server is read-only; this operation is unavailable");
  }
  return success({ sessionId, channel, payload });
}

/** Describe is the only enabled reply carrying bytes. JSON needs an explicit representation. */
export function encodeRemoteReply(reply: Result<unknown>): Result<unknown> {
  if (!reply.ok || !isRecord(reply.value) || !(reply.value.head instanceof Uint8Array)) {
    return reply;
  }
  return success({ ...reply.value, head: Array.from(reply.value.head) });
}

export function decodeRemoteReply(raw: unknown): Result<unknown> {
  if (!isRecord(raw)) return failure("invalid_reply", "invalid remote reply");
  if (raw.ok === false) return decodeRemoteError(raw.error);
  if (raw.ok !== true) return failure("invalid_reply", "invalid remote reply");
  return decodeRemoteValue(raw.value);
}

function decodeRemoteError(raw: unknown): Result<never> {
  if (!isRecord(raw)) return failure("invalid_reply", "invalid remote error");
  if (typeof raw.message !== "string") return failure("invalid_reply", "invalid remote error");
  return failure("read_failed", raw.message);
}

function decodeRemoteValue(value: unknown): Result<unknown> {
  if (!isRecord(value)) return success(value);
  if (!Array.isArray(value.head)) return success(value);
  const head = value.head;
  if (!head.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return failure("invalid_reply", "invalid preview bytes");
  }
  return success({ ...value, head: Uint8Array.from(head) });
}
