import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { shell } from "electron";
import { parseMainSection } from "../desktopEntry.ts";
import { launchDesktopFile } from "../fileActions/applications.ts";
import { actionProcesses } from "../fileActions/process.ts";

import { dataDirectories } from "../xdg.ts";

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

/** Where desktop entries live, most-specific first. */
function applicationDirectories(): string[] {
  return dataDirectories().map((dir) => join(dir, "applications"));
}

/**
 * Read a desktop entry's `[Desktop Entry]` section.
 *
 * Only that section. A `.desktop` file may carry several action groups, each
 * with its own keys, and reading the whole file flat would let an action's
 * `Terminal=true` decide how the main command runs.
 */

async function desktopEntry(
  id: string,
): Promise<{ keys: Map<string, string>; path: string } | null> {
  for (const dir of applicationDirectories()) {
    const text = await readFile(join(dir, id), "utf8").catch(() => null);
    if (text === null) continue;

    // Most-specific directory wins: the user's own copy of an entry overrides
    // the system's, and reading further would let the system's win instead.
    const keys = parseMainSection(text);
    if (keys.size > 0) return { keys, path: join(dir, id) };
  }

  return null;
}

async function desktopEntryKeys(id: string): Promise<Map<string, string>> {
  return (await desktopEntry(id))?.keys ?? new Map();
}

/** Which application the desktop says handles this file. */
async function defaultApplication(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    // `xdg-mime` is the portable answer to "what opens this", and it is the
    // same tool the desktop's own file managers ask.
    const probe = spawn("xdg-mime", ["query", "filetype", path]);
    let mime = "";
    probe.stdout.on("data", (chunk: Buffer) => {
      mime += chunk.toString();
    });
    probe.on("error", () => resolve(null));
    probe.on("close", () => {
      const type = mime.trim();
      if (type === "") {
        resolve(null);
        return;
      }

      const query = spawn("xdg-mime", ["query", "default", type]);
      let id = "";
      query.stdout.on("data", (chunk: Buffer) => {
        id += chunk.toString();
      });
      query.on("error", () => resolve(null));
      query.on("close", () => resolve(id.trim() === "" ? null : id.trim()));
    });
  });
}

/**
 * Open one entry.
 *
 * Returns the route taken, so a caller can say what happened and a test can
 * assert the terminal branch without launching anything.
 */
export async function openEntry(path: string): Promise<"terminal" | "desktop"> {
  const id = await defaultApplication(path);
  const entry = id === null ? null : await desktopEntry(id);
  if (entry?.keys.get("Terminal") === "true") {
    await launchDesktopFile(actionProcesses, entry.path, path);
    return "terminal";
  }

  const error = await shell.openPath(path);
  if (error !== "") throw new Error(error);
  return "desktop";
}

export { desktopEntryKeys };
