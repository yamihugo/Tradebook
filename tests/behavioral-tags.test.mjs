import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: {
    dash: new URL("../src/views/dashboard.ts", import.meta.url).pathname,
  },
  outdir: "bundle",
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  loader: { ".png": "dataurl" },
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: [
          "export const App = class {};",
          "export const TFile = class {};",
          "export const TFolder = class {};",
          "export const normalizePath = (p) => p;",
          "export const setIcon = () => {};",
          "export const ItemView = class ItemView {};",
          "export const View = class View {};",
          "export const Modal = class Modal {};",
          "export const Notice = class Notice {};",
          "export const Menu = class Menu {};",
          "export const Component = class Component {};",
          "export const Setting = class Setting {};",
          "export const Plugin = class Plugin {};",
          "export const PluginSettingTab = class PluginSettingTab {};",
          "export const MarkdownView = class MarkdownView {};",
          "export const FuzzySuggestModal = class FuzzySuggestModal {};",
          "export const SuggestModal = class SuggestModal {};",
          "export const debounce = (fn) => fn;",
          "export const requestUrl = async () => ({ json: {} });",
        ].join("\n"),
        loader: "js",
      }));
    },
  }],
});
const output = result.outputFiles.find((file) => file.path.endsWith("dash.js"));
const dash = await import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);

const ACCOUNTS = [
  { id: "live-1", name: "Live One", type: "live" },
  { id: "eval-1", name: "Eval One", type: "eval" },
];

const trade = (overrides = {}) => ({
  id: "trade",
  date: "2026-09-01",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "Live One",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20001,
  pnl: 100,
  commission: 0,
  fees: 0,
  costCoverage: { commission: true, fees: true },
  ...overrides,
});

// A stand-in for Obsidian's createDiv/createSpan with just enough layout to
// drive the widget's fit loop: every node is one row tall, and a container's
// scrollHeight is the rows it holds plus the flex gaps between them.
const ROW_H = 36;
const GAP = 8;

const fakeEl = (cls = "", text) => {
  const el = {
    cls,
    text,
    style: {},
    children: [],
    parent: null,
    dataset: {},
    _clientH: 0,
    classList: { add() {}, toggle() {} },
    addEventListener() {},
    setText(t) { el.text = t; },
    empty() { for (const c of el.children) c.parent = null; el.children.length = 0; },
    remove() {
      if (!el.parent) return;
      const i = el.parent.children.indexOf(el);
      if (i >= 0) el.parent.children.splice(i, 1);
      el.parent = null;
    },
  };
  Object.defineProperty(el, "clientHeight", {
    get() { return el._clientH; },
    set(v) { el._clientH = v; },
  });
  Object.defineProperty(el, "offsetHeight", { get() { return ROW_H; } });
  Object.defineProperty(el, "scrollHeight", {
    get() {
      const n = el.children.length;
      return n ? n * ROW_H + (n - 1) * GAP : 0;
    },
  });
  const make = (opts = {}) => {
    const child = fakeEl(opts.cls ?? "", opts.text);
    child.parent = el;
    child._clientH = el._clientH;
    el.children.push(child);
    return child;
  };
  el.createDiv = make;
  el.createSpan = make;
  el.createEl = make;
  return el;
};

const flatten = (el) => [el, ...el.children.flatMap(flatten)];
const countByCls = (nodes, cls) => nodes.filter((n) => n.cls === cls).length;

/** Render the Tags widget at a given card height and return every node it wrote. */
const tagsWidget = (rows, cardHeight) => {
  const view = Object.create(dash.WidgetGridView.prototype);
  view.plugin = {
    settings: {
      excludeDemosFromPortfolio: true,
      includeCopiesInPortfolioAnalytics: false,
      propAccounts: ACCOUNTS,
      timeZone: "America/New_York",
    },
    resolveAccountType: (label) =>
      ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase())?.type ?? "unknown",
    mappedAccount: () => null,
    isArchivedTrade: () => false,
    openTradeLogView: async () => {},
  };
  view._accountIds = [];
  view._accountTypes = [];
  view._countCache = new WeakMap();
  view._finCache = new WeakMap();
  const body = fakeEl();
  body._clientH = cardHeight;
  view.renderBehavioralTagsWidget(body, rows);
  return flatten(body);
};

const tenTaggedTrades = () =>
  Array.from({ length: 10 }, (_, i) =>
    trade({ id: `t${i}`, mistake_tags: [`Tag ${String(i + 1).padStart(2, "0")}`] }),
  );

test("a short tags card shows what fits and names the rest", () => {
  const nodes = tagsWidget(tenTaggedTrades(), 80);
  const shown = countByCls(nodes, "tj-tags-row");
  const note = nodes.find((n) => n.cls === "tj-tags-more");

  assert.ok(shown > 0 && shown < 10, "a short card hides some tags");
  assert.ok(note, "the hidden tail is named, never silently dropped");
  assert.equal(note.text, `+${10 - shown} more tags`);
  assert.equal(shown + Number(note.text.match(/\+(\d+)/)[1]), 10, "every tag is accounted for");
});

test("growing the card reveals strictly more tags", () => {
  const short = countByCls(tagsWidget(tenTaggedTrades(), 80), "tj-tags-row");
  const tall = countByCls(tagsWidget(tenTaggedTrades(), 200), "tj-tags-row");
  assert.ok(tall > short, `taller card shows more (${tall} > ${short})`);
});

test("a card tall enough shows every tag and drops the note", () => {
  const nodes = tagsWidget(tenTaggedTrades(), 500);
  assert.equal(countByCls(nodes, "tj-tags-row"), 10);
  assert.equal(nodes.filter((n) => n.cls === "tj-tags-more").length, 0);
  // The survivors read the Breakdown base: one winning decision each, so 100%.
  const wins = nodes.filter((n) => n.cls === "tj-tags-win");
  assert.ok(wins.every((w) => w.text === "100%"), "each visible row carries its Net win rate");
});

test("an unmeasured card does not crash and keeps every row", () => {
  const nodes = tagsWidget(tenTaggedTrades(), 0);
  assert.equal(countByCls(nodes, "tj-tags-row"), 10);
  assert.equal(nodes.filter((n) => n.cls === "tj-tags-more").length, 0);
});
