import { decodePath, failure, isRecord, type Result, success } from "./contract.ts";
import { isAncestorPath } from "./overview/model.ts";

export const ARCHIVE_FORMATS = ["zip", "tar", "tar.gz", "tar.xz", "tar.zst"] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];
export type LaunchKind =
  | "application"
  | "run"
  | "run-terminal"
  | "terminal"
  | "wine"
  | "bottles"
  | "lutris";
export interface ApplicationChoice {
  readonly id: string;
  readonly name: string;
  readonly recommended: boolean;
}
export interface FileMetadata {
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
  readonly size: number;
  readonly modified: number;
  readonly mode: number;
  readonly executable: boolean;
  readonly runnable: boolean;
  readonly link: string | null;
}
export interface ActionInspection {
  readonly entries: readonly FileMetadata[];
  readonly applications: readonly ApplicationChoice[];
  readonly bottles: readonly string[];
  readonly tools: {
    readonly gio: boolean;
    readonly terminal: boolean;
    readonly wine: boolean;
    readonly bottles: boolean;
    readonly lutris: boolean;
    readonly archives: boolean;
  };
  readonly applicationError: string | null;
  readonly bottleError: string | null;
}
export interface ActionRequest {
  readonly id: string;
  readonly paths: readonly string[];
  readonly action: LaunchKind | "extract" | "compress";
  readonly choice: string;
  readonly destination: string;
  readonly format: ArchiveFormat;
  readonly makeExecutable: boolean;
  readonly prefix: string;
}
export interface ActionReply {
  readonly message: string;
  readonly outputs: readonly string[];
}

export function decodeActionPaths(raw: unknown): Result<{ paths: readonly string[] }> {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.paths) ||
    raw.paths.length < 1 ||
    raw.paths.length > 1000
  )
    return failure("invalid_request", "Select between 1 and 1000 entries.");
  const paths: string[] = [];
  for (const path of raw.paths) {
    const decoded = decodePath(path);
    if (!decoded.ok) return decoded;
    paths.push(decoded.value);
  }
  return success({ paths });
}
export function decodeActionId(raw: unknown): Result<{ id: string }> {
  if (!isRecord(raw) || typeof raw.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(raw.id))
    return failure("invalid_request", "Invalid action identifier.");
  return success({ id: raw.id });
}
const ACTION_KINDS = [
  "application",
  "run",
  "run-terminal",
  "terminal",
  "wine",
  "bottles",
  "lutris",
  "extract",
  "compress",
] as const;
function decodeOptions(
  raw: Record<string, unknown>,
): Result<Pick<ActionRequest, "choice" | "destination" | "prefix" | "format" | "makeExecutable">> {
  if (typeof raw.choice !== "string")
    return failure("invalid_request", "Invalid application choice.");
  if ([raw.choice.length > 4096, raw.choice.includes("\0")].some(Boolean))
    return failure("invalid_request", "Invalid application choice.");
  if (typeof raw.makeExecutable !== "boolean")
    return failure("invalid_request", "Invalid execution permission.");
  const destination = decodeOptionalPath(raw.destination);
  const prefix = decodeOptionalPath(raw.prefix);
  if (!destination.ok) return destination;
  if (!prefix.ok) return prefix;
  const format = ARCHIVE_FORMATS.find((format) => format === raw.format);
  if (!format) return failure("invalid_request", "Invalid archive format.");
  return success({
    choice: raw.choice,
    destination: destination.value,
    prefix: prefix.value,
    format,
    makeExecutable: raw.makeExecutable,
  });
}
function decodeOptionalPath(raw: unknown): Result<string> {
  return raw === "" ? success("") : decodePath(raw);
}
export function decodeActionRequest(raw: unknown): Result<ActionRequest> {
  const paths = decodeActionPaths(raw);
  const id = decodeActionId(raw);
  if (!paths.ok) return paths;
  if (!id.ok) return id;
  if (!isRecord(raw)) return failure("invalid_request", "Invalid action request.");
  const action = ACTION_KINDS.find((action) => action === raw.action);
  if (!action) return failure("invalid_request", "Invalid action.");
  if (!["extract", "compress"].includes(action) && paths.value.paths.length !== 1)
    return failure("invalid_request", "This action requires one entry.");
  const options = decodeOptions(raw);
  return options.ok ? success({ ...id.value, ...paths.value, action, ...options.value }) : options;
}
function validNumber(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw);
}
function statFields(
  raw: Record<string, unknown>,
): Pick<FileMetadata, "size" | "modified" | "mode" | "executable" | "runnable" | "link"> | null {
  if (!validNumber(raw.size) || raw.size < 0) return null;
  if (!validNumber(raw.modified)) return null;
  if (!validNumber(raw.mode) || !Number.isInteger(raw.mode)) return null;
  return executionFields(raw, { size: raw.size, modified: raw.modified, mode: raw.mode });
}
function executionFields(
  raw: Record<string, unknown>,
  numbers: Pick<FileMetadata, "size" | "modified" | "mode">,
): Pick<FileMetadata, "size" | "modified" | "mode" | "executable" | "runnable" | "link"> | null {
  if (typeof raw.executable !== "boolean" || typeof raw.runnable !== "boolean") return null;
  if (raw.link !== null && typeof raw.link !== "string") return null;
  return { ...numbers, executable: raw.executable, runnable: raw.runnable, link: raw.link };
}
function metadata(raw: unknown): FileMetadata | null {
  if (!isRecord(raw)) return null;
  const path = decodePath(raw.path);
  const kind = ["file", "directory", "other"].find((kind) => kind === raw.kind);
  if (!path.ok || !kind) return null;
  const fields = statFields(raw);
  if (!fields) return null;
  // The explicit kind branches preserve the literal union without a type assertion.
  if (kind === "file" || kind === "directory" || kind === "other")
    return { ...fields, path: path.value, kind };
  return null;
}
function applications(raw: unknown): ApplicationChoice[] | null {
  if (!Array.isArray(raw)) return null;
  const choices: ApplicationChoice[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.recommended !== "boolean"
    )
      return null;
    choices.push({ id: item.id, name: item.name, recommended: item.recommended });
  }
  return choices;
}
function stringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const values: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") return null;
    values.push(value);
  }
  return values;
}
function toolFlags(raw: unknown): ActionInspection["tools"] | null {
  if (!isRecord(raw)) return null;
  return launchFlags(raw);
}
function launchFlags(t: Record<string, unknown>): ActionInspection["tools"] | null {
  if (typeof t.gio !== "boolean" || typeof t.terminal !== "boolean" || typeof t.wine !== "boolean")
    return null;
  return managerFlags(t, { gio: t.gio, terminal: t.terminal, wine: t.wine });
}
function managerFlags(
  t: Record<string, unknown>,
  flags: Pick<ActionInspection["tools"], "gio" | "terminal" | "wine">,
): ActionInspection["tools"] | null {
  if (
    typeof t.bottles !== "boolean" ||
    typeof t.lutris !== "boolean" ||
    typeof t.archives !== "boolean"
  )
    return null;
  return { ...flags, bottles: t.bottles, lutris: t.lutris, archives: t.archives };
}
function inspectionErrors(
  raw: Record<string, unknown>,
): Pick<ActionInspection, "applicationError" | "bottleError"> | null {
  if (raw.applicationError !== null && typeof raw.applicationError !== "string") return null;
  if (raw.bottleError !== null && typeof raw.bottleError !== "string") return null;
  return { applicationError: raw.applicationError, bottleError: raw.bottleError };
}
export function decodeActionInspection(raw: unknown): Result<ActionInspection> {
  if (!isRecord(raw) || !Array.isArray(raw.entries))
    return failure("invalid_reply", "Invalid file action inspection.");
  const entries: FileMetadata[] = [];
  for (const item of raw.entries) {
    const entry = metadata(item);
    if (!entry) return failure("invalid_reply", "Invalid file metadata.");
    entries.push(entry);
  }
  return inspectionDetails(raw, entries);
}
function inspectionDetails(
  raw: Record<string, unknown>,
  entries: FileMetadata[],
): Result<ActionInspection> {
  const choices = applications(raw.applications);
  const bottles = stringList(raw.bottles);
  const tools = toolFlags(raw.tools);
  const errors = inspectionErrors(raw);
  if (!choices || !bottles || !tools || !errors)
    return failure("invalid_reply", "Invalid action capabilities.");
  return success({ entries, applications: choices, bottles, tools, ...errors });
}
export function decodeActionReply(raw: unknown): Result<ActionReply> {
  if (!isRecord(raw) || typeof raw.message !== "string" || !Array.isArray(raw.outputs))
    return failure("invalid_reply", "Invalid action result.");
  const outputs: string[] = [];
  for (const path of raw.outputs) {
    const decoded = decodePath(path);
    if (!decoded.ok) return failure("invalid_reply", "Invalid output path.");
    outputs.push(decoded.value);
  }
  return success({ message: raw.message, outputs });
}
export function archiveStem(path: string): string {
  return (
    path
      .slice(path.lastIndexOf("/") + 1)
      .replace(/\.(tar\.(gz|xz|bz2|zst)|tgz|tbz2?|txz|zip|tar|7z|rar|gz|xz|bz2|zst)$/i, "") ||
    "archive"
  );
}

/** Normalize filesystem mutation sources without changing selection indicators. */
export function mutationPaths(paths: readonly string[]): readonly string[] {
  const unique = [...new Set(paths)];
  return unique.filter(
    (path) => !unique.some((parent) => parent !== path && isAncestorPath(parent, path)),
  );
}
