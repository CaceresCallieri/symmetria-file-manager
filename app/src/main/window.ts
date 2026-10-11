import { fileURLToPath } from "node:url";

import type { BrowserWindowConstructorOptions } from "electron";

/**
 * The first paint happens before any stylesheet loads. Without a background
 * colour that first frame is white, which on a near-black application reads as
 * a flash every time a window opens.
 */
export const WINDOW_BACKGROUND = "#0b0b0b";

/**
 * The Wayland app id of every window this daemon opens.
 *
 * Chromium sets it from `desktopName` in `app/package.json`, once per process,
 * so the browse window and every picker share it. `pickerPlacement.test.ts`
 * asserts it equals the desktop name.
 */
export const WINDOW_CLASS = "symmetria-fm-electron";

/**
 * The smallest a window may be. Exported because the picker's placement
 * honours it too: a picker sized to 90% of a narrow caller must not ask the
 * compositor for less than the window itself accepts.
 */
export const WINDOW_MINIMUM_SIZE = { width: 640, height: 400 };

/** Where the preload bundle lands, relative to the built main bundle. */
function preloadPath(): string {
  return fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
}

/**
 * Build the options for the one window this application opens.
 *
 * Pure on purpose: it imports Electron's *types* and nothing from Electron at
 * runtime, so the security posture can be asserted in a plain unit test instead
 * of only inside a launched application.
 *
 * The three `webPreferences` flags below are copied from the host that will
 * eventually embed this panel. They are not a preference: the renderer must be
 * unable to reach the filesystem, so that every scan, stat and mutation is
 * forced across the bridge. If the standalone diverges here, the interface
 * cannot be shared and the project ends up maintaining two of them.
 */
export function buildWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: WINDOW_MINIMUM_SIZE.width,
    minHeight: WINDOW_MINIMUM_SIZE.height,
    show: false,
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Stated rather than left to the default. These two are what quietly
      // reopen what `sandbox: true` closed, and a future edit that flips one
      // would otherwise pass every other assertion about this object.
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      plugins: false,
    },
  };
}
