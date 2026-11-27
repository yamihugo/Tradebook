import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { JSDOM } from "jsdom";
import { installElementHelpers, loadAnalyticsView, syntheticAnalyticsPlugin } from "./support/analytics-view-host.mjs";

let dom;
let home;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  installElementHelpers(window);
  window.HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
  window.HTMLElement.prototype.setCssStyles = function (styles) { Object.assign(this.style, styles); };
  const HomeView = await loadAnalyticsView();
  home = new HomeView({ app: {} }, syntheticAnalyticsPlugin());
});

after(() => dom?.window.close());

test("Home best-hour metric label stays concise", () => {
  const host = document.createElement("div");
  home.renderMetricBody(host, [], "m.besthour");
  assert.equal(host.querySelector(".tj-metric-label")?.textContent, "Best Hour");
});

test("Without stop tooltip describes the recorded stop-price filter", () => {
  const trade = { id: "synthetic", date: "2026-01-01", symbol: "TEST", account: "Example", direction: "long", quantity: 1, entryPrice: 100, exitPrice: 101, pnl: 1 };
  home.trades = [trade];
  const body = document.createElement("div");
  home.renderFocusAreasWidget(body, [trade]);
  const row = body.querySelector('[data-flag="nostop"]');
  row?.dispatchEvent(new window.MouseEvent("mouseenter", { clientX: 40, clientY: 50 }));
  const text = document.querySelector(".tj-tip")?.textContent ?? "";
  assert.match(text, /stop price/i);
  assert.doesNotMatch(text, /default risk.*not in this row/i);
});
