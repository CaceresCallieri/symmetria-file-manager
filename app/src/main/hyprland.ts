import { createConnection } from "node:net";
import { join } from "node:path";

/**
 * A minimal client for Hyprland's request socket.
 *
 * The socket and not the `hyprctl` binary: one request is one connection, one
 * write and one read to end-of-stream, so a process spawn per request would
 * cost more than the request itself and add a PATH dependency a systemd unit
 * does not guarantee.
 *
 * Protocol, as Hyprland 0.56 speaks it: the client writes the request and
 * Hyprland writes the whole reply, then closes. A `j/` prefix asks for JSON. A
 * `[[BATCH]]` prefix runs several `;`-separated requests in order and
 * concatenates their replies.
 */

/** A request sent, and the reply, or null when there is no usable reply. */
export type HyprlandRequest = (request: string) => Promise<string | null>;

/**
 * Where this session's Hyprland listens, or null when it is not Hyprland.
 *
 * `HYPRLAND_INSTANCE_SIGNATURE` is what Hyprland exports to everything it
 * starts and what the systemd user environment carries, so its absence is the
 * reliable "not on Hyprland" signal.
 */
export function hyprlandSocketPath(env: Record<string, string | undefined>): string | null {
  const signature = env.HYPRLAND_INSTANCE_SIGNATURE;
  const runtime = env.XDG_RUNTIME_DIR;
  if (signature === undefined || signature === "") return null;
  if (runtime === undefined || runtime === "") return null;
  return join(runtime, "hypr", signature, ".socket.sock");
}

/**
 * The sender for THIS process's Hyprland, or null when its windows are not
 * Hyprland's to manage.
 *
 * Null when the session is not Hyprland, and when Chromium runs on X11. The
 * second is not hypothetical: every launch the tests, the benches and the
 * release check make is `--ozone-platform=x11` under `xvfb-run`, and those
 * processes inherit the developer's `HYPRLAND_INSTANCE_SIGNATURE`. An X window
 * on a virtual display is not Hyprland's, and a test must not rewrite a rule or
 * move focus in the session somebody is using.
 */
export function hyprlandSenderFor(
  env: Record<string, string | undefined>,
  ozonePlatform: string,
): HyprlandSend | null {
  const socketPath = hyprlandSocketPath(env);
  if (socketPath === null || ozonePlatform === "x11") return null;
  return hyprlandSender(socketPath);
}

/** One request with its own time limit. */
export type HyprlandSend = (request: string, timeoutMs: number) => Promise<string | null>;

/**
 * Send requests to the Hyprland socket at `socketPath`.
 *
 * Every failure resolves to null rather than rejecting: a connection refused,
 * a socket that vanished with a restarted compositor, a reply that never ends.
 * The callers place a window as a courtesy, and no compositor failure may stop
 * the window itself. `timeoutMs` bounds every request, because a compositor
 * that accepts and never answers would otherwise hold a dialog off screen.
 */
export function hyprlandSender(socketPath: string): HyprlandSend {
  return (request, timeoutMs) =>
    new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const socket = createConnection(socketPath);
      const settle = (reply: string | null) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(reply);
      };
      const timer = setTimeout(() => settle(null), timeoutMs);

      socket.once("connect", () => socket.end(request));
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      // Hyprland answers every request with SOMETHING, even a refusal, so an
      // empty reply means the connection closed without one.
      socket.once("end", () => {
        const reply = Buffer.concat(chunks).toString("utf8");
        settle(reply === "" ? null : reply);
      });
      socket.once("error", () => settle(null));
    });
}

/**
 * Requests that share ONE time budget, however many of them there are.
 *
 * A budget per request would let a caller that makes three requests wait three
 * times as long; a dialog waits on all of them, so the bound belongs to the
 * whole sequence. Once the budget is spent, a request resolves null without
 * being sent.
 */
export function withDeadline(
  send: HyprlandSend,
  budgetMs: number,
  now: () => number = Date.now,
): HyprlandRequest {
  const deadline = now() + budgetMs;
  return (request) => {
    const remaining = deadline - now();
    return remaining > 0 ? send(request, remaining) : Promise.resolve(null);
  };
}
