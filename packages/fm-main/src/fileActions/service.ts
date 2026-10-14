import {
  type ActionInspection,
  type ActionReply,
  type ActionRequest,
  isWindowsProgram,
} from "@symmetria/fm-core/fileActions";
import { installedApplications } from "./applications.ts";
import { archiveAction } from "./archives.ts";
import { bottleNames, bottlesCommand, fileMetadata, launch, terminalFor } from "./launch.ts";
import { type ActionProcesses, actionProcesses } from "./process.ts";

export interface FileActionService {
  inspect(paths: readonly string[]): Promise<ActionInspection>;
  execute(request: ActionRequest, signal: AbortSignal): Promise<ActionReply>;
}
function cachedQuery<T>(load: (key: string) => Promise<T>, limit = 32) {
  const cache = new Map<string, { expires: number; work: Promise<T> }>();
  return (key: string): Promise<T> => {
    const existing = cache.get(key);
    if (existing && existing.expires > Date.now()) return existing.work;
    if (cache.size >= limit) cache.clear();
    const work = load(key).catch((cause) => {
      cache.delete(key);
      throw cause;
    });
    cache.set(key, { expires: Date.now() + 30_000, work });
    return work;
  };
}
async function inspectTools(
  processes: ActionProcesses,
  windows: boolean,
): Promise<ActionInspection["tools"]> {
  const [gio, terminal, archiveTool, mv] = await Promise.all([
    processes.find("gio"),
    terminalFor(processes),
    processes.find("bsdtar"),
    processes.find("mv"),
  ]);
  const managers = windows
    ? await inspectManagers(processes)
    : { wine: false, bottles: false, lutris: false };
  return {
    gio: gio !== null,
    terminal: terminal !== null,
    archives: archiveTool !== null && mv !== null,
    ...managers,
  };
}
async function inspectManagers(
  processes: ActionProcesses,
): Promise<Pick<ActionInspection["tools"], "wine" | "bottles" | "lutris">> {
  const [wine, bottles, lutris] = await Promise.all([
    processes.find("wine"),
    bottlesCommand(processes),
    processes.find("lutris"),
  ]);
  return {
    wine: wine !== null,
    bottles: bottles !== null,
    lutris: lutris !== null && wine !== null,
  };
}
async function optionalList<T>(
  enabled: boolean,
  key: string,
  query: (key: string) => Promise<T[]>,
): Promise<{ items: T[]; error: string | null }> {
  if (!enabled) return { items: [], error: null };
  try {
    return { items: await query(key), error: null };
  } catch (cause) {
    return { items: [], error: String(cause) };
  }
}
function isSingleFile(entries: ActionInspection["entries"]): boolean {
  return entries.length === 1 && entries[0]?.kind === "file";
}
function isWindowsTarget(paths: readonly string[]): boolean {
  return paths.length === 1 && isWindowsProgram(paths[0] ?? "");
}
export function fileActionService(processes: ActionProcesses = actionProcesses): FileActionService {
  const toolsFor = cachedQuery((kind) => inspectTools(processes, kind === "windows"), 2);
  const applicationsFor = cachedQuery((path) => installedApplications(processes, path));
  const bottlesFor = cachedQuery(() => bottleNames(processes), 1);
  return {
    async inspect(paths) {
      const entries = await Promise.all(paths.map(fileMetadata));
      const windows = isWindowsTarget(paths);
      const tools = await toolsFor(windows ? "windows" : "other");
      const [applications, bottles] = await Promise.all([
        optionalList(isSingleFile(entries) && tools.gio, paths[0] ?? "", applicationsFor),
        optionalList(windows && tools.bottles, "bottles", bottlesFor),
      ]);
      return {
        entries,
        applications: applications.items,
        bottles: bottles.items,
        tools,
        applicationError: applications.error,
        bottleError: bottles.error,
      };
    },
    async execute(request, signal) {
      signal.throwIfAborted();
      if (request.action === "extract" || request.action === "compress") {
        const outputs = await archiveAction(processes, request, signal);
        return {
          message: `${request.action === "extract" ? "Extracted" : "Created"} ${outputs.length} ${outputs.length === 1 ? "archive output" : "archive outputs"}.`,
          outputs,
        };
      }
      await launch(processes, request, signal);
      return {
        message: "Started the selected application. Its own window reports subsequent errors.",
        outputs: [],
      };
    },
  };
}
