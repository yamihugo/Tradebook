import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const tempDir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(process.env.TMPDIR || path.join(os.homedir(), ".hermes", "cache", "scratch"), "tradebook-replay-filter-")));
const bundlePath = path.join(tempDir, "trade-log.cjs");
await build({
  entryPoints: [path.join(repo, "src/views/tradeLogView.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: bundlePath,
  plugins: [{ name: "obsidian-filter-host", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    builder.onLoad({ filter: /.*/, namespace: "host" }, () => ({
      contents: `
        export class ItemView { constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = leaf.contentEl; } }
        export class Modal {} export class Notice {} export class TFile {} export class TFolder {}
        export class App {} export class View {} export class Component {} export class Setting {}
        export class Menu {} export class Plugin {} export class PluginSettingTab {}
        export class MarkdownView {} export class FuzzySuggestModal {} export class SuggestModal {}
        export const setIcon = () => {}; export const normalizePath = value => value;
        export const debounce = fn => fn; export const requestUrl = async () => ({ json: {} });
        export const MarkdownRenderer = {}; export const Platform = { isDesktop: true, isMobile: false };
      `,
    }));
  } }],
});
const { TradeLogView } = createRequire(bundlePath)(bundlePath);

const demo = { id: "demo-1", name: "Replay sandbox", type: "demo" };
const live = { id: "live-1", name: "Live account", type: "live" };
const plugin = {
  settings: { propAccounts: [demo, live], timeZone: "UTC" },
  mappedAccount(label) {
    return [demo, live].find((account) => account.name === label) ?? null;
  },
};
const view = new TradeLogView({ app: {}, contentEl: {} }, plugin);
view.trades = [
  { id: "replay-1", type: "trade", account: demo.name, accountType: "demo", origin: "replay", dataSource: "replay", date: "2026-11-12", pnl: 50 },
  { id: "live-1", type: "trade", account: live.name, accountType: "live", origin: "broker", dataSource: "broker", date: "2026-11-12", pnl: 50 },
];

test("Replay trades stay out of the default ledger and are reachable through demo filtering", () => {
  assert.deepEqual(view.filtered().map((trade) => trade.id), ["live-1"]);
  view.excludeDemos = false;
  assert.deepEqual(view.filtered().map((trade) => trade.id).sort(), ["live-1", "replay-1"]);
  view.accountTypeFilter = "demo";
  assert.deepEqual(view.filtered().map((trade) => trade.id), ["replay-1"]);
});
