import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import WebSocket from "ws";

const root = path.resolve(import.meta.dirname, "..");
const chromium = process.env.CHROMIUM_BIN || "chromium";
const available = spawnSync(chromium, ["--version"], { encoding: "utf8" }).status === 0;

test("real Chromium Trade Card selection matrix and preview/download parity", { timeout: 120000, skip: available ? false : "Chromium is required for the visual renderer test" }, async () => {
  const dir = process.env.TRADE_CARD_ARTIFACTS || await mkdtemp(path.join(tmpdir(), "trade-card-"));
  await mkdir(dir, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), "trade-card-chromium-"));
  const bundle = await build({
    entryPoints: [path.join(root, "tests/support/trade-card-browser.ts")], bundle: true, format: "iife", write: false, platform: "browser",
    plugins: [{ name: "isolated-host-api", setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      b.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
        export class ItemView {} export class Modal {} export class Plugin {} export class PluginSettingTab {}
        export class TFile {} export class TFolder {} export class Component {} export class MarkdownRenderChild {}
        export class Setting {} export class Menu {} export class SuggestModal {} export class FuzzySuggestModal {}
        export class Notice { constructor(message) { (window.testNotices ||= []).push(message); } }
        export const setIcon = (el, name) => { el.dataset.icon = name; };
        export const normalizePath = (value) => value;
        export const moment = () => {};
        export const debounce = (fn) => fn;
        export const MarkdownRenderer = {};
        export const requestUrl = () => { throw new Error('Network is forbidden in the isolated export test'); };
        export const Platform = { isDesktop: true, isMobile: false };
      ` }));
    } }],
  });
  const child = spawn(chromium, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let socket;
  const pending = new Map(); let id = 0;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(port, "Isolated Chromium did not start");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    socket.on("message", (raw) => { const response = JSON.parse(String(raw)); if (pending.has(response.id)) { const { resolve, reject } = pending.get(response.id); pending.delete(response.id); if (response.error) reject(new Error(JSON.stringify(response.error))); else resolve(response.result); } });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const css = await readFile(path.join(root, "styles.css"), "utf8");
    await cdp("Runtime.evaluate", { expression: `document.head.appendChild(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(`:root { --background-primary:#191919; --background-secondary:#262626; --background-modifier-border:#424242; --text-normal:#f4f4f4; --text-muted:#b8b8b8; --tj-fg-3:#b8b8b8; --tj-fs-small:13px; --tj-fs-body:15px; --tj-fs-label:12px; --tj-fs-head:20px; --interactive-accent:#8261d6; } body {font-family: sans-serif;} body button:not(.clickable-icon) {background:#303030;box-shadow:0 1px 3px #0005;border:1px solid #555;} * {box-sizing:border-box;} ${css}`)}}));` });
    const loaded = await cdp("Runtime.evaluate", { expression: bundle.outputFiles[0].text, returnByValue: true });
    assert.ok(!loaded.exceptionDetails, JSON.stringify(loaded.exceptionDetails));
    const response = await cdp("Runtime.evaluate", { expression: "runCardCases()", awaitPromise: true, returnByValue: true, timeout: 90000 });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    const result = response.result.value;
    const palette = await cdp("Runtime.evaluate", { expression: "inspectLightPalette()", awaitPromise: true, returnByValue: true });
    assert.ok(!palette.exceptionDetails, JSON.stringify(palette.exceptionDetails));
    result.lightPaletteAudit = palette.result.value;
    const dialogAudits = [];
    for (const [label, width, height, lightHost] of [["wide-dark", 1440, 1000, false], ["medium-dark", 1280, 900, false], ["compact-dark", 960, 720, false], ["wide-light", 1440, 1000, true]]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      if (lightHost) await cdp("Runtime.evaluate", { expression: `Object.entries({'--background-primary':'#ffffff','--background-secondary':'#f1f1ef','--background-modifier-border':'#d6d6d2','--text-normal':'#202020','--text-muted':'#595959'}).forEach(([key,value])=>document.documentElement.style.setProperty(key,value))` });
      const audit = await cdp("Runtime.evaluate", { expression: "inspectExportDialog()", returnByValue: true });
      assert.ok(!audit.exceptionDetails, JSON.stringify(audit.exceptionDetails));
      dialogAudits.push({ label, ...audit.result.value });
      const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(dir, `dialog-${label}.png`), Buffer.from(screenshot.data, "base64"));
    }
    result.dialogAudits = dialogAudits;
    const modalScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(dir, "export-modal.png"), Buffer.from(modalScreenshot.data, "base64"));
    const downloads = await mkdtemp(path.join(tmpdir(), "trade-card-download-"));
    await cdp("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
    const expectedDownload = await cdp("Runtime.evaluate", { expression: 'document.querySelector(".tj-export-preview-wrap canvas").toDataURL("image/png")', returnByValue: true });
    await cdp("Runtime.evaluate", { expression: 'document.querySelector(".tj-export-btn").click()' });
    let actualDownload;
    for (let i = 0; i < 100; i++) {
      const files = (await readdir(downloads)).filter((name) => name.endsWith(".png"));
      if (files.length) { actualDownload = await readFile(path.join(downloads, files[0])); break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(actualDownload, "Browser did not save the PNG download");
    assert.deepEqual(actualDownload, Buffer.from(expectedDownload.result.value.split(",")[1], "base64"), "Saved PNG does not match the displayed preview");
    await writeFile(path.join(dir, "actual-browser-download.png"), actualDownload);
    result.actualBrowserDownloadByteIdentical = true;
    for (const row of [...result.rows, ...result.modal.states]) {
      if (row.png) { await writeFile(path.join(dir, `${row.key}.png`), Buffer.from(row.png.split(",")[1], "base64")); delete row.png; }
    }
    await writeFile(path.join(dir, "results.json"), JSON.stringify(result, null, 2));
    if (process.env.TRADE_CARD_DARK_BASELINE) {
      const darkCases = result.rows.filter((row) => row.key.includes("-dark-") || row.key.endsWith("-long-review"));
      for (const row of darkCases) assert.deepEqual(await readFile(path.join(dir, `${row.key}.png`)), await readFile(path.join(process.env.TRADE_CARD_DARK_BASELINE, `${row.key}.png`)), `Accepted Dark renderer changed: ${row.key}`);
      result.darkReferenceMatches = darkCases.length;
      const baseline = JSON.parse(await readFile(path.join(process.env.TRADE_CARD_DARK_BASELINE, "results.json"), "utf8"));
      const boxes = new Map(baseline.rows.map((row) => [row.key, row.boxes]));
      for (const row of result.rows) assert.deepEqual(row.boxes, boxes.get(row.key), `Accepted card geometry changed: ${row.key}`);
      result.acceptedGeometryMatches = result.rows.length;
      await writeFile(path.join(dir, "results.json"), JSON.stringify(result, null, 2));
    }
    for (const row of result.rows.filter((row) => row.key.startsWith("horizontal-"))) {
      const top = Math.min(...row.boxes.map((box) => box.y));
      const png = await readFile(path.join(dir, `${row.key}.png`));
      const bottom = png.readUInt32BE(20) - Math.max(...row.boxes.map((box) => box.y + box.h));
      assert.ok(Math.abs(top - bottom) <= 1, `Horizontal composition is top-heavy: ${row.key}; top=${top}, bottom=${bottom}`);
    }
    if (process.env.TRADE_CARD_BALANCE_BASELINE) {
      const baseline = JSON.parse(await readFile(path.join(process.env.TRADE_CARD_BALANCE_BASELINE, "results.json"), "utf8"));
      const previous = new Map(baseline.rows.map((row) => [row.key, row]));
      let portraitExact = 0; let horizontalTranslations = 0;
      for (const row of result.rows) {
        const old = previous.get(row.key);
        const png = await readFile(path.join(dir, `${row.key}.png`));
        const previousPng = await readFile(path.join(process.env.TRADE_CARD_BALANCE_BASELINE, `${row.key}.png`));
        assert.equal(png.readUInt32BE(16), previousPng.readUInt32BE(16)); assert.equal(png.readUInt32BE(20), previousPng.readUInt32BE(20));
        if (row.key.startsWith("vertical-")) {
          assert.deepEqual(row.boxes, old.boxes);
          assert.deepEqual(await readFile(path.join(dir, `${row.key}.png`)), await readFile(path.join(process.env.TRADE_CARD_BALANCE_BASELINE, `${row.key}.png`)), `Portrait changed: ${row.key}`);
          portraitExact++;
        } else {
          const shift = row.boxes[0].y - old.boxes[0].y;
          assert.ok(Number.isInteger(shift) && shift >= 0);
          assert.deepEqual(row.boxes, old.boxes.map((box) => ({ ...box, y: box.y + shift })), `Horizontal internal layout changed: ${row.key}`);
          horizontalTranslations++;
        }
      }
      result.balanceReferenceMatches = { portraitExact, horizontalTranslations };
      await writeFile(path.join(dir, "results.json"), JSON.stringify(result, null, 2));
    }
    assert.equal(result.rows.length, 68);
    assert.equal(result.modal.states.length, 78);
    console.log(`Real Chromium: ${result.rows.length} rendered states, ${result.modal.states.length} byte-identical PNG preview/download checks. Artifacts: ${dir}`);
  } finally { socket?.close(); child.kill("SIGTERM"); }
});
