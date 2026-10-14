import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationChoice } from "@symmetria/fm-core/fileActions";
import { parseMainSection } from "../desktopEntry.ts";
import { dataDirectories } from "../xdg.ts";
import { type ActionProcesses, type ProcessOptions, requireTool } from "./process.ts";

interface DesktopApplication extends ApplicationChoice {
  readonly desktopFile: string;
}
async function desktopFiles(
  directory: string,
  prefix = "",
): Promise<{ id: string; path: string }[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: { id: string; path: string }[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await desktopFiles(path, `${prefix}${entry.name}-`)));
    else if (entry.name.endsWith(".desktop")) files.push({ id: `${prefix}${entry.name}`, path });
  }
  return files;
}
export async function installedApplications(
  processes: ActionProcesses,
  path: string,
): Promise<DesktopApplication[]> {
  const mimeTool = await processes.find("xdg-mime");
  const mime =
    mimeTool === null
      ? ""
      : (await processes.run(mimeTool, ["query", "filetype", path]).catch(() => "")).trim();
  const defaultId =
    mimeTool === null || mime === ""
      ? ""
      : (await processes.run(mimeTool, ["query", "default", mime]).catch(() => "")).trim();
  const seen = new Set<string>();
  const applications: DesktopApplication[] = [];
  for (const directory of dataDirectories())
    for (const file of await desktopFiles(join(directory, "applications"))) {
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      const application = await desktopApplication(processes, file, mime, defaultId);
      if (application) applications.push(application);
    }
  return applications.sort(
    (a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name),
  );
}
async function desktopApplication(
  processes: ActionProcesses,
  file: { id: string; path: string },
  mime: string,
  defaultId: string,
): Promise<DesktopApplication | null> {
  const keys = parseMainSection(await readFile(file.path, "utf8").catch(() => ""));
  const name = keys.get("Name");
  if (!name || !keys.get("Exec")) return null;
  if (
    [
      keys.get("Type") !== "Application",
      keys.get("Hidden") === "true",
      keys.get("NoDisplay") === "true",
    ].some(Boolean)
  )
    return null;
  const tryExec = keys.get("TryExec");
  if (tryExec && !(await processes.find(tryExec))) return null;
  const recommended =
    file.id === defaultId ||
    (mime !== "" && (keys.get("MimeType") ?? "").split(";").includes(mime));
  return { id: file.id, name, recommended, desktopFile: file.path };
}
export async function launchApplication(
  processes: ActionProcesses,
  path: string,
  id: string,
  options: ProcessOptions = {},
): Promise<void> {
  const application = (await installedApplications(processes, path)).find((app) => app.id === id);
  if (!application) throw new Error("The selected application is no longer installed.");
  await launchDesktopFile(processes, application.desktopFile, path, options);
}
export async function launchDesktopFile(
  processes: ActionProcesses,
  desktopFile: string,
  path: string,
  options: ProcessOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  // GIO owns field codes, quoting and Terminal=true. Its application inherits
  // ignored stdio, so its lifetime cannot hold this launcher reply open.
  await processes.dispatch(
    await requireTool(processes, "gio"),
    ["launch", desktopFile, path],
    options,
  );
}
