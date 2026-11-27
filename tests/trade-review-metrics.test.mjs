import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const built = await build({
  entryPoints: [new URL("../src/lib/fills.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
});
const fills = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

const riskBuild = await build({ entryPoints: [new URL("../src/lib/risk.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
const risk = await import(`data:text/javascript;base64,${Buffer.from(riskBuild.outputFiles[0].text).toString("base64")}`);

test("open legacy trade cannot fabricate an executed zero-price exit", () => {
  assert.ok(Number.isNaN(fills.maxExitPoints({ symbol: "MES", direction: "long", quantity: 1, entryPrice: 100, exitPrice: 0, entryTime: "10:00:00", exitTime: "" })));
});
test("overflowed recorded risk does not fabricate a zero maximum R", () => {
  assert.equal(risk.maxExitR({ symbol: "MES", direction: "long", quantity: 100, entryPrice: 1e308, exitPrice: 1e308, stopLoss: 1, entryTime: "10:00:00", exitTime: "10:01:00" }), null);
});

test("review maximum actual-exit points is distinct from weighted realized points without mutating either", () => {
  const trade = {
    symbol: "MES", direction: "long", quantity: 4, entryPrice: 100, exitPrice: 112.5,
    entryTime: "10:00:00", exitTime: "10:02:00", date: "2026-11-01",
    pnl: 250, pnlPoints: 12.5, stopLoss: 95,
    fills: [
      { side: "buy", qty: 4, price: 100, time: "10:00:00" },
      { side: "sell", qty: 3, price: 110, pnl: 150, time: "10:01:00" },
      { side: "sell", qty: 1, price: 120, pnl: 100, time: "10:02:00" },
    ],
  };
  const before = structuredClone(trade);
  assert.equal(fills.maxExitPoints(trade), 20);
  assert.equal(fills.tradePoints(trade), 12.5);
  assert.deepEqual(trade, before);
});

const fixture = (changes = {}) => ({
  id: "Synthetic/metrics.md", symbol: "MES", direction: "long", quantity: 4,
  entryPrice: 100, exitPrice: 112.5, stopLoss: 95, pnl: 250, pnlPoints: 12.5,
  date: "2026-11-01", entryTime: "10:00:00", exitTime: "10:02:00",
  account: "Synthetic", accountType: "demo", commission: 0, fees: 0,
  setup: "", mistake: "", review: "", thesis: "", screenshot: "", rating: 0,
  origin: "manual", dataSource: "manual",
  fills: [{ side: "buy", qty: 4, price: 100, time: "10:00:00" },
    { side: "sell", qty: 3, price: 110, pnl: 150, time: "10:01:00" },
    { side: "sell", qty: 1, price: 120, pnl: 100, time: "10:02:00" }],
  ...changes,
});
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
for (const [name, trade, maximum] of [
  ["long", fixture(), 20],
  ["short", fixture({ direction: "short", stopLoss: 105, fills: [{ side: "sell", qty: 4, price: 100 }, { side: "buy", qty: 3, price: 90 }, { side: "buy", qty: 1, price: 80 }] }), 20],
  ["weighted scale-in", fixture({ fills: [{ side: "buy", qty: 1, price: 100 }, { side: "buy", qty: 3, price: 104 }, { side: "sell", qty: 2, price: 108 }, { side: "sell", qty: 2, price: 112 }] }), 9],
  ["all break-even", fixture({ fills: [{ side: "buy", qty: 4, price: 100 }, { side: "sell", qty: 4, price: 100 }] }), 0],
  ["losing-only", fixture({ fills: [{ side: "buy", qty: 4, price: 100 }, { side: "sell", qty: 3, price: 90 }, { side: "sell", qty: 1, price: 95 }] }), -5],
  ["legacy", fixture({ fills: undefined }), 12.5],
  ["empty legacy ledger", fixture({ fills: [] }), 12.5],
  ["executed zero price", fixture({ fills: undefined, exitPrice: 0 }), -100],
  ["negative prices", fixture({ fills: [{ side: "buy", qty: 1, price: -20 }, { side: "sell", qty: 1, price: -10 }] }), 10],
  ["zero entry price", fixture({ fills: [{ side: "buy", qty: 1, price: 0 }, { side: "sell", qty: 1, price: 2 }] }), 2],
  ["planned target ignored", fixture({ target: 999999 }), 20],
]) test(`maximum points: ${name}`, () => {
  const before = structuredClone(trade);
  closeTo(fills.maxExitPoints(trade), maximum);
  assert.deepEqual(trade, before);
});
for (const [name, changes] of [
  ["entry only", { fills: [{ side: "buy", qty: 4, price: 100 }] }],
  ["exit only", { fills: [{ side: "sell", qty: 4, price: 120 }] }],
  ["zero quantity", { fills: [{ side: "buy", qty: 0, price: 100 }, { side: "sell", qty: 1, price: 120 }] }],
  ["negative quantity", { fills: [{ side: "buy", qty: -1, price: 100 }] }],
  ["invalid price", { fills: [{ side: "buy", qty: 4, price: NaN }, { side: "sell", qty: 4, price: 120 }] }],
  ["infinite price", { fills: [{ side: "buy", qty: 4, price: 100 }, { side: "sell", qty: 4, price: Infinity }] }],
  ["invalid side", { fills: [{ side: "unknown", qty: 4, price: 100 }] }],
  ["null fill", { fills: [null] }], ["non-array ledger", { fills: {} }],
  ["invalid direction", { direction: "unknown" }],
  ["missing legacy price", { fills: undefined, exitPrice: undefined }],
  ["null legacy price", { fills: undefined, exitPrice: null }],
  ["string legacy price", { fills: undefined, exitPrice: "120" }],
  ["missing legacy entry time", { fills: undefined, entryTime: "" }],
  ["invalid legacy quantity", { fills: undefined, quantity: 0 }],
]) test(`maximum is unavailable: ${name}`, () => {
  const trade = fixture(changes), before = structuredClone(trade);
  assert.ok(Number.isNaN(fills.maxExitPoints(trade)));
  assert.equal(risk.maxExitR(trade), null);
  assert.deepEqual(trade, before);
});
test("maximum R uses initial recorded risk without changing realized gross R", () => {
  const trade = fixture(), before = structuredClone(trade);
  assert.equal(risk.recordedRisk(trade), 100);
  assert.equal(trade.pnl / risk.recordedRisk(trade), 2.5);
  assert.equal(risk.maxExitR(trade), 4);
  assert.equal(fills.tradePoints(trade), 12.5);
  assert.deepEqual(trade, before);
});
test("fractional futures points are not rounded away before R conversion", () => {
  const trade = fixture({ symbol: "6E", quantity: 1, entryPrice: 1.1, exitPrice: 1.1001, stopLoss: 1.0999, fills: undefined });
  closeTo(fills.maxExitPoints(trade), 0.0001);
  closeTo(risk.maxExitR(trade), 1);
});
for (const [name, changes] of [["unknown instrument", { symbol: "UNKNOWN" }], ["missing stop", { stopLoss: undefined }], ["zero stop", { stopLoss: 0 }], ["wrong-side stop", { stopLoss: 105 }], ["zero risk", { stopLoss: 100 }], ["zero position", { quantity: 0 }]]) {
  test(`maximum R unavailable: ${name}`, () => assert.equal(risk.maxExitR(fixture(changes)), null));
}
test("negative and break-even maximum R remain signed, not missing or clamped", () => {
  for (const [exit, expected] of [[95, -1], [100, 0]]) assert.equal(risk.maxExitR(fixture({ fills: [{ side: "buy", qty: 4, price: 100 }, { side: "sell", qty: 4, price: exit }] })), expected);
});

// Use the actual view and public canvas painter with an isolated host API. Browser
// geometry/pixels are checked separately; this capture asserts painted content.
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, runScripts: "outside-only" });
const win = dom.window;
const uiBundle = await build({
  stdin: { contents: `import {TradeDetailView} from './src/views/tradeDetailView'; import {renderTradeCard} from './src/lib/tradeCard'; import {tradeToMarkdown,parseTradeFromMarkdown} from './src/storage'; import {TFile} from 'obsidian'; window.metricsAPI={TradeDetailView,renderTradeCard,tradeToMarkdown,parseTradeFromMarkdown,TFile};`, resolveDir: new URL("../", import.meta.url).pathname, loader: "ts" },
  bundle: true, write: false, platform: "browser", format: "iife",
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
async function mount(trade) {
  let content = api.tradeToMarkdown(trade);
  const file = Object.assign(new api.TFile(), { path: trade.id, extension: "md" });
  const loadTrades = async () => [{ ...api.parseTradeFromMarkdown(content), id: trade.id }];
  const app = { vault: { getAbstractFileByPath: p => p === file.path ? file : null, adapter: { exists: async () => false }, process: async (_f, f) => { content = f(content); } }, metadataCache: { getFirstLinkpathDest: () => null } };
  const plugin = { app, settings: { timeZone: "UTC", setups: [], propAccounts: [], reviewOptions: { psychology: [], mistakes: [] } }, loadTrades, loadTradesExpanded: loadTrades, knownSetups: async () => [], mappedAccount: () => null };
  const root = win.document.body.createDiv({ cls: "view-content" }).createDiv();
  const view = new api.TradeDetailView({ app, contentEl: root }, plugin);
  view.trade = structuredClone(trade); view.allTrades = [view.trade]; view.index = 0; view.setupOptions = []; view.render();
  return { root, view, reopen: async () => { await view.onClose(); const reopened = new api.TradeDetailView({ app, contentEl: root }, plugin); await reopened.onOpen(); return reopened; }, saved: () => api.parseTradeFromMarkdown(content) };
}
test("actual Trade Detail renders maximum hero and exact paired R without replacing realized totals", async () => {
  const m = await mount(fixture());
  assert.equal(m.root.querySelector(".tj-td-hero-points .tj-td-hero-v").textContent, "+20.00 pts");
  assert.equal(m.root.querySelector('[data-exec-label="R"] .tj-td-flip-key').textContent, "R (AVG) | R (MAX)");
  assert.equal(m.root.querySelector('[data-r-kind="avg"]').textContent, "+2.50R");
  assert.equal(m.root.querySelector('[data-r-kind="max"]').textContent, "+4.00R");
  assert.equal(m.view.trade.pnlPoints, 12.5);
  assert.equal(m.view.trade.pnl, 250);
  await m.view.onClose();
});
test("maximum refreshes after actual exit correction, save and reopen", async () => {
  const m = await mount(fixture());
  const button = text => [...m.root.querySelectorAll("button")].find(e => e.textContent.trim() === text);
  button("Edit executions").click();
  m.root.querySelector('[aria-label="Edit Execution 3 price"]').click();
  const input = m.root.querySelector('input[aria-label="Execution 3 price"]');
  input.value = "125"; input.dispatchEvent(new win.Event("input", { bubbles: true }));
  input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  button("Save executions").click();
  for (let i = 0; i < 30 && m.saved().fills?.[2]?.price !== 125; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(m.saved().fills[2].price, 125);
  const reopened = await m.reopen();
  assert.equal(m.root.querySelector(".tj-td-hero-points .tj-td-hero-v").textContent, "+25.00 pts");
  assert.equal(m.root.querySelector('[data-r-kind="max"]').textContent, "+5.00R");
  assert.equal(reopened.trade.pnlPoints, 13.75);
  await reopened.onClose();
});
const painted = [];
Object.defineProperty(win.document, "fonts", { value: { ready: Promise.resolve() } });
win.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({ font: "26px sans-serif", measureText(text) { return { width: String(text).length * 12 }; }, fillText(text, x, y) { painted.push({ text: String(text), x, y }); } }, { get(target, prop) { return prop in target ? target[prop] : () => {}; } });
};
for (const orientation of ["vertical", "horizontal"]) for (const theme of ["light", "dark"]) {
  test(`public Trade Card painter has matching metric facts: ${orientation}/${theme}`, async () => {
    painted.length = 0;
    const trade = fixture(), before = structuredClone(trade);
    const result = await api.renderTradeCard(trade, { orientation, theme, screenshot: false, stats: true, rating: false, notes: false, repeatChange: false, exitReason: false, psychology: false, hidePnl: false, primaryPrint: 0 }, "UTC", () => null);
    const texts = painted.map(p => p.text);
    assert.ok(texts.includes("Points")); assert.ok(texts.includes("+20.00"));
    assert.ok(texts.includes("R (AVG) | R (MAX)"));
    assert.ok(texts.join(" ").includes("2.50R | 4.00R"));
    assert.ok(!texts.includes("Gross R")); assert.ok(!texts.includes("+12.50"));
    assert.ok(result.boxes.every(b => b.x >= 0 && b.y >= 0 && b.x + b.w <= result.canvas.width && b.y + b.h <= result.canvas.height));
    assert.deepEqual(trade, before);
  });
}
// Export reusable synthetic setup for the independent real-browser QA script.
export { uiBundle, hostDOM, fixture };

