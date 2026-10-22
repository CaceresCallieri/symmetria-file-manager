import type { Bridge, ExternalOpen } from "@symmetria/fm-core/bridge";
import type { MachineId, MachineInfo } from "@symmetria/fm-core/machines";
import { createTabs, type TabsState } from "@symmetria/fm-ui/state/tabs";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

interface Connection {
  readonly machine: MachineInfo;
  readonly bridge: Bridge;
  readonly generation: number;
  readonly externalOpen: ExternalOpen | null;
}
export interface LiveConnection {
  /** The mounted connection, for rendering. */
  readonly connection: Connection;
  /** The current connection is dead and needs a recovery probe. */
  readonly reconnecting: boolean;
  /** The mounted connection now, for a caller that resumes after an await. */
  readonly current: () => Connection;
  readonly isDead: () => boolean;
  /** Every selection and every switch bumps it; a waiting caller compares it. */
  readonly selectionRequest: RefObject<number>;
  readonly switchTo: (machine: MachineInfo, externalOpen?: ExternalOpen | null) => void;
}

export function boundBridge(host: Bridge, machine: MachineId): Bridge {
  return host.forMachine?.(machine) ?? host;
}

/**
 * Own the mounted machine connection. Async callers read it and its health
 * through refs, never through a render's closure: a probe or a selection that
 * finishes after another switch must not dispose a bridge twice or reuse a
 * generation.
 */
export function useLiveConnection(
  host: Bridge,
  initial: MachineInfo,
  saved: RefObject<Map<MachineId, TabsState>>,
  setMachines: Dispatch<SetStateAction<readonly MachineInfo[]>>,
): LiveConnection {
  const [connection, setConnection] = useState<Connection>(() => ({
    machine: initial,
    bridge: boundBridge(host, initial.id),
    generation: 0,
    externalOpen: null,
  }));
  const live = useRef(connection);
  const dead = useRef(false);
  const selectionRequest = useRef(0);
  const [reconnecting, setReconnecting] = useState(false);
  const switchTo = (machine: MachineInfo, externalOpen: ExternalOpen | null = null) => {
    if (machine.error === null && !saved.current.has(machine.id))
      saved.current.set(machine.id, createTabs(machine.startPath));
    const previous = live.current;
    previous.bridge.dispose?.();
    const next: Connection = {
      machine,
      bridge: boundBridge(host, machine.id),
      generation: previous.generation + 1,
      externalOpen,
    };
    live.current = next;
    ++selectionRequest.current;
    dead.current = machine.error !== null;
    setReconnecting(dead.current);
    setConnection(next);
  };
  useEffect(
    () =>
      connection.bridge.onConnectionLost?.((message) => {
        // A late loss from a replaced connection says nothing about the current one.
        if (live.current !== connection) return;
        dead.current = true;
        setReconnecting(true);
        setMachines((previous) =>
          previous.map((machine) =>
            machine.id === connection.machine.id ? { ...machine, error: message } : machine,
          ),
        );
      }),
    [connection, setMachines],
  );
  return {
    connection,
    reconnecting,
    current: () => live.current,
    isDead: () => dead.current,
    selectionRequest,
    switchTo,
  };
}
