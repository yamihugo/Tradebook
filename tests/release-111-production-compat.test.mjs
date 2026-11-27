import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, runScripts: "outside-only" });
const win = dom.window;
const uiBundle = await build({
  stdin: { contents: `import {TradeDetailView} from './src/views/tradeDetailView'; import {renderTradeCard} from './src/lib/tradeCard'; import {tradeToMarkdown,parseTradeFromMarkdown} from './src/storage'; import {TFile} from 'obsidian'; import {AddTradePanel} from './src/views/addTradePanel'; import {CORE_SYMBOLS} from './src/futures'; window.metricsAPI={TradeDetailView,renderTradeCard,tradeToMarkdown,parseTradeFromMarkdown,TFile,AddTradePanel,CORE_SYMBOLS};`, resolveDir: new URL("../", import.meta.url).pathname, loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "iife", loader: { ".png": "dataurl", ".svg": "dataurl" },
  plugins: [{ name: "synthetic-host", setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    b.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
      export class ItemView { constructor(leaf) { this.app=leaf.app; this.leaf=leaf; this.contentEl=leaf.contentEl; } }
      export class TFile {} export class TFolder {} export class Modal {} export class Plugin {} export class PluginSettingTab {}
      export class Component {} export class MarkdownRenderChild {} export class Setting {} export class Menu {} export class SuggestModal {} export class FuzzySuggestModal {}
      export class Notice { constructor(message) { (window.testNotices ||= []).push(message); } }
      export const setIcon=(el,name)=>{el.dataset.icon=name;}; export const normalizePath=x=>x; export const moment=()=>{};
      export const debounce=fn=>fn; export const MarkdownRenderer={}; export const Platform={isDesktop:true,isMobile:false};
      export const requestUrl=()=>{throw new Error('Network forbidden');};
    ` }));
  } }],
});
const hostDOM = `Object.assign(HTMLElement.prototype, {
  createEl(tag,o={}) {const e=document.createElement(tag);if(o.cls)e.className=o.cls;if(o.text)e.textContent=o.text;for(const[k,v]of Object.entries(o.attr||{}))e.setAttribute(k,String(v));this.append(e);return e;},
  createDiv(o={}){return this.createEl('div',o);},createSpan(o={}){return this.createEl('span',o);},empty(){this.replaceChildren();},
  setText(t){this.textContent=t;},setAttr(k,v){this.setAttribute(k,v);},setAttrs(o){for(const[k,v]of Object.entries(o))this.setAttribute(k,v);},
  addClass(...n){this.classList.add(...n);},removeClass(...n){this.classList.remove(...n);},toggleClass(n,b){this.classList.toggle(n,b);},
  setCssStyles(s){Object.assign(this.style,s);},setCssProps(s){for(const[k,v]of Object.entries(s))this.style.setProperty(k,v);}
});`;
win.eval(hostDOM + uiBundle.outputFiles[0].text);
const api = win.metricsAPI;

const trade = (id) => ({ id, symbol: "MES", direction: "long", quantity: 1, entryPrice: 100, exitPrice: 101, pnl: 5, pnlPoints: 1, date: "2026-01-01", entryTime: "10:00:00", exitTime: "10:01:00", account: "Synthetic", accountType: "demo", commission: 0, fees: 0, setup: "", mistake: "", review: "", thesis: "", screenshot: "", rating: 0, origin: "manual", dataSource: "manual" });
const settings = { timeZone: "UTC", dateFormat: "YYYY-MM-DD", defaultSymbol: "", setups: [], propAccounts: [], reviewOptions: { psychology: [], mistakes: [] } };
test("actual Add Trade symbol picker offers exactly the canonical symbols", async () => {
 const plugin = { settings, knownSetups: async () => [], resolveAccountType: () => "demo" };
 const root = win.document.body.createDiv();
 const panel = new api.AddTradePanel(plugin);
 panel.mount(root);
 await Promise.resolve(); await Promise.resolve();
 const input = root.querySelector('input[aria-label="Symbol"]'); assert.ok(input);
 input.focus();
 const list = win.document.getElementById(input.getAttribute("aria-controls")); assert.ok(list);
 const values = [...list.querySelectorAll('[role="option"]')].map(e => e.dataset.acValue);
 assert.equal(new Set(api.CORE_SYMBOLS).size, api.CORE_SYMBOLS.length);
 assert.deepEqual(values, Array.from(api.CORE_SYMBOLS));
 assert.equal(new Set(values).size, values.length);
 panel.dispose(); root.remove();
});
test("actual review text and rating handlers flush to the edited trade on navigation", async () => {
 const a = trade("synthetic/first.md"), b = trade("synthetic/second.md");
 const files = new Map([a,b].map(t => [t.id, Object.assign(new api.TFile(), {path:t.id, extension:"md"})]));
 const notes = new Map([a,b].map(t => [t.id, api.tradeToMarkdown(t)]));
 const writes = [];
 const loadTrades = async () => [...notes].map(([id,text]) => ({...api.parseTradeFromMarkdown(text),id}));
 const app = { vault: { getAbstractFileByPath: p => files.get(p) ?? null, adapter: { exists: async () => false }, process: async (f,fn) => { writes.push(f.path); notes.set(f.path,fn(notes.get(f.path))); } }, metadataCache: { getFirstLinkpathDest: () => null } };
 const plugin = { app, settings, loadTrades, loadTradesExpanded: loadTrades, knownSetups: async () => [], mappedAccount: () => null };
 const root = win.document.body.createDiv({cls:"view-content"}).createDiv();
 const view = new api.TradeDetailView({app,contentEl:root},plugin);
 view.trade = a; view.allTrades = [a,b]; view.index = 0; view.setupOptions = []; view.render();
 const text = root.querySelector('[data-review-field="review_what_happened"]'); assert.ok(text);
 text.textContent = "Synthetic reflection"; text.dispatchEvent(new win.Event("input",{bubbles:true}));
 const star = root.querySelector('[data-review-control="rating:4"]'); assert.ok(star); star.click();
 assert.ok(view._saveTimers.review_what_happened); assert.ok(view._saveTimers.rating);
 const untouched = notes.get(b.id); assert.equal(writes.length,0);
 await view.next();
 assert.equal(view.trade.id,b.id);
 assert.deepEqual(writes.sort(),[a.id,a.id]);
 const saved = api.parseTradeFromMarkdown(notes.get(a.id));
 assert.equal(saved.review_what_happened,"Synthetic reflection"); assert.equal(saved.rating,4);
 assert.equal(notes.get(b.id),untouched);
 await view.onClose(); root.remove();
});
