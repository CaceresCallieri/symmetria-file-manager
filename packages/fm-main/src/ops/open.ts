import { shell } from "electron";
import { defaultDesktopEntry, launchDesktopFile } from "../fileActions/applications.ts";
import { actionProcesses } from "../fileActions/process.ts";

/**
 * Hand an entry to whatever the desktop says opens it.
 *
 * `shell.openPath` covers almost all of it. The exception is the reason this
 * module exists at all: a desktop entry may declare `Terminal=true`, meaning
 * its command is a text-mode program that must be given a terminal to run in.
 * Electron cannot express that, so GIO launches the exact desktop entry through
 * the same adapter that Open With uses. GIO owns Exec quoting and field codes.
 *
 * ── WARNING: this is the one operation that is NOT confined by the test
 * environment ──────────────────────────────────────────────────────────────
 * `shell.openPath` and the `xdg-mime` probe talk to the session D-Bus and the
 * desktop's real file associations. Neither is contained by a virtual display
 * or by a scratch `HOME`: a verification run under `xvfb-run` with `HOME`
 * pointed at `/tmp` still opened a real editor window on the operator's live
 * Hyprland session. Every other operation here writes only where it is told.
 *
 * So: do NOT exercise opening from an automated or headless run. Assert the
 * ROUTE this function returns — `"terminal"` or `"desktop"` — or that the IPC
 * call was made, and stop there.
 */

/**
 * Open one entry.
 *
 * Returns the route taken, so a caller can say what happened and a test can
 * assert the terminal branch without launching anything.
 */
export async function openEntry(path: string): Promise<"terminal" | "desktop"> {
  const entry = await defaultDesktopEntry(actionProcesses, path);
  if (entry?.keys.get("Terminal") === "true") {
    await launchDesktopFile(actionProcesses, entry.path, path);
    return "terminal";
  }

  const error = await shell.openPath(path);
  if (error !== "") throw new Error(error);
  return "desktop";
}
