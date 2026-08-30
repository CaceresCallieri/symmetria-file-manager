/**
 * The single global the sandboxed renderer is allowed to see.
 *
 * One name, one object. Every capability the interface needs arrives through
 * it, which keeps the surface auditable: counting the ways into the privileged
 * half is counting the keys on this object.
 */
export const BRIDGE_KEY = "symmetriaFm";

/** What the bridge carries. Phase 4 replaces this with the real method set. */
export interface Bridge {
  /** Proves the bridge arrived, and identifies which build produced it. */
  readonly version: string;
}

export function buildBridge(version: string): Bridge {
  return { version };
}
