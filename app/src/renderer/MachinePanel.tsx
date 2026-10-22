import { BRIDGE_KEY, type Bridge, type ExternalOpen } from "@symmetria/fm-core/bridge";
import type { ViewKind } from "@symmetria/fm-core/keys/types";
import { decodeMachines, type MachineId, type MachineInfo } from "@symmetria/fm-core/machines";
import { homeFromSearch, pickerFromSearch } from "@symmetria/fm-core/windowUrl";
import { App } from "@symmetria/fm-ui/App";
import { createFileManagerIo } from "@symmetria/fm-ui/bridge";
import { observeDiskUsage } from "@symmetria/fm-ui/diskUsage";
import { MachineChooser, MachineDock, type MachineStorage } from "@symmetria/fm-ui/machines";
import { createTabs, type TabsState } from "@symmetria/fm-ui/state/tabs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOfflineMachineProbe } from "./useOfflineMachineProbe.ts";

const LOCAL: MachineInfo = {
  id: "local",
  name: "Local",
  homePath: homeFromSearch(window.location.search),
  startPath: homeFromSearch(window.location.search),
  readOnly: false,
  error: null,
};
interface Connection {
  readonly machine: MachineInfo;
  readonly bridge: Bridge;
  readonly generation: number;
  readonly externalOpen: ExternalOpen | null;
}
function startPath(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1)) || LOCAL.startPath;
  } catch {
    return LOCAL.startPath;
  }
}
interface PanelOptions {
  readonly rowHeight: number;
  /** Waits between automatic reconnect probes. Tests shorten them. */
  readonly reconnectDelaysMs?: readonly number[];
}
export function MachinePanel({ rowHeight, reconnectDelaysMs }: PanelOptions) {
  const host = window[BRIDGE_KEY];
  if (!host?.forMachine || pickerFromSearch(window.location.search))
    return <App chrome="atmosphere" rowHeight={rowHeight} actionMenu />;
  return (
    <ConnectedMachines
      host={host}
      rowHeight={rowHeight}
      reconnectDelaysMs={reconnectDelaysMs}
    />
  );
}
function ConnectedMachines({
  host,
  rowHeight,
  reconnectDelaysMs,
}: PanelOptions & { readonly host: Bridge }) {
  const [machines, setMachines] = useState<readonly MachineInfo[]>([LOCAL]);
  const [connection, setConnection] = useState<Connection>(() => ({
    machine: LOCAL,
    bridge: boundBridge(host, "local"),
    generation: 0,
    externalOpen: null,
  }));
  const [choosing, setChoosing] = useState(false);
  const saved = useRef(new Map<MachineId, TabsState>([["local", createTabs(startPath())]]));
  const view = useRef<ViewKind>("miller");
  const selectionRequest = useRef(0);
  const storage = useMachineStorage(host, machines);
  const refresh = async () => {
    const reply = await host.machinesRead?.();
    if (!reply?.ok) return null;
    const decoded = decodeMachines(reply.value);
    if (!decoded.ok) return null;
    // An unchanged catalog keeps its identity, so a probe that finds Home
    // still offline does not reopen every storage meter.
    setMachines((previous) => (sameMachines(previous, decoded.value) ? previous : decoded.value));
    return decoded.value;
  };
  useEffect(() => {
    let current = true;
    void host.machinesRead?.().then((reply) => {
      if (!current || !reply.ok) return;
      const decoded = decodeMachines(reply.value);
      if (decoded.ok) setMachines(decoded.value);
    });
    return () => {
      current = false;
    };
  }, [host]);
  const switchTo = (machine: MachineInfo, externalOpen: ExternalOpen | null = null) => {
    if (machine.error === null && !saved.current.has(machine.id))
      saved.current.set(machine.id, createTabs(machine.startPath));
    connection.bridge.dispose?.();
    setConnection({
      machine,
      bridge: boundBridge(host, machine.id),
      generation: connection.generation + 1,
      externalOpen,
    });
  };
  const choose = async (id: MachineId) => {
    const machine = machines.find((candidate) => candidate.id === id);
    if (!machine) return;
    setChoosing(false);
    const request = ++selectionRequest.current;
    if (id === connection.machine.id && id === "local") return;
    if (machine.error === null && id !== connection.machine.id) {
      switchTo(machine);
      return;
    }
    const updated = await refresh();
    if (request !== selectionRequest.current) return;
    switchTo(updated?.find((candidate) => candidate.id === id) ?? machine);
  };
  // A lost connection stays dead in the main process. Recovery opens a new
  // one through the same path as a manual selection of the machine.
  const reconnectWhenOnline = async () => {
    const request = selectionRequest.current;
    const current = connection.machine.id;
    const wasOffline = machines.some((machine) => machine.id === current && machine.error !== null);
    const updated = await refresh();
    if (!wasOffline || request !== selectionRequest.current) return;
    const recovered = updated?.find((candidate) => candidate.id === current);
    if (recovered?.error === null) switchTo(recovered);
  };
  useOfflineMachineProbe(machines, reconnectWhenOnline, reconnectDelaysMs);
  useLocalOpenRedirect(host, connection.machine.id, (request) => {
    ++selectionRequest.current;
    switchTo(machines.find((candidate) => candidate.id === "local") ?? LOCAL, request);
  });
  useEffect(
    () =>
      connection.bridge.onConnectionLost?.((message) => {
        setMachines((previous) =>
          previous.map((machine) =>
            machine.id === connection.machine.id ? { ...machine, error: message } : machine,
          ),
        );
      }),
    [connection],
  );
  const machine = connection.machine;
  const initialTabs = saved.current.get(machine.id) ?? createTabs(machine.startPath);
  const open = () => setChoosing(true);
  const controls = {
    machines,
    current: machine.id,
    storage,
    choose: (id: MachineId) => {
      void choose(id);
    },
  };
  return (
    <>
      <App
        key={connection.generation}
        bridge={connection.bridge}
        chrome="atmosphere"
        actionMenu
        rowHeight={rowHeight}
        startPath={machine.startPath}
        homePath={machine.homePath}
        readOnly={machine.readOnly}
        initialTabs={initialTabs}
        initialExternalOpen={connection.externalOpen}
        onTabsChange={(tabs) => {
          if (machine.error === null) saved.current.set(machine.id, tabs);
        }}
        initialView={view.current}
        onViewChange={(kind) => {
          view.current = kind;
        }}
        onChooseMachine={open}
        chromeExtras={{
          railFooter: <MachineDock {...controls} />,
        }}
      />
      {choosing ? <MachineChooser {...controls} close={() => setChoosing(false)} /> : null}
    </>
  );
}
function sameMachines(left: readonly MachineInfo[], right: readonly MachineInfo[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function boundBridge(host: Bridge, machine: MachineId): Bridge {
  return host.forMachine?.(machine) ?? host;
}
function useMachineStorage(host: Bridge, machines: readonly MachineInfo[]): MachineStorage {
  const [storage, setStorage] = useState<MachineStorage>({});
  useEffect(() => {
    let current = true;
    const connections = machines.map((machine) => ({
      machine,
      bridge: boundBridge(host, machine.id),
    }));
    const stop = connections.map(({ machine, bridge }) =>
      observeDiskUsage(createFileManagerIo(bridge), machine.homePath, (usage) => {
        if (!current) return;
        setStorage((previous) => {
          const next = { ...previous };
          if (usage === null) delete next[machine.id];
          else next[machine.id] = usage;
          return next;
        });
      }),
    );
    return () => {
      current = false;
      for (const unsubscribe of stop) unsubscribe();
      for (const { bridge } of connections) bridge.dispose?.();
    };
  }, [host, machines]);
  return storage;
}

function useLocalOpenRedirect(
  host: Bridge,
  machine: MachineId,
  redirect: (request: ExternalOpen) => void,
): void {
  const io = useMemo(() => createFileManagerIo(host), [host]);
  const latest = useRef({ machine, redirect });
  useEffect(() => {
    latest.current = { machine, redirect };
  });
  useEffect(
    () =>
      io.onOpenPath((request) => {
        if (latest.current.machine === "home") latest.current.redirect(request);
      }),
    [io],
  );
}
