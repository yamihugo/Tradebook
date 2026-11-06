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

test("real Chromium explicit-none review state, persistence and computed colors", { timeout: 120000, skip: available ? false : "Chromium is required for the visual renderer test" }, async () => {
  const dir = process.env.REVIEW_ACK_ARTIFACTS || await mkdtemp(path.join(tmpdir(), "trade-card-"));
  await mkdir(dir, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), "trade-card-chromium-"));
  const bundle = await build({
    entryPoints: [path.join(root, "tests/support/review-ack-browser.ts")], bundle: true, format: "iife", write: false, platform: "browser",
    plugins: [{ name: "isolated-host-api", setup(b) {
      b.onLoad({ filter: /src[\\/]views[\\/]tradeDetailView\.ts$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        const start = source.indexOf("    const tagSection = (");
        const end = source.indexOf("    // Market context/news stays independent", start);
        assert.ok(start > 0 && end > start, "Production tagSection boundary changed");
        const section = source.slice(start, end);
        return { contents: source + `\nexport function __mountReviewAckTest(this: any, ...args: any[]) { ${section} tagSection(...args); }`, loader: "ts" };
      });
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
    await cdp("Runtime.evaluate", { expression: `document.head.appendChild(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(`:root { --background-primary:#191919; --background-secondary:#262626; --background-modifier-border:#424242; --text-normal:#f4f4f4; --text-muted:#b8b8b8; --tj-fg-3:#b8b8b8; --tj-fs-small:13px; --tj-fs-body:15px; --tj-fs-label:12px; --tj-fs-head:20px; --interactive-accent:#8261d6; } body {font-family: sans-serif;background:var(--background-primary);color:var(--text-normal);display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px;} .ack-test {padding:16px!important;margin:0!important;min-width:0!important;} body button:not(.clickable-icon) {background:#303030;box-shadow:0 1px 3px #0005;border:1px solid #555;} * {box-sizing:border-box;} ${css}`)}}));` });
    const loaded = await cdp("Runtime.evaluate", { expression: bundle.outputFiles[0].text, returnByValue: true });
    assert.ok(!loaded.exceptionDetails, JSON.stringify(loaded.exceptionDetails));
    const results = [];
    for (const mode of ["dark", "light"]) {
      const response = await cdp("Runtime.evaluate", { expression: `runReviewAckCases(${JSON.stringify(mode)})`, awaitPromise: true, returnByValue: true });
      const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(dir, `${mode}.png`), Buffer.from(screenshot.data,"base64"));
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      results.push(response.result.value);
      await cdp("DOM.enable"); await cdp("CSS.enable");
      const document = await cdp("DOM.getDocument");
      const buttons = await cdp("DOM.querySelectorAll", { nodeId: document.root.nodeId, selector: '.tj-td-ack[aria-pressed="true"]' });
      for (const nodeId of buttons.nodeIds) await cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover","focus-visible"] });
      const hovered = await cdp("Runtime.evaluate", { expression: `[...document.querySelectorAll('.tj-td-ack[aria-pressed="true"]')].map(b=>({color:getComputedStyle(b).color,border:getComputedStyle(b).borderColor}))`, returnByValue: true });
      const expected = "rgb(46, 204, 113)";
      for (const state of hovered.result.value) { assert.equal(state.color,expected); assert.equal(state.border,expected); }
    }
    await writeFile(path.join(dir,"results.json"),JSON.stringify(results,null,2));
    console.log(`Review acknowledgement: ${results.reduce((n,r)=>n+r.checks.length,0)} state checks; real persistence and selected hover/focus colors pass in both modes. ${dir}`);
  } finally { socket?.close(); child.kill("SIGTERM"); }
});
