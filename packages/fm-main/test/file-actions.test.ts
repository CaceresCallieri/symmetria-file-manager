import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActionRequest, ARCHIVE_FORMATS } from "@symmetria/fm-core/fileActions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchDesktopFile } from "../src/fileActions/applications.ts";
import { archiveAction } from "../src/fileActions/archives.ts";
import { launch } from "../src/fileActions/launch.ts";
import {
  type ActionProcesses,
  actionProcesses,
  type ProcessOptions,
} from "../src/fileActions/process.ts";
import { fileActionService } from "../src/fileActions/service.ts";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fm-actions-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
function request(
  action: ActionRequest["action"],
  paths: readonly string[],
  options: Partial<ActionRequest> = {},
): ActionRequest {
  return {
    id: "test-action",
    paths,
    action,
    choice: "",
    destination: "",
    format: "zip",
    prefix: "",
    makeExecutable: false,
    ...options,
  };
}
function recordingProcesses(available: readonly string[]) {
  const calls: { command: string; args: readonly string[]; options: ProcessOptions }[] = [];
  const processes: ActionProcesses = {
    find: async (command) => (available.includes(command) ? `/tools/${command}` : null),
    run: async (command, args, options = {}) => {
      calls.push({ command, args, options });
      return args.includes("bottles") ? '{"Gaming":{}}' : "";
    },
    dispatch: async (command, args, options = {}) => {
      calls.push({ command, args, options });
    },
    start: async (command, args, options = {}) => {
      calls.push({ command, args, options });
    },
  };
  return { processes, calls };
}
describe("desktop execution", () => {
  it("reports an actionable error for a broken desktop executable", async () => {
    const desktop = join(root, "broken.desktop");
    await writeFile(
      desktop,
      `[Desktop Entry]\nType=Application\nName=Broken\nExec=${root}/missing-executable %f\n`,
    );
    await expect(
      launchDesktopFile(actionProcesses, desktop, join(root, "file.txt")),
    ).rejects.toThrow("Check the application's installation and desktop entry");
  });
  it("requires explicit permission and runs a real script with a literal hostile filename", async () => {
    const marker = join(root, "started");
    const script = join(root, "program ' $(touch UNEXPECTED).sh");
    await writeFile(script, `#!/bin/sh\nprintf done > '${marker}'\n`, { mode: 0o600 });
    await expect(launch(actionProcesses, request("run", [script]))).rejects.toThrow(
      "Allow executable",
    );
    expect((await stat(script)).mode & 0o100).toBe(0);
    await launch(actionProcesses, request("run", [script], { makeExecutable: true }));
    await vi.waitFor(async () => expect(await readFile(marker, "utf8")).toBe("done"));
    expect(await readdir(root)).not.toContain("UNEXPECTED");
  });
  it("passes terminal commands as arguments and retains program output", async () => {
    const script = join(root, "script.sh");
    await writeFile(script, "#!/bin/sh\nexit 4\n");
    await chmod(script, 0o700);
    const { processes, calls } = recordingProcesses(["kitty"]);
    await launch(processes, request("run-terminal", [script]));
    expect(calls[0]?.command).toBe("/tools/kitty");
    expect(calls[0]?.args.slice(-2)).toEqual(["symmetria-run", script]);
    expect(calls[0]?.args).toContain(
      '"$@"; status=$?; printf "\\nExit status: %s. Press Enter to close.\\n" "$status"; read -r answer; exit "$status"',
    );
    await launch(processes, request("terminal", [root]));
    expect(calls[1]?.options.cwd).toBe(root);
  });
  it("preserves Wine MSI arguments, bottle choice, prefix and Lutris command quoting", async () => {
    const program = join(root, "game ' with spaces.msi");
    await writeFile(program, "windows program");
    const { processes, calls } = recordingProcesses(["wine", "bottles-cli", "lutris"]);
    await launch(processes, request("wine", [program], { prefix: join(root, "prefix") }));
    expect(calls[0]?.args).toEqual(["msiexec", "/i", program]);
    expect(calls[0]?.options.env?.["WINEPREFIX"]).toBe(join(root, "prefix"));
    await launch(processes, request("bottles", [program], { choice: "Gaming" }));
    expect(calls.at(-1)?.args).toEqual(["run", "-b", "Gaming", "-e", program]);
    await expect(
      launch(processes, request("bottles", [program], { choice: "Missing" })),
    ).rejects.toThrow("no longer available");
    await launch(processes, request("lutris", [program]));
    const command = calls.at(-1)?.args[1] ?? "";
    const parsed = await actionProcesses.run("python3", [
      "-c",
      "import json,shlex,sys; print(json.dumps(shlex.split(sys.argv[1])))",
      command,
    ]);
    expect(JSON.parse(parsed)).toEqual(["env", "/tools/wine", "msiexec", "/i", program]);
  });
  it("uses a scoped Flatpak folder grant for Bottles", async () => {
    const program = join(root, "game.exe");
    await writeFile(program, "windows program");
    const { processes, calls } = recordingProcesses(["flatpak"]);
    await launch(processes, request("bottles", [program], { choice: "Gaming" }));
    expect(calls.at(-1)?.args).toEqual([
      "run",
      `--filesystem=${root}`,
      "--command=bottles-cli",
      "com.usebottles.bottles",
      "run",
      "-b",
      "Gaming",
      "-e",
      program,
    ]);
  });
  it("replies promptly for a long-lived GIO application with one literal file argument", async () => {
    const data = join(root, "data");
    await mkdir(join(data, "applications"), { recursive: true });
    vi.stubEnv("XDG_DATA_HOME", data);
    vi.stubEnv("XDG_DATA_DIRS", join(root, "empty"));
    const runner = join(root, "own program");
    const marker = join(root, "opened");
    const file = join(root, "document ' special.txt");
    await writeFile(file, "text");
    const finished = join(root, "finished");
    await writeFile(
      runner,
      `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\nsleep 2\nprintf done > '${finished}'\n`,
      { mode: 0o700 },
    );
    await writeFile(
      join(data, "applications", "test.desktop"),
      `[Desktop Entry]\nType=Application\nName=Own application\nExec="${runner}" %f\nMimeType=text/plain;\n`,
    );
    const service = fileActionService(actionProcesses);
    const inspection = await service.inspect([file]);
    expect(inspection.applications.map((app) => app.id)).toEqual(["test.desktop"]);
    const started = Date.now();
    await service.execute(
      request("application", [file], { choice: "test.desktop" }),
      new AbortController().signal,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    await expect(readFile(finished)).rejects.toThrow();
    await vi.waitFor(async () => expect(await readFile(marker, "utf8")).toBe(file));
    await expect(
      service.execute(
        request("application", [file], { choice: "../bad.desktop" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("no longer installed");
    await vi.waitFor(async () => expect(await readFile(finished, "utf8")).toBe("done"), {
      timeout: 4_000,
    });
  });
  it("keeps unreadable metadata available and does not query managers for ordinary targets", async () => {
    const file = join(root, "private.txt");
    await writeFile(file, "private", { mode: 0o000 });
    const { processes, calls } = recordingProcesses(["flatpak", "bottles-cli"]);
    const service = fileActionService(processes);
    const inspected = await service.inspect([file]);
    expect(inspected.entries[0]?.mode).toBe(0);
    expect(inspected.entries[0]?.runnable).toBe(false);
    await service.inspect([root]);
    expect(calls).toEqual([]);
  });
  it("caches Windows inspection and revalidates the bottle at launch", async () => {
    const program = join(root, "game.exe");
    await writeFile(program, "windows");
    const { processes, calls } = recordingProcesses(["bottles-cli"]);
    const service = fileActionService(processes);
    await service.inspect([program]);
    await service.inspect([program]);
    expect(calls.filter((call) => call.args.includes("list"))).toHaveLength(1);
    await service.execute(
      request("bottles", [program], { choice: "Gaming" }),
      new AbortController().signal,
    );
    expect(calls.filter((call) => call.args.includes("list"))).toHaveLength(2);
  });
  it("detaches a long-lived Bottles launcher after validating the bottle", async () => {
    const tools = join(root, "tools");
    await mkdir(tools);
    const marker = join(root, "bottle-started");
    const finished = join(root, "bottle-finished");
    const tool = join(tools, "bottles-cli");
    await writeFile(
      tool,
      `#!/bin/sh\nif [ "$1" = --json ]; then printf '{"Gaming":{}}'; exit; fi\nprintf '%s' "$5" > '${marker}'\nsleep 2\nprintf done > '${finished}'\n`,
      { mode: 0o700 },
    );
    vi.stubEnv("PATH", `${tools}:${process.env["PATH"] ?? ""}`);
    const program = join(root, "game.exe");
    await writeFile(program, "windows");
    const started = Date.now();
    await launch(actionProcesses, request("bottles", [program], { choice: "Gaming" }));
    expect(Date.now() - started).toBeLessThan(1_000);
    await vi.waitFor(async () => expect(await readFile(marker, "utf8")).toBe(program));
    await vi.waitFor(async () => expect(await readFile(finished, "utf8")).toBe("done"), {
      timeout: 4_000,
    });
  });
  it("does not launch after cancellation during tool discovery", async () => {
    const controller = new AbortController();
    const { processes, calls } = recordingProcesses(["kitty"]);
    const cancelled: ActionProcesses = {
      ...processes,
      find: async (command) => {
        controller.abort();
        return processes.find(command);
      },
    };
    await expect(
      launch(cancelled, request("terminal", [root]), controller.signal),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it("reports unsupported colon paths for Flatpak without launching", async () => {
    const folder = join(root, "Game: one");
    await mkdir(folder);
    const program = join(folder, "game.exe");
    await writeFile(program, "windows");
    const { processes, calls } = recordingProcesses(["flatpak"]);
    await expect(
      launch(processes, request("bottles", [program], { choice: "Gaming" })),
    ).rejects.toThrow("use native Bottles");
    expect(calls.some((call) => call.args.includes("-e"))).toBe(false);
  });
});
describe("real archive operations", () => {
  it("rejects a symlink chain that escapes after kernel resolution of dot-dot", async () => {
    const source = join(root, "source");
    await mkdir(source);
    await symlink(".", join(source, "s"));
    await symlink("s/../SECRET", join(source, "l"));
    await writeFile(join(root, "SECRET"), "private");
    const archive = join(root, "escape.tar");
    await actionProcesses.run("bsdtar", ["-cf", archive, "-C", source, "s", "l"]);
    await expect(
      archiveAction(actionProcesses, request("extract", [archive]), new AbortController().signal),
    ).rejects.toThrow("link outside");
    expect(await readdir(root)).not.toContain("escape");
    expect((await readdir(root)).filter((name) => name.startsWith(".symmetria"))).toEqual([]);
    expect(await readFile(join(root, "SECRET"), "utf8")).toBe("private");
  });
  it.each(ARCHIVE_FORMATS)(
    "round trips %s with spaces and option-like filenames",
    async (format) => {
      const source = join(root, "sources");
      const output = join(root, "output");
      await mkdir(source);
      await mkdir(output);
      const file = join(source, "-report $(touch BAD).txt");
      await writeFile(file, "archive contents");
      const archive = join(root, `round trip.${format}`);
      await archiveAction(
        actionProcesses,
        request("compress", [file], { destination: archive, format }),
        new AbortController().signal,
      );
      const outputs = await archiveAction(
        actionProcesses,
        request("extract", [archive], { destination: output }),
        new AbortController().signal,
      );
      expect(await readFile(join(outputs[0] ?? "", "-report $(touch BAD).txt"), "utf8")).toBe(
        "archive contents",
      );
      expect(await readdir(root)).not.toContain("BAD");
      expect((await stat(outputs[0] ?? "")).mode & 0o777).toBe(0o777 & ~process.umask());
    },
  );
  it("extracts an internal dangling symlink without following it", async () => {
    const source = join(root, "source");
    await mkdir(source);
    await symlink("missing", join(source, "link"));
    const archive = join(root, "dangling.tar");
    await actionProcesses.run("bsdtar", ["-cf", archive, "-C", source, "link"]);
    const outputs = await archiveAction(
      actionProcesses,
      request("extract", [archive]),
      new AbortController().signal,
    );
    expect(await readlink(join(outputs[0] ?? "", "link"))).toBe("missing");
  });
  it("preserves existing archive files, folders and dangling links", async () => {
    const file = join(root, "file.txt");
    await writeFile(file, "contents");
    const archive = join(root, "file.zip");
    await archiveAction(
      actionProcesses,
      request("compress", [file], { destination: archive }),
      new AbortController().signal,
    );
    const before = await readFile(archive);
    await expect(
      archiveAction(
        actionProcesses,
        request("compress", [file], { destination: archive }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("already exists");
    expect(await readFile(archive)).toEqual(before);
    await mkdir(join(root, "file"));
    await writeFile(join(root, "file", "existing"), "preserve");
    await expect(
      archiveAction(actionProcesses, request("extract", [archive]), new AbortController().signal),
    ).rejects.toThrow("already exists");
    expect(await readFile(join(root, "file", "existing"), "utf8")).toBe("preserve");
    const dangling = join(root, "dangling.zip");
    await symlink(join(root, "absent"), dangling);
    await expect(
      archiveAction(
        actionProcesses,
        request("compress", [file], { destination: dangling }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("already exists");
  });
  it("rejects traversal and escaping symlinks, with no published output", async () => {
    const source = join(root, "source");
    const output = join(root, "output");
    await mkdir(source);
    await mkdir(output);
    await writeFile(join(source, "payload"), "bad");
    const traversal = join(root, "traversal.tar");
    await actionProcesses.run("bsdtar", [
      "-cf",
      traversal,
      "-s",
      "|^payload|../escaped|",
      "-C",
      source,
      "payload",
    ]);
    await expect(
      archiveAction(
        actionProcesses,
        request("extract", [traversal], { destination: output }),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(await readdir(output)).toEqual([]);
    expect(await readdir(root)).not.toContain("escaped");
    await symlink("/etc/passwd", join(source, "outside"));
    const linked = join(root, "linked.tar");
    await actionProcesses.run("bsdtar", ["-cf", linked, "-C", source, "outside"]);
    await expect(
      archiveAction(
        actionProcesses,
        request("extract", [linked], { destination: output }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("link outside");
    expect(await readdir(output)).toEqual([]);
  });
  it("cleans failed and cancelled jobs and refuses an output within its source", async () => {
    const archive = join(root, "broken.zip");
    await writeFile(archive, "not an archive");
    await expect(
      archiveAction(actionProcesses, request("extract", [archive]), new AbortController().signal),
    ).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith(".symmetria"))).toEqual([]);
    await expect(
      archiveAction(
        actionProcesses,
        request("compress", [root], { destination: join(root, "inside.zip") }),
        new AbortController().signal,
      ),
    ).rejects.toThrow("outside its source");
    const controller = new AbortController();
    const processes: ActionProcesses = {
      ...actionProcesses,
      run: async (_, __, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          });
          controller.abort();
        }),
    };
    await expect(
      archiveAction(processes, request("extract", [archive]), controller.signal),
    ).rejects.toThrow("cancelled");
    expect((await readdir(root)).filter((name) => name.startsWith(".symmetria"))).toEqual([]);
  });
});
