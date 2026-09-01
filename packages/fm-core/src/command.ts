import {
  type Decoder,
  decodePath,
  failure,
  isFailure,
  isRecord,
  type Result,
  success,
} from "./contract.ts";

/**
 * What a running daemon accepts over its socket, and what it answers.
 *
 * **This input is untrusted, and more sharply than the renderer's.** Any process
 * running as this user can connect to the socket and write to it, so a command
 * gets the same decoding an IPC payload gets — a value returned, never an
 * exception thrown, because a decoder that throws takes the connection down
 * instead of answering it.
 *
 * The path rules are `decodePath`'s and are deliberately not restated here. A
 * second copy would pass its own tests on the day it was written and drift
 * afterwards, and the looser of the two copies is the one an attacker uses.
 */

export interface OpenCommand {
  readonly cmd: "open";
  /** Absolute, NUL-free, within the kernel's length limit. */
  readonly path: string;
}

/**
 * One arm today, written as a union on purpose.
 *
 * `createPicker` and `closePicker` join it in a later run, and a union with one
 * arm costs nothing while a bare interface would have to be widened by whoever
 * adds the second — which is the moment the exhaustiveness check below stops
 * being free.
 */
export type DaemonCommand = OpenCommand;

export const decodeDaemonCommand: Decoder<DaemonCommand> = (raw) => {
  if (!isRecord(raw)) return failure("invalid_request", "command must be an object");

  const cmd = raw.cmd;
  if (typeof cmd !== "string") return failure("invalid_request", "cmd must be a string");
  // Named rather than defaulted. An unrecognised command that fell through to
  // `open` would run something the caller did not ask for, and one that was
  // silently ignored would report success for work nobody did.
  if (cmd !== "open") return failure("invalid_request", `unknown command: ${cmd}`);

  const path = decodePath(raw.path);
  if (isFailure(path)) return path;

  return success({ cmd: "open", path: path.value });
};

/**
 * The single line the daemon writes back, newline included.
 *
 * Newline-delimited because the caller reads until one: a reply split across
 * two reads has to be reassembled somehow, and a delimiter is the cheapest
 * agreement that makes that possible. The shape mirrors the Qt daemon's so the
 * two are legible side by side while both exist.
 */
export function replyLine(result: Result<unknown>): string {
  if (isFailure(result)) {
    return `${JSON.stringify({ ok: false, error: result.error.code, message: result.error.message })}\n`;
  }
  return `${JSON.stringify({ ok: true })}\n`;
}
