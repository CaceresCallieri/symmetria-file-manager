import { randomBytes } from "node:crypto";
import { TOKEN_PREFIX } from "@symmetria/fm-main/previewTokens";
import { APP_ORIGIN } from "../appScheme.ts";
import { remoteFetch } from "./client.ts";
import type { RemoteConfig } from "./config.ts";

export const REMOTE_PREVIEW_PREFIX = "/__remote_preview/";
interface Grant {
  readonly config: RemoteConfig;
  readonly path: string;
  readonly directory: boolean;
}
const grants = new Map<string, Grant>();
export function remotePreviewUrl(config: RemoteConfig, path: string, directory: boolean): string {
  if (!path.startsWith(TOKEN_PREFIX) || path.includes(".."))
    throw new Error("Invalid remote preview URL");
  const token = randomBytes(24).toString("hex");
  grants.set(token, { config, path, directory });
  if (grants.size > 128) {
    const first = grants.keys().next().value;
    if (first !== undefined) grants.delete(first);
  }
  return `${APP_ORIGIN}${REMOTE_PREVIEW_PREFIX}${token}`;
}
export async function serveRemotePreview(
  request: Request,
  pathname: string,
  headerTimeoutMs = 30_000,
): Promise<Response> {
  const rest = pathname.slice(REMOTE_PREVIEW_PREFIX.length);
  const slash = rest.indexOf("/");
  const token = slash < 0 ? rest : rest.slice(0, slash);
  const grant = grants.get(token);
  if (grant === undefined) return new Response("not found", { status: 404 });
  if (slash >= 0 && !grant.directory) return new Response("not found", { status: 404 });
  const suffix = slash < 0 ? "" : rest.slice(slash);
  const headers: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range !== null) headers.Range = range;
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(), headerTimeoutMs);
  timer.unref();
  try {
    const response = await remoteFetch(grant.config, grant.path + suffix, {
      headers,
      method: request.method,
      signal: controller.signal,
    });
    // The deadline covers headers. A media body can remain open for playback.
    if (response.body === null) {
      request.signal.removeEventListener("abort", abort);
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            request.signal.removeEventListener("abort", abort);
            target.close();
          } else target.enqueue(chunk.value);
        } catch (cause) {
          request.signal.removeEventListener("abort", abort);
          target.error(cause);
        }
      },
      async cancel(reason) {
        request.signal.removeEventListener("abort", abort);
        // An already aborted fetch rejects reader.cancel; cancellation still
        // closes the upstream request and must not reject the consumer's cancel.
        await reader.cancel(reason).catch(() => {});
        controller.abort(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    request.signal.removeEventListener("abort", abort);
    return new Response("Vigilia Home is unavailable", { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
