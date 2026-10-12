import { failure, isRecord, type Result, success } from "./contract.ts";

export type MachineId = "local" | "home";
export interface MachineInfo {
  readonly id: MachineId;
  readonly name: string;
  readonly homePath: string;
  readonly startPath: string;
  readonly readOnly: boolean;
  readonly error: string | null;
}
export const MACHINES_CHANNEL = "symmetria-fm:machines";
export const MACHINE_OPEN_CHANNEL = "symmetria-fm:machine-open";
export const MACHINE_CLOSE_CHANNEL = "symmetria-fm:machine-close";
export const MACHINE_LOST_CHANNEL = "symmetria-fm:machine-lost";
function machineIdentity(
  raw: Record<string, unknown>,
): Pick<MachineInfo, "id" | "name" | "readOnly"> | null {
  if (raw.id !== "local" && raw.id !== "home") return null;
  if (typeof raw.name !== "string" || typeof raw.readOnly !== "boolean") return null;
  return { id: raw.id, name: raw.name, readOnly: raw.readOnly };
}
function absolutePath(raw: unknown): string | null {
  return typeof raw === "string" && raw.startsWith("/") ? raw : null;
}
function machineLocation(
  raw: Record<string, unknown>,
): Pick<MachineInfo, "homePath" | "startPath" | "error"> | null {
  const homePath = absolutePath(raw.homePath);
  const startPath = absolutePath(raw.startPath);
  const error = machineError(raw.error);
  if (error === false) return null;
  if (homePath === null || startPath === null) return null;
  return { homePath, startPath, error };
}
function decodeMachineInfo(raw: unknown): MachineInfo | null {
  if (!isRecord(raw)) return null;
  const identity = machineIdentity(raw);
  const location = machineLocation(raw);
  if (identity === null || location === null) return null;
  return { ...identity, ...location };
}
export function decodeMachines(raw: unknown): Result<readonly MachineInfo[]> {
  if (!Array.isArray(raw)) return failure("invalid_reply", "Invalid machines reply");
  const machines: MachineInfo[] = [];
  for (const item of raw) {
    const machine = decodeMachineInfo(item);
    if (machine === null) return failure("invalid_reply", "Invalid machine");
    if (machines.some((existing) => existing.id === machine.id))
      return failure("invalid_reply", "Duplicate machine");
    machines.push(machine);
  }
  return success(machines);
}

function machineError(raw: unknown): string | null | false {
  if (raw === null || typeof raw === "string") return raw;
  return false;
}
