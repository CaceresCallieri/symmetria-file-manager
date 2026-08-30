import { contextBridge } from "electron";

import { BRIDGE_KEY, buildBridge } from "./bridge.ts";

/**
 * The preload runs with Node available, inside the renderer process. Anything
 * attached to `window` here becomes reachable from sandboxed page code, so this
 * file exposes exactly one object built from plain data — never a module, never
 * a function that closes over one.
 *
 * There is one `exposeInMainWorld` call in this file and a test asserts that
 * count, because "exactly one" is the property worth pinning.
 */
contextBridge.exposeInMainWorld(BRIDGE_KEY, buildBridge(process.versions.electron ?? "unknown"));
