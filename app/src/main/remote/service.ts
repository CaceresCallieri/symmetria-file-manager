import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir, hostname } from "node:os";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type Decoder, failure, isRecord, type Result, success } from "@symmetria/fm-core/contract";
import { resolveMimeType } from "@symmetria/fm-core/mime";
import { containedRealPath } from "@symmetria/fm-main/appPath";
import { mimeTables } from "@symmetria/fm-main/fs/mimeTables";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import {
  createRegistry,
  type IpcHandler,
  type SenderHandle,
} from "@symmetria/fm-main/ipc/register";
import {
  resolvePreviewDirectoryPath,
  resolveToken,
  TOKEN_PREFIX,
} from "@symmetria/fm-main/previewTokens";

import { fileResponse } from "../fileResponse.ts";
import { decodeRemoteRequest, encodeRemoteReply, isSessionId } from "./policy.ts";

export interface RemoteServiceOptions {
  readonly token: string;
  readonly uiRoot?: string;
  readonly startPath?: string;
}

/** A Node-only read host. The allowlist applies before the registry sees a request. */
export function createRemoteFileService(options: RemoteServiceOptions) {
  const accessToken = options.token;
  if (!/^[a-f0-9]{64}$/.test(accessToken))
    throw new Error("The access token must contain 32 random bytes encoded as hex");
  const secret = Buffer.from(accessToken);
  const uiRoot = options.uiRoot;
  const handlers = new Map<string, IpcHandler>();
  const sessions = new Map<string, SenderHandle>();
  const registry = createRegistry(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
    },
    { readOnly: true, previewUrlFor: (token) => `${TOKEN_PREFIX}${token}` },
  );

  function validToken(candidate: string): boolean {
    const bytes = Buffer.from(candidate);
    return bytes.length === secret.length && timingSafeEqual(bytes, secret);
  }

  function authenticated(request: IncomingMessage): boolean {
    const bearer = request.headers.authorization;
    if (bearer?.startsWith("Bearer ")) return validToken(bearer.slice(7));
    const cookie = request.headers.cookie
      ?.split("; ")
      .find((part) => part.startsWith("fm_viewer="));
    return cookie !== undefined && validToken(cookie.slice("fm_viewer=".length));
  }

  function json(response: ServerResponse, value: unknown, status = 200): void {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  }

  async function readBody<T>(request: IncomingMessage, decode: Decoder<T>): Promise<Result<T>> {
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > 16_384) throw new Error("request exceeds 16 KiB");
      chunks.push(bytes);
    }
    return decode(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  }

  function events(url: URL, response: ServerResponse): void {
    const id = url.searchParams.get("session");
    if (!isSessionId(id)) {
      json(response, failure("invalid_request", "invalid session id"), 400);
      return;
    }
    if (sessions.has(id) || sessions.size >= 8) {
      json(response, failure("invalid_request", "session unavailable"), 400);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    const sender: SenderHandle = {
      send(channel, payload) {
        if (response.writableLength > 65_536) {
          response.destroy();
          return;
        }
        response.write(`data: ${JSON.stringify({ channel, payload })}\n\n`);
      },
    };
    sessions.set(id, sender);
    response.write("event: ready\ndata: {}\n\n");
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
    response.once("close", () => {
      clearInterval(heartbeat);
      sessions.delete(id);
      registry.disposeSender(sender);
    });
  }

  /** Device nodes and FIFOs must never enter a preview reader. */
  async function previewable(channel: string, payload: unknown): Promise<boolean> {
    const readers: readonly string[] = [
      REQUEST_CHANNELS.describe,
      REQUEST_CHANNELS.readText,
      REQUEST_CHANNELS.previewUrl,
    ];
    if (!readers.includes(channel)) return true;
    const path = requestedPath(payload);
    if (path === null) return true;
    // Let the handler preserve its normal missing-path error. Only an existing
    // special file needs the guard before a reader can open it.
    const stats = await stat(path).catch(() => null);
    if (stats === null || stats.isFile()) return true;
    return directoryDescription(channel, stats.isDirectory());
  }

  function directoryDescription(channel: string, directory: boolean): boolean {
    return channel === REQUEST_CHANNELS.describe && directory;
  }

  function requestedPath(payload: unknown): string | null {
    if (!isRecord(payload)) return null;
    return typeof payload.path === "string" ? payload.path : null;
  }

  function connectedHandler(
    sessionId: string,
    channel: string,
  ): { sender: SenderHandle; handler: IpcHandler } | null {
    const sender = sessions.get(sessionId);
    const handler = handlers.get(channel);
    if (sender === undefined || handler === undefined) return null;
    return { sender, handler };
  }

  async function rpc(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const decoded = await readBody(request, decodeRemoteRequest);
    if (!decoded.ok) {
      json(response, decoded);
      return;
    }
    const { channel, payload, sessionId } = decoded.value;
    const connection = connectedHandler(sessionId, channel);
    if (connection === null) {
      json(response, failure("invalid_request", "session is not connected"));
      return;
    }
    if (!(await previewable(channel, payload))) {
      json(response, failure("read_failed", "Only regular files can be previewed"));
      return;
    }
    json(response, encodeRemoteReply(await connection.handler(payload, connection.sender)));
  }

  async function sendFile(
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const stats = await stat(path);
    if (!stats.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    const type = resolveMimeType(await mimeTables(), basename(path)) ?? "application/octet-stream";
    const result = fileResponse(path, stats.size, type, request.headers.range ?? null);
    await sendResponse(result, request, response);
  }

  async function sendResponse(
    result: Response,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.writeHead(result.status, Object.fromEntries(result.headers));
    if (request.method === "HEAD" || result.body === null) {
      await result.body?.cancel();
      response.end();
      return;
    }
    await pipeline(Readable.fromWeb(result.body), response);
  }

  async function preview(
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const remainder = url.pathname.slice(TOKEN_PREFIX.length);
    const slash = remainder.indexOf("/");
    const path =
      slash < 0
        ? resolveToken(remainder)
        : await resolvePreviewDirectoryPath(remainder.slice(0, slash), remainder.slice(slash + 1));
    if (path === null) {
      response.writeHead(404);
      response.end();
      return;
    }
    await sendFile(path, request, response);
  }

  const ASSET_TYPES: ReadonlyMap<string, string> = new Map([
    [".html", "text/html"],
    [".js", "text/javascript"],
    [".css", "text/css"],
    [".woff2", "font/woff2"],
    [".wasm", "application/wasm"],
    [".png", "image/png"],
  ]);

  async function asset(url: URL, response: ServerResponse): Promise<void> {
    if (uiRoot === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    const path = await containedRealPath(
      uiRoot,
      url.pathname === "/" ? "index.html" : url.pathname.slice(1),
    );
    if (path === null) {
      response.writeHead(404);
      response.end();
      return;
    }
    await sendAsset(path, response);
  }
  async function sendAsset(path: string, response: ServerResponse): Promise<void> {
    const type = ASSET_TYPES.get(path.slice(path.lastIndexOf("."))) ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'self' blob:; form-action 'none'; base-uri 'none'",
    });
    response.end(await readFile(path));
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "POST") {
      await post(url, request, response);
      return;
    }
    if (!["GET", "HEAD"].includes(String(request.method))) {
      response.writeHead(405);
      response.end();
      return;
    }
    await get(url, request, response);
  }

  async function login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const decoded = await readBody(request, decodeAccessToken);
    if (!decoded.ok) {
      json(response, { error: "invalid access link" }, 401);
      return;
    }
    response.setHeader("Set-Cookie", `fm_viewer=${accessToken}; HttpOnly; SameSite=Strict; Path=/`);
    json(response, { connected: true });
  }

  async function post(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!hasBearer(request) && request.headers.origin !== url.origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (url.pathname === "/session") {
      await login(request, response);
      return;
    }
    await authenticatedPost(url, request, response);
  }

  async function authenticatedPost(
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!authenticated(request)) {
      response.writeHead(401);
      response.end();
      return;
    }
    if (url.pathname === "/rpc") {
      await rpc(request, response);
      return;
    }
    response.writeHead(405);
    response.end();
  }

  function privatePath(path: string): boolean {
    return ["/host", "/events"].includes(path) || path.startsWith(TOKEN_PREFIX);
  }

  async function get(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!privatePath(url.pathname)) {
      await asset(url, response);
      return;
    }
    if (!authenticated(request)) {
      response.writeHead(401);
      response.end();
      return;
    }
    await authenticatedGet(url, request, response);
  }

  async function authenticatedGet(
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (url.pathname === "/host") {
      json(response, {
        homePath: homedir(),
        startPath: options.startPath ?? homedir(),
        machine: hostname(),
      });
      return;
    }
    if (url.pathname === "/events") {
      events(url, response);
      return;
    }
    await preview(url, request, response);
  }

  function decodeAccessToken(raw: unknown): Result<string> {
    if (!isRecord(raw)) return failure("invalid_request", "invalid access link");
    if (typeof raw.token !== "string") return failure("invalid_request", "invalid access link");
    return validToken(raw.token)
      ? success(raw.token)
      : failure("invalid_request", "invalid access link");
  }

  const server = createServer((request, response) => {
    void route(request, response).catch((cause: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      json(
        response,
        failure("read_failed", cause instanceof Error ? cause.message : String(cause)),
        400,
      );
    });
  });
  server.requestTimeout = 20_000;
  server.once("close", () => registry.dispose());
  return server;
}

function hasBearer(request: IncomingMessage): boolean {
  return request.headers.authorization?.startsWith("Bearer ") === true;
}
