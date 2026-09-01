import { fileURLToPath, pathToFileURL } from "node:url";
import { BRIDGE_KEY } from "@symmetria/fm-core/bridge";
import { failure } from "@symmetria/fm-core/contract";
import { homeQuery } from "@symmetria/fm-core/windowUrl";
import { PUSH_CHANNELS, REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import { electronIpcSurface } from "@symmetria/fm-main/ipc/electronSurface";
import { createRegistry } from "@symmetria/fm-main/ipc/register";
import { app, BrowserWindow, ipcMain } from "electron";
import { createResidency } from "./lifecycle.ts";

import { APP_ENTRY_URL, handleAppScheme, previewUrlFor, registerAppScheme } from "./protocol.ts";
import { claimSocket, daemonSocketPath, sendCommand } from "./socket.ts";
import { buildWindowOptions } from "./window.ts";

// Must happen before the app is ready. See `protocol.ts` for why the renderer
// is not served over `file://`.
registerAppScheme();

/**
 * Set by the smoke test. Never set in normal use.
 */
const SMOKE = process.env.SYMMETRIA_FM_SMOKE === "1";

/**
 * "Another daemon already holds the socket." NOT exit 1.
 *
 * The unit tells systemd not to restart on this code, because retrying it can
 * never succeed — and the value has to be one nothing else produces. Exit 1 was
 * used here first and was wrong: Node exits 1 for an uncaught exception, and the
 * launcher script exits 1 on three of its own failures, so
 * `RestartPreventExitStatus=1` also told systemd to stop restarting after a real
 * crash. That is the opposite of what `Restart=always` is for, and it turned a
 * loop into a silent death.
 *
 * 69 is `EX_UNAVAILABLE` from sysexits.h — the service is unavailable to this
 * process because another is providing it, which is exactly the situation.
 */
const ALREADY_RUNNING = 69;

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

/**
 * Whether a close destroys the window, and it never does until a real quit.
 *
 * This is the residency half of decision D3, which shipped without it: the
 * previous version quit the process when the last window closed, under a
 * comment citing the very decision that says one window should stay resident.
 */
const residency = createResidency();

let shownOnReadyToShow = false;

/**
 * The window, and a promise that it has painted.
 *
 * Named rather than returned as an anonymous object type: the two are handed
 * around together and a caller reading `{ window, painted }` has to guess what
 * the second one means.
 */
interface StartedWindow {
  readonly window: BrowserWindow;
  /** Resolves once `ready-to-show` has fired, never before. */
  readonly painted: Promise<void>;
}

function createWindow(): StartedWindow {
  const window = new BrowserWindow(buildWindowOptions());

  // Show only once the renderer has something to paint. Paired with the
  // background colour in `buildWindowOptions`, this is what removes the white
  // flash on open.
  //
  // The promise is what the smoke report waits on. `did-finish-load` and
  // `ready-to-show` are independent events with no guaranteed order, and a
  // report written on the first one sampled this flag before the second had
  // fired — which made the assertion about it fail intermittently, in the
  // harness rather than in the product.
  const painted = new Promise<void>((resolve) => {
    window.once("ready-to-show", () => {
      shownOnReadyToShow = true;
      window.show();
      resolve();
    });
  });

  // Hide, never destroy. The tab set, the cursor and the scroll position live
  // in the renderer, so a destroyed window loses all three and coming back is a
  // fresh start — which is the opposite of the "one place I return to" this
  // application is for.
  //
  // The guard is not defensive habit. Without it the process is unkillable by
  // the ordinary route: `systemctl --user stop` would hang and only a SIGKILL
  // would end it, which is a worse defect than the one being fixed.
  window.on("close", (event) => {
    if (!residency.shouldHideOnClose()) return;
    event.preventDefault();
    window.hide();
  });

  // Two facts, carried separately on purpose: the fragment is where this window
  // OPENS, the query is where HOME is. Neither reaches the scheme handler —
  // `protocol.ts` reads only the hostname and the pathname — so both add a
  // parameter without widening the surface it has to validate. See
  // `windowUrl.ts` for why they must not be conflated.
  const home = app.getPath("home");
  void window.loadURL(`${APP_ENTRY_URL}${homeQuery(home)}#${encodeURIComponent(home)}`);
  return { window, painted };
}

/** The built page's own `file://` URL, used as the probe target. */
function ownPageFileUrl(): string {
  return pathToFileURL(
    fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
  ).toString();
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What the smoke report says about the window surviving a close.
 *
 * Declared here rather than inferred, because the smoke test declares the same
 * shape on its side and the two have to be readable against each other. A field
 * added here without one there is a field nothing asserts.
 */
interface ResidencyReport {
  readonly windowsBeforeClose: number;
  readonly destroyedAfterClose: boolean;
  readonly visibleAfterClose: boolean;
  readonly windowsAfterClose: number;
  readonly tabPathsBeforeClose: readonly string[];
  readonly tabPathsAfterShow: readonly string[];
  readonly cursorBeforeClose: number;
  readonly cursorAfterShow: number;
  /**
   * The listing's scroll offset, which the acceptance criterion names and the
   * first version of this probe did not measure.
   *
   * Verification said so plainly: tabs and cursor were measured, scroll was
   * not, and nothing in the phase demonstrated it survived. A criterion nobody
   * measured is a criterion nobody met.
   */
  readonly scrollBeforeClose: number;
  readonly scrollAfterShow: number;
  /** Proof the offset was not simply zero at both ends, which would prove nothing. */
  readonly scrollWasNonZero: boolean;
  readonly quitRanAfterRequest: boolean;
  /** True when a close driven from PAGE code also hid rather than destroyed. */
  readonly survivedRendererClose: boolean;
}

/**
 * Give the window a second tab, through the real socket.
 *
 * `/usr/bin` rather than `/usr`, and the difference is load-bearing: a column
 * only scrolls when its content overflows, and `/usr` holds about ten entries on
 * this system. The first version used it and could not move the scroll offset
 * off zero, which would have made "the scroll position survived" true and empty.
 *
 * Driven over the socket rather than by calling the handler directly, so what is
 * exercised is the path a user's command actually takes: it arrives from
 * outside, is decoded, reaches the renderer and becomes a tab.
 */
async function openSecondTab(window: BrowserWindow, socketPath: string): Promise<void> {
  await sendCommand(socketPath, { cmd: "open", path: "/usr/bin" });

  for (let i = 0; i < 100; i++) {
    // SAFETY: `NodeList.length` is a number by the DOM specification, and the
    // expression is a literal here rather than anything a caller supplies.
    const count = (await window.webContents.executeJavaScript(
      `document.querySelectorAll('[data-testid="tab"]').length`,
    )) as number;
    if (count >= 2) return;
    await delay(50);
  }
}

/**
 * Put the listing somewhere other than the top.
 *
 * Retried rather than set once: the listing arrives asynchronously and the
 * virtualiser sizes the scroll area only after the rows exist, so an offset
 * written too early is silently clamped straight back to zero.
 */
async function scrollTheListing(window: BrowserWindow): Promise<void> {
  for (let i = 0; i < 40; i++) {
    // SAFETY: the literal below returns a number on every path.
    const offset = (await window.webContents.executeJavaScript(`(() => {
      const column = document.querySelector('[data-testid="column-current"]');
      if (column === null) return -1;
      column.scrollTop = 120;
      return column.scrollTop;
    })()`)) as number;
    if (offset > 0) {
      // Settle before anything reads it back: the virtualiser re-renders rows
      // on scroll and the offset is only stable once that has run.
      await delay(150);
      return;
    }
    await delay(100);
  }
}

/**
 * What the window and its state do across a close.
 *
 * Split into three because the whole thing scored a CRAP of 72 against a bound
 * of 30 — cyclomatic 8 with no coverage data, which is what an uncovered probe
 * in the main process looks like to the gate. The split is along the seam it
 * already had: set the state up, put it somewhere non-default, then measure.
 */
async function measureResidency(
  window: BrowserWindow,
  socketPath: string,
): Promise<ResidencyReport> {
  const read = () =>
    // SAFETY: the expression evaluated below is a literal in this file and
    // returns exactly this shape on every path — there is no branch that omits
    // a field. `executeJavaScript` is typed `Promise<any>` because it cannot
    // know that, so the assertion states what the literal above guarantees.
    window.webContents.executeJavaScript(`(() => {
      const column = document.querySelector('[data-testid="column-current"]');
      return {
        tabPaths: Array.from(document.querySelectorAll('[data-testid="tab"]')).map((t) => t.textContent),
        cursor: (() => {
          const rows = Array.from(document.querySelectorAll('[data-testid="column-current"] [data-testid="row"]'));
          return rows.findIndex((r) => r.getAttribute("data-cursor") === "true");
        })(),
        scroll: column === null ? -1 : column.scrollTop,
      };
    })()`) as Promise<{ tabPaths: string[]; cursor: number; scroll: number }>;

  await openSecondTab(window, socketPath);
  await scrollTheListing(window);

  const before = await read();
  const windowsBeforeClose = BrowserWindow.getAllWindows().length;

  // The route page code takes, exercised FIRST because it is the one that was
  // broken: the renderer used to call `window.close()` here, which destroys the
  // window without raising its `close` event at all.
  await window.webContents.executeJavaScript(
    `window[${JSON.stringify(BRIDGE_KEY)}].hideWindow({})`,
  );
  await delay(300);
  const survivedRendererClose = !window.isDestroyed() && !window.isVisible();
  if (!window.isDestroyed()) window.show();
  await delay(200);

  window.close();
  await delay(300);

  const destroyedAfterClose = window.isDestroyed();
  const windowsAfterClose = BrowserWindow.getAllWindows().length;
  if (destroyedAfterClose) {
    // Reading anything else would throw on a destroyed window. Reporting the
    // fields that were reachable is what lets the failing assertion name the
    // real defect instead of an exception inside the probe.
    return {
      windowsBeforeClose,
      destroyedAfterClose,
      visibleAfterClose: true,
      windowsAfterClose,
      tabPathsBeforeClose: before.tabPaths,
      tabPathsAfterShow: [],
      cursorBeforeClose: before.cursor,
      cursorAfterShow: -1,
      scrollBeforeClose: before.scroll,
      scrollAfterShow: -1,
      scrollWasNonZero: before.scroll > 0,
      quitRanAfterRequest: false,
      survivedRendererClose,
    };
  }

  const visibleAfterClose = window.isVisible();
  window.show();
  await delay(300);
  const after = await read();

  return {
    windowsBeforeClose,
    destroyedAfterClose,
    visibleAfterClose,
    windowsAfterClose,
    tabPathsBeforeClose: before.tabPaths,
    tabPathsAfterShow: after.tabPaths,
    cursorBeforeClose: before.cursor,
    cursorAfterShow: after.cursor,
    scrollBeforeClose: before.scroll,
    scrollAfterShow: after.scroll,
    scrollWasNonZero: before.scroll > 0,
    quitRanAfterRequest: await canStillQuit(),
    survivedRendererClose,
  };
}

/**
 * Does a deliberate quit still get through the close interception?
 *
 * `will-quit` is prevented so the report can still be written; what matters is
 * that it fired at all. A blocked quit resolves false on the timer instead of
 * hanging the launch until the harness's own timeout, which would arrive as a
 * mysterious 45-second failure rather than as a named one.
 */
function canStillQuit(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3_000);
    app.once("will-quit", (event) => {
      event.preventDefault();
      clearTimeout(timer);
      resolve(true);
    });
    app.quit();
  });
}

/**
 * Launch, report on the running application, and exit.
 *
 * This exists so the smoke test can assert facts that only hold in a real
 * process — above all that the sandboxed renderer cannot reach the filesystem.
 * The probes run in the renderer's main world, which is the world page code
 * sees, so a pass here means page code genuinely has no way through.
 */
async function reportAndQuit(window: BrowserWindow, socketPath: string): Promise<void> {
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

  // Sampled BEFORE the residency probe, and that ordering is load-bearing.
  //
  // `measureResidency` ends by proving a deliberate quit still gets through the
  // close interception, and a quit destroys the window. Reading these two
  // afterwards reported zero windows and an empty title — a real regression in
  // the report, from a probe rather than from the product. Sampling at boot is
  // also what these two assertions are actually about.
  const windowCount = BrowserWindow.getAllWindows().length;
  const title = window.getTitle();

  // Last, because it closes the window and then quits. Everything above needs a
  // live page.
  const residencyReport = await measureResidency(window, socketPath);

  process.stdout.write(
    `SMOKE_REPORT ${JSON.stringify({
      ...probe,
      residency: residencyReport,
      windowCount,
      title,
      shownOnReadyToShow,
    })}\n`,
  );

  app.exit(0);
}

app.whenReady().then(async () => {
  handleAppScheme();
  const { window, painted } = createWindow();

  // The renderer has no filesystem of its own, so this registry is the only
  // way it reaches one. Bound to this window's sender: a push goes to the
  // window that asked, never broadcast to whatever else might be listening.
  const registry = createRegistry(
    electronIpcSurface(ipcMain),
    {
      send: (channel, payload) => {
        if (!window.isDestroyed()) window.webContents.send(channel, payload);
      },
    },
    // The host owns its own origin, so it is the host that turns a preview
    // token into a URL. The registry used to import this and that import was
    // the last line tying the privileged half to one particular application.
    { previewUrlFor },
  );

  // `dispose` was written and never called, which meant every filesystem watch
  // a session opened lived until the process exited. For an application whose
  // whole point is to stay resident, an uninvoked cleanup path is a leak with a
  // delay on it.
  //
  // Hung off `will-quit` alone. It used to also hang off the window's `closed`
  // event, which now never fires — the window is hidden rather than destroyed —
  // so leaving it there would have looked like cleanup that no longer ran.
  app.on("will-quit", () => registry.dispose());
  app.on("before-quit", () => residency.beginQuit());

  // The socket is the authority on who is the daemon, and taking it is what
  // makes a second launch exit instead of opening a rival window.
  // Hiding the window is a HOST concern, so its handler is registered here
  // rather than in the IPC registry. The registry is the privileged filesystem
  // half and becomes an importable package; a window method in it would be the
  // one thing an embedding host could not satisfy.
  ipcMain.handle(REQUEST_CHANNELS.hideWindow, () => {
    if (!window.isDestroyed()) window.hide();
    return { ok: true, value: null };
  });

  const socketPath = daemonSocketPath();
  const claimed = await claimSocket(socketPath, async (command) => {
    // Reporting the truth, which the first version did not.
    //
    // It answered `{ok:true}` unconditionally and only sent the message when a
    // window existed, so a caller branching on the exit code — the portal
    // backend does exactly this — was told the path had opened when nothing
    // had. Verification caught it. A command that could not be delivered is a
    // failure, and saying so is the whole value of having a reply channel.
    if (window.isDestroyed()) {
      return failure("write_failed", "the file manager has no window to open it in");
    }
    window.webContents.send(PUSH_CHANNELS.openPath, { path: command.path });
    return { ok: true, value: null };
  });
  if (!claimed.ok) {
    // Another daemon already owns the path, so this process has nothing to do.
    // Exiting is the whole point of the check: two daemons would answer the
    // same socket and the user would get whichever won the race.
    process.stderr.write(`${claimed.error.message}\n`);
    app.exit(ALREADY_RUNNING);
    return;
  }
  app.on("will-quit", () => void claimed.value.close());

  if (SMOKE) {
    window.webContents.once("did-finish-load", () => {
      // Both events, not just the one that happens to fire first. See the
      // comment on `painted` in `createWindow`.
      void painted.then(() => reportAndQuit(window, socketPath));
    });
  }
});

// Deliberately empty, and NOT `app.quit()`.
//
// This is the residency half of D3. It is also nearly unreachable now: the
// window hides rather than closing, so nothing gets here except during a real
// quit, by which point `before-quit` has already run. Kept as a stated no-op so
// a future reader does not reinstate the quit on the grounds that nothing uses
// it — that line is exactly what made the daemon non-resident for three runs.
app.on("window-all-closed", () => {});
