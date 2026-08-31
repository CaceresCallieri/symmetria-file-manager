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
    // How a row lays out when its name is too wide for its column.
    //
    // Measured here because it cannot be measured anywhere else. The renderer
    // suite runs under happy-dom, which has no layout engine and computes no
    // cascade: it reports a flex-shrink no algorithm ever ran and a bounding
    // rect of zeros. Only a real Chromium can tell an aligned row from a
    // misaligned one.
    //
    // It measures the COMPONENT'S OWN row rather than markup of its own,
    // lengthening the name in place to force the overflow. A probe that built
    // its own row would be measuring its own styles and would pass whatever the
    // stylesheet said.
    rowLayout: await (async () => {
      const findRow = async () => {
        // The listing is asynchronous, and this runs at did-finish-load — the
        // page is up well before the first directory answers.
        for (let i = 0; i < 100; i++) {
          const found =
            document.querySelector('[data-testid="column-current"] [data-testid="row"]') ??
            document.querySelector('[data-testid="row"]');
          if (found !== null) return found;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      };

      const row = await findRow();
      if (row === null) return "no-row";

      const mark = row.querySelector(".row__mark");
      const name = row.querySelector(".row__name");
      const icon = row.querySelector(".file-icon");
      if (mark === null || name === null || icon === null) return "row-missing-parts";

      const original = name.textContent;
      const fittingIconLeft = icon.getBoundingClientRect().left;

      // The trailing symlink arrow is drawn only for a symlink, and the home
      // directory need not contain one. Added to the real row so it inherits
      // the real cascade.
      const link = document.createElement("span");
      link.className = "row__link";
      link.textContent = "→";

      // The restore is in a finally, and that is not defensive habit. Without
      // it, a measurement that throws escapes this function, app.exit(0) is
      // never reached, and the launch hangs until the harness's 45-second
      // timeout kills it — a probe bug arriving disguised as a timeout, which
      // is the hardest shape of failure to read.
      let measured;
      try {
        name.textContent = "overflow".repeat(60);
        row.appendChild(link);

        measured = {
          fittingIconLeft,
          overflowingIconLeft: icon.getBoundingClientRect().left,
          overflowingMarkWidth: mark.getBoundingClientRect().width,
          overflowingLinkWidth: link.getBoundingClientRect().width,
          // Reported so a mis-escaped literal cannot pass as an arrow. This
          // string crosses two levels of escaping to reach the page, and a
          // width alone would be satisfied by the six characters of a broken
          // escape as readily as by the glyph.
          overflowingLinkText: link.textContent,
          // Clipping is what an ellipsis needs. With no overflow rule the item
          // never shrinks, so its content box equals its content and the two
          // are identical.
          nameClipped: name.clientWidth < name.scrollWidth,
        };
      } finally {
        link.remove();
        name.textContent = original;
      }

      // Measured AFTER the finally, so it reports on the restoration itself.
      // The containment test asks about this probe's OWN node rather than about
      // any row__link element, which a genuinely symlinked row would carry too.
      //
      // NOTE: no backticks anywhere inside this probe. The whole thing is one
      // template literal, so a backtick even in a comment ends the string and
      // everything after it is parsed as TypeScript.
      return { ...measured, rowRestored: name.textContent === original && !row.contains(link) };
    })(),
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
