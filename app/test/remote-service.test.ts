import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IpcReply, isRecord } from "@symmetria/fm-core/contract";
import {
  MACHINE_CLOSE_CHANNEL,
  MACHINE_OPEN_CHANNEL,
  MACHINES_CHANNEL,
} from "@symmetria/fm-core/machines";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import {
  createRegistry,
  type IpcHandler,
  type SenderHandle,
} from "@symmetria/fm-main/ipc/register";
import { afterAll, beforeAll, expect, it } from "vitest";
import { RemoteClient } from "../src/main/remote/client.ts";
import type { RemoteConfig } from "../src/main/remote/config.ts";
import { MachineHost } from "../src/main/remote/host.ts";
import { serveRemotePreview } from "../src/main/remote/previews.ts";
import { createRemoteFileService } from "../src/main/remote/service.ts";

const token = randomBytes(32).toString("hex");
const service = createRemoteFileService({ token });
const handlers = new Map<string, IpcHandler>();
const pushes: { channel: string; payload: unknown }[] = [];
const owner: SenderHandle = {
  send: (channel, payload) => {
    pushes.push({ channel, payload });
  },
};
const foreign: SenderHandle = { send: () => {} };
let config: RemoteConfig;
let host: MachineHost;
let fixture: string;
let home: string;
let local: string;
async function invoke(channel: string, payload: unknown, sender = owner): Promise<IpcReply> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return handler(payload, sender);
}
function value(reply: IpcReply) {
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.value;
}
function field(reply: IpcReply, name: string): string {
  return recordField(value(reply), name);
}
function recordField(raw: unknown, name: string): string {
  if (!isRecord(raw) || typeof raw[name] !== "string") throw new Error(`Missing ${name}`);
  return raw[name];
}
const remote = (channel: string, payload: unknown) => invoke(channel, { fmContext: home, payload });
beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), "fm-remote-test-"));
  await writeFile(join(fixture, "hello π.txt"), "remote text\n");
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const address = service.address();
  if (!address || typeof address === "string") throw new Error("Missing service port");
  config = { url: `http://127.0.0.1:${address.port}`, token, name: "Vigilia Home" };
  host = new MachineHost(config, (sender) => sender === owner);
  const registry = createRegistry(
    host.wrap({
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
    }),
    { readOnly: true, previewUrlFor: (grant) => `local:${grant}` },
  );
  host.bindRegistry(registry);
  home = field(await invoke(MACHINE_OPEN_CHANNEL, { machine: "home" }), "id");
  local = field(await invoke(MACHINE_OPEN_CHANNEL, { machine: "local" }), "id");
});
afterAll(async () => {
  host.dispose();
  service.closeAllConnections();
  await new Promise<void>((resolve) => service.close(() => resolve()));
  await rm(fixture, { recursive: true, force: true });
});
it("runs without Electron, authenticates, and reports both machines", async () => {
  expect((await fetch(`${config.url}/host`)).status).toBe(401);
  const machines = value(await invoke(MACHINES_CHANNEL, null));
  expect(machines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "local", readOnly: false }),
      expect.objectContaining({ id: "home", readOnly: true }),
    ]),
  );
  expect(JSON.stringify(machines)).not.toContain(token);
  expect(value(await remote(REQUEST_CHANNELS.list, { path: fixture }))).toMatchObject({
    entries: [expect.objectContaining({ name: "hello π.txt" })],
  });
  expect(
    value(
      await remote(REQUEST_CHANNELS.readText, {
        path: join(fixture, "hello π.txt"),
        maxBytes: 1024,
      }),
    ),
  ).toMatchObject({ text: "remote text\n" });
});
it("rejects mutation requests independently of the renderer and keeps local routing", async () => {
  for (const channel of [
    REQUEST_CHANNELS.fileActionInspect,
    REQUEST_CHANNELS.fileActionExecute,
    REQUEST_CHANNELS.fileActionCancel,
    REQUEST_CHANNELS.create,
    REQUEST_CHANNELS.rename,
    REQUEST_CHANNELS.trash,
    REQUEST_CHANNELS.transfer,
    REQUEST_CHANNELS.open,
    REQUEST_CHANNELS.searchStart,
  ]) {
    expect(await remote(channel, { path: join(fixture, "hello π.txt") })).toMatchObject({
      ok: false,
    });
  }
  expect(await readFile(join(fixture, "hello π.txt"), "utf8")).toBe("remote text\n");
  expect(
    await invoke(REQUEST_CHANNELS.list, { fmContext: local, payload: { path: fixture } }),
  ).toMatchObject({ ok: true });
  expect(
    await remote(REQUEST_CHANNELS.readText, { path: "/dev/zero", maxBytes: 1024 }),
  ).toMatchObject({ ok: false });
});
it("scopes connections to their owner and refuses a closed connection", async () => {
  expect(
    await invoke(REQUEST_CHANNELS.list, { fmContext: home, payload: { path: fixture } }, foreign),
  ).toMatchObject({ ok: false });
  expect(await invoke(MACHINE_OPEN_CHANNEL, { machine: "home" }, foreign)).toMatchObject({
    ok: false,
  });
  const id = field(await invoke(MACHINE_OPEN_CHANNEL, { machine: "local" }), "id");
  await invoke(MACHINE_CLOSE_CHANNEL, { id });
  expect(
    await invoke(REQUEST_CHANNELS.list, { fmContext: id, payload: { path: fixture } }),
  ).toMatchObject({ ok: false });
});
it("proxies preview ranges through an opaque URL and preserves HTML sandboxing", async () => {
  const url = field(
    await remote(REQUEST_CHANNELS.previewUrl, { path: join(fixture, "hello π.txt") }),
    "url",
  );
  expect(url).toMatch(/^symmetria-fm:\/\/app\/__remote_preview\/[a-f0-9]+$/);
  expect(url).not.toContain(token);
  const response = await serveRemotePreview(
    new Request(url, { headers: { Range: "bytes=0-5" } }),
    new URL(url).pathname,
  );
  expect(response.status).toBe(206);
  expect(await response.text()).toBe("remote");
  await writeFile(join(fixture, "page.html"), "<script>alert(1)</script><h1>Read only</h1>");
  const htmlUrl = field(
    await remote(REQUEST_CHANNELS.previewUrl, { path: join(fixture, "page.html") }),
    "url",
  );
  const html = await serveRemotePreview(new Request(htmlUrl), new URL(htmlUrl).pathname);
  expect(html.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
});
it("keeps watch ids and pushes inside their connection", async () => {
  expect(
    await remote(REQUEST_CHANNELS.watch, { path: fixture, subscriptionId: "same-id" }),
  ).toMatchObject({ ok: true });
  expect(
    await invoke(REQUEST_CHANNELS.watch, {
      fmContext: local,
      payload: { path: fixture, subscriptionId: "same-id" },
    }),
  ).toMatchObject({ ok: true });
  await invoke(REQUEST_CHANNELS.unwatch, {
    fmContext: local,
    payload: { subscriptionId: "same-id" },
  });
  pushes.length = 0;
  await writeFile(join(fixture, "new.txt"), "new");
  await expect
    .poll(() => pushes.some(({ payload }) => isRecord(payload) && payload.fmContext === home))
    .toBe(true);
  expect(pushes.some(({ payload }) => isRecord(payload) && payload.fmContext === local)).toBe(
    false,
  );
});
it("keeps missing-path errors separate from the special-file guard", async () => {
  const result = await remote(REQUEST_CHANNELS.readText, {
    path: join(fixture, "missing.txt"),
    maxBytes: 64,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).not.toContain("answered 400");
    expect(result.error.message).toContain("missing.txt");
  }
});
it("rejects writes at the service itself and reports a dropped connection", async () => {
  const clientPushes: unknown[] = [];
  const client = new RemoteClient(config, {
    send: (_, payload) => {
      clientPushes.push(payload);
    },
  });
  expect(
    await client.invoke(REQUEST_CHANNELS.watch, { path: fixture, subscriptionId: "lost" }),
  ).toMatchObject({ ok: true });
  const response = await fetch(`${config.url}/rpc`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "00000000-0000-0000-0000-000000000000",
      channel: REQUEST_CHANNELS.create,
      payload: { path: join(fixture, "forbidden"), kind: "file" },
    }),
  });
  expect(await response.json()).toMatchObject({ ok: false });
  service.closeAllConnections();
  await expect
    .poll(() =>
      clientPushes.some(
        (payload) =>
          isRecord(payload) &&
          payload.subscriptionId === "lost" &&
          typeof payload.error === "string",
      ),
    )
    .toBe(true);
  expect(await client.invoke(REQUEST_CHANNELS.list, { path: fixture })).toMatchObject({
    ok: false,
  });
  client.dispose();
});
