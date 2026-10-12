import type { Bridge } from "@symmetria/fm-core/bridge";
import { decodeDiskUsageReply } from "@symmetria/fm-core/contract";
import type { MachineInfo } from "@symmetria/fm-core/machines";
import { MachineChooser, MachineDock, type MachineStorage } from "@symmetria/fm-ui/machines";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LOCAL_HOME, LOCAL_STORAGE } from "./localSample.ts";
import { listenForMachineKey } from "./machineKeys.ts";
import {
  currentMachine,
  MACHINE_NAMES,
  MACHINES,
  navigateMachine,
  restoreView,
} from "./machineNavigation.ts";

function useStorage(remote: Bridge, homePath: string): MachineStorage {
  const [storage, setStorage] = useState<MachineStorage>({ local: LOCAL_STORAGE });
  useEffect(() => {
    let current = true;
    const read = () =>
      void remote.diskUsage?.({ path: homePath }).then((raw) => {
        if (!raw.ok) return;
        const reply = decodeDiskUsageReply(raw.value);
        if (current && reply.ok) setStorage({ local: LOCAL_STORAGE, home: reply.value });
      });
    read();
    const timer = window.setInterval(read, 30_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [remote, homePath]);
  return storage;
}
function useChromeSlots() {
  const [rail, setRail] = useState<Element | null>(null);
  useLayoutEffect(() => {
    const rail = document.querySelector(".atmo-rail");
    if (rail === null) return;
    setRail(rail);
    restoreView();
  }, []);
  return rail;
}
export function MachineStudy({
  remote,
  homePath,
}: {
  readonly remote: Bridge;
  readonly homePath: string;
}) {
  const storage = useStorage(remote, homePath);
  const rail = useChromeSlots();
  const [choosing, setChoosing] = useState(false);
  useEffect(() => listenForMachineKey(() => setChoosing(true)), []);
  const machines: readonly MachineInfo[] = MACHINES.map((id) => ({
    id,
    name: MACHINE_NAMES[id],
    homePath: sampleHome(id, homePath),
    startPath: homePath,
    readOnly: id === "home",
    error: null,
  }));
  const choose = (id: "local" | "home") => {
    chooseStudyMachine(id, () => setChoosing(false));
  };
  const controls = { machines, current: currentMachine, storage, choose };
  return (
    <>
      {rail ? createPortal(<MachineDock {...controls} />, rail) : null}
      {choosing ? <MachineChooser {...controls} close={() => setChoosing(false)} /> : null}
    </>
  );
}

function sampleHome(id: "local" | "home", homePath: string): string {
  return id === "local" ? LOCAL_HOME : homePath;
}
function chooseStudyMachine(id: "local" | "home", close: () => void): void {
  if (id === currentMachine) close();
  else navigateMachine(id);
}
