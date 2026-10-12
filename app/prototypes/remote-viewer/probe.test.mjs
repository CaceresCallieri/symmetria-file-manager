import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";

import { decodeRemoteReply, encodeRemoteReply } from "./policy.ts";

const origin = "http://127.0.0.1:4786";
const token = process.env.FM_VIEWER_TOKEN;
assert.ok(token, "set FM_VIEWER_TOKEN to the running prototype's token");
const sessionId = randomUUID();
const controller = new AbortController();
let fixture;
let cookie;
let reader;

async function invoke(channel, payload) {
  const response = await fetch(`${origin}/rpc`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, channel, payload }),
    signal: AbortSignal.timeout(5000),
  });
  return response.json();
}

before(async () => {
  fixture = await mkdtemp(fileURLToPath(new URL("dist/probe-", import.meta.url)));
  await writeFile(join(fixture, "a 'quoted' 日本語.txt"), "Read-only preview\n");
  await writeFile(join(fixture, ".hidden"), "hidden\n");
  const response = await fetch(`${origin}/session`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie").split(";")[0];
  const stream = await fetch(`${origin}/events?session=${sessionId}`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
});

after(async () => {
  controller.abort();
  await reader?.cancel().catch(() => {});
  await rm(fixture, { recursive: true, force: true });
});

test("authentication protects metadata, requests and preview bytes", async () => {
  for (const path of ["/host", "/events?session=missing", "/__preview/missing"]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 401, path);
  }
  const crossOrigin = await fetch(`${origin}/rpc`, {
    method: "POST",
    headers: { Origin: "https://unrelated.example", Cookie: cookie },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);
});

test("the existing scan preserves quoted and Unicode names and hidden filtering", async () => {
  const payload = {
    path: fixture,
    sort: "alphabetical",
    reverse: false,
    showHidden: false,
    stream: false,
  };
  const result = await invoke(REQUEST_CHANNELS.list, payload);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.value.entries.map((entry) => entry.name),
    ["a 'quoted' 日本語.txt"],
  );
  const hidden = await invoke(REQUEST_CHANNELS.list, { ...payload, showHidden: true });
  assert.equal(hidden.value.total, 2);
});

test("text and binary preview replies cross JSON without losing bytes", async () => {
  const path = join(fixture, "a 'quoted' 日本語.txt");
  const text = await invoke(REQUEST_CHANNELS.readText, { path, maxBytes: 1024 });
  assert.equal(text.value.text, "Read-only preview\n");
  const described = decodeRemoteReply(await invoke(REQUEST_CHANNELS.describe, { path }));
  assert.equal(described.ok, true);
  assert.ok(described.value.head instanceof Uint8Array);
  assert.deepEqual(Buffer.from(described.value.head), await readFile(path));
  const allBytes = { ok: true, value: { head: Uint8Array.from({ length: 256 }, (_, i) => i) } };
  const roundTrip = decodeRemoteReply(JSON.parse(JSON.stringify(encodeRemoteReply(allBytes))));
  assert.deepEqual(roundTrip.value.head, allBytes.value.head);
  assert.equal(decodeRemoteReply({ ok: true, value: { head: [256] } }).ok, false);
});

test("an image preview uses the original bytes and supports byte ranges", async () => {
  const path = fileURLToPath(new URL("../../../assets/symmetria-fm.png", import.meta.url));
  const grant = await invoke(REQUEST_CHANNELS.previewUrl, { path });
  assert.equal(grant.ok, true);
  const response = await fetch(`${origin}${grant.value.url}`, {
    headers: { Cookie: cookie, Range: "bytes=0-7" },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    (await readFile(path)).subarray(0, 8),
  );
});

test("the server rejects every mutation even when the client bypasses the bridge", async () => {
  const original = await readdir(fixture);
  const path = join(fixture, "a 'quoted' 日本語.txt");
  for (const method of [
    "create",
    "rename",
    "trash",
    "transfer",
    "open",
    "bookmarksWrite",
    "listingWrite",
    "searchRecord",
  ]) {
    const result = await invoke(REQUEST_CHANNELS[method], {
      path,
      name: "renamed.txt",
      kind: "file",
      paths: [path],
      sources: [path],
      destination: fixture,
      mode: "move",
      overwrite: true,
      transferId: "probe",
    });
    assert.equal(result.ok, false, method);
    assert.match(result.error.message, /read-only/, method);
  }
  assert.deepEqual(await readdir(fixture), original);
  assert.equal(await readFile(path, "utf8"), "Read-only preview\n");
});

test("special files and malformed requests fail without hanging the reader", async () => {
  const special = await invoke(REQUEST_CHANNELS.readText, { path: "/dev/zero", maxBytes: 1024 });
  assert.equal(special.ok, false);
  assert.match(special.error.message, /regular files/);
  const relative = await invoke(REQUEST_CHANNELS.list, { path: "relative" });
  assert.equal(relative.ok, false);
});

test("a server watch reports changes made outside the read-only viewer", async () => {
  const subscriptionId = "remote-probe";
  const watched = await invoke(REQUEST_CHANNELS.watch, { path: fixture, subscriptionId });
  assert.equal(watched.ok, true);
  await writeFile(join(fixture, "external.txt"), "The probe wrote this file, not the viewer.\n");
  const pending = reader.read();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const chunk = await pending;
  clearTimeout(timeout);
  assert.match(new TextDecoder().decode(chunk.value), /remote-probe/);
  assert.equal((await invoke(REQUEST_CHANNELS.unwatch, { subscriptionId })).ok, true);
});
