import { isRecord } from "@symmetria/fm-core/contract";

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Socket error codes that fetch() hides behind its generic "fetch failed". */
const NETWORK_FAILURES: ReadonlyMap<string, string> = new Map([
  ["ECONNREFUSED", "refused the connection; is its file service running?"],
  ["ECONNRESET", "closed the connection"],
  ["EHOSTUNREACH", "is unreachable; is it online and on the tailnet?"],
  ["ENETUNREACH", "is unreachable; is it online and on the tailnet?"],
  ["ETIMEDOUT", "did not answer"],
  ["UND_ERR_CONNECT_TIMEOUT", "did not answer"],
  ["ENOTFOUND", "has a name that does not resolve; is Tailscale running?"],
  ["EAI_AGAIN", "has a name that does not resolve; is Tailscale running?"],
]);

/**
 * Name the network cause of a failed remote request. fetch() rejects with
 * TypeError("fetch failed") and keeps the socket error in `cause`, so the bare
 * message tells the operator nothing about which side failed.
 */
export function describeConnectionFailure(cause: unknown, machineName: string): string {
  if (isRecord(cause) && cause.name === "TimeoutError") return answerTimeoutMessage(machineName);
  const code = networkErrorCode(cause);
  const explanation = code === null ? undefined : NETWORK_FAILURES.get(code);
  return explanation === undefined ? errorMessage(cause) : `${machineName} ${explanation}`;
}

export function answerTimeoutMessage(machineName: string): string {
  return `${machineName} did not answer in time`;
}

function networkErrorCode(cause: unknown): string | null {
  if (!(cause instanceof TypeError) || !isRecord(cause.cause)) return null;
  return typeof cause.cause.code === "string" ? cause.cause.code : null;
}
