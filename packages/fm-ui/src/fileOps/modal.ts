import type { Clipboard, OperationTarget } from "./targets.ts";

export interface CreateTarget {
  readonly directory: string;
  onCreated?(path: string): void;
}

export type OpsModal =
  | { readonly kind: "none" }
  | { readonly kind: "delete"; readonly paths: readonly string[]; readonly source: OperationTarget }
  | {
      readonly kind: "rename";
      readonly path: string;
      readonly name: string;
      /** The stem for r, the full name for Shift+R. */
      readonly selectTo: number;
      readonly source: OperationTarget;
    }
  | { readonly kind: "create"; readonly target: CreateTarget }
  | {
      readonly kind: "conflict";
      readonly conflicts: readonly string[];
      readonly clipboard: Clipboard;
      readonly destination: string;
      readonly target: OperationTarget;
    };
