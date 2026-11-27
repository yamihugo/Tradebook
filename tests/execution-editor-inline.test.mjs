import assert from "node:assert/strict";
import Module from "node:module";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { test, afterEach } from "node:test";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://tradebook.test/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
const runtimeErrors = [];
dom.window.addEventListener("error", (event) => { runtimeErrors.push(event.error); event.preventDefault(); });
afterEach(() => { assert.deepEqual(runtimeErrors.splice(0), [], "no hidden event-handler errors"); });

function installElementHelpers(window) {
  const proto = window.HTMLElement.prototype;
  proto.createEl = function (tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text !== undefined) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, String(value));
    this.appendChild(element);
    return element;
  };
  proto.createDiv = function (options = {}) { return this.createEl("div", options); };
  proto.createSpan = function (options = {}) { return this.createEl("span", options); };
  proto.setText = function (text) { this.textContent = text; return this; };
  proto.empty = function () { this.replaceChildren(); };
  proto.addClass = function (...names) { this.classList.add(...names); };
  proto.removeClass = function (...names) { this.classList.remove(...names); };
  proto.toggleClass = function (name, value) { this.classList.toggle(name, value); };
  proto.hasClass = function (name) { return this.classList.contains(name); };
  proto.setAttr = function (name, value) { this.setAttribute(name, String(value)); };
  proto.setCssStyles = function (styles) { Object.assign(this.style, styles); };
  window.createEl = function (tag, options = {}) {
    const element = window.document.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text !== undefined) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, String(value));
    return element;
  };
  window.createDiv = function (options = {}) { return window.createEl("div", options); };
  window.createSpan = function (options = {}) { return window.createEl("span", options); };
}
installElementHelpers(dom.window);

const entry = fileURLToPath(new URL("../src/views/tradeDetailView.ts", import.meta.url));
const built = await build({
  entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs",
  external: ["obsidian"], loader: { ".png": "dataurl" }, logLevel: "silent",
});
class HostBase {}
class HostNotice {}
const obsidian = new Proxy({
  ItemView: HostBase,
  Modal: HostBase,
  Notice: HostNotice,
  TFile: HostBase,
  normalizePath: (value) => value,
  setIcon: () => {},
  moment: () => ({}),
}, { get(target, key) { return key in target ? target[key] : HostBase; } });
const compiled = new Module(entry);
compiled.filename = entry;
compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("../src/views", import.meta.url)));
const requireOriginal = compiled.require.bind(compiled);
compiled.require = (id) => id === "obsidian" ? obsidian : requireOriginal(id);
compiled._compile(built.outputFiles[0].text, entry);
const { TradeDetailView } = compiled.exports;

const trade = {
  id: "Synthetic/Replay trade.md", type: "trade", date: "2026-11-06", exitDate: "2026-11-06",
  entryTime: "10:00:00", exitTime: "10:02:00", symbol: "MES", account: "Synthetic Replay",
  accountType: "demo", direction: "long", quantity: 4, entryPrice: 100, exitPrice: 101.5,
  pnl: 30, pnlPoints: 1.5, commission: 2, fees: 1, setup: "", mistake: "", review: "",
  thesis: "", screenshot: "", rating: 0, origin: "replay", dataSource: "replay",
  fills: [
    { side: "buy", date: "2026-11-06", time: "10:00:00", qty: 4, price: 100, orderType: "Limit", fillId: "entry-1" },
    { side: "sell", date: "2026-11-06", time: "10:01:00", qty: 2, price: 101, fees: 0.5, orderType: "Market", fillId: "exit-1" },
    { side: "sell", date: "2026-11-06", time: "10:02:00", qty: 2, price: 102, fees: 0.5, orderType: "Market", fillId: "exit-2" },
  ],
};

function mount() {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const view = Object.create(TradeDetailView.prototype);
  view.plugin = { settings: { timeZone: "America/New_York", dateFormat: "MM/DD/YYYY" } };
  view._pendingExecutionWrite = null;
  view._lastLocalWriteAt = 0;
  view.trade = trade;
  view.allTrades = [trade];
  view.index = 0;
  view.renderExecutions(host, trade);
  return { view, host };
}

function clickButton(host, label) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  assert.ok(button, `expected button named ${label}`);
  button.click();
  return button;
}

function setValue(element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function activate(host, row, field) {
  const target = host.querySelector(`.tj-td-execs-table tbody tr:nth-child(${row}) [data-execution-field="${field}"]`);
  assert.ok(target, `expected ${field} display target`);
  target.click();
  return host.querySelector(".tj-td-execs-table input");
}

function moveLastExitForward(host) {
  activate(host, 3, "date");
  const date = host.querySelector('input[aria-label="Execution 3 date"]');
  setValue(date, "11/07/2026");
  date.dispatchEvent(new window.Event("blur", { bubbles: false }));
}

test("edit mode keeps the executions table and activates only one cell at a time", () => {
  const { host } = mount();
  const table = host.querySelector(".tj-td-execs-table");
  const savedText = table.textContent;
  clickButton(host, "Edit executions");
  assert.deepEqual([...table.querySelectorAll("thead th")].map((cell) => cell.textContent),
    ["Date / time", "Side", "Qty", "Price", "Points/contract", "P&L", "Fees", "Fill"]);
  assert.equal(table.querySelectorAll("tbody tr").length, 4, "three fills plus the existing totals row remain rendered");
  assert.equal(table.querySelectorAll("input, select").length, 0, "entering edit mode does not replace the table with a form");

  const quantity = table.querySelector("tbody tr:nth-child(2) td[data-execution-field='qty']");
  assert.ok(quantity, "the displayed quantity cell exposes keyboard/click activation");
  quantity.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(table.querySelectorAll("input, select").length, 1, "keyboard activation opens just one editor");
  assert.equal(table.querySelector("input").getAttribute("aria-label"), "Execution 2 quantity");
  const quantityInput = table.querySelector("input");
  setValue(quantityInput, "1");
  assert.equal(quantityInput.value, "1", "the active input retains the typed value during preview");
  assert.equal(table.querySelector("tbody tr:nth-child(2) td:nth-child(5)").textContent, "+1.00");
  assert.equal(table.querySelector("tbody tr:nth-child(2) td:nth-child(6)").textContent, "+$5.00");
  assert.equal(table.querySelector("tbody tr.is-total td:nth-child(6)").textContent, "+$25.00");
  assert.equal(table.querySelectorAll("input, select").length, 1, "preview updates do not steal the active editor");

  table.querySelector("input").dispatchEvent(new window.Event("blur", { bubbles: false }));
  assert.equal(table.querySelectorAll("input, select").length, 0, "blur restores a quiet clickable display cell");
  assert.equal(table.querySelector("tbody tr:nth-child(2) td[data-execution-field='qty']").textContent, "1");
  table.querySelector("tbody tr:nth-child(2) td[data-execution-field='qty']").click();
  assert.equal(table.querySelectorAll("input, select").length, 1, "the same field can be activated repeatedly");

  clickButton(host, "Cancel");
  assert.equal(table.querySelectorAll("input, select").length, 0);
  assert.equal(table.textContent, savedText, "Cancel discards the in-memory preview");
});

test("app-owned date, time, and side controls activate in their existing table cells", async () => {
  const { host } = mount();
  const table = host.querySelector(".tj-td-execs-table");
  clickButton(host, "Edit executions");
  const first = table.querySelector("tbody tr");
  first.querySelector("[data-execution-field='date']").click();
  const date = first.querySelector("input.tj-datefield-input");
  assert.ok(date, "date activation mounts TradeBook's formatted date field");
  assert.equal(date.type, "text");
  assert.equal(date.value, "11/06/2026");
  assert.equal(table.querySelectorAll("input, select").length, 1);
  date.blur();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  first.querySelector("[data-execution-field='time']").click();
  const time = first.querySelector("input.tj-time-text");
  assert.ok(time, "time activation mounts the shared app-owned time picker control");
  assert.equal(time.type, "text", "time does not use the native popup");
  assert.equal(table.querySelectorAll("input.tj-time-text").length, 1);
  time.blur();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  first.querySelector("[data-execution-field='side']").click();
  assert.ok(first.querySelector(".tj-mg-dd-btn"), "side activation mounts TradeBook's dropdown");
  assert.equal(table.querySelectorAll("input, select").length, 0);
});

test("Add execution is preserved and Cancel discards draft rows without exposing deletion of saved rows", () => {
  const { host } = mount();
  const table = host.querySelector(".tj-td-execs-table");
  const originalText = table.textContent;
  clickButton(host, "Edit executions");
  clickButton(host, "Add execution");
  assert.equal(table.querySelectorAll("tbody tr").length, 5, "the new fill is added within the stable table");
  assert.equal(table.querySelectorAll("button[aria-label*='Remove']").length, 0, "saved and draft fills have no deletion control");
  clickButton(host, "Cancel");
  assert.equal(table.textContent, originalText);
});

test("execution date uses the configured format and app calendar, then saves the picked day as ISO", async () => {
  const { view, host } = mount();
  let captured;
  view.saveTradeExecutionEdits = async (...args) => { captured = args; };

  clickButton(host, "Edit executions");
  activate(host, 3, "date");
  const date = host.querySelector('input[aria-label="Execution 3 date"]');
  assert.ok(date);
  assert.equal(date.type, "text", "the execution date is not delegated to the OS-native picker");
  assert.equal(date.value, "11/06/2026", "the field uses the configured TradeBook date format");

  const NativeDate = globalThis.Date;
  const instant = "2026-11-07T04:30:00.000Z";
  globalThis.Date = class extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
      this.forceUtcDate = args.length === 0;
    }
    getFullYear() { return this.forceUtcDate ? super.getUTCFullYear() : super.getFullYear(); }
    getMonth() { return this.forceUtcDate ? super.getUTCMonth() : super.getMonth(); }
    getDate() { return this.forceUtcDate ? super.getUTCDate() : super.getDate(); }
    static now() { return NativeDate.parse(instant); }
  };
  try {
    date.click();
  } finally {
    globalThis.Date = NativeDate;
  }
  const calendar = document.body.querySelector('.tj-cal[role="dialog"]');
  assert.ok(calendar, "opening the field shows TradeBook's themed calendar");
  assert.equal(
    calendar.querySelector(".tj-cal-day.is-today")?.getAttribute("aria-label"),
    "2026-11-06",
    "Today follows the configured correction timezone, not the host date",
  );
  calendar.querySelector('button[aria-label="2026-11-07"]').click();
  assert.equal(date.value, "11/07/2026");

  clickButton(host, "Save executions");
  await view._pendingExecutionWrite;
  assert.equal(captured[1][2].fill.date, "2026-11-07");
});

test("typing an execution date in the configured format saves it as ISO", async () => {
  const { view, host } = mount();
  let captured;
  view.saveTradeExecutionEdits = async (...args) => { captured = args; };

  clickButton(host, "Edit executions");
  activate(host, 3, "date");
  const date = host.querySelector('input[aria-label="Execution 3 date"]');
  date.value = "11/07/2026";
  date.dispatchEvent(new window.Event("input", { bubbles: true }));
  clickButton(host, "Save executions");
  await view._pendingExecutionWrite;

  assert.equal(captured[1][2].fill.date, "2026-11-07");
});

test("clearing a typed execution date clears the draft instead of retaining its saved value", async () => {
  const { view, host } = mount();
  let captured;
  view.saveTradeExecutionEdits = async (...args) => { captured = args; };

  clickButton(host, "Edit executions");
  activate(host, 3, "date");
  const date = host.querySelector('input[aria-label="Execution 3 date"]');
  date.value = "";
  date.dispatchEvent(new window.Event("input", { bubbles: true }));
  clickButton(host, "Save executions");
  await view._pendingExecutionWrite;

  assert.equal(captured, undefined, "blank dates never reach persistence");
  assert.equal(host.querySelector('[aria-label="Save executions"]').disabled, true);
});

test("an invalid partial execution date cannot be saved", async () => {
  const { host } = mount();
  clickButton(host, "Edit executions");
  activate(host, 3, "date");
  const date = host.querySelector('input[aria-label="Execution 3 date"]');
  date.value = "11/";
  date.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(host.querySelector('button[aria-label="Save executions"]')?.disabled, true);
  assert.match(host.querySelector(".tj-td-execution-edit-status").textContent, /correct the highlighted/);
});

test("an invalid partial correction retains the latest valid typed execution date", async () => {
  const { view, host } = mount();
  let captured;
  view.saveTradeExecutionEdits = async (...args) => { captured = args; };

  clickButton(host, "Edit executions");
  activate(host, 3, "date");
  const date = host.querySelector('input[aria-label="Execution 3 date"]');
  date.value = "11/07/2026";
  date.dispatchEvent(new window.Event("input", { bubbles: true }));
  date.value = "11/";
  date.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(date.value, "11/");
  clickButton(host, "Save executions");
  await view._pendingExecutionWrite;
  assert.equal(captured, undefined, "an unfinished correction cannot save stale values");
  date.value = "11/07/2026";
  date.dispatchEvent(new window.Event("input", { bubbles: true }));
  clickButton(host, "Save executions");
  await view._pendingExecutionWrite;
  assert.equal(captured[1][2].fill.date, "2026-11-07");
});

test("cell editing supports live price totals, Enter, Escape and clean Cancel/reopen", () => {
  const { host } = mount();
  clickButton(host, "Edit executions");
  const price = activate(host, 3, "price");
  setValue(price, "103");
  assert.equal(host.querySelector("tr.is-total td:nth-child(6)").textContent, "+$40.00");
  assert.equal(document.activeElement, price, "preview preserves the active input");
  price.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(host.querySelectorAll("input").length, 0);
  const again = activate(host, 3, "price");
  setValue(again, "104");
  again.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(host.querySelector("tr.is-total td:nth-child(6)").textContent, "+$40.00", "Escape cancels only this cell edit");
  clickButton(host, "Cancel");
  clickButton(host, "Edit executions");
  assert.equal(activate(host, 3, "price").value, "102", "Cancel resets drafts for the next edit session");
});

test("side popup closes after a choice and remains repeatable", () => {
  const { host } = mount();
  clickButton(host, "Edit executions");
  activate(host, 2, "side");
  host.querySelector(".tj-mg-dd-btn").click();
  assert.ok(document.querySelector('.tj-mg-dd-list.is-portal'), "the app-owned popup really opened");
  document.querySelector('[data-dd-value="sell"]').click();
  assert.equal(host.querySelectorAll(".tj-mg-dd").length, 0, "choice restores the ordinary side cell");
  activate(host, 2, "side");
  assert.ok(host.querySelector(".tj-mg-dd-btn"));
});

test("time reordering keeps each draft row tied to its original fill identity", async () => {
  const { host, view } = mount();
  let captured;
  view.saveTradeExecutionEdits = async (...args) => { captured = args; };
  clickButton(host, "Edit executions");
  const time = activate(host, 2, "time");
  setValue(time, "10:03:00");
  time.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const rows = host.querySelectorAll("tbody tr:not(.is-total)");
  assert.equal(rows[1].querySelector('[data-execution-field="time"]').textContent, "10:03:00");
  assert.equal(rows[2].querySelector('[data-execution-field="time"]').textContent, "10:02:00");
  assert.equal(rows[1].cells[3].textContent, "101");
  assert.equal(rows[2].cells[3].textContent, "102");
  assert.equal(rows[1].cells[7].textContent, "TP2");
  assert.equal(rows[2].cells[7].textContent, "TP1");
  clickButton(host, "Save executions");
  await view._pendingExecutionWrite;
  assert.equal(captured[1][1].fill.fillId, "exit-1");
  assert.equal(captured[1][1].fill.time, "10:03:00");
  assert.equal(captured[1][2].fill.fillId, "exit-2");
  assert.equal(captured[1][2].fill.time, "10:02:00");
});

test("the execution time popup escapes the scrolling table and cleans up on Cancel", () => {
  const { host } = mount();
  clickButton(host, "Edit executions");
  activate(host, 3, "time");
  host.querySelector(".tj-time-toggle").click();
  const popup = document.querySelector(".tj-time-picker:not([hidden])");
  assert.ok(popup);
  assert.equal(popup.parentElement, document.body, "a table scroller must not clip the picker");
  clickButton(host, "Cancel");
  assert.equal(document.querySelector(".tj-time-picker:not([hidden])"), null);
});

test("unfinished time input blocks saving until corrected through the shared control", () => {
  const { host } = mount();
  clickButton(host, "Edit executions");
  const time = activate(host, 3, "time");
  time.value = "99:";
  time.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(host.querySelector('[aria-label="Save executions"]').disabled, true);
  setValue(time, "10:04:00");
  assert.equal(host.querySelector('[aria-label="Save executions"]').disabled, false);
});

test("edit mode freezes measured column proportions and Cancel restores the normal table", () => {
  const { host } = mount();
  const table = host.querySelector("table");
  for (const header of table.querySelectorAll("th")) header.getBoundingClientRect = () => ({ width: 80 });
  clickButton(host, "Edit executions");
  assert.equal(table.querySelectorAll("colgroup col").length, 8);
  assert.equal(table.querySelector("col").style.width, "12.5%");
  clickButton(host, "Cancel");
  assert.equal(table.querySelector("colgroup"), null);
});

test("execution cells expose keyboard focus and quiet activation styling", async () => {
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tj-td-execs-table\.is-editing \.tj-td-execrow \[data-execution-field\]:focus-visible/);
  assert.match(css, /outline:\s*2px solid var\(--interactive-accent\)/);
  assert.match(css, /\.tj-td-execs-table\.is-editing \.tj-td-execrow \.is-active/);
});
