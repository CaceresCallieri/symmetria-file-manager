/**
 * Build: pnpm --filter @symmetria/fm-app build
 * Run: node app/bench/pdfPaged.mjs [/absolute/17-page-document.pdf]
 *
 * Headless integration checks with a private profile and socket. Screenshots stay
 * in the printed temporary directory. This checks behavior, not desktop latency.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pdfFixture } from "./pdfFixture.mjs";

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

function pressEnter(webContents) {
  webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
}

async function launch() {
  const scratch = await mkdtemp(join(tmpdir(), "fm-pdf-paged-"));
  await cp(fileURLToPath(new URL("../dist-electron", import.meta.url)), join(scratch, "dist"), {
    recursive: true,
  });
  await writeFile(join(scratch, "package.json"), '{"type":"module"}');
  const main = join(scratch, "dist/main/index.js");
  const source = await readFile(main, "utf8");
  assert.equal(source.split("webPreferences: {").length, 2);
  await writeFile(main, source.replace("webPreferences: {", "webPreferences: { offscreen: true,"));
  await mkdir(join(scratch, "fixtures"));
  await writeFile(
    join(scratch, "fixtures/sample.pdf"),
    process.argv[2] ? await readFile(resolve(process.argv[2])) : pdfFixture(),
  );
  await cp(fileURLToPath(new URL("./fixtures", import.meta.url)), join(scratch, "compatibility"), {
    recursive: true,
  });
  const bootstrap = join(scratch, "bootstrap.cjs");
  await writeFile(
    bootstrap,
    `require('electron').app.setPath('userData', ${JSON.stringify(join(scratch, "profile"))}); import(${JSON.stringify(import.meta.url)});`,
  );
  const env = {
    ...process.env,
    PDF_PAGED_ROOT: scratch,
    SYMMETRIA_FM_SOCKET: join(scratch, "fm.sock"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(
    String(createRequire(import.meta.url)("electron")).trim(),
    [
      "--headless",
      "--ozone-platform=headless",
      "--use-angle=swiftshader",
      "--no-sandbox",
      bootstrap,
    ],
    { env, stdio: "inherit", timeout: 90_000 },
  );
  console.log(`Artifacts: ${scratch}`);
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

async function verifyCompatibility(window, evaluate, until, scratch) {
  const pixelExpression = `(() => {
    const canvas = document.querySelector('[data-pdf-page="1"] canvas');
    if (canvas?.style.visibility !== 'visible') return null;
    return Array.from(canvas.getContext('2d').getImageData(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
  })()`;
  const open = (directory) =>
    window.webContents.send("symmetria-fm:open-path", {
      path: join(scratch, "compatibility", directory),
    });
  open("jpeg2000");
  // A visible canvas can still contain a blank image when its decoder is absent.
  await until(`JSON.stringify(${pixelExpression}) === '[255,0,0,255]'`);
  assert.deepEqual(await evaluate(pixelExpression), [255, 0, 0, 255]);
  open("password");
  await until(`document.querySelector('form[aria-label="Unlock PDF"]') !== null`);
  assert.equal(await evaluate(`document.querySelector('input[type=password]').value`), "");
  async function submit(password) {
    await evaluate(`document.querySelector('input[type=password]').focus()`);
    window.webContents.focus();
    await window.webContents.insertText(password);
    pressEnter(window.webContents);
  }
  await submit("wrong-test-password");
  await until(
    `document.querySelector('input[type=password]')?.getAttribute('aria-invalid') === 'true'`,
  );
  assert.equal(await evaluate(`document.querySelector('input[type=password]').value`), "");
  assert.equal(
    await evaluate(`document.querySelector('[role=alert]').textContent`),
    "Incorrect password. Try again.",
  );
  await submit("pdf-test-password");
  await until(
    `document.querySelector('form[aria-label="Unlock PDF"]') === null && JSON.stringify(${pixelExpression}) === '[255,0,0,255]'`,
  );
  assert.deepEqual(await evaluate(pixelExpression), [255, 0, 0, 255]);
  assert.equal(await evaluate(`document.querySelector('input[type=password]') !== null`), false);
}

async function verify() {
  const { app, BrowserWindow } = await import("electron");
  const scratch = process.env.PDF_PAGED_ROOT;
  assert.ok(scratch);
  const loading = import(pathToFileURL(join(scratch, "dist/main/index.js")).href);
  await app.whenReady();
  await loading;
  await delay(1000);
  const window = BrowserWindow.getAllWindows()[0];
  assert.ok(window);
  window.setSize(1600, 1000);
  const evaluate = (script) => window.webContents.executeJavaScript(script);
  async function until(expression) {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    assert.fail(`Timed out: ${expression}`);
  }
  async function screenshot(name) {
    await writeFile(join(scratch, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  try {
    // No sessionStorage override: a fresh window must choose Paged preview.
    window.webContents.send("symmetria-fm:open-path", { path: join(scratch, "fixtures") });
    await until(
      `document.querySelector('[data-pdf-thumbnail="1"] canvas')?.style.visibility === 'visible'`,
    );
    assert.equal(await evaluate(`document.querySelectorAll('embed').length`), 0);
    assert.equal(await evaluate(`document.body.innerText.includes('Browser viewer')`), false);
    await until(
      `Array.from(document.querySelectorAll("[data-pdf-thumbnail] canvas")).every(canvas => canvas.style.visibility === "visible")`,
    );
    await screenshot("column");
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',ctrlKey:true,bubbles:true}))`,
    );
    await until(
      `document.querySelector('[data-testid=reader] [data-pdf-page="1"] canvas')?.style.visibility === 'visible'`,
    );
    await until(`document.querySelector('[aria-label="Go to page 5"]') !== null`);
    await evaluate(`document.querySelector('[aria-label="Go to page 5"]').focus()`);
    window.webContents.focus();
    pressEnter(window.webContents);
    await until(
      `document.querySelector('[aria-current="page"]')?.getAttribute('aria-label') === 'Go to page 5'`,
    );
    await until(
      `document.querySelector('[data-pdf-page="5"] canvas')?.style.visibility === 'visible'`,
    );
    assert.equal(await evaluate(`document.querySelector('[data-pdf-page="1"]') !== null`), false);
    await until(
      `Array.from(document.querySelectorAll("[data-pdf-thumbnail] canvas")).every(canvas => canvas.style.visibility === "visible")`,
    );
    await screenshot("reader");
    // Scroll each independent viewport to the end. Eviction must affect both.
    await evaluate(`document.querySelector('[data-testid=pdf-scroll]').scrollTop = 1e9`);
    await until(
      `document.querySelector('[aria-current="page"]') !== null && Number(document.querySelector('[aria-current="page"]').textContent.trim()) > 5`,
    );
    await evaluate(`document.querySelector('[data-testid=pdf-thumbnails-scroll]').scrollTop = 1e9`);
    await until(`document.querySelector('[data-pdf-thumbnail="1"]') === null`);
    const resident = await evaluate(
      `({pages:document.querySelectorAll('[data-pdf-page]').length,thumbnails:document.querySelectorAll('[data-pdf-thumbnail]').length})`,
    );
    assert.ok(resident.pages < 10);
    assert.ok(resident.thumbnails < 17);
    // Rapid reversals cancel obsolete rendering without leaving failed pages.
    for (let i = 0; i < 20; i++) {
      await evaluate(
        `document.querySelector('[data-testid=pdf-scroll]').scrollTop = ${i % 2 ? 0 : 10000}`,
      );
      await delay(30);
    }
    await evaluate(`document.querySelector('[aria-label="Zoom in"]').click()`);
    await until(
      `document.querySelector('[data-pdf-page="1"] canvas')?.style.visibility === 'visible'`,
    );
    await evaluate(`document.querySelector('[aria-label="Page thumbnails"]').click()`);
    await until(`document.querySelectorAll('[data-pdf-thumbnail]').length === 0`);
    await evaluate(`document.querySelector('[aria-label="Page thumbnails"]').click()`);
    await until(
      `document.querySelector('[data-pdf-thumbnail="1"] canvas')?.style.visibility === 'visible'`,
    );
    assert.equal(await evaluate(`document.body.innerText.includes('Could not render')`), false);
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`,
    );
    await until(
      `document.querySelector('[data-testid=reader]') === null && document.querySelector('[data-pdf-page="1"] canvas')?.style.visibility === 'visible'`,
    );
    assert.equal(await evaluate(`document.querySelectorAll('embed').length`), 0);
    await verifyCompatibility(window, evaluate, until, scratch);
    console.log(
      JSON.stringify({
        passed: true,
        resident,
        checks: [
          "default column and reader",
          "native keyboard thumbnail activation",
          "current page",
          "independent page and thumbnail eviction",
          "rapid scrolling",
          "zoom",
          "sidebar toggle",
          "Escape",
          "browser viewer option removed",
          "JPEG2000 decoded red pixels",
          "encrypted PDF password retry and keyboard submit",
          "password field cleared after rejection and removed after unlock",
        ],
      }),
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

if (process.versions.electron) {
  void verify();
} else {
  void launch().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
