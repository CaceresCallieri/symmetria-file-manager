import { describe, expect, it } from "vitest";
import { decodeDaemonCommand, replyLine } from "../src/command.ts";
import { isFailure } from "../src/contract.ts";

/**
 * The commands a running daemon accepts over its socket.
 *
 * Acceptance criteria 7 and 8 of phase 1.
 *
 * This input is untrusted in the same way the renderer's is, and for a sharper
 * reason: anything running as this user can connect to the socket and write to
 * it. So it gets the same treatment `decodeListRequest` gives an IPC payload —
 * a decoder that returns a value and never throws, with the same path rules.
 * A second decoder that forgot one of those rules would be a hole with the
 * first decoder's tests still passing beside it.
 */
describe("decodeDaemonCommand", () => {
  it("accepts an open with an absolute path", () => {
    const out = decodeDaemonCommand({ cmd: "open", path: "/home/jc/Downloads" });

    expect(isFailure(out)).toBe(false);
    if (isFailure(out)) return;
    expect(out.value.cmd).toBe("open");
    expect(out.value.path).toBe("/home/jc/Downloads");
  });

  it("refuses a relative path", () => {
    // The daemon has no working directory the caller could mean, so a relative
    // path can only be a mistake or an attempt to reach somewhere unintended.
    expect(isFailure(decodeDaemonCommand({ cmd: "open", path: "../etc" }))).toBe(true);
    expect(isFailure(decodeDaemonCommand({ cmd: "open", path: "Downloads" }))).toBe(true);
  });

  it("refuses a path longer than any the kernel could use", () => {
    const out = decodeDaemonCommand({ cmd: "open", path: `/${"a".repeat(5000)}` });
    expect(isFailure(out)).toBe(true);
  });

  it("refuses a path carrying a NUL byte", () => {
    // A NUL terminates the path at the syscall, so the path that gets opened is
    // not the path that was validated.
    expect(isFailure(decodeDaemonCommand({ cmd: "open", path: "/tmp/a\0/../etc" }))).toBe(true);
  });

  it("refuses an unknown command rather than ignoring it", () => {
    expect(isFailure(decodeDaemonCommand({ cmd: "rm", path: "/tmp" }))).toBe(true);
  });

  it("refuses anything that is not an object", () => {
    expect(isFailure(decodeDaemonCommand(null))).toBe(true);
    expect(isFailure(decodeDaemonCommand("open /tmp"))).toBe(true);
    expect(isFailure(decodeDaemonCommand([]))).toBe(true);
  });

  it("returns a failure rather than throwing, for every rejection above", () => {
    // The socket handler must be able to answer every input. A decoder that
    // throws on one shape takes the connection down instead of replying.
    for (const raw of [null, "x", [], {}, { cmd: "open" }, { cmd: "open", path: 7 }]) {
      expect(() => decodeDaemonCommand(raw)).not.toThrow();
    }
  });
});

describe("replyLine", () => {
  it("is one line, and parses as the envelope", () => {
    const line = replyLine({ ok: true, value: null });

    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({ ok: true });
  });

  it("carries the failure code and message on a rejection", () => {
    const line = replyLine({ ok: false, error: { code: "invalid_request", message: "nope" } });

    expect(JSON.parse(line)).toEqual({ ok: false, error: "invalid_request", message: "nope" });
  });
});
