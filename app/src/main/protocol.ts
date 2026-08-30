import { fileURLToPath, pathToFileURL } from "node:url";

import { net, protocol } from "electron";

import { containedRealPath } from "./appPath.ts";

/**
 * The scheme the renderer is served from.
 *
 * NOT `file://`, and that is the whole point of this module. Verification of
 * phase 2 found that a page loaded with `loadFile` sits on a `file://` origin,
 * and Chromium lets a `file://` page read any other `file://` resource with
 * plain `fetch` or `XMLHttpRequest`. `sandbox: true` does not close that;
 * neither does `webSecurity: true`, because it is not a CORS problem in
 * Chromium's file-scheme model. `require("node:fs")` was blocked and the
 * filesystem was reachable anyway — `fetch("file:///etc/passwd")` returned
 * 2088 bytes.
 *
 * Giving the page its own origin closes it: a `symmetria-fm://` document has no
 * privilege over `file://` resources, so the only route to the disk becomes the
 * bridge, which is what the architecture assumes everywhere else.
 */
const APP_SCHEME = "symmetria-fm";

/** The authority segment. `symmetria-fm://app/index.html`. */
const APP_HOST = "app";

/**
 * Must run before the app is ready, and before any window exists.
 *
 * `standard` gives the scheme normal URL parsing so relative asset paths work.
 * `secure` puts it in a secure context, which the platform requires for several
 * APIs. `supportFetchAPI` lets page code fetch its own assets. None of these
 * grants any access to `file://`.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/** The directory the built renderer lives in. */
function rendererRoot(): string {
  return fileURLToPath(new URL("../renderer/", import.meta.url));
}

export function handleAppScheme(): void {
  const root = rendererRoot();

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response("not found", { status: 404 });

    // One gate, not two. An `access()` check before the read would add a
    // syscall and a window between the check and the use; letting the fetch
    // itself fail is both simpler and race-free.
    const file = await containedRealPath(root, url.pathname);
    if (file === null) return new Response("not found", { status: 404 });

    return net.fetch(pathToFileURL(file).toString());
  });
}

/** The URL the window loads. */
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
