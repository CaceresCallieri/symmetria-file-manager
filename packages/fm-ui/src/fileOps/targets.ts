import type { TransferMode } from "@symmetria/fm-core/contract";
import type { CursorEntry } from "@symmetria/fm-core/keys/types";
import { isAncestorPath } from "@symmetria/fm-core/overview/model";

export interface OperationChange {
  readonly removed?: readonly string[];
  readonly reveal?: string;
}

/** Paths and destination are captured when the action starts, before any dialog. */
export interface OperationTarget {
  readonly cursor: CursorEntry | null;
  readonly paths: readonly string[];
  readonly directory: string;
  readonly protectedPath?: string;
  /** Miller's preview supplies image gating; lightweight tree snapshots cannot supply bytes. */
  readonly supportsImageBytes: boolean;
  isCurrent(): boolean;
  clearMarks(): void;
  /** Capture completion state when the bridge request starts, after confirmation. */
  captureCompletion(): (change: OperationChange) => void;
}

export interface Clipboard {
  readonly paths: readonly string[];
  readonly mode: TransferMode;
  readonly source: OperationTarget;
}

/** Keep indicator paths intact; normalize only the filesystem mutation sources. */
export function mutationPaths(paths: readonly string[]): readonly string[] {
  const unique = [...new Set(paths)];
  return unique.filter(
    (path) => !unique.some((parent) => parent !== path && isAncestorPath(parent, path)),
  );
}
