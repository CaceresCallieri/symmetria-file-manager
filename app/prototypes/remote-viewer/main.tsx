import { BRIDGE_KEY, type Bridge } from "@symmetria/fm-core/bridge";
import { App } from "@symmetria/fm-ui/App";
import { createRoot } from "react-dom/client";
import "@symmetria/fm-ui/theme/tokens.css";
import "@symmetria/fm-ui/styles.css";
import "@symmetria/fm-ui/syntax-wine.css";
import "../../src/renderer/atmosphere.css";
import "./style.css";

import { createRemoteBridge } from "./bridge.ts";
import { createLocalSampleBridge, LOCAL_HOME } from "./localSample.ts";
import { MachineStudy } from "./MachineStudy.tsx";
import { currentMachine, startingPath } from "./machineNavigation.ts";

async function start(): Promise<void> {
  const host = document.getElementById("root");
  const status = document.getElementById("connection-status");
  if (host === null || status === null) throw new Error("prototype markup is incomplete");
  await authenticate();
  const response = await fetch("/host");
  if (!response.ok) throw new Error("Open the access link to connect to Home server");
  const info: { homePath: string; startPath: string; machine: string } = await response.json();
  const remote = createRemoteBridge(() => {
    status.textContent = "Disconnected — reconnect to continue";
    status.dataset.connected = "false";
  });
  const bridge = selectedBridge(remote);
  const { homePath, startPath } = selectedPaths(info);
  Object.defineProperty(window, BRIDGE_KEY, { value: bridge });
  document.body.dataset.machine = currentMachine;
  status.textContent = `Connected to ${info.machine}`;
  status.dataset.connected = "true";
  document.documentElement.style.setProperty("--row-height", "31px");
  createRoot(host).render(
    <>
      <App
        readOnly={currentMachine === "home"}
        chrome="atmosphere"
        rowHeight={31}
        startPath={startingPath(startPath)}
        homePath={homePath}
      />
      <MachineStudy remote={remote} homePath={info.homePath} />
    </>,
  );
}

function selectedBridge(remote: Bridge): Bridge {
  return currentMachine === "local" ? createLocalSampleBridge() : remote;
}

function selectedPaths(info: { homePath: string; startPath: string }) {
  return currentMachine === "local" ? { homePath: LOCAL_HOME, startPath: LOCAL_HOME } : info;
}

async function authenticate(): Promise<void> {
  const token = window.location.hash.slice(1);
  // Remove the access token from the address bar before a file is previewed.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (token !== "") {
    const response = await fetch("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw new Error("The access link is invalid");
  }
}

document.getElementById("reconnect")?.addEventListener("click", () => window.location.reload());
void start().catch((cause: unknown) => {
  const status = document.getElementById("connection-status");
  if (status !== null) status.textContent = cause instanceof Error ? cause.message : String(cause);
});
