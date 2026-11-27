import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { installElementHelpers, loadAnalyticsView, syntheticAnalyticsPlugin } from "./support/analytics-view-host.mjs";

const root = new URL("../", import.meta.url).pathname;
const bundle = await build({
  stdin: { contents: "export { default as Product } from './src/main';", resolveDir: root, loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  plugins: [{
    name: "synthetic-obsidian-host",
    setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      b.onLoad({ filter: /.*/, namespace: "host" }, () => ({
        contents: `
          export class App {} export class Plugin {} export class PluginManifest {} export class ItemView {}
          export class Modal {} export class PluginSettingTab {} export class Setting {} export class Menu {}
          export class SuggestModal {} export class FuzzySuggestModal {} export class Component {} export class MarkdownRenderChild {}
          export class TFile { constructor(path) { this.path=path; this.name=path.split('/').pop(); this.extension=this.name.split('.').pop(); } }
          export class TFolder {} export class Notice {}
          export const normalizePath=p=>p.replace(/\\\\/g,'/').replace(/\\/+/g,'/');
          export const setIcon=()=>{}; export const addIcon=()=>{}; export const debounce=fn=>fn; export const apiVersion='synthetic';
          export const moment=()=>{}; export const MarkdownRenderer={}; export const Platform={isDesktop:true,isMobile:false};
          export const requestUrl=()=>{throw Error('Network forbidden')};
        `,
        loader: "js",
      }));
    },
  }],
});
const { Product } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const unresolvedTrade = {
  id: "Synthetic/unresolved.md",
  date: "2020-01-01",
  entryTime: "09:30:00",
  exitTime: "09:35:00",
  timeUnresolved: true,
  sessionOverride: "newyork",
  symbol: "ES",
  direction: "long",
  quantity: 1,
  entryPrice: 100,
  exitPrice: 101,
  pnl: 100,
  pnlPoints: 1,
  commission: 0,
  fees: 0,
  account: "Synthetic",
  accountType: "demo",
  setup: "",
  mistake: "",
  review: "",
  rating: 0,
};

function pluginFor(trades, accounts = []) {
  const plugin = Object.create(Product.prototype);
  plugin.settings = { timeZone: "UTC", propAccounts: accounts, copyGroups: [], payouts: [] };
  plugin.loadTrades = async () => trades;
  plugin.mappedAccount = () => undefined;
  plugin.saveSettings = async () => {};
  return plugin;
}

test("unresolved Replay time does not age the journal maturity snapshot", async () => {
  const plugin = pluginFor([unresolvedTrade]);
  const score = await plugin.refreshMaturity();
  assert.ok(score.parts.volume < 0.01, `volume score ${score.parts.volume} should not use an unresolved date`);
});

test("unresolved Replay P&L cannot set a prop-account pass date", async () => {
  const account = { id: "synthetic-account", name: "Synthetic" };
  const resolved = { ...unresolvedTrade, id: "Synthetic/resolved.md", date: "2026-01-02", timeUnresolved: undefined, sessionOverride: undefined, pnl: 60 };
  const plugin = pluginFor([unresolvedTrade, resolved], [account]);
  plugin.mappedAccount = () => account;
  assert.equal(await plugin.passedDateOf(account.id, 50), "2026-01-02");
});

test("unresolved Replay wall clocks do not appear in Home Hour or Session breakdowns", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(dom.window);
  dom.window.HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 200 });
  const HomeView = await loadAnalyticsView();
  const plugin = syntheticAnalyticsPlugin();
  plugin.settings.timeZone = "UTC";
  plugin.settings.dashboardBreakdownTab = "hour";
  const view = new HomeView({ app: {} }, plugin);
  const body = document.createElement("div");

  view.renderBreakdownWidget(body, [unresolvedTrade]);
  assert.ok(body.querySelector(".tj-empty"), "an unresolved wall clock must not create an Hour bucket");

  body.replaceChildren();
  plugin.settings.dashboardBreakdownTab = "session";
  view.renderBreakdownWidget(body, [unresolvedTrade]);
  assert.ok(body.querySelector(".tj-empty"), "an unresolved wall clock must not create a Session bucket");
  dom.window.close();
});
