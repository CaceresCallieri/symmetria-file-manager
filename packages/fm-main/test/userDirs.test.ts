import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseUserDirs, userPlaces } from "../src/xdg.ts";

/** `user-dirs.dirs` as `xdg-user-dirs-update` writes it, on a Spanish desktop. */
const SPANISH = `# This file is written by xdg-user-dirs-update
XDG_DESKTOP_DIR="$HOME/Escritorio"
XDG_DOWNLOAD_DIR="$HOME/Descargas"
XDG_DOCUMENTS_DIR="/srv/docs"
XDG_MUSIC_DIR="$HOME"
XDG_PICTURES_DIR="$HOME/Imágenes"
`;

describe("reading user-dirs.dirs", () => {
  it("expands $HOME, keeps absolute paths, and keeps translated names", () => {
    const places = parseUserDirs(SPANISH, "/home/jc");

    expect(places.get("download")).toBe("/home/jc/Descargas");
    expect(places.get("documents")).toBe("/srv/docs");
    expect(places.get("pictures")).toBe("/home/jc/Imágenes");
  });

  it("drops a directory set to $HOME, which is how the spec disables one", () => {
    expect(parseUserDirs(SPANISH, "/home/jc").has("music")).toBe(false);
  });

  it("keeps the English default for a key the file does not set", () => {
    expect(parseUserDirs(SPANISH, "/home/jc").get("videos")).toBe("/home/jc/Videos");
    expect(parseUserDirs("", "/home/jc").get("download")).toBe("/home/jc/Downloads");
  });

  it("undoes the shell escapes xdg-user-dirs-update writes, and nothing more", () => {
    const places = parseUserDirs(
      [
        'XDG_DOWNLOAD_DIR="$HOME/Price\\$docs"',
        'XDG_DOCUMENTS_DIR="$HOME/say \\"hi\\" \\`now\\` a\\\\b"',
        'XDG_PICTURES_DIR="\\$HOME/literal"',
      ].join("\n"),
      "/home/jc",
    );

    expect(places.get("download")).toBe("/home/jc/Price$docs");
    expect(places.get("documents")).toBe('/home/jc/say "hi" `now` a\\b');
    // An escaped `$HOME` is not a variable: the value is relative, so dropped.
    expect(places.has("pictures")).toBe(false);
  });

  it("ignores comments, unknown keys and a relative value", () => {
    const places = parseUserDirs(
      '# XDG_DOWNLOAD_DIR="/nope"\nXDG_TEMPLATES_DIR="$HOME/T"\nXDG_VIDEOS_DIR="clips"\n',
      "/home/jc",
    );

    expect(places.get("download")).toBe("/home/jc/Downloads");
    expect(places.has("videos")).toBe(false);
  });
});

describe("the places that exist", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "symfm-places-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it("offers only directories that are on disk, in rail order", async () => {
    await mkdir(join(home, ".config"));
    await writeFile(
      join(home, ".config", "user-dirs.dirs"),
      'XDG_DOWNLOAD_DIR="$HOME/Descargas"\n',
    );
    await mkdir(join(home, "Descargas"));
    await mkdir(join(home, "Music"));

    expect(await userPlaces()).toEqual([
      { kind: "download", path: join(home, "Descargas") },
      { kind: "music", path: join(home, "Music") },
    ]);
  });

  it("answers the English defaults that exist when there is no file", async () => {
    await mkdir(join(home, "Documents"));

    expect(await userPlaces()).toEqual([{ kind: "documents", path: join(home, "Documents") }]);
  });
});
