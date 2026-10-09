import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEntry, renameEntry, transfer } from "../src/ops/mutate.ts";
import { desktopEntryKeys } from "../src/ops/open.ts";

/**
 * The mutations, against a real filesystem.
 *
 * Real because these are the operations that lose data when they are wrong, and
 * a fake filesystem agrees with whatever the implementation believes. The one
 * thing not exercised here is trash — it is delegated to Electron's
 * implementation of the freedesktop specification, which needs a running
 * Electron and which reimplementing would be a way to lose files.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "symfm-ops-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A directory holding a file and a nested directory with a file in it. */
async function tree(name: string): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, "nested"), { recursive: true });
  await writeFile(join(dir, "top.txt"), "top");
  await writeFile(join(dir, "nested", "deep.txt"), "deep");
  return dir;
}

async function names(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

describe("copy", () => {
  it.each([false, true])(
    "tree-operations review P1-1 guard: copy overwrite=%s retains missing-destination creation",
    async (overwrite) => {
      const source = join(root, "keep.txt");
      await writeFile(source, "source bytes");
      const destination = join(root, "missing", "nested");
      await transfer({ sources: [source], destination, mode: "copy", overwrite });
      expect(await readFile(join(destination, "keep.txt"), "utf8")).toBe("source bytes");
      expect(await readFile(source, "utf8")).toBe("source bytes");
    },
  );

  it("duplicates a directory and everything under it", async () => {
    const source = await tree("source");
    const destination = join(root, "into");
    await mkdir(destination);

    const outcome = await transfer({
      sources: [source],
      destination,
      mode: "copy",
      overwrite: false,
    });

    expect(outcome).toEqual({ moved: 1, conflicts: [] });
    expect(await readFile(join(destination, "source", "nested", "deep.txt"), "utf8")).toBe("deep");
    // The original is still there. A copy that moves is a move.
    expect(await names(source)).toEqual(["nested", "top.txt"]);
  });

  it("copies several entries in one transfer", async () => {
    await writeFile(join(root, "a.txt"), "a");
    await writeFile(join(root, "b.txt"), "b");
    const destination = join(root, "into");
    await mkdir(destination);

    const outcome = await transfer({
      sources: [join(root, "a.txt"), join(root, "b.txt")],
      destination,
      mode: "copy",
      overwrite: false,
    });

    expect(outcome.moved).toBe(2);
    expect(await names(destination)).toEqual(["a.txt", "b.txt"]);
  });
});

describe("move", () => {
  it.each([false, true])(
    "tree-operations review P1-1 guard: move overwrite=%s retains missing-destination refusal",
    async (overwrite) => {
      const source = join(root, "keep.txt");
      await writeFile(source, "source bytes");
      await expect(
        transfer({
          sources: [source],
          destination: join(root, "missing"),
          mode: "move",
          overwrite,
        }),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(source, "utf8")).toBe("source bytes");
      expect(await names(root)).toEqual(["keep.txt"]);
    },
  );

  it("moves the entries and leaves nothing behind", async () => {
    const source = await tree("source");
    const destination = join(root, "into");
    await mkdir(destination);

    await transfer({ sources: [source], destination, mode: "move", overwrite: false });

    expect(await names(root)).toEqual(["into"]);
    expect(await readFile(join(destination, "source", "top.txt"), "utf8")).toBe("top");
  });
});

describe("conflicts", () => {
  it("names every collision and transfers NOTHING", async () => {
    // Transferring three files and asking about the fourth leaves the user
    // reasoning about a partial result. Naming them all lets them answer once.
    await writeFile(join(root, "a.txt"), "new a");
    await writeFile(join(root, "b.txt"), "new b");
    const destination = join(root, "into");
    await mkdir(destination);
    await writeFile(join(destination, "a.txt"), "old a");
    await writeFile(join(destination, "b.txt"), "old b");

    const outcome = await transfer({
      sources: [join(root, "a.txt"), join(root, "b.txt")],
      destination,
      mode: "copy",
      overwrite: false,
    });

    expect(outcome).toEqual({ moved: 0, conflicts: ["a.txt", "b.txt"] });
    expect(await readFile(join(destination, "a.txt"), "utf8")).toBe("old a");
  });

  it("stops even when only one of several entries collides", async () => {
    await writeFile(join(root, "a.txt"), "new a");
    await writeFile(join(root, "c.txt"), "new c");
    const destination = join(root, "into");
    await mkdir(destination);
    await writeFile(join(destination, "a.txt"), "old a");

    const outcome = await transfer({
      sources: [join(root, "a.txt"), join(root, "c.txt")],
      destination,
      mode: "copy",
      overwrite: false,
    });

    expect(outcome.conflicts).toEqual(["a.txt"]);
    expect(await names(destination)).toEqual(["a.txt"]);
  });

  it("replaces when the caller says to, having been asked", async () => {
    await writeFile(join(root, "a.txt"), "new a");
    const destination = join(root, "into");
    await mkdir(destination);
    await writeFile(join(destination, "a.txt"), "old a");

    await transfer({
      sources: [join(root, "a.txt")],
      destination,
      mode: "copy",
      overwrite: true,
    });

    expect(await readFile(join(destination, "a.txt"), "utf8")).toBe("new a");
  });

  it("treats a broken symlink as being in the way", async () => {
    // It occupies the name, so writing there would replace it — and it may be
    // the only record of where something used to point.
    const { symlink } = await import("node:fs/promises");
    await writeFile(join(root, "a.txt"), "a");
    const destination = join(root, "into");
    await mkdir(destination);
    await symlink(join(root, "gone"), join(destination, "a.txt"));

    const outcome = await transfer({
      sources: [join(root, "a.txt")],
      destination,
      mode: "copy",
      overwrite: false,
    });

    expect(outcome.conflicts).toEqual(["a.txt"]);
  });
});

describe("refusals", () => {
  it("tree-operations review P1-1 guard: filesystem-root recursion refuses before reading or copying entries", async () => {
    await expect(
      transfer({
        sources: ["/"],
        destination: root,
        mode: "copy",
        overwrite: false,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow(/into itself/);
    expect(await names(root)).toEqual([]);
  });

  it.each(["copy", "move"] as const)(
    "tree-operations review P1-1 guard: %s preserves a final source symlink as an entry",
    async (mode) => {
      const real = await tree("real");
      const source = join(root, "link");
      await symlink(real, source);
      await transfer({
        sources: [source],
        destination: join(real, "nested"),
        mode,
        overwrite: false,
      });
      expect((await stat(real)).isDirectory()).toBe(true);
      const { lstat } = await import("node:fs/promises");
      expect((await lstat(join(real, "nested", "link"))).isSymbolicLink()).toBe(true);
      expect(await readFile(join(real, "top.txt"), "utf8")).toBe("top");
    },
  );

  it.each([
    ["copy", false],
    ["copy", true],
    ["move", false],
    ["move", true],
  ] as const)(
    "tree-operations review P1-1 descendant: refuses aliased recursion %s overwrite=%s before any batch mutation",
    async (mode, overwrite) => {
      const real = join(root, "real");
      const source = join(real, "folder");
      const nested = join(source, "sub", "folder");
      await mkdir(nested, { recursive: true });
      await writeFile(join(nested, "keep.txt"), "nested bytes");
      await writeFile(join(source, "source.txt"), "source bytes");
      const earlier = join(root, "earlier.txt");
      await writeFile(earlier, "earlier bytes");
      const alias = join(root, "alias");
      await symlink(real, alias);
      const destination = join(alias, "folder", "sub");
      const reply = await transfer({
        sources: [earlier, source],
        destination,
        mode,
        overwrite,
      }).then(
        () => null,
        (error: unknown) => error,
      );

      expect(await readFile(join(nested, "keep.txt"), "utf8").catch(() => null)).toBe(
        "nested bytes",
      );
      expect(await readFile(join(source, "source.txt"), "utf8").catch(() => null)).toBe(
        "source bytes",
      );
      expect(await readFile(earlier, "utf8").catch(() => null)).toBe("earlier bytes");
      expect(await names(join(source, "sub"))).toEqual(["folder"]);
      expect(reply).toMatchObject({ message: expect.stringMatching(/into itself/) });
    },
  );

  it.each([
    ["copy", false],
    ["copy", true],
    ["move", false],
    ["move", true],
  ] as const)(
    "tree-operations review P0-1: refuses duplicate-basename %s overwrite=%s before any batch mutation",
    async (mode, overwrite) => {
      const left = join(root, "left");
      const right = join(root, "right");
      const destination = join(root, "into");
      await Promise.all([mkdir(left), mkdir(right), mkdir(destination)]);
      const leftSource = join(left, "README.md");
      const rightSource = join(right, "README.md");
      const sources = [leftSource, rightSource];
      await writeFile(leftSource, "left bytes");
      await writeFile(rightSource, "right bytes");
      if (overwrite) await writeFile(join(destination, "README.md"), "destination bytes");
      const reply = await transfer({ sources, destination, mode, overwrite }).then(
        () => null,
        (error: unknown) => error,
      );

      expect(await readFile(leftSource, "utf8").catch(() => null)).toBe("left bytes");
      expect(await readFile(rightSource, "utf8").catch(() => null)).toBe("right bytes");
      expect(await names(destination)).toEqual(overwrite ? ["README.md"] : []);
      if (overwrite)
        expect(await readFile(join(destination, "README.md"), "utf8")).toBe("destination bytes");
      expect(reply).toMatchObject({
        message: expect.stringMatching(/two entries named README\.md/),
      });
    },
  );

  it.each([
    ["copy", false],
    ["copy", true],
    ["move", false],
    ["move", true],
  ] as const)(
    "tree-operations review P1-1: refuses directory-alias %s overwrite=%s before any batch mutation",
    async (mode, overwrite) => {
      const real = join(root, "real");
      const destination = join(root, "alias");
      await mkdir(real);
      await symlink(real, destination);
      const earlier = join(root, "earlier.txt");
      const source = join(real, "keep.txt");
      await writeFile(earlier, "earlier bytes");
      await writeFile(source, "the only copy");
      const reply = await transfer({
        sources: [earlier, source],
        destination,
        mode,
        overwrite,
      }).then(
        () => null,
        (error: unknown) => error,
      );

      expect(await readFile(source, "utf8").catch(() => null)).toBe("the only copy");
      expect(await readFile(earlier, "utf8").catch(() => null)).toBe("earlier bytes");
      expect(await names(real)).toEqual(["keep.txt"]);
      expect(reply).toMatchObject({ message: expect.stringMatching(/into itself/) });
    },
  );

  it.each([
    ["copy", false],
    ["copy", true],
    ["move", false],
    ["move", true],
  ] as const)(
    "tree-operations native safety: refuses same-parent %s overwrite=%s before changing source bytes",
    async (mode, overwrite) => {
      const source = join(root, "keep.txt");
      await writeFile(source, "the only copy");
      const reply = await transfer({ sources: [source], destination: root, mode, overwrite }).then(
        () => null,
        (error: unknown) => error,
      );
      const bytes = await readFile(source, "utf8").catch(() => null);
      expect(bytes).toBe("the only copy");
      expect(reply).toMatchObject({ message: expect.stringMatching(/into itself/) });
    },
  );

  it("tree-operations native safety: refuses a later self-target before mutating an earlier source in the batch", async () => {
    const source = await tree("source");
    const unsafe = join(root, "keep.txt");
    await writeFile(unsafe, "keep");
    await expect(
      transfer({
        sources: [join(source, "top.txt"), unsafe],
        destination: root,
        mode: "move",
        overwrite: true,
      }),
    ).rejects.toThrow(/into itself/);
    expect(await readFile(unsafe, "utf8")).toBe("keep");
    expect(await readFile(join(source, "top.txt"), "utf8")).toBe("top");
    expect(await names(root)).not.toContain("top.txt");
  });

  it("refuses to put a directory inside itself", async () => {
    // `cp -r a a/b` is an infinite tree, and `mv` refuses it outright.
    const source = await tree("source");

    await expect(
      transfer({
        sources: [source],
        destination: join(source, "nested"),
        mode: "copy",
        overwrite: false,
      }),
    ).rejects.toThrow(/into itself/);
  });

  it("refuses a destination several levels inside the source", async () => {
    const source = await tree("source");
    await mkdir(join(source, "nested", "deeper"), { recursive: true });

    await expect(
      transfer({
        sources: [source],
        destination: join(source, "nested", "deeper"),
        mode: "move",
        overwrite: false,
      }),
    ).rejects.toThrow(/into itself/);
  });
});

describe("cancellation", () => {
  it("stops between entries, leaving whole ones behind", async () => {
    // A cancelled transfer must never leave a half-written file. Checking
    // between entries is what guarantees that.
    for (let i = 0; i < 6; i++) await writeFile(join(root, `f${i}.txt`), `${i}`);
    const destination = join(root, "into");
    await mkdir(destination);

    const controller = new AbortController();
    const outcome = await transfer({
      sources: Array.from({ length: 6 }, (_, i) => join(root, `f${i}.txt`)),
      destination,
      mode: "copy",
      overwrite: false,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 2) controller.abort();
      },
    });

    expect(outcome.moved).toBe(2);
    expect(await names(destination)).toEqual(["f0.txt", "f1.txt"]);
  });

  it("reports progress from zero to the total", async () => {
    await writeFile(join(root, "a.txt"), "a");
    await writeFile(join(root, "b.txt"), "b");
    const destination = join(root, "into");
    await mkdir(destination);

    const seen: string[] = [];
    await transfer({
      sources: [join(root, "a.txt"), join(root, "b.txt")],
      destination,
      mode: "copy",
      overwrite: false,
      onProgress: (done, total) => seen.push(`${done}/${total}`),
    });

    // The leading zero is what lets a caller show a bar before anything lands.
    expect(seen).toEqual(["0/2", "1/2", "2/2"]);
  });
});

describe("create", () => {
  it("creates a file, and the directories above it", async () => {
    // What `mkdir -p` gave the Qt build, and what makes typing a path into the
    // create dialog do what it looks like it does.
    await createEntry(join(root, "notes", "2026", "august.md"), "file");

    expect((await stat(join(root, "notes", "2026", "august.md"))).isFile()).toBe(true);
  });

  it("creates a directory and its parents", async () => {
    await createEntry(join(root, "a", "b", "c"), "directory");

    expect((await stat(join(root, "a", "b", "c"))).isDirectory()).toBe(true);
  });

  it("refuses to empty a file that is already there", async () => {
    // An accidental second Enter on the create dialog must not truncate.
    await writeFile(join(root, "kept.txt"), "important");

    await expect(createEntry(join(root, "kept.txt"), "file")).rejects.toThrow();
    expect(await readFile(join(root, "kept.txt"), "utf8")).toBe("important");
  });

  it("tree-create P2-1: rejects an existing directory and preserves its contents", async () => {
    const existing = await tree("there");
    await expect(createEntry(existing, "directory")).rejects.toMatchObject({
      code: "EEXIST",
      syscall: "mkdir",
      path: existing,
    });
    expect(await names(existing)).toEqual(["nested", "top.txt"]);
    expect(await readFile(join(existing, "nested", "deep.txt"), "utf8")).toBe("deep");
    expect(await readFile(join(existing, "top.txt"), "utf8")).toBe("top");
  });

  it("tree-create P2-1: rejects a file at the final directory target without changing its contents", async () => {
    const existing = join(root, "kept.txt");
    await writeFile(existing, "important");
    await expect(createEntry(existing, "directory")).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(existing, "utf8")).toBe("important");
  });

  it.each(["file", "directory"] as const)(
    "tree-create P2-1: preserves a blocking parent file when creating a %s",
    async (kind) => {
      const parent = join(root, "parent.txt");
      await writeFile(parent, "important");
      await expect(createEntry(join(parent, "nested", "child"), kind)).rejects.toMatchObject({
        code: "ENOTDIR",
      });
      expect(await readFile(parent, "utf8")).toBe("important");
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    "tree-create P2-1: returns the real permission error for a directory create without writing",
    async () => {
      const locked = join(root, "locked");
      await mkdir(locked);
      await chmod(locked, 0o500);
      try {
        await expect(createEntry(join(locked, "denied"), "directory")).rejects.toMatchObject({
          code: "EACCES",
          syscall: "mkdir",
          path: join(locked, "denied"),
        });
        expect(await names(locked)).toEqual([]);
      } finally {
        await chmod(locked, 0o700);
      }
    },
  );
});

describe("rename", () => {
  it("renames in place", async () => {
    await writeFile(join(root, "before.txt"), "x");

    const renamed = await renameEntry(join(root, "before.txt"), "after.txt");

    expect(renamed).toBe(join(root, "after.txt"));
    expect(await names(root)).toEqual(["after.txt"]);
  });

  it("refuses a name that is already taken, and says which", async () => {
    // `rename` would silently replace the other entry, and the other entry may
    // be the only copy of something.
    await writeFile(join(root, "a.txt"), "a");
    await writeFile(join(root, "b.txt"), "b");

    await expect(renameEntry(join(root, "a.txt"), "b.txt")).rejects.toThrow(
      /b\.txt already exists/,
    );
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("b");
  });

  it("accepts renaming an entry to the name it already has", async () => {
    await writeFile(join(root, "same.txt"), "x");

    await expect(renameEntry(join(root, "same.txt"), "same.txt")).resolves.toBe(
      join(root, "same.txt"),
    );
  });
});

describe("desktop entries", () => {
  it("reads only the main section, not an action's keys", async () => {
    // A `.desktop` file may carry several action groups with their own keys.
    // Reading the file flat would let an action's `Terminal=true` decide how
    // the MAIN command runs.
    const applications = join(root, "applications");
    await mkdir(applications, { recursive: true });
    await writeFile(
      join(applications, "thing.desktop"),
      "[Desktop Entry]\nName=Thing\nExec=thing %f\nTerminal=false\n\n[Desktop Action Edit]\nTerminal=true\nExec=vim %f\n",
    );

    const before = process.env["XDG_DATA_HOME"];
    process.env["XDG_DATA_HOME"] = root;
    process.env["XDG_DATA_DIRS"] = "";
    try {
      const keys = await desktopEntryKeys("thing.desktop");
      expect(keys.get("Terminal")).toBe("false");
      expect(keys.get("Exec")).toBe("thing %f");
    } finally {
      if (before === undefined) delete process.env["XDG_DATA_HOME"];
      else process.env["XDG_DATA_HOME"] = before;
    }
  });

  it("returns nothing for an entry that does not exist", async () => {
    expect((await desktopEntryKeys("nothing-here.desktop")).size).toBe(0);
  });
});
