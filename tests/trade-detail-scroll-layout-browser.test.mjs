import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import WebSocket from "ws";

const root = path.resolve(import.meta.dirname, "..");
const chromium = process.env.CHROMIUM_BIN || "chromium";
const available = spawnSync(chromium, ["--version"], { encoding: "utf8" }).status === 0;

test("Trade Detail retains nested scroll after refresh and lays out complete thumbnail tiles", { timeout: 120000, skip: available ? false : "Chromium required" }, async () => {
  const dir = process.env.DETAIL_LAYOUT_ARTIFACTS || await mkdtemp(path.join(tmpdir(), "td-layout-"));
  await mkdir(dir, { recursive: true });
  const profile = await mkdtemp(path.join(tmpdir(), "td-profile-"));
  const bundle = await build({
    entryPoints: [path.join(root, "tests/support/trade-detail-scroll-layout-browser.ts")], bundle: true, format: "iife", write: false, platform: "browser",
    plugins: [{ name: "synthetic-host-only", setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      b.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
        export class ItemView { constructor(leaf) { this.leaf=leaf; this.app=leaf.app; this.contentEl=leaf.contentEl; } }
        export class Modal {} export class Plugin {} export class PluginSettingTab {}
        export class TFile {} export class TFolder {} export class Component {} export class MarkdownRenderChild {}
        export class Setting {} export class Menu {} export class SuggestModal {} export class FuzzySuggestModal {}
        export class Notice { constructor(message) { (window.testNotices ||= []).push(message); } }
        export const setIcon = (el, name) => { el.dataset.icon = name; };
        export const normalizePath = value => value;
        export const moment = () => {};
        export const debounce = fn => fn;
        export const MarkdownRenderer = {};
        export const requestUrl = () => { throw new Error('Network forbidden'); };
        export const Platform = { isDesktop: true, isMobile: false };
      ` }));
    } }],
  });
  const child = spawn(chromium, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let socket; const pending = new Map(); let id = 0;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(port, "Headless Chromium did not start");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    socket.on("message", raw => { const res=JSON.parse(String(raw)); if (pending.has(res.id)) { const {resolve,reject}=pending.get(res.id);pending.delete(res.id);res.error?reject(new Error(JSON.stringify(res.error))):resolve(res.result); } });
    const cdp = (method, params={}) => new Promise((resolve,reject) => { const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params})); });
    const evaluate = async expression => {
      const response = await cdp("Runtime.evaluate", { expression, awaitPromise:true, returnByValue:true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    const css=await readFile(path.join(root,"styles.css"),"utf8");
    // Model the native host's fixed button height; standalone HTML defaults hide this regression.
    const hostCss=`:root { --background-primary:#191919;--background-secondary:#242424;--background-modifier-border:#444;--text-normal:#ddd;--text-muted:#aaa;--input-height:30px;--interactive-accent:#8261d6;--color-green-bright:#34d17a; } * {box-sizing:border-box} body {margin:0;background:#191919;color:#ddd;font-family:sans-serif;} button {height:var(--input-height);font:inherit;color:inherit;} .view-content {height:100vh;overflow:auto;} ${css}`;
    await evaluate(`document.head.appendChild(Object.assign(document.createElement('style'),{textContent:${JSON.stringify(hostCss)}}));`);
    await evaluate(bundle.outputFiles[0].text);
    const results=[];
    for (const width of [1600, 1024, 650]) {
      await cdp("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:false});
      const result=await evaluate(`runDetailLayoutCases(${width})`);
      const screenshot=await cdp("Page.captureScreenshot",{format:"png"});
      await writeFile(path.join(dir,`layout-${width}.png`),Buffer.from(screenshot.data,"base64"));
      results.push(result);
    }
    await writeFile(path.join(dir,"results.json"),JSON.stringify(results,null,2));
    console.log(JSON.stringify({artifacts:dir,results},null,2));
    assert.deepEqual(results.flatMap(r=>r.failures),[],"Browser layout/scroll checks failed");
  } finally {
    socket?.close(); child.kill("SIGTERM");
    await new Promise(resolve => { if(child.exitCode!==null) resolve(); else child.once("exit",resolve); });
  }
});
