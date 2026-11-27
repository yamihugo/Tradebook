import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { test } from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const tempDir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(process.env.TMPDIR || path.join(os.homedir(), ".hermes", "cache", "scratch"), "tradebook-replay-ui-")));
const bundlePath = path.join(tempDir, "import-ui.cjs");
await build({
  entryPoints: [path.join(repo, "src/views/importUi.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundlePath,
  plugins: [{ name: "obsidian-import-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({
      contents: `
        export class Modal {
          constructor(app) { this.app=app; this.modalEl=document.createElement('div'); this.contentEl=this.modalEl; window.activeImportModal=this; }
          open() { document.body.append(this.modalEl); this.onOpen?.(); }
          close() { this.onClose?.(); this.modalEl.remove(); }
        }
        export class Notice {} export class TFile {} export class TFolder {} export class App {}
        export class ItemView {} export class View {} export class Component {} export class Setting {}
        export class Menu {} export class Plugin {} export class PluginSettingTab {}
        export class MarkdownView {} export class FuzzySuggestModal {} export class SuggestModal {}
        export const setIcon = (el, name) => { el.dataset.icon = name; };
        export const normalizePath = value => value; export const debounce = fn => fn;
        export const requestUrl = async () => ({ json: {} });
        export const MarkdownRenderer = {}; export const Platform = { isDesktop: true, isMobile: false };
      `,
    }));
  } }],
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, runScripts: "outside-only" });
const win = dom.window;
Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, MutationObserver: win.MutationObserver });
win.HTMLElement.prototype.createEl = function (tag, options = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.type) el.type = options.type;
  for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, String(value));
  this.append(el);
  return el;
};
win.HTMLElement.prototype.createDiv = function (options = {}) { return this.createEl("div", options); };
win.HTMLElement.prototype.createSpan = function (options = {}) { return this.createEl("span", options); };
win.HTMLElement.prototype.setText = function (text) { this.textContent = text; };
win.HTMLElement.prototype.setAttr = function (name, value) { this.setAttribute(name, value); };
win.HTMLElement.prototype.toggleClass = function (name, on) { this.classList.toggle(name, on); };
win.HTMLElement.prototype.hasClass = function (name) { return this.classList.contains(name); };
win.HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
win.HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
win.HTMLElement.prototype.empty = function () { this.replaceChildren(); };
win.HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
win.HTMLElement.prototype.setCssProps = function (styles) { for (const [name, value] of Object.entries(styles)) this.style.setProperty(name, value); };

const { openImportCsvModal } = createRequire(bundlePath)(bundlePath);
const demo = { id: "demo-1", name: "Replay sandbox", type: "demo", firmId: "", programId: "", size: 0 };
const live = { id: "live-1", name: "Live account", type: "live", firmId: "", programId: "", size: 0 };
const savedTrades = [];
const plugin = {
  app: {},
  settings: { importZone: "America/New_York", timeZone: "UTC", propAccounts: [demo, live], defaultRiskBySymbol: {} },
  async knownSetups() { return []; },
  getAccountRules() { return []; },
  async saveSettings() {},
  mappedAccount(label) { return [demo, live].find((account) => account.name === label) ?? null; },
  async loadTradesExpanded() { return savedTrades.map((trade) => ({ ...trade })); },
  async storeTrades(trades) { savedTrades.push(...trades.map((trade) => ({ ...trade }))); return trades.length; },
  async storeReplayTrades(trades) {
    const paths = trades.map((trade, i) => `synthetic-${savedTrades.length + i}.md`);
    savedTrades.push(...trades.map((trade, i) => ({ ...trade, id: paths[i], costCoverage: { commission: Number.isFinite(trade.commission), fees: Number.isFinite(trade.fees) } })));
    return { paths, failed: false };
  },
  async readReplayNotes(paths) { return savedTrades.filter((trade) => paths.includes(trade.id)); },
  async openAccounts() {},
};
openImportCsvModal(plugin);

const headers = ["Trade number", "Type", "Date and time", "Signal", "Price USD", "Size (qty)", "Net PnL USD", "Commission USD"];
const csv = [
  headers.join(","),
  ["1", "Entry long", "2026-11-12 09:30:00", "Entry long", "5000", "1", "0", "0"].join(","),
  ["1", "Exit long", "2026-11-12 09:31:00", "Exit long", "5001", "1", "50", "0"].join(","),
].join("\n");
const fileInput = document.querySelector(".tj-dropzone input[type=file]");
assert.ok(fileInput, "trade-file input should be present");
const importSurface = {
  title: document.querySelector(".tj-import-head h2")?.textContent,
  platforms: document.querySelector(".tj-import-sub")?.textContent ?? "",
  dropTitle: document.querySelector(".tj-drop-text")?.textContent ?? "",
  filePickerCount: document.querySelectorAll(".tj-dropzone input[type=file]").length,
  accept: fileInput.getAttribute("accept") ?? "",
  dropCopy: document.querySelector(".tj-drop-sub")?.textContent ?? "",
};
const replayFile = { name: "Replay_Trading_CME_MINI_ES1!_2026-11-12_d3cea.csv", text: async () => csv };
Object.defineProperty(fileInput, "files", { configurable: true, value: [replayFile] });
fileInput.dispatchEvent(new win.Event("change", { bubbles: true }));
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

const initialPreview = await waitFor(() => document.body.textContent.includes("Simulated · TradingView Replay"));
assert.equal(initialPreview, true, `Replay preview should be available without selecting a source timezone. UI: ${document.body.textContent}`);
assert.equal(document.querySelector(".tj-error"), null, "missing timezone must not be presented as an unsupported-file failure");
assert.doesNotMatch(document.body.textContent, /time(?:s|zone).*unresolved|unresolved.*time/i, "timezone-less Replay stamps should default to the Journal timezone");
assert.match(document.querySelector(".tj-import-zone-dd .tj-mg-dd-val")?.textContent ?? "", /Journal timezone.*UTC/i);
const hasUnassignedReplayTrade = await waitFor(() => document.body.textContent.includes("1 without an account"));
assert.equal(hasUnassignedReplayTrade, true, "the unassigned Replay trade should remain in the preview pool");
const replayUnassignedPreview = {
  text: document.body.textContent ?? "",
  rowCount: document.querySelectorAll(".tj-import-tbl tbody tr").length,
  rowState: document.querySelector(".tj-import-rowstate")?.textContent ?? "",
  setupRowCount: document.querySelectorAll(".tj-import-setuprow").length,
};
const zoneButton = document.querySelector(".tj-import-zone-dd .tj-mg-dd-btn");
zoneButton.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
const zoneOption = Array.from(document.querySelectorAll(".tj-mg-dd-item")).find((item) => item.dataset.ddValue === "America/Chicago");
assert.ok(zoneOption, "a named timezone should be available");
zoneOption.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

const ready = await waitFor(() => document.body.textContent.includes("Simulated · TradingView Replay"));
assert.equal(ready, true, "Replay preview should be visible after timezone selection");
const mapButton = document.querySelector(".tj-import-mapdd .tj-mg-dd-btn");
assert.ok(mapButton, "Replay preview must require account mapping");
mapButton.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
const accountOptions = Array.from(document.querySelectorAll(".tj-mg-dd-item"));
assert.ok(accountOptions.some((item) => item.textContent.includes("Replay sandbox · Demo")));
assert.ok(accountOptions.some((item) => item.textContent.includes("Live account · Live")), "Replay can be assigned to a user-selected live account, visibly labeled");
const demoOption = accountOptions.find((item) => item.dataset.ddValue === "demo-1");
demoOption.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
const importButtonReady = await waitFor(() => {
  const button = document.querySelector(".tj-import-actions .is-primary");
  return !!button && !button.disabled && button.textContent.includes("Import 1 trade");
});

test("Replay preview lists unassigned trades instead of calling them duplicates", () => {
  assert.doesNotMatch(
    replayUnassignedPreview.text,
    /Everything in this file is already in your journal\./,
    "an unassigned Replay trade is new, not a duplicate"
  );
  assert.equal(replayUnassignedPreview.rowCount, 1, "show the parsed trade in the preview table");
  assert.equal(replayUnassignedPreview.rowState, "No account yet", "show why the trade is not writable yet");
  assert.equal(replayUnassignedPreview.setupRowCount, 0, "Replay previews must not show strategy/review controls for broker imports");
});

test("Replay exports use the existing Import trades file flow", () => {
  assert.equal(importSurface.title, "Import trades");
  assert.equal(importSurface.platforms, "Import Tradovate, TradeSea or TradingView Replay reports.");
  assert.equal(importSurface.dropTitle, "Drop CSV or XLSX files here");
  assert.equal(importSurface.dropCopy, "or click to choose files");
  assert.equal(importSurface.filePickerCount, 1);
  assert.match(importSurface.accept, /\.csv/i);
  assert.match(importSurface.accept, /\.xlsx/i);
  assert.doesNotMatch(importSurface.dropCopy, /imported separately/i);
  assert.equal(importButtonReady, true, "Import should become available after an explicit account mapping");
  assert.equal(document.body.textContent.includes("Simulated · TradingView Replay"), true);
  assert.equal(document.querySelector(".tj-import-zone-dd .tj-mg-dd-val")?.textContent, "America/Chicago (CT)", "the selected source timezone should be visible in the preview setup");
  assert.ok(document.querySelector(".tj-import-mapdd .tj-mg-dd-val")?.textContent.includes("Replay sandbox"), "the preview should show the mapped demo account");
  assert.equal(plugin.settings.importZone, "America/New_York", "per-import Replay timezone must not overwrite the saved broker import timezone");
});

test("imports Replay CSV and XLSX through file selection into the explicitly chosen account", async () => {
  window.activeImportModal.close();
  savedTrades.length = 0;

  const csvText = [
    headers.join(","),
    ["1", "Entry long", "2026-11-12 09:30:00", "Entry long", "5000", "1", "0", "0"].join(","),
    ["1", "Exit long", "2026-11-12 09:31:00", "Exit long", "5001", "1", "50", "0"].join(","),
  ].join("\n");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, [2, "Entry short", "2026-11-12 09:40:00", "Entry short", 5002, 1, 0, 0], [2, "Exit short", "2026-11-12 09:41:00", "Exit short", 5001, 1, 50, 0]]), "Trades");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Summary must not be imported"], [999]]), "Performance");
  const workbookBytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const workbookBuffer = workbookBytes.buffer.slice(workbookBytes.byteOffset, workbookBytes.byteOffset + workbookBytes.byteLength);

  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  };

  const cases = [
    {
      name: "Replay_Trading_CME_MINI_ES1!_2026-11-12_d3cea.csv",
      file: { name: "Replay_Trading_CME_MINI_ES1!_2026-11-12_d3cea.csv", text: async () => csvText },
      account: live,
      expectedPnl: 50,
    },
    {
      name: "Replay_Trading_CME_MINI_ES1!_2026-11-12_ef123.xlsx",
      file: { name: "Replay_Trading_CME_MINI_ES1!_2026-11-12_ef123.xlsx", arrayBuffer: async () => workbookBuffer },
      account: demo,
      expectedPnl: 50,
    },
  ];

  for (const [index, item] of cases.entries()) {
    document.body.replaceChildren();
    openImportCsvModal(plugin);
    const input = document.querySelector(".tj-dropzone input[type=file]");
    assert.ok(input, `${item.name}: file chooser should be present`);
    Object.defineProperty(input, "files", { configurable: true, value: [item.file] });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(await waitFor(() => document.body.textContent.includes("Simulated · TradingView Replay")), true, `${item.name}: preview without a source timezone`);
    assert.doesNotMatch(document.body.textContent, /time(?:s|zone).*unresolved|unresolved.*time/i, `${item.name}: Journal timezone should resolve timezone-less Replay stamps`);

    const mapButton = document.querySelector(".tj-import-mapdd .tj-mg-dd-btn");
    assert.ok(mapButton, `${item.name}: require an explicit destination account`);
    mapButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const destination = [...document.querySelectorAll(".tj-mg-dd-item")].find((option) => option.dataset.ddValue === item.account.id);
    assert.ok(destination, `${item.name}: offer the chosen ${item.account.type} account`);
    assert.match(destination.textContent, new RegExp(item.account.type, "i"), `${item.name}: show the destination account type clearly`);
    destination.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(await waitFor(() => {
      const button = document.querySelector(".tj-import-actions .is-primary");
      return !!button && !button.disabled && button.textContent.includes("Import 1 trade");
    }), true, `${item.name}: enable import after account selection, even without a source timezone`);
    document.querySelector(".tj-import-actions .is-primary").click();
    assert.equal(await waitFor(() => document.body.textContent.includes("Import complete")), true, `${item.name}: confirm the import after persistence read-back`);

    const written = savedTrades[index];
    assert.ok(written, `${item.name}: write a trade`);
    assert.equal(written.account, item.account.name);
    assert.equal(written.accountType, item.account.type);
    assert.equal(written.symbol, "ES");
    assert.equal(written.quantity, 1);
    assert.equal(written.pnl, item.expectedPnl);
    assert.equal(written.origin, "replay");
    assert.equal(written.dataSource, "replay");
    assert.equal(written.commission, 0);
    assert.equal(written.sourceZone, undefined);
    assert.equal(written.timeUnresolved, undefined);
    assert.equal(written.timezone, "UTC");
    assert.equal(written.instantSource, "journal-zone");
    assert.match(written.entryInstant, /^2026-11-12T\d{2}:\d{2}:00\.000Z$/);
    assert.ok(written.importKey, `${item.name}: persist a stable import identity`);
    assert.equal(savedTrades.length, index + 1, `${item.name}: write exactly one trade`);
    window.activeImportModal.close();
  }

  document.body.replaceChildren();
  openImportCsvModal(plugin);
  const duplicateInput = document.querySelector(".tj-dropzone input[type=file]");
  assert.ok(duplicateInput, "re-import the same Replay file for duplicate-state coverage");
  Object.defineProperty(duplicateInput, "files", { configurable: true, value: [cases[0].file] });
  duplicateInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(await waitFor(() => document.body.textContent.includes("1 without an account")), true, "an unassigned replay remains reviewable until account mapping");
  assert.doesNotMatch(document.body.textContent, /Everything in this file is already in your journal\./);

  const duplicateMapButton = document.querySelector(".tj-import-mapdd .tj-mg-dd-btn");
  assert.ok(duplicateMapButton, "duplicate matching must use the explicitly chosen destination account");
  duplicateMapButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const duplicateDestination = [...document.querySelectorAll(".tj-mg-dd-item")].find((option) => option.dataset.ddValue === live.id);
  assert.ok(duplicateDestination, "offer the account where this Replay trade was previously imported");
  duplicateDestination.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(await waitFor(() => document.body.textContent.includes("Everything in this file is already in your journal.")), true, "only a confirmed all-duplicate match should show the duplicate empty-state");
  assert.equal(document.querySelectorAll(".tj-import-tbl tbody tr").length, 0, "do not show import rows after an exact duplicate match");
  window.activeImportModal.close();
});

async function mappedReplayPreview(text, count = 1) {
  document.body.replaceChildren();
  openImportCsvModal(plugin);
  const input = document.querySelector('.tj-dropzone input[type=file]');
  Object.defineProperty(input, 'files', { configurable:true, value:[{name:replayFile.name,text:async()=>text}] });
  input.dispatchEvent(new win.Event('change',{bubbles:true}));
  assert.equal(await waitFor(()=>document.querySelector('.tj-import-mapdd .tj-mg-dd-btn')),true);
  document.querySelector('.tj-import-mapdd .tj-mg-dd-btn').click();
  [...document.querySelectorAll('.tj-mg-dd-item')].find(item=>item.dataset.ddValue===demo.id).click();
  assert.equal(await waitFor(()=>document.querySelector('.tj-import-actions .is-primary')?.textContent.includes(`Import ${count} trade`)),true);
}
test('a changed journal after preview aborts before writing', async()=>{
  savedTrades.length=0;
  await mappedReplayPreview(csv);
  savedTrades.push({...window.activeImportModal.importable[0],account:demo.name,review:'keep'});
  document.querySelector('.tj-import-actions .is-primary').click();
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(savedTrades.length,1);
  assert.equal(savedTrades[0].review,'keep');
  assert.doesNotMatch(document.body.textContent,/Import complete/);
  assert.match(document.body.textContent,/already in your journal|changed/i);
  window.activeImportModal.close();
});
test('receipt reports held conflicts alongside imported trades',async()=>{
  savedTrades.length=0;
  await mappedReplayPreview(csv);
  savedTrades.push({...window.activeImportModal.importable[0],account:demo.name,entryPrice:4999});
  window.activeImportModal.close();
  const second=csv.split('\n').slice(1).map(row=>row.replace(/^1,/, '2,')).join('\n');
  await mappedReplayPreview(`${csv}\n${second}`);
  assert.match(document.body.textContent,/1 conflict/i);
  document.querySelector('.tj-import-actions .is-primary').click();
  assert.equal(await waitFor(()=>document.body.textContent.includes('Import complete')),true);
  assert.match(document.querySelector('.tj-import-summary')?.textContent ?? '',/1 conflict/i);
  assert.equal(savedTrades.length,2);
  window.activeImportModal.close();
});
test("Replay conflicts are visible and held in the batch import preview", async () => {
  document.body.replaceChildren();
  savedTrades.length = 0;
  const originalCsv = csv;
  const changedCsv = csv.replace('5001,1,50,0', '5002,1,100,0');
  async function preview(text) {
    openImportCsvModal(plugin);
    const input = document.querySelector('.tj-dropzone input[type=file]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{name: replayFile.name, text: async () => text}] });
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    assert.equal(await waitFor(() => document.querySelector('.tj-import-mapdd .tj-mg-dd-btn')), true);
    document.querySelector('.tj-import-mapdd .tj-mg-dd-btn').click();
    [...document.querySelectorAll('.tj-mg-dd-item')].find(item => item.dataset.ddValue === demo.id).click();
  }
  await preview(originalCsv);
  assert.equal(await waitFor(() => !document.querySelector('.tj-import-actions .is-primary')?.disabled), true);
  document.querySelector('.tj-import-actions .is-primary').click();
  assert.equal(await waitFor(() => savedTrades.length === 1), true);
  window.activeImportModal.close();
  await preview(changedCsv);
  assert.equal(await waitFor(() => /1.*conflict/i.test(document.body.textContent)), true, 'show a conflict count');
  assert.match(document.body.textContent, /held|not imported/i);
  assert.equal(document.querySelector('.tj-import-actions .is-primary')?.disabled, true);
  assert.equal(savedTrades.length, 1);
  window.activeImportModal.close();
});


test('Replay failure states disable retry until the import is reopened', async () => {
  const originalWrite = plugin.storeReplayTrades;
  const originalRead = plugin.readReplayNotes;
  try {
    for (const scenario of ['zero', 'partial-throw', 'readback-throw']) {
      savedTrades.length = 0;
      plugin.storeReplayTrades = originalWrite;
      plugin.readReplayNotes = originalRead;
      await mappedReplayPreview(csv);
      plugin.storeReplayTrades = async (trades) => {
        if (scenario === 'zero') return { paths: [] };
        const result = await originalWrite.call(plugin, trades);
        return scenario === 'partial-throw' ? { ...result, failed: true } : result;
      };
      if (scenario === 'readback-throw') plugin.readReplayNotes = async () => { throw new Error('read failed'); };
      const button = document.querySelector('.tj-import-actions .is-primary');
      button.click();
      assert.equal(await waitFor(() => button.textContent.includes('Reopen import to retry')), true, scenario);
      assert.equal(button.disabled, true, scenario);
      assert.doesNotMatch(document.body.textContent, /Import complete/, scenario);
      assert.equal(savedTrades.length, scenario === 'zero' ? 0 : 1, scenario);
      window.activeImportModal.close();
    }
  } finally { plugin.storeReplayTrades = originalWrite; plugin.readReplayNotes = originalRead; }
});

test('two distinct same-clock trades cannot be confirmed by one new note', async () => {
  savedTrades.length = 0;
  const second = csv.split('\n').slice(1).map(row => row.replace(/^1,/, '2,')).join('\n');
  await mappedReplayPreview(`${csv}\n${second}`, 2);
  const originalWrite = plugin.storeReplayTrades;
  try {
    plugin.storeReplayTrades = (trades) => originalWrite.call(plugin, trades.slice(0, 1));
    const button = document.querySelector('.tj-import-actions .is-primary');
    button.click();
    assert.equal(await waitFor(() => button.textContent.includes('Reopen import to retry')), true);
    assert.equal(savedTrades.length, 1);
    assert.equal(button.disabled, true);
    assert.doesNotMatch(document.body.textContent, /Import complete/);
  } finally { plugin.storeReplayTrades = originalWrite; window.activeImportModal.close(); }
});
