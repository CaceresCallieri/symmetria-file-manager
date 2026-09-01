#!/usr/bin/env node
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Ask the running file manager to do one thing.
 *
 * **Plain Node, never Electron, and that is the point of the file.** Running
 * this under the Electron binary would pay a complete cold start — a quarter of
 * a second at best, and 200 MB of transient memory — to deliver one line to a
 * process that is already up. Every system file dialog in the session would
 * eventually pay it.
 *
 * It therefore has **no build step and no dependencies**, which is why the dozen
 * lines of socket client below are not shared with `src/main/socket.ts`. That
 * constraint is what makes the two genuinely different requirements rather than
 * one requirement written twice: a tool importing the TypeScript tree would stop
 * working the moment somebody ran it before a build, which is exactly when a
 * user reaches for it.
 *
 * The exit code is the contract. Zero means the daemon accepted it; one means
 * anything else. A portal backend branches on this.
 */

const SOCKET_BASENAME = "symmetria-fm-electron.sock";

function socketPath() {
  const override = process.env.SYMMETRIA_FM_SOCKET;
  if (override !== undefined && override !== "") return override;

  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime !== undefined && runtime !== "") return join(runtime, SOCKET_BASENAME);
  return join(tmpdir(), SOCKET_BASENAME);
}

const USAGE = `symmetria-fm-electron-cli — talk to the running file manager

  open <absolute-path>   open that directory as a tab, and go to it

The daemon must be running. It is started by symmetria-fm-electron.service.`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Send one JSON line, read one JSON line back. */
function send(path, payload) {
  return new Promise((resolve) => {
    const connection = createConnection(path);
    let buffer = "";

    connection.setEncoding("utf8");
    connection.setTimeout(5_000, () => {
      connection.destroy();
      resolve({ ok: false, error: "the file manager did not answer" });
    });
    connection.once("connect", () => connection.write(`${JSON.stringify(payload)}\n`));
    connection.on("data", (chunk) => {
      buffer += chunk;
    });
    // Named rather than generic. "ENOENT" tells a user nothing; "not running"
    // tells them what to do, and this is the failure they will actually hit.
    connection.once("error", () =>
      resolve({ ok: false, error: `the file manager is not running (no socket at ${path})` }),
    );
    connection.once("close", () => {
      try {
        resolve(JSON.parse(buffer.trim()));
      } catch {
        resolve({ ok: false, error: "the file manager sent no reply" });
      }
    });
  });
}

const [subcommand, ...rest] = process.argv.slice(2);

if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
  process.stdout.write(`${USAGE}\n`);
  // Non-zero even for --help, because reaching help means no command ran and
  // the caller's exit-code branch must not read that as success.
  process.exit(1);
}

if (subcommand !== "open") {
  fail(`unknown command: ${subcommand}\n\n${USAGE}`);
}

const path = rest[0];
if (path === undefined || path === "") {
  fail(`open needs a path\n\n${USAGE}`);
}

const reply = await send(socketPath(), { cmd: "open", path });
if (reply.ok !== true) {
  fail(reply.message ?? reply.error ?? "the file manager refused the command");
}
