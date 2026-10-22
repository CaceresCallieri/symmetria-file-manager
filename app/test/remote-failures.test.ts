import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failure, success } from "@symmetria/fm-core/contract";
import { MACHINE_LOST_CHANNEL } from "@symmetria/fm-core/machines";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import { TOKEN_PREFIX } from "@symmetria/fm-main/previewTokens";
import { expect, it } from "vitest";
import { RemoteClient } from "../src/main/remote/client.ts";
import { loadOptionalRemoteConfig, type RemoteConfig } from "../src/main/remote/config.ts";
import { describeConnectionFailure } from "../src/main/remote/connectionFailure.ts";
import { consumeEvents } from "../src/main/remote/events.ts";
import { remotePreviewUrl, serveRemotePreview } from "../src/main/remote/previews.ts";

async function listening(server: Server): Promise<RemoteConfig> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { url: `http://127.0.0.1:${address.port}`, token: "a".repeat(64), name: "Home" };
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
it("keeps Local available when configuration is malformed or the path is invalid", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "fm-invalid-config-"));
  const errors: string[] = [];
  try {
    const path = join(scratch, "remote.json");
    await writeFile(path, "invalid json");
    expect(await loadOptionalRemoteConfig(scratch, path, (error) => errors.push(error))).toBeNull();
    await writeFile(path, JSON.stringify({ url: "http://127.0.0.1/files", token: "secret" }));
    expect(await loadOptionalRemoteConfig(scratch, path, (error) => errors.push(error))).toBeNull();
    expect(
      await loadOptionalRemoteConfig(scratch, scratch, (error) => errors.push(error)),
    ).toBeNull();
    expect(
      await loadOptionalRemoteConfig(scratch, "relative.json", (error) => errors.push(error)),
    ).toBeNull();
    expect(errors).toHaveLength(4);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
it("detects a silent event stream and cancels the pending read", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    consumeEvents(
      stream,
      () => {},
      () => {},
      40,
    ),
  ).rejects.toThrow("heartbeat timed out");
  expect(cancelled).toBe(true);
});
it("renews the idle deadline on heartbeats and still detects later silence", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const outcome = consumeEvents(
    stream,
    () => {},
    () => {},
    80,
  ).catch((cause: unknown) => cause);
  const heartbeat = setInterval(
    () => controller?.enqueue(new TextEncoder().encode(": heartbeat\n\n")),
    20,
  );
  await new Promise((resolve) => setTimeout(resolve, 160));
  clearInterval(heartbeat);
  const cause = await outcome;
  expect(cause).toBeInstanceOf(Error);
  expect(String(cause)).toContain("heartbeat timed out");
});
it("reports an expired RPC session as a connection loss even without watches", async () => {
  let events: ServerResponse | undefined;
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/events")) {
      events = response;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("event: ready\ndata: {}\n\n");
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(failure("invalid_request", "session is not connected")));
    }
  });
  const config = await listening(server);
  const pushes: { channel: string; payload: unknown }[] = [];
  const client = new RemoteClient(config, {
    send: (channel, payload) => pushes.push({ channel, payload }),
  });
  try {
    expect(await client.invoke(REQUEST_CHANNELS.list, { path: "/" })).toMatchObject({ ok: false });
    expect(pushes).toContainEqual({
      channel: MACHINE_LOST_CHANNEL,
      payload: "Vigilia Home disconnected",
    });
    expect(await client.invoke(REQUEST_CHANNELS.list, { path: "/" })).toMatchObject({
      error: { message: "Vigilia Home disconnected" },
    });
  } finally {
    client.dispose();
    events?.destroy();
    await stop(server);
  }
});
it("streams a preview past the header deadline without aborting its body", async () => {
  const server = createServer((_, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.write("first");
    const timer = setTimeout(() => response.end("last"), 250);
    response.once("close", () => clearTimeout(timer));
  });
  const config = await listening(server);
  try {
    const url = remotePreviewUrl(config, `${TOKEN_PREFIX}grant`, false);
    const response = await serveRemotePreview(new Request(url), new URL(url).pathname, 100);
    expect(await response.text()).toBe("firstlast");
  } finally {
    await stop(server);
  }
});
it("propagates cancellation of a remote preview to the service", async () => {
  let closed = false;
  const server = createServer((_, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.write("first");
    response.once("close", () => {
      closed = true;
    });
  });
  const config = await listening(server);
  try {
    const url = remotePreviewUrl(config, `${TOKEN_PREFIX}grant`, false);
    const response = await serveRemotePreview(new Request(url), new URL(url).pathname);
    await response.body?.cancel();
    await expect.poll(() => closed).toBe(true);
  } finally {
    await stop(server);
  }
});

it("does not disclose malformed configuration bytes in the diagnostic", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "fm-safe-config-"));
  const errors: string[] = [];
  const secret = "private-token-must-not-appear";
  try {
    const path = join(scratch, "remote.json");
    await writeFile(path, `{ "token": "${secret}" unexpected }`);
    expect(
      await loadOptionalRemoteConfig(scratch, path, (message) => errors.push(message)),
    ).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Remote configuration is not valid JSON");
    expect(errors[0]).not.toContain(secret);
    expect(errors[0]).not.toContain("unexpected");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
it.each(["timeout", "malformed"])("keeps the connection after a %s RPC failure", async (mode) => {
  let events: ServerResponse | undefined;
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/events")) {
      events = response;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("event: ready\ndata: {}\n\n");
      return;
    }
    requests++;
    if (requests === 1 && mode === "timeout") return;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      requests === 1
        ? "invalid json"
        : JSON.stringify(success({ entries: [], total: 0, streamId: null })),
    );
  });
  const config = await listening(server);
  const pushes: { channel: string; payload: unknown }[] = [];
  const client = new RemoteClient(
    config,
    { send: (channel, payload) => pushes.push({ channel, payload }) },
    150,
  );
  try {
    expect(await client.invoke(REQUEST_CHANNELS.list, { path: "/" })).toMatchObject({ ok: false });
    expect(await client.invoke(REQUEST_CHANNELS.list, { path: "/" })).toMatchObject({ ok: true });
    expect(requests).toBe(2);
    expect(pushes.some((push) => push.channel === MACHINE_LOST_CHANNEL)).toBe(false);
    expect(events?.destroyed).toBe(false);
  } finally {
    client.dispose();
    events?.destroy();
    await stop(server);
  }
});
async function closedPort(): Promise<RemoteConfig> {
  const server = createServer();
  const config = await listening(server);
  await stop(server);
  return config;
}
it("names a refused connection instead of reporting a bare fetch failure", async () => {
  const config = await closedPort();
  const pushes: { channel: string; payload: unknown }[] = [];
  const client = new RemoteClient(config, {
    send: (channel, payload) => pushes.push({ channel, payload }),
  });
  try {
    const reply = await client.invoke(REQUEST_CHANNELS.list, { path: "/" });
    expect(reply).toMatchObject({
      ok: false,
      error: { message: "Home refused the connection; is its file service running?" },
    });
    expect(pushes).toContainEqual({
      channel: MACHINE_LOST_CHANNEL,
      payload: "Home refused the connection; is its file service running?",
    });
  } finally {
    client.dispose();
  }
});
it("describes network causes and keeps other messages", async () => {
  const config = await closedPort();
  const refused = await fetch(config.url).catch((cause: unknown) => cause);
  expect(describeConnectionFailure(refused, "Home")).toBe(
    "Home refused the connection; is its file service running?",
  );
  const silent = createServer(() => {});
  const silentConfig = await listening(silent);
  try {
    const timeout = await fetch(silentConfig.url, { signal: AbortSignal.timeout(50) }).catch(
      (cause: unknown) => cause,
    );
    expect(describeConnectionFailure(timeout, "Home")).toBe("Home did not answer in time");
  } finally {
    await stop(silent);
  }
  expect(describeConnectionFailure(new Error("Remote events answered 401"), "Home")).toBe(
    "Remote events answered 401",
  );
});
it("names the machine when the event stream accepts but never answers", async () => {
  const server = createServer(() => {});
  const config = await listening(server);
  const client = new RemoteClient(config, { send: () => {} }, 15_000, 100);
  try {
    expect(await client.invoke(REQUEST_CHANNELS.list, { path: "/" })).toMatchObject({
      ok: false,
      error: { message: "Home did not answer in time" },
    });
  } finally {
    client.dispose();
    await stop(server);
  }
});
