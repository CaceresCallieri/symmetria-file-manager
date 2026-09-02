import { fileURLToPath, pathToFileURL } from "node:url";
import { containedRealPath } from "@symmetria/fm-main/appPath";
import { resolveToken, TOKEN_PREFIX } from "@symmetria/fm-main/previewTokens";
import { net, protocol } from "electron";

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

const notFound = () => new Response("not found", { status: 404 });

/**
 * A previewed file, addressed by a token the main process issued.
 *
 * Served from this scheme rather than as a blob URL because Chromium's PDF
 * viewer refuses a blob whose origin is a custom scheme — the embed resolves to
 * an error page, invisibly. It also saves copying the file across the process
 * boundary.
 */
// The union rather than `async`, because only one of the two branches is
// asynchronous: `net.fetch` returns a promise and the not-found answer is
// immediate. Marking the whole function `async` would wrap a value that needs
// no wrapping, and `protocol.handle` accepts either.
function servePreview(pathname: string): Response | Promise<Response> {
  const previewed = resolveToken(pathname.slice(TOKEN_PREFIX.length));
  // A token that was never issued, or was evicted. Not found is the honest
  // answer: this route reaches exactly what the main process handed out.
  if (previewed === null) return notFound();

  return net.fetch(pathToFileURL(previewed).toString());
}

/**
 * One of the page's own assets.
 *
 * One gate, not two. An `access()` check before the read would add a syscall
 * and a window between the check and the use; letting the fetch itself fail is
 * both simpler and race-free.
 */
async function serveAsset(root: string, pathname: string): Promise<Response> {
  const file = await containedRealPath(root, pathname);
  if (file === null) return notFound();

  return net.fetch(pathToFileURL(file).toString());
}

export function handleAppScheme(): void {
  const root = rendererRoot();

  // Three branches and nothing else: wrong host, a preview token, or an asset.
  // The two routes are functions rather than blocks because they answer
  // different questions with different failure modes — and because as one body
  // this handler sat exactly on the project's change-risk bound.
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return notFound();
    if (url.pathname.startsWith(TOKEN_PREFIX)) return servePreview(url.pathname);

    return serveAsset(root, url.pathname);
  });
}

/** The URL the window loads. */
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/** Where a token-addressed preview is served from. */
export function previewUrlFor(token: string): string {
  return `${APP_SCHEME}://${APP_HOST}${TOKEN_PREFIX}${token}`;
}
