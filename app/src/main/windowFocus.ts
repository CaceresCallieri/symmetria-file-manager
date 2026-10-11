import { isRecord } from "@symmetria/fm-core/contract";

import { type HyprlandRequest, type HyprlandSend, withDeadline } from "./hyprland.ts";
import { PICKER_TITLE_PREFIX } from "./picker.ts";
import { WINDOW_CLASS } from "./window.ts";

/**
 * Take the user to the file manager's window when another program opened
 * something in it.
 *
 * `BrowserWindow.show()` is not enough on Hyprland, and this was measured, not
 * assumed: with the window on workspace 1 and the user on workspace 2, an
 * `open` answered `{"ok":true}` and left the user on workspace 2 looking at
 * nothing. Hyprland's `misc:focus_on_activate` is off by default, so an
 * activation request from the client does not move anybody. "Show in folder"
 * that shows nothing reads as broken, so the daemon asks the compositor to
 * focus its window, which switches to that window's workspace.
 *
 * Best effort, like picker placement: outside Hyprland, on X11, or on any
 * failure, the window is shown exactly as before and nothing else happens.
 */

/**
 * How long focusing may take in total.
 *
 * A window that was hidden is mapped again by `show()`, which takes a few
 * frames, so the window may not be in Hyprland's list on the first look.
 */
const FOCUS_BUDGET_MS = 600;

/** How long to wait between looks for a window that is not mapped yet. */
const FOCUS_RETRY_MS = 50;

/**
 * How many looks, at most. The budget already bounds the loop in real use;
 * this bounds it when a caller passes a request without one.
 */
const FOCUS_ATTEMPTS = FOCUS_BUDGET_MS / FOCUS_RETRY_MS;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * The address of this process's browse window in a `j/clients` reply.
 *
 * Matched on the process id, because every window of this daemon reports the
 * Electron main process as its pid, and on the class, then told apart from a
 * picker by the title — the same discriminator the picker's placement rule
 * uses, because the class is shared.
 */
export function ownWindowAddress(clientsReply: string, pid: number): string | null {
  let clients: unknown;
  try {
    clients = JSON.parse(clientsReply);
  } catch {
    return null;
  }
  if (!Array.isArray(clients)) return null;

  for (const client of clients) {
    if (!isRecord(client) || client.pid !== pid || client.class !== WINDOW_CLASS) continue;
    if (typeof client.title !== "string" || client.title.startsWith(PICKER_TITLE_PREFIX)) continue;
    if (client.mapped === false || client.hidden === true) continue;
    if (typeof client.address === "string" && client.address !== "") return client.address;
  }
  return null;
}

/**
 * Find this process's browse window and focus it. Resolves to whether Hyprland
 * accepted the focus.
 */
export async function focusOwnWindow(
  request: HyprlandRequest,
  pid: number,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<boolean> {
  for (let attempt = 0; attempt < FOCUS_ATTEMPTS; attempt++) {
    const clients = await request("j/clients");
    // Null is the budget spent or Hyprland unreachable; either way, stop.
    if (clients === null) return false;

    const address = ownWindowAddress(clients, pid);
    if (address !== null) {
      const reply = await request(`dispatch focuswindow address:${address}`);
      return reply?.trim() === "ok";
    }
    await wait(FOCUS_RETRY_MS);
  }
  return false;
}

/** Focus this process's window, or do nothing. Never rejects. */
export type WindowFocuser = () => Promise<boolean>;

/**
 * The focuser for this process: a no-op where `hyprlandSenderFor` found no
 * Hyprland to talk to.
 */
export function windowFocuser(send: HyprlandSend | null, pid: number): WindowFocuser {
  if (send === null) return async () => false;
  // A fresh budget for every request, so the retries above are bounded.
  return () => focusOwnWindow(withDeadline(send, FOCUS_BUDGET_MS), pid);
}
