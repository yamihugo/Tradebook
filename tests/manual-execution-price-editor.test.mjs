import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const built = await build({
  entryPoints: [new URL("./support/manual-execution-price-editor.ts", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  plugins: [{ name: "isolated-obsidian-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
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

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, runScripts: "outside-only" });
const win = dom.window;
Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, DOMParser: win.DOMParser });
win.HTMLElement.prototype.createEl = function (tag, options = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, String(value));
  this.append(el);
  return el;
};
win.HTMLElement.prototype.createDiv = function (options = {}) { return this.createEl("div", options); };
win.HTMLElement.prototype.createSpan = function (options = {}) { return this.createEl("span", options); };
win.HTMLElement.prototype.setText = function (text) { this.textContent = text; };
win.HTMLElement.prototype.setAttr = function (name, value) { this.setAttribute(name, value); };
win.HTMLElement.prototype.setAttrs = function (attrs) { for (const [name, value] of Object.entries(attrs)) this.setAttribute(name, value); };
win.HTMLElement.prototype.toggleClass = function (name, on) { this.classList.toggle(name, on); };
win.HTMLElement.prototype.addClass = function (...names) { this.classList.add(...names); };
win.HTMLElement.prototype.removeClass = function (...names) { this.classList.remove(...names); };
win.HTMLElement.prototype.empty = function () { this.replaceChildren(); };
win.HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
win.HTMLElement.prototype.setCssProps = function (styles) { for (const [name, value] of Object.entries(styles)) this.style.setProperty(name, value); };
win.eval(built.outputFiles[0].text);

const scenario = await win.runManualExecutionPriceEditScenario();
const executionScenario = await win.runExecutionEditorScenario();
const addedPartialScenario = await win.runAddedPartialCloseScenario();

test("manual Trade Detail executions can be time and price corrected, saved, and reopened", () => {
  assert.equal(scenario.editButtonFound, true, "original manual trades expose the shared execution editor");
  assert.equal(scenario.executionInputsFound, true);
  assert.equal(scenario.saveButtonFound, true);
  assert.equal(scenario.savedEntryDate, "2026-11-06");
  assert.equal(scenario.savedEntryTime, "10:00:00");
  assert.equal(scenario.savedExitDate, "2026-11-07");
  assert.equal(scenario.savedExitTime, "10:04:00");
  assert.equal(scenario.savedEntry, 99);
  assert.equal(scenario.savedExit, 102);
  assert.equal(scenario.savedPnl, 15, "MES P&L is recalculated from the corrected three-point move");
  assert.equal(scenario.savedPnlPoints, 3);
  assert.equal(scenario.savedCommission, 2);
  assert.equal(scenario.savedFees, 1);
  assert.equal(scenario.savedFillCount, 0, "a single entry/exit remains represented by the trade's scalar fields");
  assert.equal(scenario.savedOrigin, "manual");
  assert.equal(scenario.savedDataSource, "manual");
  assert.equal(scenario.reopenedEntry, 99);
  assert.equal(scenario.reopenedExit, 102);
  assert.equal(scenario.reopenedPnl, 15);
  assert.equal(scenario.reopenedEntryDate, "2026-11-06");
  assert.equal(scenario.reopenedEntryTime, "10:00:00");
  assert.equal(scenario.reopenedExitDate, "2026-11-07");
  assert.equal(scenario.reopenedExitTime, "10:04:00");
  assert.equal(scenario.brokerEditVisible, true, "broker trades use the same execution correction editor");
  assert.equal(scenario.annotationPreserved, true);
  assert.equal(scenario.notices.length, 0);
});

test("Replay trades can add a partial close from Trade Review", () => {
  assert.equal(addedPartialScenario.editButtonFound, true);
  assert.equal(addedPartialScenario.addButtonFound, true);
  assert.equal(addedPartialScenario.newRowFound, true);
  assert.equal(addedPartialScenario.saveButtonFound, true);
  assert.equal(addedPartialScenario.savedFillCount, 2);
  assert.equal(addedPartialScenario.savedOpenDate, "2026-11-06");
  assert.equal(addedPartialScenario.savedExitDate, "2026-11-06");
  assert.equal(addedPartialScenario.savedExitTime, "10:01:00");
  assert.equal(addedPartialScenario.savedQuantity, 4);
  assert.equal(addedPartialScenario.savedPnl, 10);
  assert.equal(addedPartialScenario.savedImportKey, "replay:synthetic-open-key");
  assert.equal(addedPartialScenario.savedEntryFillId, "entry-open");
  assert.equal(addedPartialScenario.newFillIdAbsent, true);
  assert.equal(addedPartialScenario.journalResolved, true);
  assert.equal(addedPartialScenario.annotationPreserved, true);
});

test("Replay executions can be corrected per fill and survive note reload", () => {
  assert.equal(executionScenario.editButtonFound, true);
  assert.equal(executionScenario.executionInputsFound, true);
  assert.equal(executionScenario.saveButtonFound, true);
  assert.equal(executionScenario.savedEntryDate, "2026-11-07");
  assert.equal(executionScenario.savedEntryTime, "23:58:00");
  assert.equal(executionScenario.savedExitDate, "2026-11-08");
  assert.equal(executionScenario.savedExitTime, "00:03:00");
  assert.equal(executionScenario.savedQuantity, 4);
  assert.equal(executionScenario.savedExitPrice, 101.75);
  assert.equal(executionScenario.savedPnl, 35);
  assert.equal(executionScenario.savedPnlPoints, 1.75);
  assert.equal(executionScenario.savedImportKey, "replay:synthetic-stable-key");
  assert.equal(executionScenario.savedOrigin, "replay");
  assert.equal(executionScenario.savedDataSource, "replay");
  assert.equal(executionScenario.fillIds?.join(","), "entry-1,exit-1,exit-2");
  assert.equal(executionScenario.journalResolved, true);
  assert.match(executionScenario.correctionZoneNote, /ET \(Journal timezone\)/);
  assert.match(executionScenario.correctionZoneNote, /trade direction/);
  assert.equal(executionScenario.entryInstant, "2026-11-08T04:58:00.000Z");
  assert.equal(executionScenario.exitInstant, "2026-11-08T05:03:00.000Z");
  assert.equal(executionScenario.annotationPreserved, true);
  assert.equal(executionScenario.reopenedEntryDate, "2026-11-07");
  assert.equal(executionScenario.reopenedExitDate, "2026-11-08");
  assert.equal(executionScenario.reopenedEntryTime, "23:58:00");
  assert.equal(executionScenario.reopenedExitTime, "00:03:00");
});
