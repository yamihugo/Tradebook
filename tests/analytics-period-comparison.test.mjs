import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import Module from "node:module";

const harnessRequire = createRequire("/home/hugo/trading-journal-smoke/smoke.js");
const { JSDOM } = harnessRequire("jsdom");
const mock = harnessRequire("./obsidian-mock");
const projectRequire = createRequire(import.meta.url);
const originalLoad = Module._load;

let dom;
let plugin;
let dashboard;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.requestAnimationFrame = window.requestAnimationFrame?.bind(window) || ((callback) => setTimeout(callback, 0));
  global.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) || clearTimeout;
  global.Event = window.Event;
  global.HTMLElement = window.HTMLElement;
  global.SVGElement = window.SVGElement;
  Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
  mock.installDomPolyfill(window.document);

  Module._load = function (request, parent, isMain) {
    if (request === "obsidian") return mock;
    return originalLoad.call(this, request, parent, isMain);
  };
  const TradebookPlugin = projectRequire("../main.js").default;
  const app = new mock.App();
  plugin = new TradebookPlugin(app, { defaults: {} });
  await plugin.onload();
  app.workspace.plugin = plugin;
  const leaf = app._makeLeaf("tradebook-dashboard-view");
  await leaf.setViewState({ type: "tradebook-dashboard-view", active: true });
  dashboard = leaf.view;
  plugin.settings.animations = false;
});

after(() => {
  Module._load = originalLoad;
  dom?.window.close();
});

function trade(id, date, pnl) {
  return {
    id,
    date,
    entryTime: "09:30",
    exitTime: "09:35",
    symbol: "NQ",
    account: "Test account",
    accountType: "eval",
    direction: "long",
    quantity: 1,
    entryPrice: 100,
    exitPrice: 101,
    commission: 0,
    fees: 0,
    costCoverage: { commission: true, fees: true },
    pnl,
    pnlPoints: pnl / 20,
    setup: "Test",
    mistake: "",
    thesis: "",
    review: "",
    screenshot: "",
  };
}

function renderMetric(metricId, current, comparison) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dashboard.renderMetricBody(host, current, metricId, comparison.baseline, comparison);
  return host;
}

test("Analytics comparison windows use selected Custom dates, independent of sparse trade dates", () => {
  dashboard.dateRange = "custom";
  dashboard.customFrom = "2026-04-10";
  dashboard.customTo = "2026-04-19";
  dashboard.filter = "eval";
  dashboard.accountId = null;
  dashboard.trades = [
    trade("base", "2026-04-05", -20),
    trade("current-a", "2026-04-10", 30),
    trade("current-b", "2026-04-19", -10),
    { ...trade("other-type", "2026-04-12", 999), accountType: "funded" },
    trade("outside", "2026-04-20", 100),
    trade("future", "2026-12-01", 200),
  ];

  const comparison = dashboard.analyticsComparisonTrades();
  assert.equal(comparison.eligible, true);
  assert.deepEqual(comparison.current.map((item) => item.id), ["current-a", "current-b"]);
  assert.deepEqual(comparison.baseline.map((item) => item.id), ["base"]);
  const host = renderMetric("m.expectancy", comparison.current, comparison);
  assert.equal(host.querySelector(".tj-metric-sub")?.textContent, "↑ +$30.00 vs prev");
});

test("a comparable metric delta is displayed using the existing Net calculation", () => {
  const current = [
    trade("current-a", "2026-04-10", 30),
    trade("current-b", "2026-04-19", -10),
  ];
  const comparison = {
    current,
    baseline: [trade("base", "2026-04-05", -20)],
    eligible: true,
  };
  const host = renderMetric("m.expectancy", current, comparison);
  assert.equal(host.querySelector(".tj-metric-value")?.textContent, "+$10.00");
  assert.equal(host.querySelector(".tj-metric-sub")?.textContent, "↑ +$30.00 vs prev");
});

test("eligible calendar bounds with no comparable metric value show no delta", () => {
  const current = [trade("current", "2026-04-10", 30)];
  const host = renderMetric("m.expectancy", current, { current, baseline: [], eligible: true });
  assert.equal(host.querySelector(".tj-metric-sub"), null);
});

test("ineligible period comparisons and Net P&L do not show a vs-prev delta", () => {
  const current = [trade("current", "2026-04-10", 30)];
  const unavailable = renderMetric("m.expectancy", current, { current: [], baseline: [], eligible: false });
  assert.equal(unavailable.querySelector(".tj-metric-sub"), null);
  const remaining = renderMetric("m.netpnl", current, {
    current,
    baseline: [trade("base", "2026-04-05", -20)],
    eligible: true,
  });
  assert.equal(remaining.querySelector(".tj-metric-sub"), null);
});

test("delta formatting does not attach currency to percentages, counts, ratios, or durations", () => {
  assert.equal(dashboard.constructor.prototype.formatMetricDelta("m.winrate", 2.5), "↑ +2.5 pp");
  assert.equal(dashboard.constructor.prototype.formatMetricDelta("m.trades", 3), "↑ +3 trades");
  assert.equal(dashboard.constructor.prototype.formatMetricDelta("m.profitfactor", 0.25), "↑ +0.25");
  assert.equal(dashboard.constructor.prototype.formatMetricDelta("m.holdtime", 1.5), "↑ +1m 30s");
});
