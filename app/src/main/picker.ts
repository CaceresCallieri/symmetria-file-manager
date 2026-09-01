import type { ClosePickerCommand, CreatePickerCommand } from "@symmetria/fm-core/command";
import { failure, type Result, success } from "@symmetria/fm-core/contract";
import type { BrowserWindowConstructorOptions } from "electron";

import { buildWindowOptions } from "./window.ts";

/**
 * One picker window at a time, and a title the compositor can route by.
 *
 * **No runtime Electron import**, on purpose and following `window.ts`: the
 * decisions worth testing — how many windows open, which request owns the open
 * one, what the window is called — must be checkable without a display. The
 * real `BrowserWindow` is adapted to `PickerWindow` in `index.ts`, and the smoke
 * test exercises that adapter in a launched process.
 */

/**
 * What every picker window's title must begin with.
 *
 * **This is a contract with the operator's compositor, not a label.** The rule
 * in `~/.dotfiles/.config/hypr/windowrules.conf` sends this application's
 * windows to the `files` workspace and excludes the picker BY TITLE:
 *
 *   windowrule = workspace name:files silent,
 *                match:class ^(symmetria-fm-electron)$,
 *                match:title negative:^(Choose a file.*)$
 *
 * It has to be the title because Chromium sets the Wayland app id once per
 * PROCESS, from the desktop name, so a dialog cannot have an id of its own —
 * every window of this daemon carries the same class. Change this string and
 * every save dialog is dragged onto the file manager's workspace, away from the
 * application that asked for it. Change it in the dotfiles at the same time or
 * not at all.
 */
export const PICKER_TITLE_PREFIX = "Choose a file";

/**
 * The window title for a request, keeping the caller's own words after the
 * prefix so the window list still says which dialog this is.
 */
export function pickerWindowTitle(requested: string): string {
  const asked = requested.trim();
  if (asked === "") return PICKER_TITLE_PREFIX;
  if (asked.startsWith(PICKER_TITLE_PREFIX)) return asked;
  return `${PICKER_TITLE_PREFIX} — ${asked}`;
}

/**
 * A picker window, as the host must present one.
 *
 * Deliberately three methods and no more. Anything else this file could ask for
 * would be something a test double has to imitate for no gain.
 */
export interface PickerWindow {
  /**
   * Keep the window called this, whatever the page does.
   *
   * Electron lets a page's `<title>` element replace the window title after the
   * fact. The compositor reads the title when the window MAPS — which is why it
   * is also in the constructor options — but a human reading a window list
   * always sees the later one, and a compositor that re-evaluates on a title
   * change would too.
   */
  enforceTitle(title: string): void;
  /** Called when the window has really gone, however it went. */
  onClosed(listener: () => void): void;
  close(): void;
  /**
   * Has the underlying window already gone?
   *
   * Asked rather than only waited for, because the close event can arrive after
   * the next request does: between a forced destroy and the `closed` that
   * follows it, a `createPicker` would otherwise be refused on behalf of a
   * window that no longer exists.
   *
   * **It does not catch every death, and the limit is worth stating.** Measured:
   * when a window's X surface is destroyed from outside the process, Electron
   * raises nothing and `isDestroyed()` stays false, because it reports
   * Electron's own state rather than the compositor's. No compositor does that
   * — a close button sends `xdg_toplevel.close` or `WM_DELETE_WINDOW`, which do
   * raise the close event — and a crashed renderer is turned into an ordinary
   * close by the host's `render-process-gone` handler. The real bound on a
   * picker nobody ever answers is the FIFO write timeout.
   */
  isGone(): boolean;
  /**
   * Give back whatever the window was holding. Must be idempotent: the close
   * event and the stale-slot path both call it, and either may come first.
   */
  release(): void;
}

export type OpenPickerWindow = (command: CreatePickerCommand, title: string) => PickerWindow;

export interface PickerHost {
  /** Open a picker, or refuse because one is already up. */
  create(command: CreatePickerCommand): Result<null>;
  /** Dismiss the picker answering this FIFO, if it is the one that is open. */
  close(command: ClosePickerCommand): Result<null>;
  /**
   * The FIFO the open picker is answering, or null when none is open.
   *
   * The slot has no other observable, and that is what this is for: whether a
   * stale slot was cleared is otherwise indistinguishable from a slot that was
   * never taken. The same reasoning put `trackedWindows` on the IPC registry.
   */
  openFifo(): string | null;
}

/**
 * The options a picker window is constructed with.
 *
 * Built ON `buildWindowOptions` rather than beside it, so the sandbox posture
 * cannot drift between the two windows this application opens. Only the size
 * and the title differ — a dialog is smaller than a file manager, and the title
 * has to be present at construction because that is when the compositor reads
 * it.
 */
export function pickerWindowOptions(title: string): BrowserWindowConstructorOptions {
  return { ...buildWindowOptions(), width: 900, height: 600, title };
}

export function createPickerHost(open: OpenPickerWindow): PickerHost {
  let current: { readonly fifo: string; readonly window: PickerWindow } | null = null;

  /**
   * Drop the slot when the window in it has already gone.
   *
   * **Not defensive habit.** The slot used to be cleared only by the window's
   * close event, and that event is not guaranteed: a renderer that crashes
   * leaves a live `BrowserWindow` around a dead process until the host destroys
   * it, and between a forced destroy and its `closed` there is a window in which
   * the slot names something that no longer exists. Either way the daemon would
   * refuse every later `createPicker` for the rest of the process — on a machine
   * where this runs for days, a file dialog dead until the next login.
   *
   * The release matters as much as the slot: the window's streams and file
   * watches are held in the IPC registry under a strong key, so a slot cleared
   * without releasing would trade one permanent leak for another. Review found
   * that the first version of this did exactly that.
   *
   * It is a safety net and not a guarantee — see `isGone` for what it cannot
   * see. The guarantee is the FIFO write timeout, which bounds every picker.
   */
  function dropIfGone(): void {
    if (current === null || !current.window.isGone()) return;
    current.window.release();
    current = null;
  }

  return {
    create(command) {
      dropIfGone();

      if (current !== null) {
        // Refused, and refused with a code the caller can branch on. A picker
        // blocks a caller on a FIFO, so a second request has to be ANSWERED on
        // its own FIFO rather than dropped — that answer is written in the next
        // phase, and `conflict` is what tells it apart from a broken daemon.
        return failure("conflict", `a picker is already open for ${current.fifo}`);
      }

      const title = pickerWindowTitle(command.options.title);
      const window = open(command, title);
      current = { fifo: command.fifo, window };

      window.enforceTitle(title);
      // Whatever closes it — the user, the compositor's close button, a
      // `closePicker`, or the answer being written — one path clears the slot.
      // The identity check matters because a slow close could otherwise clear a
      // slot a later request has already taken.
      window.onClosed(() => {
        if (current?.window === window) current = null;
      });

      return success(null);
    },

    close(command) {
      dropIfGone();
      if (current !== null && current.fifo === command.fifo) current.window.close();
      // Success either way. A close for a picker that has already gone is the
      // ordinary case — the portal sends it when the calling application dies,
      // which often happens after the user has already answered — and reporting
      // it as a failure would make a normal sequence look broken.
      return success(null);
    },

    openFifo: () => {
      dropIfGone();
      return current?.fifo ?? null;
    },
  };
}
