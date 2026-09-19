/**
 * Build first: pnpm --filter @symmetria/fm-app build
 * Run: node app/bench/pdfScroll.mjs [--native] [--trace] [/absolute/document.pdf]
 *
 * Uses a private profile/socket and an offscreen copy of the production bundle.
 * Measures programmatic scrolling, NOT wheel latency or desktop frame delivery.
 * Artifacts remain in the printed temporary directory. See docs/pdf-viewer-research.md.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pdfFixture } from "./pdfFixture.mjs";

// Electron drives its global timers through Chromium's event loop. The
// node:timers/promises timer stalled this offscreen harness before PDF loading.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const args = process.argv.slice(2);
const native = args.includes("--native");
const trace = args.includes("--trace");

async function launch() {
  const scratch = await mkdtemp(join(tmpdir(), "fm-pdf-bench-"));
  const built = fileURLToPath(new URL("../dist-electron", import.meta.url));
  await cp(built, join(scratch, "dist"), { recursive: true });
  await writeFile(join(scratch, "package.json"), '{"type":"module"}');
  const main = join(scratch, "dist/main/index.js");
  let source = await readFile(main, "utf8");
  // Only the measurement copy gets offscreen rendering. Assert the transform
  // still matches after a build change instead of accidentally opening a window.
  assert.equal(source.split("webPreferences: {").length, 2);
  source = source.replace("webPreferences: {", "webPreferences: { offscreen: true,");
  if (native) {
    const registrations = /stylePdfScrollbars\((?:window|dialog)\.webContents\);/g;
    assert.equal([...source.matchAll(registrations)].length, 2);
    source = source.replace(registrations, "");
  }
  await writeFile(main, source);
  const fixtures = join(scratch, "fixtures");
  await mkdir(fixtures);
  const pdf = args.find((arg) => !arg.startsWith("--"));
  await writeFile(join(fixtures, "sample.pdf"), pdf ? await readFile(resolve(pdf)) : pdfFixture());
  const env = { ...process.env, PDF_BENCH_ROOT: scratch };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = String(createRequire(import.meta.url)("electron")).trim();
  const bootstrap = join(scratch, "bootstrap.cjs");
  await writeFile(
    bootstrap,
    `
    const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(join(scratch, "profile"))});
    process.env.SYMMETRIA_FM_SOCKET = ${JSON.stringify(join(scratch, "daemon.sock"))};
    import(${JSON.stringify(pathToFileURL(main).href)});
    import(${JSON.stringify(import.meta.url)});
  `,
  );
  console.log(`Artifacts: ${scratch}`);
  const child = spawnSync(
    executable,
    [
      "--headless",
      "--ozone-platform=headless",
      "--use-angle=swiftshader",
      "--no-sandbox",
      bootstrap,
      ...args,
    ],
    { env, stdio: "inherit", timeout: 180_000, killSignal: "SIGKILL" },
  );
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

async function measure() {
  const { app, BrowserWindow, contentTracing } = await import("electron");
  const scratch = process.env.PDF_BENCH_ROOT;
  assert.ok(scratch);
  const loading = import(pathToFileURL(join(scratch, "dist/main/index.js")).href);

  await app.whenReady();

  await loading;
  await delay(1000);
  const window = BrowserWindow.getAllWindows()[0];
  assert.ok(window);
  window.setSize(2048, 1220);
  window.webContents.setFrameRate(60);
  const results = [];
  const viewer = () =>
    window.webContents.mainFrame.framesInSubtree.find((frame) =>
      frame.url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/"),
    );
  async function ready() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const frame = viewer();
      if (
        frame &&
        (await frame.executeJavaScript(
          "!!document.querySelector('pdf-viewer')?.documentDimensions",
        ))
      ) {
        await delay(750);
        assert.equal(frame.frames.length, 1, "Expected the Chromium 146 PDF document child");
        return frame;
      }
      await delay(100);
    }
    throw new Error("PDF failed to load");
  }
  async function sample(mode, round) {
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('[data-testid=reader]').length",
      ),
      mode === "reader" ? 1 : 0,
      `Expected ${mode} mode before sampling`,
    );
    const frame = await ready();
    const documentFrame = frame.frames[0];
    const dimensions = await frame.executeJavaScript(`(() => {
      const viewer = document.querySelector('pdf-viewer');
      const bar = viewer.shadowRoot.querySelector('viewer-pdf-sidenav').shadowRoot
        .querySelector('viewer-thumbnail-bar').shadowRoot.querySelector('#thumbnails');
      return {zoom: viewer.viewport_.getZoom(), thumbnailScrollbar: getComputedStyle(bar, '::-webkit-scrollbar').width};
    })()`);
    if (trace)
      await contentTracing.startRecording({
        included_categories: ["toplevel", "devtools.timeline", "cc", "pdf"],
      });
    // Fixed CSS-pixel steps remove the velocity difference between preview sizes.
    // Each fresh viewer starts at page one. Reverse at the ends of short documents.
    const stats = await documentFrame.executeJavaScript(`new Promise(resolve => {
      const scroller = document.scrollingElement;
      const gaps = [], longTasks = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({type: 'longtask'});
      const start = performance.now();
      let active = true, previous, steps = 0, direction = 1, travel = 0, maxScroll = 0;
      function tick(time) { if (previous !== undefined) gaps.push(time - previous); previous = time; if (active) requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
      function step() {
        const before = scroller.scrollTop;
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (before >= max) direction = -1;
        if (before <= 0) direction = 1;
        scroller.scrollTop = Math.max(0, Math.min(max, before + direction * 60));
        travel += Math.abs(scroller.scrollTop - before);
        maxScroll = Math.max(maxScroll, scroller.scrollTop);
        if (++steps < 240) { setTimeout(step, 16); return; }
        setTimeout(() => {
          active = false; observer.disconnect(); gaps.sort((a,b) => a-b);
          resolve({elapsedMs: performance.now()-start, frames: gaps.length,
            p95Ms: gaps[Math.floor(gaps.length*.95)], maxMs: gaps.at(-1),
            over33ms: gaps.filter(gap => Math.round(gap * 10) / 10 > 33.4).length, longTasks, travel, maxScroll,
            scrollHeight: scroller.scrollHeight, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
            documentScrollbar: getComputedStyle(scroller,'::-webkit-scrollbar').width});
        }, 150);
      }
      step();
    })`);
    if (trace) await contentTracing.stopRecording(join(scratch, `${mode}-${round}-trace.json`));
    assert.ok(stats.travel > 1000, "The benchmark must actually scroll");
    if (!native) {
      assert.equal(stats.documentScrollbar, "6px");
      assert.equal(dimensions.thumbnailScrollbar, "6px");
    }
    const result = { mode, round, ...dimensions, ...stats };
    results.push(result);
    console.log(JSON.stringify(result));
    if (round === 0)
      await writeFile(
        join(scratch, `${mode}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
  }
  async function toggleReader(mode) {
    const previous = viewer();
    await window.webContents.executeJavaScript(
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}))",
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      const readerCount = await window.webContents.executeJavaScript(
        "document.querySelectorAll('[data-testid=reader]').length",
      );
      const current = viewer();
      if (
        readerCount === (mode === "reader" ? 1 : 0) &&
        current &&
        current !== previous &&
        !window.webContents.mainFrame.framesInSubtree.includes(previous)
      ) {
        await ready();
        return;
      }
      await delay(100);
    }
    throw new Error(`PDF viewer did not remount in ${mode} mode`);
  }
  try {
    window.webContents.send("symmetria-fm:open-path", { path: join(scratch, "fixtures") });
    for (let round = 0; round < 3; round++) {
      await sample("column", round);
      await toggleReader("reader");
      await sample("reader", round);
      await toggleReader("column");
    }
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelectorAll('[data-testid=reader]').length",
      ),
      0,
    );
    await writeFile(
      join(scratch, "results.json"),
      JSON.stringify(
        {
          versions: process.versions,
          cpu: cpus()[0]?.model,
          native,
          trace,
          gpu: await app.getGPUInfo("basic"),
          results,
        },
        null,
        2,
      ),
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

function fail(error) {
  console.error(error);
  process.exit(1);
}

if (process.versions.electron) {
  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
  void measure();
} else {
  void launch().catch(fail);
}
