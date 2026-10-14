import { constants } from "node:fs";
import { access, chmod, lstat, open, readlink, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord } from "@symmetria/fm-core/contract";
import type { ActionRequest, FileMetadata } from "@symmetria/fm-core/fileActions";
import { launchApplication } from "./applications.ts";
import { type ActionProcesses, requireTool } from "./process.ts";

export async function fileMetadata(path: string): Promise<FileMetadata> {
  const own = await lstat(path);
  const info = own.isSymbolicLink() ? await stat(path).catch(() => own) : own;
  const executable =
    info.isFile() &&
    (await access(path, constants.X_OK).then(
      () => true,
      () => false,
    ));
  const link = await readlink(path).catch(() => null);
  const script = info.isFile() && !executable ? await hasInterpreterLine(path) : false;
  return {
    path,
    kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
    size: info.size,
    modified: info.mtimeMs,
    mode: info.mode & 0o7777,
    executable,
    runnable: executable || script,
    link,
  };
}
async function hasInterpreterLine(path: string): Promise<boolean> {
  try {
    const handle = await open(path, "r");
    try {
      const head = Buffer.alloc(2);
      await handle.read(head, 0, 2, 0);
      return head.toString() === "#!";
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

interface Terminal {
  readonly command: string;
  readonly args: readonly string[];
}
export async function terminalFor(processes: ActionProcesses): Promise<Terminal | null> {
  const configured = process.env["TERMINAL"];
  const names = [
    ...(configured ? [configured] : []),
    "xdg-terminal-exec",
    "kitty",
    "foot",
    "konsole",
    "alacritty",
    "wezterm",
    "gnome-terminal",
    "xterm",
  ];
  for (const name of names) {
    const command = await processes.find(name);
    if (command) {
      const base = command.slice(command.lastIndexOf("/") + 1);
      const prefixes = {
        wezterm: ["start", "--"],
        "gnome-terminal": ["--"],
        "xdg-terminal-exec": ["--"],
        foot: [],
        kitty: [],
      };
      const args = Object.entries(prefixes).find(([name]) => name === base)?.[1] ?? ["-e"];
      return { command, args };
    }
  }
  return null;
}
export async function bottlesCommand(processes: ActionProcesses): Promise<Terminal | null> {
  const native = await processes.find("bottles-cli");
  if (native) return { command: native, args: [] };
  const flatpak = await processes.find("flatpak");
  if (!flatpak) return null;
  try {
    await processes.run(flatpak, ["info", "com.usebottles.bottles"]);
    return { command: flatpak, args: ["run", "--command=bottles-cli", "com.usebottles.bottles"] };
  } catch {
    return null;
  }
}
export async function bottleNames(processes: ActionProcesses): Promise<string[]> {
  const command = await bottlesCommand(processes);
  if (!command) return [];
  const raw: unknown = JSON.parse(
    await processes.run(command.command, [...command.args, "--json", "list", "bottles"]),
  );
  if (!isRecord(raw)) throw new Error("Bottles returned an invalid bottle list.");
  return Object.keys(raw);
}
function quoteArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export async function launch(
  processes: ActionProcesses,
  request: ActionRequest,
  signal = new AbortController().signal,
): Promise<void> {
  signal.throwIfAborted();
  const path = request.paths[0];
  if (!path) throw new Error("Select one entry.");
  const metadata = await fileMetadata(path);
  const cwd = metadata.kind === "directory" ? path : dirname(path);
  if (request.action === "application") {
    await launchApplication(processes, path, request.choice, { signal });
    return;
  }
  if (request.action === "terminal") {
    if (metadata.kind !== "directory") throw new Error("Select a directory.");
    const terminal = await terminalFor(processes);
    if (!terminal) throw new Error("No supported terminal is installed.");
    signal.throwIfAborted();
    await processes.start(
      terminal.command,
      [...terminal.args, process.env["SHELL"] ?? "/bin/bash"],
      { cwd },
    );
    return;
  }
  if (metadata.kind !== "file") throw new Error("Select a regular file.");
  if (request.action === "run" || request.action === "run-terminal") {
    await runNative(processes, request, metadata, path, cwd, signal);
    return;
  }
  await runWindows(processes, request, path, cwd, signal);
}
async function runNative(
  processes: ActionProcesses,
  request: ActionRequest,
  metadata: FileMetadata,
  path: string,
  cwd: string,
  signal: AbortSignal,
) {
  if (!metadata.runnable)
    throw new Error("The file has no executable permission or interpreter line.");
  if (!metadata.executable) {
    if (!request.makeExecutable)
      throw new Error("Allow executable permission before running this file.");
    signal.throwIfAborted();
    await chmod(path, metadata.mode | 0o100);
  }
  signal.throwIfAborted();
  if (request.action === "run") {
    await processes.start(path, [], { cwd });
    return;
  }
  const terminal = await terminalFor(processes);
  if (!terminal) throw new Error("No supported terminal is installed.");
  signal.throwIfAborted();
  // The script is fixed. The selected path travels as an argument, never shell source.
  const hold =
    '"$@"; status=$?; printf "\\nExit status: %s. Press Enter to close.\\n" "$status"; read -r answer; exit "$status"';
  await processes.start(
    terminal.command,
    [...terminal.args, "/bin/sh", "-c", hold, "symmetria-run", path],
    { cwd },
  );
  return;
}
async function runWindows(
  processes: ActionProcesses,
  request: ActionRequest,
  path: string,
  cwd: string,
  signal: AbortSignal,
) {
  if (!/\.(exe|msi)$/i.test(path)) throw new Error("Select a Windows .exe or .msi file.");
  if (request.action === "bottles") {
    await launchBottle(processes, request, path, cwd, signal);
    return;
  }
  const wine = await requireTool(processes, "wine");
  const args = /\.msi$/i.test(path) ? ["msiexec", "/i", path] : [path];
  const env = { ...process.env };
  if (request.prefix !== "") env["WINEPREFIX"] = request.prefix;
  signal.throwIfAborted();
  if (request.action === "wine") {
    await processes.start(wine, args, { cwd, env });
    return;
  }
  if (request.action !== "lutris") throw new Error("Invalid launch action.");
  // Lutris --exec does not inherit a saved game's runner configuration.
  // The label and dialog explicitly identify this as system Wine with this prefix.
  const command = [
    "env",
    ...(request.prefix ? [`WINEPREFIX=${request.prefix}`] : []),
    wine,
    ...args,
  ]
    .map(quoteArgument)
    .join(" ");
  const lutris = await requireTool(processes, "lutris");
  signal.throwIfAborted();
  await processes.start(lutris, ["--exec", command], { cwd });
}

async function launchBottle(
  processes: ActionProcesses,
  request: ActionRequest,
  path: string,
  cwd: string,
  signal: AbortSignal,
) {
  if (!(await bottleNames(processes)).includes(request.choice))
    throw new Error("The selected bottle is no longer available.");
  const command = await bottlesCommand(processes);
  if (!command) throw new Error("Bottles is not installed.");
  const args = [...command.args];
  if (args.length) {
    if (cwd.includes(":"))
      throw new Error(
        "Flatpak Bottles cannot grant a folder whose path contains a colon. Move the program or use native Bottles.",
      );
    args.splice(1, 0, `--filesystem=${cwd}`);
  }
  signal.throwIfAborted();
  await processes.start(command.command, [...args, "run", "-b", request.choice, "-e", path], {
    cwd,
  });
  return;
}
