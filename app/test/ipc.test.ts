import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcReply, ListBatch, ListReply } from "@symmetria/fm-core/contract";

import type { FsEntry } from "@symmetria/fm-core/entry";
import type { IpcMainInvokeEvent } from "electron";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CHANNELS, REQUEST_CHANNELS } from "../src/main/ipc/channels.ts";
import { electronIpcSurface } from "../src/main/ipc/electronSurface.ts";
import { createRegistry, type IpcHandler, type IpcSurface } from "../src/main/ipc/register.ts";

/**
 * A stand-in for Electron's `ipcMain`.
 *
 * The registry is deliberately handed its transport rather than importing
 * `electron`, so the routing, decoding and error handling are testable in plain
 * Node — the same reasoning that keeps `buildWindowOptions` and
 * `resolveWithinRoot` free of a runtime Electron import.
 */
interface FakeIpc extends IpcSurface {
  invoke(channel: string, payload: unknown): Promise<IpcReply>;
}

function fakeIpc(): FakeIpc {
  const handlers = new Map<string, IpcHandler>();
  return {
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`duplicate handler for ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) return Promise.reject(new Error(`no handler for ${channel}`));
      return handler(payload);
    },
  };
}

/** Names out of a successful list reply, sorted. */
function names(value: unknown): string[] {
  return (value as ListReply).entries.map((e: FsEntry) => e.name).sort();
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "symfm-ipc-"));
  await writeFile(join(root, "alpha.txt"), "twelve bytes");
  await writeFile(join(root, "beta.md"), "x");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the bridge returns what the main process produced", () => {
  it("lists a directory", async () => {
    const ipc = fakeIpc();
    createRegistry(ipc, { send: () => {} });

    const reply = await ipc.invoke(CHANNELS.list, { path: root });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(names(reply.value)).toEqual(["alpha.txt", "beta.md"]);
  });

  it("reports a failure as a value, never as a thrown error", async () => {
    const ipc = fakeIpc();
    createRegistry(ipc, { send: () => {} });

    const reply = await ipc.invoke(CHANNELS.list, { path: "/does/not/exist" });

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.code).toBe("scan_failed");
  });
});

describe("the boundary rejects before the handler runs", () => {
  it("never enters the handler on a malformed payload", async () => {
    const scan = vi.fn();
    const ipc = fakeIpc();
    createRegistry(ipc, { send: () => {} }, { scanDirectory: scan });

    const reply = await ipc.invoke(CHANNELS.list, { path: 7 });

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.code).toBe("invalid_request");
    // The point of decoding at the boundary: the handler is not merely given
    // bad input to cope with, it is never called at all.
    expect(scan).not.toHaveBeenCalled();
  });

  it("rejects a relative path without touching the filesystem", async () => {
    const scan = vi.fn();
    const ipc = fakeIpc();
    createRegistry(ipc, { send: () => {} }, { scanDirectory: scan });

    await ipc.invoke(CHANNELS.list, { path: "../../etc" });

    expect(scan).not.toHaveBeenCalled();
  });
});

describe("the channel surface is closed", () => {
  it("registers exactly the request channels, and nothing else", async () => {
    const registered: string[] = [];
    const ipc: IpcSurface = {
      handle(channel) {
        registered.push(channel);
      },
      removeHandler() {},
    };

    createRegistry(ipc, { send: () => {} });

    // Request channels only. A push channel is sent to and never handled, and
    // conflating the two made this assertion fail for a correct registry.
    expect(registered.sort()).toEqual(Object.values(REQUEST_CHANNELS).sort());
  });

  it("declares every channel under one prefix, so a stray one is obvious", () => {
    for (const channel of Object.values(CHANNELS)) {
      expect(channel.startsWith("symmetria-fm:")).toBe(true);
    }
  });

  it("refuses to register the same channel twice", () => {
    const ipc = fakeIpc();
    createRegistry(ipc, { send: () => {} });

    expect(() => createRegistry(ipc, { send: () => {} })).toThrow();
  });
});

describe("a large listing arrives in batches", () => {
  let big: string;

  beforeAll(async () => {
    big = await mkdtemp(join(tmpdir(), "symfm-ipc-big-"));
    await Promise.all(
      Array.from({ length: 10_000 }, (_, i) => writeFile(join(big, `e-${i}.txt`), "x")),
    );
  }, 180_000);

  afterAll(async () => {
    await rm(big, { recursive: true, force: true });
  });

  it("streams ten thousand entries as several messages, not one", async () => {
    // Transfer lists are NOT zero-copy in Electron: transfer and clone cost the
    // same, about 400 MB/s, so the entire cost of a large reply is copying. One
    // giant message blocks; batches let the first rows paint.
    const sent: { channel: string; payload: unknown }[] = [];
    const ipc = fakeIpc();
    createRegistry(ipc, { send: (channel, payload) => sent.push({ channel, payload }) });

    const reply = await ipc.invoke(CHANNELS.list, { path: big, stream: true });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect((reply.value as ListReply).total).toBe(10_000);

    const batches = sent.filter((m) => m.channel === CHANNELS.listBatch);
    expect(batches.length).toBeGreaterThan(1);

    const streamed = batches.flatMap((m) => (m.payload as ListBatch).entries);
    expect(streamed).toHaveLength(10_000);
  });
});

describe("cancellation reaches the work", () => {
  it("stops a scan that is still running", async () => {
    const ipc = fakeIpc();
    createRegistry(ipc, { send: () => {} });

    const started = performance.now();
    const pending = ipc.invoke(CHANNELS.list, { path: "/usr/lib", stream: true });
    await ipc.invoke(CHANNELS.cancel, { streamId: "all" });

    const reply = await pending;
    const elapsed = performance.now() - started;

    // Either it finished before the cancel arrived, or it was cancelled. What
    // must not happen is a cancel that is accepted and ignored.
    if (!reply.ok) expect(reply.error.code).toBe("cancelled");
    expect(elapsed).toBeLessThan(2000);
  });
});

/**
 * A guard for the mismatch the end-to-end smoke test found.
 *
 * `ipcMain.handle` calls its handler with `(event, ...args)`. The registry's
 * transport takes one argument. Wired directly, every handler received the
 * event where it expected the request and rejected it as `invalid_request` —
 * while these unit tests passed, because the fake transport encoded the
 * assumption rather than the API.
 */
describe("the Electron adapter", () => {
  it("drops the event argument, so the handler sees the request", async () => {
    // Electron's own shape: the invoke event first, then the payload.
    type ElectronHandler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<IpcReply>;
    const handlers = new Map<string, ElectronHandler>();
    const fakeIpcMain = {
      handle(channel: string, handler: ElectronHandler) {
        handlers.set(channel, handler);
      },
      removeHandler(channel: string) {
        handlers.delete(channel);
      },
    };

    // No cast. `electronIpcSurface` asks for exactly the two members it uses,
    // so this double satisfies it structurally — which is the point of the
    // narrow parameter type.
    const surface = electronIpcSurface(fakeIpcMain);
    createRegistry(surface, { send: () => {} });

    // Called the way Electron calls it: event first, payload second.
    const handler = handlers.get(CHANNELS.list);
    expect(handler).toBeDefined();
    if (!handler) return;

    // SAFETY: the adapter drops the event without reading it, which is the one
    // behaviour under test, so an empty stand-in is enough.
    const event = {} as IpcMainInvokeEvent;
    const reply = await handler(event, { path: root });

    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(names(reply.value)).toContain("alpha.txt");
  });
});
