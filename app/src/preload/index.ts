import { BRIDGE_KEY, type Bridge, type Unsubscribe } from "@symmetria/fm-core/bridge";
import { failure, isRecord, type Result, success } from "@symmetria/fm-core/contract";
import {
  MACHINE_CLOSE_CHANNEL,
  MACHINE_LOST_CHANNEL,
  MACHINE_OPEN_CHANNEL,
  MACHINES_CHANNEL,
  type MachineId,
} from "@symmetria/fm-core/machines";
import { PUSH_CHANNELS, REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import { contextBridge, ipcRenderer } from "electron";

/**
 * The preload runs with Node available, inside the renderer process. Anything
 * attached to `window` here becomes reachable from sandboxed page code, so this
 * file exposes exactly one object holding plain functions — never a module,
 * never `ipcRenderer` itself, and never a function that takes a channel name
 * from the caller. A bridge that lets page code choose the channel is not a
 * bridge, it is a hole with a railing.
 *
 * There is one `exposeInMainWorld` call in this file and a test asserts that
 * count, because "exactly one" is the property worth pinning.
 */

function rawListen(channel: string, listener: (payload: unknown) => void): Unsubscribe {
  const wrapped = (_event: unknown, payload: unknown) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

interface BridgeTransport {
  invoke(channel: string, payload: unknown): Promise<Result<unknown>>;
  listen(channel: string, listener: (payload: unknown) => void): Unsubscribe;
}
function buildBridge(transport: BridgeTransport): Bridge {
  return {
    version: process.versions.electron ?? "unknown",
    fileActionInspect: (request) => transport.invoke(REQUEST_CHANNELS.fileActionInspect, request),
    fileActionExecute: (request) => transport.invoke(REQUEST_CHANNELS.fileActionExecute, request),
    fileActionCancel: (request) => transport.invoke(REQUEST_CHANNELS.fileActionCancel, request),
    overview: (request) => transport.invoke(REQUEST_CHANNELS.overview, request),
    list: (request) => transport.invoke(REQUEST_CHANNELS.list, request),
    watch: (request) => transport.invoke(REQUEST_CHANNELS.watch, request),
    unwatch: (request) => transport.invoke(REQUEST_CHANNELS.unwatch, request),
    readText: (request) => transport.invoke(REQUEST_CHANNELS.readText, request),
    cancel: (request) => transport.invoke(REQUEST_CHANNELS.cancel, request),
    searchStart: (request) => transport.invoke(REQUEST_CHANNELS.searchStart, request),
    searchQuery: (request) => transport.invoke(REQUEST_CHANNELS.searchQuery, request),
    searchRecord: (request) => transport.invoke(REQUEST_CHANNELS.searchRecord, request),
    searchRelease: (request) => transport.invoke(REQUEST_CHANNELS.searchRelease, request),
    describe: (request) => transport.invoke(REQUEST_CHANNELS.describe, request),
    previewUrl: (request) => transport.invoke(REQUEST_CHANNELS.previewUrl, request),
    previewDirectoryUrl: (request) =>
      transport.invoke(REQUEST_CHANNELS.previewDirectoryUrl, request),
    transfer: (request) => transport.invoke(REQUEST_CHANNELS.transfer, request),
    cancelTransfer: (request) => transport.invoke(REQUEST_CHANNELS.cancelTransfer, request),
    create: (request) => transport.invoke(REQUEST_CHANNELS.create, request),
    rename: (request) => transport.invoke(REQUEST_CHANNELS.rename, request),
    trash: (request) => transport.invoke(REQUEST_CHANNELS.trash, request),
    open: (request) => transport.invoke(REQUEST_CHANNELS.open, request),
    clipboard: (request) => transport.invoke(REQUEST_CHANNELS.clipboard, request),
    frecent: (request) => transport.invoke(REQUEST_CHANNELS.frecent, request),
    diskUsage: (request) => transport.invoke(REQUEST_CHANNELS.diskUsage, request),
    places: (request) => transport.invoke(REQUEST_CHANNELS.places, request),
    bookmarksRead: (request) => transport.invoke(REQUEST_CHANNELS.bookmarksRead, request),
    bookmarksWrite: (request) => transport.invoke(REQUEST_CHANNELS.bookmarksWrite, request),
    listingRead: (request) => transport.invoke(REQUEST_CHANNELS.listingRead, request),
    listingWrite: (request) => transport.invoke(REQUEST_CHANNELS.listingWrite, request),
    hideWindow: (request) => transport.invoke(REQUEST_CHANNELS.hideWindow, request),
    pickerConfirm: (request) => transport.invoke(REQUEST_CHANNELS.pickerConfirm, request),
    pickerCancel: (request) => transport.invoke(REQUEST_CHANNELS.pickerCancel, request),
    onListBatch: (listener) => transport.listen(PUSH_CHANNELS.listBatch, listener),
    onChanged: (listener) => transport.listen(PUSH_CHANNELS.changed, listener),
    onTransferProgress: (listener) => transport.listen(PUSH_CHANNELS.transferProgress, listener),
    onOpenPath: (listener) => transport.listen(PUSH_CHANNELS.openPath, listener),
  };
}

function machineBridge(machine: MachineId): Bridge {
  let opened: Promise<Result<string>> | null = null;
  let id: string | null = null;
  let closed = false;
  const ensure = (): Promise<Result<string>> => {
    if (closed) return Promise.resolve(failure("read_failed", "Machine connection is closed"));
    if (opened !== null) return opened;
    const attempt = ipcRenderer
      .invoke(MACHINE_OPEN_CHANNEL, { machine })
      .then((raw: unknown): Result<string> => {
        if (
          !isRecord(raw) ||
          raw.ok !== true ||
          !isRecord(raw.value) ||
          typeof raw.value.id !== "string"
        )
          return failure("read_failed", "Could not open machine connection");
        id = raw.value.id;
        return success(id);
      })
      .catch((): Result<string> => failure("read_failed", "Could not open machine connection"));
    opened = attempt;
    void attempt.then((reply) => {
      if (!reply.ok && opened === attempt) opened = null;
    });
    return attempt;
  };
  return {
    onConnectionLost: (listener) =>
      rawListen(MACHINE_LOST_CHANNEL, (raw) => {
        if (isRecord(raw) && raw.fmContext === id && typeof raw.payload === "string")
          listener(raw.payload);
      }),
    ...buildBridge({
      invoke: async (channel, payload) => {
        const connection = await ensure();
        return connection.ok
          ? ipcRenderer.invoke(channel, { fmContext: connection.value, payload })
          : connection;
      },
      listen: (channel, listener) =>
        rawListen(channel, (raw) => {
          if (!isRecord(raw) || raw.fmContext !== id) return;
          listener(raw.payload);
        }),
    }),
    onOpenPath:
      machine === "local"
        ? (listener) => rawListen(PUSH_CHANNELS.openPath, listener)
        : () => () => {},
    dispose: () => {
      closed = true;
      if (opened === null) return;
      void opened.then((connection) => {
        if (connection.ok) void ipcRenderer.invoke(MACHINE_CLOSE_CHANNEL, { id: connection.value });
      });
    },
  };
}
const bridge: Bridge = {
  ...buildBridge({
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    listen: (channel, listener) =>
      rawListen(channel, (raw) => {
        if (isRecord(raw) && typeof raw.fmContext === "string") return;
        listener(raw);
      }),
  }),
  machinesRead: () => ipcRenderer.invoke(MACHINES_CHANNEL, {}),
  forMachine: machineBridge,
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
