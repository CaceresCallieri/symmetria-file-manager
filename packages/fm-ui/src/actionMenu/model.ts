import { type ActionInspection, isWindowsProgram } from "@symmetria/fm-core/fileActions";
import { basename } from "@symmetria/fm-core/pane";
import type { OperationTarget } from "../fileOps/targets.ts";

export type ActionId =
  | "open"
  | "open-with"
  | "run"
  | "run-terminal"
  | "run-with"
  | "terminal"
  | "extract-here"
  | "extract-to"
  | "cut"
  | "copy"
  | "paste"
  | "rename"
  | "compress"
  | "trash"
  | "properties";
const DESKTOP_ACTION_IDS = [
  "open-with",
  "run",
  "run-terminal",
  "run-with",
  "terminal",
  "extract-here",
  "extract-to",
  "compress",
  "properties",
] as const;
export type DesktopActionId = (typeof DESKTOP_ACTION_IDS)[number];
export function desktopActionFor(id: ActionId): DesktopActionId | null {
  return DESKTOP_ACTION_IDS.find((action) => action === id) ?? null;
}
export interface FileAction {
  readonly id: ActionId;
  readonly label: string;
  readonly key: string;
  readonly group: string;
  readonly unavailable: string | null;
}

const BACKEND_UNAVAILABLE = "Loading desktop actions…";
function action(
  id: ActionId,
  label: string,
  key: string,
  group: string,
  available = false,
): FileAction {
  return { id, label, key, group, unavailable: available ? null : BACKEND_UNAVAILABLE };
}
export function targetLabel(target: OperationTarget): string {
  return target.paths.length === 1
    ? basename(target.paths[0] ?? "/")
    : `${target.paths.length} selected items`;
}

/** Filename hints only describe unavailable actions. They never authorize execution. */
export function actionsFor(
  target: OperationTarget,
  hasClipboard: boolean,
  inspection: ActionInspection | null = null,
  error: string | null = null,
): readonly FileAction[] {
  const single = target.paths.length === 1;
  const path = target.paths[0] ?? "";
  const folder = target.cursor?.isDirectory === true;
  const protectedRoot =
    target.protectedPath !== undefined && target.paths.includes(target.protectedPath);
  const opening = openingActions(folder, path, inspection);
  const archives =
    !folder &&
    target.paths.length > 0 &&
    target.paths.every((name) =>
      /\.(zip|tar(\.(gz|xz|bz2|zst))?|tgz|tbz2?|txz|7z|rar)$/i.test(name),
    );
  const clipboard = action(
    "paste",
    single && folder ? "Paste into Folder" : "Paste Here",
    "p",
    "clipboard",
    hasClipboard,
  );
  return [
    ...(single ? opening : []),
    ...(archives
      ? [
          action("extract-here", "Extract Here", "e", "archive"),
          action("extract-to", "Extract To…", "E", "archive"),
        ]
      : []),
    action("cut", "Cut", "x", "clipboard", !protectedRoot),
    action("copy", "Copy", "y", "clipboard", true),
    { ...clipboard, unavailable: hasClipboard ? null : "The clipboard is empty." },
    ...(single ? [action("rename", "Rename…", "n", "modify", !protectedRoot)] : []),
    action("compress", "Compress…", "c", "modify"),
    action("trash", "Move to Trash", "d", "modify", !protectedRoot),
    action("properties", "Properties…", "i", "properties"),
  ]
    .map((item) => desktopAvailability(item, inspection, error))
    .map((item) =>
      protectedRoot && ["cut", "rename", "trash"].includes(item.id)
        ? { ...item, unavailable: "The tree root is protected." }
        : item,
    );
}

function openingActions(
  folder: boolean,
  path: string,
  inspection: ActionInspection | null,
): FileAction[] {
  const opening = [action("open", "Open", "⇧ Enter", "open", true)];
  if (folder) {
    opening.push(action("terminal", "Open Terminal Here", "t", "open"));
    return opening;
  }
  opening.push(action("open-with", "Open With…", "o", "open"));
  if (isWindowsProgram(path)) {
    opening.push(action("run-with", "Run With…", "w", "open"));
    return opening;
  }
  if (inspection?.entries[0]?.runnable || /\.(sh|bash|py)$/i.test(path))
    opening.push(
      action("run", "Run", "r", "open"),
      action("run-terminal", "Run in Terminal", "t", "open"),
    );
  return opening;
}
function desktopAvailability(
  item: FileAction,
  inspection: ActionInspection | null,
  error: string | null,
): FileAction {
  if (desktopActionFor(item.id) === null) return item;
  if (!inspection) return { ...item, unavailable: error ?? BACKEND_UNAVAILABLE };
  return { ...item, unavailable: desktopReason(item.id, inspection) };
}
function desktopReason(id: ActionId, inspection: ActionInspection): string | null {
  const reasons = {
    "open-with": () => applicationReason(inspection),
    run: () =>
      inspection.entries[0]?.runnable
        ? null
        : "This file has no executable permission or interpreter line.",
    "run-terminal": () => desktopReason("run", inspection) ?? desktopReason("terminal", inspection),
    terminal: () => (inspection.tools.terminal ? null : "No supported terminal is installed."),
    "run-with": () => windowsReason(inspection),
  };
  if (["extract-here", "extract-to", "compress"].includes(id))
    return inspection.tools.archives
      ? null
      : "Install bsdtar (libarchive) and GNU coreutils for archives.";
  return Object.entries(reasons).find(([action]) => action === id)?.[1]() ?? null;
}

function applicationReason(inspection: ActionInspection): string | null {
  return inspection.tools.gio && inspection.applications.length > 0
    ? null
    : (inspection.applicationError ??
        "No available application was found. Install GIO and an application.");
}
function windowsReason(inspection: ActionInspection): string | null {
  const tools = inspection.tools;
  if ([tools.wine, tools.bottles && inspection.bottles.length > 0, tools.lutris].some(Boolean))
    return null;
  return inspection.bottleError ?? "Install Wine or Bottles with a configured bottle.";
}
