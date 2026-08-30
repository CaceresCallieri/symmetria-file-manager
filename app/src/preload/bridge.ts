import type { Result } from "@symmetria/fm-core/contract";

/**
 * The single global the sandboxed renderer is allowed to see.
 *
 * One name, one object. Every capability the interface needs arrives through
 * it, which keeps the surface auditable: counting the ways into the privileged
 * half is counting the keys on this object.
 */
export const BRIDGE_KEY = "symmetriaFm";

/** An unsubscribe function, returned by every listener registration. */
export type Unsubscribe = () => void;

export interface Bridge {
  /** Identifies which build produced this bridge. */
  readonly version: string;
  /** List a directory. Failures arrive as values, never as thrown errors. */
  list(request: unknown): Promise<Result<unknown>>;
  /** Start watching a directory for changes. */
  watch(request: unknown): Promise<Result<unknown>>;
  /** Stop watching. */
  unwatch(request: unknown): Promise<Result<unknown>>;
  /** Read the head of a text file. */
  readText(request: unknown): Promise<Result<unknown>>;
  /** Abandon an in-flight listing. */
  cancel(request: unknown): Promise<Result<unknown>>;
  /** Receive one batch of a streamed listing. */
  onListBatch(listener: (batch: unknown) => void): Unsubscribe;
  /** Receive a directory-changed notification. */
  onChanged(listener: (event: unknown) => void): Unsubscribe;
}
