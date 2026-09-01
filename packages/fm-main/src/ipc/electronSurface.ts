import type { IpcMain } from "electron";

import type { IpcSurface } from "./register.ts";

/**
 * Adapt Electron's `ipcMain` to the transport shape the registry expects.
 *
 * This adapter exists because of a real defect. `ipcMain.handle` invokes its
 * handler with `(event, ...args)` — two arguments — while the registry's
 * `IpcSurface` declares one. Wired directly, every handler received the EVENT
 * where it expected the request, and the decoder rejected all of it as
 * `invalid_request`.
 *
 * The unit tests did not catch it: their fake transport calls
 * `handler(payload)` with one argument, so it encoded the assumption rather
 * than the API. The end-to-end smoke test through a real renderer is what
 * found it. Keeping the mismatch in one named adapter is what stops the same
 * assumption leaking back into the registry.
 */
/**
 * Exactly the two members this adapter touches.
 *
 * Narrower than `IpcMain` on purpose. Asking for the whole interface forced a
 * test double through `as unknown as IpcMain` — an assertion chain that throws
 * away the type evidence the double actually has. Declaring the real
 * requirement means the double satisfies it structurally, with no cast at all.
 */
export type IpcMainHandlers = Pick<IpcMain, "handle" | "removeHandler">;

export function electronIpcSurface(ipcMain: IpcMainHandlers): IpcSurface {
  return {
    handle(channel, handler) {
      // The event is dropped here and nowhere else. That is the whole adapter.
      ipcMain.handle(channel, (_event: unknown, payload: unknown) => handler(payload));
    },
    removeHandler(channel) {
      ipcMain.removeHandler(channel);
    },
  };
}
