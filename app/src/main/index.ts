import { fileURLToPath, pathToFileURL } from "node:url";

import { app, BrowserWindow, ipcMain } from "electron";

import { BRIDGE_KEY } from "../preload/bridge.ts";
import { electronIpcSurface } from "./ipc/electronSurface.ts";
import { createRegistry } from "./ipc/register.ts";
import { APP_ENTRY_URL, handleAppScheme, registerAppScheme } from "./protocol.ts";
import { buildWindowOptions } from "./window.ts";

// Must happen before the app is ready. See `protocol.ts` for why the renderer
// is not served over `file://`.
registerAppScheme();

/**
 * Set by the smoke test. Never set in normal use.
 */
const SMOKE = process.env.SYMMETRIA_FM_SMOKE === "1";

/**
 * There is no `app.setDesktopName()` in Electron 41 — an earlier draft of the
 * plan said there was, and it is wrong. Electron reads the Linux desktop-entry
 * name from the `desktopName` field of `package.json`, which is where
 * `symmetria-fm-electron.desktop` is declared.
 *
 * That identifier is deliberately distinct from the Qt build's `symmetria-fm`
 * so the two applications can run side by side while the rewrite is built. Qt's
 * three-way desktop-entry contract is documented in CLAUDE.md under Service &
 * Portal; the Electron equivalent is four-way, and `desktopName` is one corner.
 */
app.setName("Symmetria File Manager");

let shownOnReadyToShow = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow(buildWindowOptions());

  // Show only once the renderer has something to paint. Paired with the
  // background colour in `buildWindowOptions`, this is what removes the white
  // flash on open.
  window.once("ready-to-show", () => {
    shownOnReadyToShow = true;
    window.show();
  });

  // The starting directory travels in the URL fragment. A fragment never
  // reaches the scheme handler — it is resolved in the page — so this adds a
  // parameter without widening the surface `protocol.ts` has to validate.
  void window.loadURL(`${APP_ENTRY_URL}#${encodeURIComponent(app.getPath("home"))}`);
  return window;
}

/** The built page's own `file://` URL, used as the probe target. */
function ownPageFileUrl(): string {
  return pathToFileURL(
    fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
  ).toString();
}

/**
 * Launch, report on the running application, and exit.
 *
 * This exists so the smoke test can assert facts that only hold in a real
 * process — above all that the sandboxed renderer cannot reach the filesystem.
 * The probes run in the renderer's main world, which is the world page code
 * sees, so a pass here means page code genuinely has no way through.
 */
async function reportAndQuit(window: BrowserWindow): Promise<void> {
  const probe = await window.webContents.executeJavaScript(`(async () => ({
    rendererCanRequireFs: (() => {
      try { return typeof require === "function" && !!require("node:fs"); }
      catch { return false; }
    })(),
    rendererHasNodeProcess: typeof process !== "undefined",
    rendererBridgePresent: typeof window[${JSON.stringify(BRIDGE_KEY)}] === "object",
    // The route verification found open: a page on a file:// origin may fetch
    // any other file:// resource. Probed here so it can never reopen silently.
    //
    // The target is the application's OWN page, by absolute file path. It is
    // certain to exist and to be readable, so a negative result means the
    // origin has no file:// privilege — and cannot mean "that file happened to
    // be missing", which is what a probe against a system path would allow.
    rendererCanFetchLocalFile: await fetch(${JSON.stringify(ownPageFileUrl())})
      .then((r) => r.ok)
      .catch(() => false),
    rendererOrigin: window.location.protocol,
    // The bridge, exercised from page code. This is the criterion the phase is
    // for: the renderer has no filesystem, so a listing it can name proves the
    // only route to the disk works, and works from the sandbox.
    bridgeList: await (async () => {
      try {
        const reply = await window[${JSON.stringify(BRIDGE_KEY)}].list({ path: "/usr", showHidden: false });
        return reply.ok ? reply.value.entries.length : "err:" + reply.error.code;
      } catch (e) { return "threw:" + String(e); }
    })(),
    bridgeRejectsBadInput: await (async () => {
      try {
        const reply = await window[${JSON.stringify(BRIDGE_KEY)}].list({ path: 7 });
        return reply.ok === false && reply.error.code === "invalid_request";
      } catch { return false; }
    })(),
    bridgeKeys: Object.keys(window[${JSON.stringify(BRIDGE_KEY)}]).sort().join(","),
  }))()`);

  process.stdout.write(
    `SMOKE_REPORT ${JSON.stringify({
      ...probe,
      windowCount: BrowserWindow.getAllWindows().length,
      title: window.getTitle(),
      shownOnReadyToShow,
    })}\n`,
  );

  app.exit(0);
}

app.whenReady().then(() => {
  handleAppScheme();
  const window = createWindow();

  // The renderer has no filesystem of its own, so this registry is the only
  // way it reaches one. Bound to this window's sender: a push goes to the
  // window that asked, never broadcast to whatever else might be listening.
  const registry = createRegistry(electronIpcSurface(ipcMain), {
    send: (channel, payload) => {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    },
  });

  // `dispose` was written and never called, which meant every filesystem watch
  // a session opened lived until the process exited. For an application whose
  // whole point is to stay resident, an uninvoked cleanup path is a leak with a
  // delay on it.
  window.on("closed", () => registry.dispose());
  app.on("will-quit", () => registry.dispose());

  if (SMOKE) {
    window.webContents.once("did-finish-load", () => {
      void reportAndQuit(window);
    });
  }
});

// One window, by decision D3: tabs carry the navigation instead. There is no
// re-open-on-activate handler because there is no second window to re-open.
app.on("window-all-closed", () => {
  app.quit();
});
