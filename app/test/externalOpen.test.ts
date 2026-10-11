import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parentOf } from "@symmetria/fm-core/pane";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { externalOpenFor, type IsDirectory, isDirectoryOnDisk } from "../src/main/externalOpen.ts";

/**
 * What the window shows when another program opens or reveals a path.
 *
 * `reveal` is "Show in folder" — `org.freedesktop.FileManager1.ShowItems` —
 * and it always lands on the item inside its parent. `open` shows a directory
 * and lands on a FILE inside its folder, because a file cannot be listed.
 */

const DIRECTORIES = new Set(["/home/jc", "/home/jc/projects"]);
const FILES = new Set(["/home/jc/notes.txt"]);
const fakeDisk: IsDirectory = async (path) =>
  DIRECTORIES.has(path) ? true : FILES.has(path) ? false : null;

describe("externalOpenFor", () => {
  it("opens a directory as itself", async () => {
    expect(await externalOpenFor({ cmd: "open", path: "/home/jc/projects" }, fakeDisk)).toEqual({
      path: "/home/jc/projects",
      reveal: null,
    });
  });

  it("opens a FILE as its folder with the cursor on it", async () => {
    expect(await externalOpenFor({ cmd: "open", path: "/home/jc/notes.txt" }, fakeDisk)).toEqual({
      path: "/home/jc",
      reveal: "/home/jc/notes.txt",
    });
  });

  it("reveals a directory inside its parent instead of opening it", async () => {
    expect(await externalOpenFor({ cmd: "reveal", path: "/home/jc/projects" }, fakeDisk)).toEqual({
      path: "/home/jc",
      reveal: "/home/jc/projects",
    });
  });

  it("opens a path it cannot stat as given, so the listing reports why", async () => {
    expect(await externalOpenFor({ cmd: "open", path: "/home/jc/gone" }, fakeDisk)).toEqual({
      path: "/home/jc/gone",
      reveal: null,
    });
  });

  it("still reveals a path it cannot stat: the folder is worth showing", async () => {
    expect(await externalOpenFor({ cmd: "reveal", path: "/home/jc/gone" }, fakeDisk)).toEqual({
      path: "/home/jc",
      reveal: "/home/jc/gone",
    });
  });

  it("normalises a trailing slash before taking the parent", async () => {
    expect(await externalOpenFor({ cmd: "reveal", path: "/home/jc/projects/" }, fakeDisk)).toEqual({
      path: "/home/jc",
      reveal: "/home/jc/projects",
    });
  });

  it("sends a reveal the window accepts: its parent, as the window computes it, is the path", async () => {
    // The renderer keeps a reveal only when `parentOf(reveal) === path`. A
    // spelling the two sides read differently loses the cursor silently.
    for (const asked of [
      "/usr//share",
      "/home/jc//notes.txt",
      "/home/jc/projects///",
      "//home/jc",
    ]) {
      const target = await externalOpenFor({ cmd: "reveal", path: asked }, fakeDisk);
      expect(target.reveal, asked).not.toBeNull();
      expect(parentOf(target.reveal ?? ""), asked).toBe(target.path);
    }
  });

  it("opens the root as itself, because it has no parent to be revealed in", async () => {
    expect(await externalOpenFor({ cmd: "reveal", path: "/" }, fakeDisk)).toEqual({
      path: "/",
      reveal: null,
    });
  });
});

describe("externalOpenFor and symlinks", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fm-external-open-"));
    await mkdir(join(dir, "real", "inner"), { recursive: true });
    // `link/..` is `real` on disk, but `dir` to anyone reading the text.
    await symlink(join(dir, "real", "inner"), join(dir, "link"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("opens a directory exactly as named, leaving `..` to the kernel", async () => {
    // Review found the first version collapsing this to `dir` with `resolve()`.
    const named = `${join(dir, "link")}/..`;
    expect(await externalOpenFor({ cmd: "open", path: named }, isDirectoryOnDisk)).toEqual({
      path: named,
      reveal: null,
    });
  });

  it("reveals the item a trailing `..` names on disk, through the symlink", async () => {
    const named = `${join(dir, "link")}/..`;
    expect(await externalOpenFor({ cmd: "reveal", path: named }, isDirectoryOnDisk)).toEqual({
      path: dir,
      reveal: join(dir, "real"),
    });
  });
});

describe("isDirectoryOnDisk", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fm-external-open-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("tells a directory, a file and a missing path apart", async () => {
    await mkdir(join(dir, "folder"));
    await writeFile(join(dir, "file.txt"), "x");

    expect(await isDirectoryOnDisk(join(dir, "folder"))).toBe(true);
    expect(await isDirectoryOnDisk(join(dir, "file.txt"))).toBe(false);
    expect(await isDirectoryOnDisk(join(dir, "missing"))).toBeNull();
  });
});
