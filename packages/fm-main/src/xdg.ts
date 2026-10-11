import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PLACE_KINDS, type Place, type PlaceKind } from "@symmetria/fm-core/contract";

/**
 * Where the desktop keeps its shared data, most-specific first.
 *
 * The user's own directory wins, which is what lets a locally installed
 * program's MIME types and desktop entries take precedence over the system's.
 *
 * One definition, because there were two: the MIME database loader and the
 * desktop-entry reader each had their own, and a fix to one would have silently
 * left the other resolving from a different set of directories.
 */
export function dataDirectories(): string[] {
  const home = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  const system = process.env["XDG_DATA_DIRS"] ?? "/usr/local/share:/usr/share";

  return [home, ...system.split(":").filter((dir) => dir !== "")];
}

/** Where `xdg-user-dirs-update` puts them on a fresh English install. */
const DEFAULT_PLACE_NAMES = {
  download: "Downloads",
  documents: "Documents",
  pictures: "Pictures",
  videos: "Videos",
  music: "Music",
} satisfies Record<PlaceKind, string>;

/**
 * Read `user-dirs.dirs`: lines of `XDG_<NAME>_DIR="<value>"`, where the value
 * is `$HOME/…` or an absolute path (the format `xdg-user-dirs-update` writes).
 *
 * A key the file does not set keeps its English default. A key set to `$HOME`
 * itself is how the spec DISABLES a directory, so it is dropped rather than
 * offered as a second Home.
 */
export function parseUserDirs(text: string, home: string): Map<PlaceKind, string> {
  const places = new Map<PlaceKind, string>(
    PLACE_KINDS.map((kind) => [kind, join(home, DEFAULT_PLACE_NAMES[kind])]),
  );
  for (const line of text.split("\n")) {
    const match = /^\s*XDG_([A-Z]+)_DIR\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    const kind = PLACE_KINDS.find((each) => each.toUpperCase() === match?.[1]);
    if (match === null || kind === undefined) continue;
    const value = expandUserDir(match[2] ?? "", home).replace(/\/+$/, "");
    if (!value.startsWith("/") || value === home.replace(/\/+$/, "")) places.delete(kind);
    else places.set(kind, value);
  }
  return places;
}

/**
 * One value, as the shell would read it inside double quotes: a leading
 * unescaped `$HOME` becomes the home directory, and the backslash escapes
 * `\$`, `\"`, `\\` and `` \` `` (what `xdg-user-dirs-update` writes for a name
 * holding them) are undone in the REST only, so neither an escaped `\$HOME`
 * nor a backslash inside the home path itself is touched. Nothing is
 * executed: the file is shell syntax, never run as shell.
 */
function expandUserDir(word: string, home: string): string {
  const unquote = (text: string) => text.replace(/\\([$`"\\])/g, "$1");
  return /^\$HOME(\/|$)/.test(word) ? home + unquote(word.slice("$HOME".length)) : unquote(word);
}

/**
 * The user directories that exist, in rail order. A configured directory that
 * is missing on disk is left out: a button that leads to an error is worse
 * than no button.
 */
export async function userPlaces(): Promise<Place[]> {
  const home = homedir();
  const config = process.env["XDG_CONFIG_HOME"] ?? join(home, ".config");
  const text = await readFile(join(config, "user-dirs.dirs"), "utf8").catch(() => "");
  const listed = [...parseUserDirs(text, home)];
  const present = await Promise.all(
    listed.map(([, path]) =>
      stat(path).then(
        (found) => found.isDirectory(),
        () => false,
      ),
    ),
  );
  return listed
    .filter((_, index) => present[index] === true)
    .map(([kind, path]) => ({ kind, path }));
}
