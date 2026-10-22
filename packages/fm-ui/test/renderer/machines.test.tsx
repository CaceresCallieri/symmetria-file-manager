/** @vitest-environment happy-dom */
import { BRIDGE_KEY, type Bridge } from "@symmetria/fm-core/bridge";
import { isRecord, success } from "@symmetria/fm-core/contract";
import { DEFAULT_LISTING_OPTIONS } from "@symmetria/fm-core/listingOptions";
import type { MachineId, MachineInfo } from "@symmetria/fm-core/machines";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MachinePanel } from "../../../../app/src/renderer/MachinePanel.tsx";
import { App } from "../../src/App.tsx";
import { createFileManagerIo } from "../../src/bridge.ts";
import { cursorIn, inertBridge, installBridge } from "./support.ts";

const machines: readonly MachineInfo[] = [
  { id: "local", name: "Local", homePath: "/", startPath: "/", readOnly: false, error: null },
  {
    id: "home",
    name: "Vigilia Home",
    homePath: "/server",
    startPath: "/server",
    readOnly: true,
    error: null,
  },
];
function machineBridge(id: MachineId): Bridge {
  return {
    ...inertBridge(),
    list: async () =>
      success({
        entries: [
          {
            name: "folder",
            kind: "directory",
            size: 0,
            modifiedMs: 0,
            isSymlink: false,
            isHidden: false,
          },
          {
            name: `${id}.txt`,
            kind: "file",
            size: 4,
            modifiedMs: 0,
            isSymlink: false,
            isHidden: false,
          },
        ],
        total: 2,
        streamId: null,
      }),
    overview: async () =>
      success({
        entries: [{ name: `${id}.txt`, kind: "file", isHidden: false, isSymlink: false }],
        inspected: 1,
        truncated: false,
      }),
    describe: async (request) => {
      const path = isRecord(request) && typeof request.path === "string" ? request.path : "/";
      return success({
        path,
        name: path.split("/").pop(),
        isDirectory: !path.endsWith(".txt"),
        entryCount: 0,
        entries: [],
        size: 4,
        mime: "text/plain",
        head: new Uint8Array([104, 111, 109, 101]),
      });
    },
    readText: async () => success({ text: `${id} contents`, bytesRead: 4, truncated: false }),
    dispose: vi.fn(),
  };
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, BRIDGE_KEY, { configurable: true, value: undefined });
});
function key(key: string) {
  fireEvent.keyDown(document.activeElement ?? window, { key });
}
function currentMachine(): string {
  return (
    within(screen.getByTestId("machine-dock")).getByRole("button", { pressed: true }).textContent ??
    ""
  );
}
it("switches real panels without a reload and retains each machine's tabs under StrictMode", async () => {
  const factory = vi.fn(machineBridge);
  const listeners = new Set<(payload: unknown) => void>();
  Object.defineProperty(window, BRIDGE_KEY, {
    configurable: true,
    value: {
      ...inertBridge(),
      machinesRead: async () => success(machines),
      forMachine: factory,
      onOpenPath: (listener: (payload: unknown) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  });
  render(
    <StrictMode>
      <MachinePanel rowHeight={31} />
    </StrictMode>,
  );
  const homeButton = await screen.findByRole("button", { name: "Browse Vigilia Home" });
  expect(screen.queryByRole("button", { name: "Choose a machine (m)" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Browse Local" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  homeButton.focus();
  const activation = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  homeButton.dispatchEvent(activation);
  expect(activation.defaultPrevented).toBe(false);
  homeButton.blur();
  await waitFor(() =>
    expect(within(screen.getByTestId("column-current")).getByText("local.txt")).toBeTruthy(),
  );
  fireEvent.keyDown(window, { key: "t" });
  await waitFor(() => expect(screen.getAllByTestId("tab")).toHaveLength(2));
  fireEvent.keyDown(window, { key: "m" });
  expect(screen.getByRole("dialog", { name: "Choose a machine" })).toBeTruthy();
  key("j");
  key("Enter");
  // Synthetic Enter has no native click default in happy-dom.
  fireEvent.click(
    document.activeElement ?? screen.getByText("Vigilia Home", { selector: "strong" }),
  );
  await waitFor(() => expect(currentMachine()).toContain("Vigilia Home"));
  expect(currentMachine()).toContain("Read-only");
  await waitFor(() =>
    expect(within(screen.getByTestId("column-current")).getByText("home.txt")).toBeTruthy(),
  );
  fireEvent.keyDown(window, { key: "a" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(window, { key: "m" });
  key("l");
  await waitFor(() => expect(currentMachine()).toContain("Local"));
  expect(screen.getAllByTestId("tab")).toHaveLength(2);
  fireEvent.keyDown(window, { key: "m" });
  key("h");
  await waitFor(() => expect(currentMachine()).toContain("Vigilia Home"));
  for (const listener of listeners) listener({ path: "/outside", reveal: "/outside/local.txt" });
  await waitFor(() => expect(currentMachine()).toContain("Local"));
  await waitFor(() =>
    expect(screen.getAllByTestId("tab").some((tab) => tab.title === "/outside")).toBe(true),
  );

  expect(
    factory.mock.results.some(
      (result) =>
        result.type === "return" &&
        result.value.dispose &&
        vi.mocked(result.value.dispose).mock.calls.length > 0,
    ),
  ).toBe(true);
});
it("keeps delayed reads and watches bound to the original bridge", async () => {
  let finish: ((reply: Awaited<ReturnType<Bridge["list"]>>) => void) | undefined;
  const original = {
    ...machineBridge("local"),
    list: () =>
      new Promise<Awaited<ReturnType<Bridge["list"]>>>((resolve) => {
        finish = resolve;
      }),
    unwatch: vi.fn(async () => success(null)),
  };
  const other = { ...machineBridge("home"), unwatch: vi.fn(async () => success(null)) };
  const local = createFileManagerIo(original);
  const home = createFileManagerIo(other);
  const options = DEFAULT_LISTING_OPTIONS;
  const pending = local.listDirectory("/same", options);
  Object.defineProperty(window, BRIDGE_KEY, { configurable: true, value: other });
  expect(await home.listDirectory("/same", options)).toMatchObject({
    ok: true,
    value: { entries: expect.arrayContaining([expect.objectContaining({ name: "home.txt" })]) },
  });
  finish?.(success({ entries: [], total: 0, streamId: null }));
  expect(await pending).toMatchObject({ ok: true, value: { entries: [] } });
  const stop = await local.watchDirectory("/same", "same", () => {});
  await stop();
  await waitFor(() => expect(original.unwatch).toHaveBeenCalled());
  expect(other.unwatch).not.toHaveBeenCalled();
});
it("publishes tab state without treating a host callback's return value as cleanup", async () => {
  const snapshots: unknown[] = [];
  render(
    <StrictMode>
      <App
        bridge={machineBridge("local")}
        startPath="/"
        onTabsChange={(state) => snapshots.push(state)}
      />
    </StrictMode>,
  );
  await screen.findByText("local.txt");
  expect(snapshots.length).toBeGreaterThan(0);
});

function installMachines(
  overrides: Partial<Bridge> = {},
  factory: (id: MachineId) => Bridge = machineBridge,
  catalog = async () => success(machines),
  reconnectDelaysMs?: readonly number[],
) {
  const bridges: Bridge[] = [];
  const listeners = new Set<(payload: unknown) => void>();
  Object.defineProperty(window, BRIDGE_KEY, {
    configurable: true,
    value: {
      ...inertBridge(),
      machinesRead: catalog,
      forMachine: (id: MachineId) => {
        const bridge = { ...factory(id), ...overrides };
        bridges.push(bridge);
        return bridge;
      },
      onOpenPath: (listener: (payload: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  render(<MachinePanel rowHeight={31} reconnectDelaysMs={reconnectDelaysMs} />);
  return { bridges, listeners };
}
async function selectHome() {
  fireEvent.click(await screen.findByRole("button", { name: "Browse Vigilia Home" }));
  await waitFor(() => expect(currentMachine()).toContain("Vigilia Home"));
  await waitFor(() =>
    expect(within(screen.getByTestId("column-current")).getByText("home.txt")).toBeTruthy(),
  );
}
it.each(["Columns", "Tree"])(
  "opens the Home %s file with Enter and double-click, then resets the reader",
  async (view) => {
    installMachines();
    await selectHome();
    if (view === "Tree") {
      fireEvent.click(screen.getByRole("button", { name: /^File tree/ }));
      await screen.findByRole("tree");
      await waitFor(() =>
        expect(
          screen.getByRole("tree").querySelector('[data-path="/server/home.txt"]'),
        ).toBeTruthy(),
      );
    }
    const row = () =>
      view === "Tree"
        ? screen.getByRole("tree").querySelector('[data-path="/server/home.txt"]')
        : within(screen.getByTestId("column-current")).getByText("home.txt");
    const target = row();
    if (!target) throw new Error("Missing file row");
    fireEvent.click(target);
    fireEvent.keyDown(window, { key: "Enter" });
    const reader = await screen.findByTestId("reader");
    await waitFor(() => expect(reader.textContent).toContain("home contents"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("reader")).toBeNull());
    const second = row();
    if (!second) throw new Error("Missing file row");
    fireEvent.doubleClick(second);
    await waitFor(() =>
      expect(screen.getByTestId("reader").textContent).toContain("home contents"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse Local" }));
    await waitFor(() => expect(currentMachine()).toContain("Local"));
    expect(screen.queryByTestId("reader")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Browse Vigilia Home" }));
    await waitFor(() => expect(currentMachine()).toContain("Vigilia Home"));
    expect(screen.queryByTestId("reader")).toBeNull();
  },
);
it.each(["Tree", "Overview"])(
  "retains %s across switches and clears temporary search",
  async (view) => {
    installMachines();
    await selectHome();
    fireEvent.click(
      screen.getByRole("button", { name: view === "Tree" ? /^File tree/ : /^Folder overview/ }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: view === "Tree" ? /^File tree/ : /^Folder overview/ })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse Local" }));
    await waitFor(() => expect(currentMachine()).toContain("Local"));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: view === "Tree" ? /^File tree/ : /^Folder overview/ })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse Vigilia Home" }));
    await waitFor(() => expect(currentMachine()).toContain("Vigilia Home"));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: view === "Tree" ? /^File tree/ : /^Folder overview/ })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
    fireEvent.keyDown(window, { key: "/" });
    expect(screen.getByRole("textbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Browse Local" }));
    await waitFor(() => expect(currentMachine()).toContain("Local"));
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);
it("shows a connection loss in the dock and still reconnects on selection", async () => {
  const callbacks = new Set<(message: string) => void>();
  installMachines({
    onConnectionLost: (listener) => {
      callbacks.add(listener);
      return () => callbacks.delete(listener);
    },
  });
  await selectHome();
  for (const notify of callbacks) notify("Home disconnected");
  await waitFor(() => expect(currentMachine()).toContain("Offline · reconnecting"));
  fireEvent.click(screen.getByRole("button", { name: "Browse Vigilia Home" }));
  await waitFor(() => expect(currentMachine()).toContain("Read-only"));
});
const FAST_RECONNECT_MS: readonly number[] = [50];
it("reconnects a lost Home connection without a manual selection", async () => {
  const callbacks = new Set<(message: string) => void>();
  let online = true;
  let probes = 0;
  const { bridges } = installMachines(
    {
      onConnectionLost: (listener) => {
        callbacks.add(listener);
        return () => callbacks.delete(listener);
      },
    },
    machineBridge,
    async () => {
      probes++;
      return success(
        online
          ? machines
          : machines.map((machine) =>
              machine.id === "home"
                ? { ...machine, error: "Home refused the connection" }
                : machine,
            ),
      );
    },
    FAST_RECONNECT_MS,
  );
  await selectHome();
  online = false;
  const before = probes;
  for (const notify of [...callbacks]) notify("Home disconnected");
  await waitFor(() => expect(currentMachine()).toContain("Offline · reconnecting"));
  await waitFor(() => expect(probes).toBeGreaterThan(before + 1));
  expect(currentMachine()).toContain("Offline · reconnecting");
  const bridgesWhileOffline = bridges.length;
  online = true;
  await waitFor(() => expect(currentMachine()).toContain("Read-only"));
  expect(bridges.length).toBeGreaterThan(bridgesWhileOffline);
  await waitFor(() =>
    expect(within(screen.getByTestId("column-current")).getByText("home.txt")).toBeTruthy(),
  );
  const settled = probes;
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(probes).toBe(settled);
});
it("does not switch to Home when a probe finds it while Local is current", async () => {
  let online = false;
  installMachines(
    {},
    machineBridge,
    async () =>
      success(
        online
          ? machines
          : machines.map((machine) =>
              machine.id === "home" ? { ...machine, error: "offline" } : machine,
            ),
      ),
    FAST_RECONNECT_MS,
  );
  const homeButton = await screen.findByRole("button", { name: "Browse Vigilia Home" });
  await waitFor(() => expect(homeButton.textContent).toContain("Offline · reconnecting"));
  online = true;
  await waitFor(() => expect(homeButton.textContent).toContain("Read-only"));
  expect(currentMachine()).toContain("Local");
});
it("does not retain the offline placeholder folder on the first successful connection", async () => {
  let online = false;
  installMachines({}, machineBridge, async () =>
    success(
      online
        ? machines
        : machines.map((machine) =>
            machine.id === "home"
              ? { ...machine, startPath: "/", homePath: "/", error: "offline" }
              : machine,
          ),
    ),
  );
  await selectHome();
  online = true;
  fireEvent.click(screen.getByRole("button", { name: "Browse Vigilia Home" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("tab").some((tab) => tab.title === "/server")).toBe(true),
  );
});

it("uses Local reveal rules for a hidden file requested while Home is active", async () => {
  const log = installBridge();
  const original = window[BRIDGE_KEY];
  if (!original) throw new Error("No Local bridge");
  const { listeners } = installMachines({}, (id) =>
    id === "local" ? original : machineBridge(id),
  );
  await selectHome();
  await act(async () => {
    for (const listener of listeners)
      listener({ path: "/home/jc/dotted", reveal: "/home/jc/dotted/.secret" });
  });
  await waitFor(() => expect(currentMachine()).toContain("Local"));
  await waitFor(() => expect(cursorIn("column-current")).toContain(".secret"));
  expect(log.listAsks.filter((ask) => ask.path === "/home/jc/dotted").at(-1)?.showHidden).toBe(
    true,
  );
});

it("returns keyboard navigation to the files after dock activation", async () => {
  const open = vi.fn(async () => success(null));
  installMachines({ open });
  const home = await screen.findByRole("button", { name: "Browse Vigilia Home" });
  home.focus();
  fireEvent.click(home);
  await waitFor(() => expect(currentMachine()).toContain("Vigilia Home"));
  const file = await within(screen.getByTestId("column-current")).findByText("home.txt");
  fireEvent.mouseDown(file);
  fireEvent.click(file);
  key("Enter");
  await waitFor(() => expect(screen.getByTestId("reader").textContent).toContain("home contents"));
  fireEvent.keyDown(window, { key: "Escape" });
  const local = screen.getByRole("button", { name: "Browse Local" });
  fireEvent.click(local);
  await waitFor(() => expect(currentMachine()).toContain("Local"));
  const current = screen.getByRole("button", { name: "Browse Local" });
  current.focus();
  fireEvent.click(current);
  const localFile = await within(screen.getByTestId("column-current")).findByText("local.txt");
  fireEvent.mouseDown(localFile);
  fireEvent.click(localFile);
  key("Enter");
  await waitFor(() => expect(open).toHaveBeenCalledWith({ path: "/local.txt" }));
});
