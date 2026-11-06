import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: {
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    periods: new URL("../src/lib/periods.ts", import.meta.url).pathname,
    metrics: new URL("../src/lib/metrics.ts", import.meta.url).pathname,
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
          // The dashboard bundle reaches the rest of the Obsidian surface; the
          // classes only have to exist so the module can be imported — the
          // tests drive `WidgetGridView.prototype` directly, never a live leaf.
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
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [money, scope, periods, metrics, dash] = await Promise.all([
  loadBundle("money"),
  loadBundle("scope"),
  loadBundle("periods"),
  loadBundle("metrics"),
  loadBundle("dash"),
]);

const ACCOUNTS = [
  { id: "live-1", name: "Live One", type: "live" },
  { id: "live-2", name: "Live Two", type: "live" },
  { id: "eval-1", name: "Eval One", type: "eval" },
  { id: "funded-1", name: "Funded One", type: "funded" },
  { id: "demo-1", name: "Demo One", type: "demo" },
  { id: "arch-1", name: "Old Archive", type: "eval" },
];
const RESOLVE = scope.accountResolver({
  accounts: ACCOUNTS,
  mappedAccount: (label) => ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase()) ?? null,
});

const dayKey = (t) => t.date;

const scopeOf = (trades, options = {}) =>
  scope.accountScope(trades, {
    resolve: RESOLVE,
    excludeDemos: true,
    isArchived: (t) => t.account === "Old Archive",
    ...options,
  });

const summarize = (trades, options = {}) =>
  money.summarizeFinancials(trades, { scope: scopeOf(trades, options.scopeOptions), dayKey: options.dayKey ?? dayKey });

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

const metric = (id, rows, summary) => metrics.metricById(id).compute(rows, dayKey, summary).value;

test("the portfolio scope keeps archived accounts out and drops demos only when nothing was picked", () => {
  const rows = [
    trade({ id: "live", account: "Live One" }),
    trade({ id: "demo", account: "Demo One" }),
    trade({ id: "arch", account: "Old Archive" }),
  ];
  const portfolio = summarize(rows);
  assert.equal(portfolio.scope.kind, "all-included-accounts");
  assert.equal(portfolio.scope.includedAccountCount, 1);
  assert.equal(portfolio.eligibleLegCount, 1);
  assert.equal(portfolio.decisionCount, 1);
  assert.equal(portfolio.net.total, 100);

  const explicit = scopeOf(rows, { explicitAccountScope: true });
  assert.deepEqual([...explicit.includedAccountIds].sort(), ["demo-1", "live-1"]);
  assert.equal(explicit.includedAccountIds.has("arch-1"), false);

  const selectedDemo = summarize(rows, { scopeOptions: { selectedAccountId: "demo-1" } });
  assert.equal(selectedDemo.scope.kind, "selected-account");
  assert.equal(selectedDemo.scope.accountId, "demo-1");
  assert.equal(selectedDemo.decisionCount, 1);
  assert.equal(selectedDemo.net.total, 100);
});

test("a lista que os widgets leem nunca contém demos com a regra ON", () => {
  const rows = [
    trade({ id: "eval", account: "Eval One" }),
    trade({ id: "funded", account: "Funded One" }),
    trade({ id: "demo", account: "Demo One" }),
  ];

  // The list every widget reads is `baseTrades()` — counts (focus, breakdown,
  // score, tags) go through it too, and `analyticsTrades` applies no account
  // scope of its own. So the demo rule has to hold HERE, at the list, or the
  // money reads right while the counts do not.
  const widgetView = (excludeDemosFromPortfolio) => {
    const view = Object.create(dash.WidgetGridView.prototype);
    view.plugin = {
      settings: { excludeDemosFromPortfolio, propAccounts: ACCOUNTS },
      resolveAccountType: (label) =>
        ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase())?.type ?? "unknown",
      mappedAccount: () => null,
    };
    view.trades = rows;
    view.accountId = null;
    view.filter = "all";
    view._cacheTrades = null;
    view._baseCache = new Map();
    view._filteredCache = new Map();
    return view;
  };

  // Rule ON: the demo is out of the portfolio population.
  assert.deepEqual(widgetView(true).baseTrades().map((t) => t.id), ["eval", "funded"]);

  // Rule OFF: the trader asked for demos in the totals, so all three stay.
  assert.deepEqual(widgetView(false).baseTrades().map((t) => t.id), ["eval", "funded", "demo"]);

  // An explicit demo pick overrides the rule — that is the reader asking for
  // that population, the same contract accountScope() implements.
  const explicit = widgetView(true);
  explicit.accountId = "demo-1";
  assert.deepEqual(explicit.baseTrades().map((t) => t.id), ["demo"]);
});

test("Total trades, Win Rate and the win/loss counts are one Net decision population", () => {
  const rows = [
    trade({ id: "w", date: "2026-09-01", pnl: 50 }),
    trade({ id: "l", date: "2026-09-02", pnl: -50 }),
    trade({ id: "b", date: "2026-09-03", pnl: 0 }),
  ];
  const summary = summarize(rows);
  assert.equal(summary.decisionCount, 3);
  assert.equal(summary.net.positiveDecisionCount, 1);
  assert.equal(summary.net.negativeDecisionCount, 1);
  assert.equal(summary.net.breakevenDecisionCount, 1);
  assert.equal(summary.net.winRate, 0.5);

  assert.equal(metric("m.trades", rows, summary), "3");
  assert.equal(metric("m.winrate", rows, summary), "50.0%");
  assert.equal(metric("m.wintrades", rows, summary), "1");
  assert.equal(metric("m.losstrades", rows, summary), "1");
  assert.equal(metric("m.netpnl", rows, summary), "+$0.00");
});

test("a positive Gross result that costs more than it earned is a Net loss", () => {
  const rows = [trade({ id: "fee-flip", pnl: 5, commission: 6, fees: 1 })];
  const summary = summarize(rows);
  assert.equal(summary.gross.positiveDecisionCount, 1);
  assert.equal(summary.net.positiveDecisionCount, 0);
  assert.equal(summary.net.negativeDecisionCount, 1);
  assert.equal(summary.net.winRate, 0);
  assert.equal(metric("m.winrate", rows, summary), "0.0%");
  assert.equal(metric("m.netpnl", rows, summary), "-$2.00");
});

test("nothing decided reports an em dash, never a misleading zero", () => {
  const flat = [trade({ id: "flat-only", pnl: 0 })];
  const flatSummary = summarize(flat);
  assert.equal(flatSummary.decisionCount, 1);
  assert.equal(flatSummary.net.winRate, null);
  assert.equal(metric("m.winrate", flat, flatSummary), "—");

  const empty = summarize([]);
  assert.equal(empty.decisionCount, 0);
  assert.equal(metric("m.winrate", [], empty), "—");
  assert.equal(metric("m.trades", [], empty), "0");
  assert.equal(metric("m.netpnl", [], empty), "—");
});

test("one copied decision can win in one account and lose across the portfolio", () => {
  const leader = trade({ id: "base-id", account: "Live One", pnl: 10, copyBaseKey: undefined });
  const copier = trade({ id: "copy-id", account: "Live Two", pnl: -12, isCopiedTrade: true, copyBaseKey: "base-id" });
  const rows = [leader, copier];

  const portfolio = summarize(rows);
  assert.equal(portfolio.decisionCount, 1);
  assert.equal(portfolio.net.total, -2);
  assert.equal(portfolio.net.positiveDecisionCount, 0);
  assert.equal(portfolio.net.negativeDecisionCount, 1);
  assert.equal(metric("m.trades", rows, portfolio), "1");

  const onlyLeader = summarize([leader], { scopeOptions: { selectedAccountId: "live-1" } });
  assert.equal(onlyLeader.net.positiveDecisionCount, 1);
  assert.equal(onlyLeader.net.winRate, 1);

  const onlyCopier = summarize([copier], { scopeOptions: { selectedAccountId: "live-2" } });
  assert.equal(onlyCopier.net.negativeDecisionCount, 1);
  assert.equal(onlyCopier.net.winRate, 0);
});

test("unknown historical costs are flagged instead of silently trusted", () => {
  const unknown = trade({ id: "unknown", pnl: 100, costCoverage: undefined });
  const known = trade({ id: "known", pnl: 100, costCoverage: { commission: true, fees: true } });
  const summary = summarize([unknown, known]);
  assert.equal(summary.eligibleLegCount, 2);
  assert.equal(summary.decisionCount, 2);
  assert.equal(summary.costCoverage.completeLegs, 1);
  assert.equal(summary.costCoverage.missingCommission, 1);
  assert.equal(summary.costCoverage.missingFees, 1);
  assert.equal(summary.costCoverage.completeDecisions, 1);
  // No fallback to Gross: the number is still the recorded Net, coverage noted.
  assert.equal(summary.net.total, 200);
});

test("rows that cannot be settled never enter the population", () => {
  const rows = [
    trade({ id: "good", pnl: 100 }),
    trade({ id: "nan", pnl: NaN }),
    trade({ id: "baddate", pnl: 10, date: "09/01/2026" }),
    trade({ id: "zeroqty", pnl: 10, quantity: 0 }),
    trade({ id: "baddir", pnl: 10, direction: "flat" }),
    trade({ id: "noexit", pnl: 10, exitPrice: 0, exitTime: "" }),
  ];
  const summary = summarize(rows);
  assert.equal(summary.eligibleLegCount, 1);
  assert.equal(summary.decisionCount, 1);
  assert.equal(summary.net.total, 100);
  assert.deepEqual(summary.eligibleLegs.map((t) => t.id), ["good"]);
  assert.equal(metric("m.trades", rows, summary), "1");
});

test("period membership and day bucketing share one journal day key", () => {
  const ny = scope.journalDayKey("America/New_York");
  const lisbon = scope.journalDayKey("Europe/Lisbon");

  // A note with no instant is its own record: the date it shows is the day it
  // belongs to, in any journal zone.
  assert.equal(ny(trade({ date: "2026-09-01", entryTime: "10:00" })), "2026-09-01");
  assert.equal(ny(trade({ date: "2026-09-01", entryTime: "23:30" })), "2026-09-01");
  assert.equal(lisbon(trade({ date: "2026-09-01", entryTime: "02:00" })), "2026-09-01");

  // With a canonical instant the day is that instant rendered in the journal
  // zone: 01:30Z on 2 September is still 1 September in New York, and the 2nd
  // in Lisbon. The instant decides; the zone only decides how it reads.
  const at = (iso) => trade({ entryInstant: iso });
  assert.equal(ny(at("2026-09-02T01:30:00.000Z")), "2026-09-01");
  assert.equal(lisbon(at("2026-09-02T01:30:00.000Z")), "2026-09-02");

  // Period bounds and day keys are the same domain now: the filter and the
  // bucket cannot disagree, whichever zone the trader chose.
  const bounds = { start: "2026-09-01", end: "2026-09-30" };
  assert.deepEqual(periods.periodDayBounds(bounds, "America/New_York"), bounds);
  assert.deepEqual(periods.periodDayBounds(bounds, "Europe/Lisbon"), bounds);
  assert.equal(periods.dateWithinPeriod("2026-08-31", periods.periodDayBounds(bounds, "Europe/Lisbon")), false);
  assert.equal(periods.dateWithinPeriod(ny(at("2026-09-02T01:30:00.000Z")), bounds), true);
  assert.equal(periods.dateWithinPeriod(lisbon(at("2026-09-02T01:30:00.000Z")), bounds), true);
  assert.equal(periods.dateWithinPeriod(ny(at("2026-09-30T23:30:00.000Z")), bounds), true, "the last day of the period is in");
  // 01:30Z on 1 October is still 30 September in New York — in the period.
  assert.equal(periods.dateWithinPeriod(ny(at("2026-10-01T01:30:00.000Z")), bounds), true, "a late instant still lands in September");
  // 13:30Z is 09:30 in New York on 1 October — the next day is out.
  assert.equal(periods.dateWithinPeriod(ny(at("2026-10-01T13:30:00.000Z")), bounds), false, "and the next day is out");
});

test("the day bucket classifies decisions by Net sign, same as the headline", () => {
  const rows = [
    trade({ id: "net-loss", date: "2026-09-01", pnl: 5, commission: 6, fees: 1 }),
    trade({ id: "net-win", date: "2026-09-01", pnl: 40 }),
    trade({ id: "net-flat", date: "2026-09-02", pnl: 0 }),
  ];
  const summary = summarize(rows);
  assert.deepEqual(summary.decisionsByDay.get("2026-09-01"), { count: 2, wins: 1, losses: 1, breakeven: 0 });
  assert.deepEqual(summary.decisionsByDay.get("2026-09-02"), { count: 1, wins: 0, losses: 0, breakeven: 1 });

  const byDay = summary.net.byDay;
  assert.equal(byDay.get("2026-09-01"), 38);
  assert.equal(byDay.get("2026-09-02"), 0);
  assert.equal(metric("m.netpnl", rows, summary), "+$38.00");
  assert.equal(metric("m.bestday", rows, summary), "+$38.00");
});

// The Position Size widget draws its own DOM (Obsidian's createDiv/createSpan);
// this is the smallest node that satisfies the surface it touches.
const fakeEl = (cls = "", text = undefined) => {
  const el = {
    cls,
    text,
    style: {},
    children: [],
    classes: [],
    classList: { add(c) { el.classes.push(c); }, toggle() {} },
    addClass(c) { el.classes.push(c); },
    addEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
  };
  const make = (opts = {}) => {
    const child = fakeEl(opts.cls ?? "", opts.text);
    el.children.push(child);
    return child;
  };
  el.createDiv = make;
  el.createSpan = make;
  return el;
};
const flatten = (el) => [el, ...el.children.flatMap(flatten)];

// The Costs ring is drawn with SVG. Node has no DOM, so the harness answers
// the only call the widget makes — the nodes are shaped so `flatten` can walk
// them like any other child (`cls` matches nothing, `children` is an array).
globalThis.document = {
  createElementNS: (ns, tag) => ({
    cls: "",
    tag,
    attrs: {},
    children: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
  }),
};

/** Render the widget against a stubbed body and return every node it wrote. */
const sizeWidget = (rows) => {
  const view = Object.create(dash.WidgetGridView.prototype);
  view.plugin = {
    settings: { excludeDemosFromPortfolio: true, propAccounts: ACCOUNTS, timeZone: "America/New_York" },
    resolveAccountType: (label) =>
      ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase())?.type ?? "unknown",
    mappedAccount: () => null,
    isArchivedTrade: () => false,
  };
  view._accountIds = [];
  view._accountTypes = [];
  view._finCache = new WeakMap();
  const body = fakeEl();
  body.clientHeight = 150;
  body.clientWidth = 0;
  view.renderPositionSizeWidget(body, rows);
  return flatten(body);
};

/** The value the widget printed in its inline facts ("Winners 1.0", "Losers 4.0"). */
const sizeRow = (nodes, label) => {
  const node = nodes.find((n) => typeof n.text === "string" && n.text.startsWith(`${label} `));
  return node ? node.text.slice(label.length + 1) : null;
};

test("the Position Size widget groups winners and losers by the Net of the decision", () => {
  const rows = [
    // Gross +10 but Net −5: a Gross win that cost more than it earned.
    trade({ id: "fee-flip", date: "2026-09-01", quantity: 4, pnl: 10, commission: 10, fees: 5 }),
    trade({ id: "clean-win", date: "2026-09-02", quantity: 1, pnl: 50 }),
  ];
  const nodes = sizeWidget(rows);

  assert.equal(sizeRow(nodes, "Winners"), "10.0");
  assert.equal(sizeRow(nodes, "Losers"), "40.0");
  const footer = nodes.find((n) => String(n.cls).includes("tj-size-footer"));
  assert.equal(footer.cls, "tj-size-footer is-bad");
  assert.equal(footer.text, "Sizing up on losers");
});

test("one copied decision lands in a single group, on its Net", () => {
  const rows = [
    trade({ id: "base-id", account: "Live One", date: "2026-09-03", quantity: 2, pnl: 100, copyBaseKey: undefined }),
    trade({
      id: "copy-id",
      account: "Live Two",
      date: "2026-09-03",
      quantity: 3,
      pnl: -105,
      isCopiedTrade: true,
      copyBaseKey: "base-id",
    }),
  ];
  const nodes = sizeWidget(rows);

  // Leader Gross-win, decision Net −5: both legs read as the losing decision,
  // in micro-equivalents (NQ ×10).
  assert.equal(sizeRow(nodes, "Winners"), "—");
  assert.equal(sizeRow(nodes, "Losers"), "25.0");
});

/** Render the R-Multiples widget against a stubbed body and card header. */
const rWidget = (rows) => {
  const view = Object.create(dash.WidgetGridView.prototype);
  view.plugin = {
    settings: { excludeDemosFromPortfolio: true, propAccounts: ACCOUNTS, timeZone: "America/New_York" },
    resolveAccountType: (label) =>
      ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase())?.type ?? "unknown",
    mappedAccount: () => null,
    isArchivedTrade: () => false,
  };
  view._accountIds = [];
  view._accountTypes = [];
  view._finCache = new WeakMap();
  const body = fakeEl();
  body.clientHeight = 160;
  body.clientWidth = 0;
  const headerKids = [];
  const header = {
    querySelectorAll: () => [],
    querySelector: () => null,
    createSpan: (opts = {}) => {
      const el = fakeEl(opts.cls ?? "", opts.text);
      headerKids.push(el);
      return el;
    },
    appendChild: () => {},
  };
  view.renderRMultiplesWidget(body, rows, header);
  return [...flatten(body), ...headerKids.flatMap(flatten)];
};

test("R-Multiples reads one R per decision, not one per copy leg", () => {
  const rows = [
    // Leader 5R, its copy only 0.5R: per-leg the average would read +2.75R.
    trade({ id: "base", account: "Live One", stopLoss: 19999, entryPrice: 20000, quantity: 1, pnl: 100 }),
    trade({
      id: "copy",
      account: "Live Two",
      stopLoss: 19999,
      entryPrice: 20000,
      quantity: 1,
      pnl: 10,
      isCopiedTrade: true,
      copyBaseKey: "base",
    }),
  ];
  const nodes = rWidget(rows);
  const avg = nodes.find((n) => n.cls === "tj-rm-avgchip-v");
  assert.equal(avg?.text, "+5.00R", "the average is the decision's R, counted once");
});

test("R-Multiples needs a stop to read R, and says so", () => {
  const nodes = rWidget([trade({ id: "nostop", stopLoss: undefined })]);
  assert.ok(nodes.some((n) => n.cls === "tj-empty"), "no stop reads as an empty state, never a zero");
});

test("Runner Rate reads one R per decision, so a copied leg is not a second runner", () => {
  const rows = [
    // Leader reaches 5R (a runner); its copy only reaches 0.5R.
    trade({ id: "base", account: "Live One", stopLoss: 19999, entryPrice: 20000, quantity: 1, pnl: 100 }),
    trade({
      id: "copy",
      account: "Live Two",
      stopLoss: 19999,
      entryPrice: 20000,
      quantity: 1,
      pnl: 10,
      isCopiedTrade: true,
      copyBaseKey: "base",
    }),
  ];
  const summary = summarize(rows);
  // One decision (the leader) → 1 runner out of 1 → 100%. Per-leg it would read 50%.
  assert.equal(metric("m.runnerrate", rows, summary), "100%");
});

/** Render the Costs widget against a stubbed body (non-compact box). */
const costsWidget = (rows, prev = []) => {
  const view = Object.create(dash.WidgetGridView.prototype);
  view.plugin = {
    settings: { excludeDemosFromPortfolio: true, propAccounts: ACCOUNTS, timeZone: "America/New_York" },
    resolveAccountType: (label) =>
      ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase())?.type ?? "unknown",
    mappedAccount: () => null,
    isArchivedTrade: () => false,
  };
  view._accountIds = [];
  view._accountTypes = [];
  view._finCache = new WeakMap();
  const body = fakeEl();
  body.clientHeight = 300;
  body.clientWidth = 400;
  view.renderCostsWidget(body, rows, prev);
  return flatten(body);
};

test("the Costs widget divides the period's costs by its recorded legs", () => {
  const rows = [
    trade({ id: "a", commission: 3, fees: 0 }),
    trade({ id: "b", commission: 2, fees: 1 }),
  ];
  const nodes = costsWidget(rows);
  const sub = nodes.find((n) => n.cls === "tj-costs-sub");
  assert.equal(sub?.text, "commission & fees · $3.00 / trade");
});

test("the Costs widget reads the move against the previous window, inverse to P&L", () => {
  const current = [trade({ id: "a", commission: 4, fees: 2 })];
  const up = costsWidget(current, [trade({ id: "p", commission: 2, fees: 0 })]);
  const rise = up.find((n) => n.cls === "tj-costs-delta");
  assert.ok(rise?.text.startsWith("\u2191"), "a rise in cost reads as an up arrow");
  assert.ok(rise?.classes.includes("is-neg"), "paying more is the bad direction");

  const down = costsWidget(current, [trade({ id: "p", commission: 10, fees: 0 })]);
  const fall = down.find((n) => n.cls === "tj-costs-delta");
  assert.ok(fall?.text.startsWith("\u2193"), "a fall in cost reads as a down arrow");
  assert.ok(fall?.classes.includes("is-pos"), "paying less is the good direction");
});

test("the Costs widget omits the comparison when there is no previous window", () => {
  const nodes = costsWidget([trade({ id: "a", commission: 4, fees: 0 })]);
  assert.equal(nodes.filter((n) => n.cls === "tj-costs-delta").length, 0);
});

/** The Costs card's rows, as `class|label` — how the card reads, line by line. */
const costsReading = (rows) =>
  costsWidget(rows)
    .filter((n) => n.cls.startsWith("tj-costs-row-label"))
    .map((n) => `${n.cls}|${n.text}`);

/** The Fees arc drawn over the Commission base — the ring's only number. */
const ringShare = (nodes) => {
  const donut = nodes.find((n) => n.cls === "tj-costs-donut");
  const svg = donut?.children.find((c) => c.tag === "svg");
  return svg?.children[1]?.attrs["stroke-dasharray"];
};

test("the Costs ring draws whenever a cost is recorded, even with a losing period", () => {
  const rows = [
    trade({ id: "a", pnl: -500, commission: 4, fees: 1 }),
    trade({ id: "b", pnl: -341, commission: 6, fees: 2 }),
  ];
  const nodes = costsWidget(rows);
  assert.ok(nodes.some((n) => n.cls === "tj-costs-donut"), "a negative Gross no longer leaves the card bare");
  // Fees are 3 of the 13 paid: the arc's dash comes from the real split.
  assert.equal(ringShare(nodes), "23.1 100");
  assert.deepEqual(costsReading(rows), [
    "tj-costs-row-label is-comm|Commission · 76.9%",
    "tj-costs-row-label is-fees|Fees · 23.1%",
  ]);
});

test("the Costs card reports costs only — P&L lives in the other charts", () => {
  const nodes = costsWidget([trade({ id: "a", pnl: 100, commission: 4, fees: 2 })]);
  const isResult = (n) =>
    n.cls.startsWith("tj-costs-row-label") && (n.text === "Gross P&L" || n.text === "Net P&L");
  assert.equal(nodes.filter(isResult).length, 0, "no Gross or Net line in this card");
  assert.equal(
    nodes.filter((n) => n.cls === "tj-costs-pnl" || n.cls === "tj-costs-share").length,
    0,
    "the P&L block no longer exists",
  );
  assert.equal(
    nodes.filter((n) => n.cls === "tj-costs-footer").length,
    1,
    "what is left at the bottom is the cost share, not a result",
  );
});

test("the Costs card reads the same with a positive and a negative Gross", () => {
  const gain = costsReading([trade({ id: "a", pnl: 100, commission: 4, fees: 2 })]);
  const loss = costsReading([trade({ id: "a", pnl: -100, commission: 4, fees: 2 })]);
  assert.deepEqual(gain, loss, "the two branches collapsed into one path");
  assert.equal(
    costsWidget([trade({ id: "a", pnl: 100, commission: 4, fees: 2 })]).filter((n) =>
      n.cls.includes("wf-bar") || n.cls.includes("wf-fill"),
    ).length,
    0,
    "the gross-relative bars are gone",
  );
});

test("the Costs ring splits by whichever of commission and fees dominates", () => {
  assert.equal(ringShare(costsWidget([trade({ id: "a", commission: 1, fees: 3 })])), "75.0 100");
  assert.equal(ringShare(costsWidget([trade({ id: "a", commission: 9, fees: 1 })])), "10.0 100");
});

/** Render the Tilt widget against a stubbed body at the smallest card size. */
const tiltWidget = (rows, prev = [], counted = rows) => {
  const view = Object.create(dash.WidgetGridView.prototype);
  view.plugin = {
    settings: { excludeDemosFromPortfolio: true, propAccounts: ACCOUNTS, timeZone: "America/New_York" },
    resolveAccountType: (label) =>
      ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase())?.type ?? "unknown",
    mappedAccount: () => null,
    isArchivedTrade: () => false,
  };
  view._accountIds = [];
  view._accountTypes = [];
  view._finCache = new WeakMap();
  view._countCache = new Map();
  const body = fakeEl();
  // The minimum Tilt card is h2/w4 — the reading must still be complete here.
  body.clientHeight = 100;
  body.clientWidth = 120;
  view.renderTiltWidget(body, rows, prev, counted);
  return flatten(body);
};

const tiltRow = (nodes, label) => {
  const index = nodes.findIndex((n) => n.cls === "tj-tilt-row-label" && n.text === label);
  return nodes[index + 1]?.text;
};

/** A run of clean winning trades, to pad a sample past the 10-trade floor. */
const cleanRun = (prefix, start = 1, count = 8) =>
  Array.from({ length: count }, (_, i) =>
    trade({ id: `${prefix}${i}`, date: `2026-12-${String(start + i).padStart(2, "0")}`, pnl: 10 }),
  );

test("the Tilt card keeps its full reading at the smallest size", () => {
  // Tilt reads at least 10 decisions; every date distinct so the runs are sane.
  const rows = Array.from({ length: 12 }, (_, i) =>
    trade({ id: `t${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}` }),
  );
  const nodes = tiltWidget(rows);
  const detail = nodes.filter((n) => n.cls === "tj-tilt-row-label").map((n) => n.text);
  assert.deepEqual(detail, ["After 2 losses", "Fast trades", "Mistake rate", "Negative state"]);
  const formula = nodes.find((n) => n.cls === "tj-tilt-formula-text");
  assert.equal(formula?.text, "Score = mean of the four shares above.", "the formula is printed on the card");
  const footer = nodes.find((n) => String(n.cls).startsWith("tj-tilt-footer"));
  assert.ok(footer?.text, "the band footer is drawn alongside the score");
  assert.equal(nodes.filter((n) => n.cls === "tj-tilt-compact").length, 0, "no compact-only path is left");
});

test("the Tilt score is the declared mean of four shares, and prices the adverse state", () => {
  const rows = [
    // One fast trade (30 s), one mistake tag, one adverse state, two losses then a trade.
    trade({ id: "fast", date: "2026-09-01", entryTime: "10:00", exitTime: "10:00:30", pnl: 10 }),
    trade({ id: "mistake", date: "2026-09-02", pnl: 10, mistake_tags: ["Moved stop"] }),
    trade({ id: "state", date: "2026-09-03", pnl: 30, psychology_tags: ["Frustrated"] }),
    ...cleanRun("w", 4, 4),
    trade({ id: "loss1", date: "2026-09-09", pnl: -10 }),
    trade({ id: "loss2", date: "2026-09-10", pnl: -10 }),
    trade({ id: "after", date: "2026-09-11", pnl: 10 }),
  ];
  const nodes = tiltWidget(rows);
  // Each share is 1/10 = 10%; the mean of four 10s is 10.
  assert.equal(nodes.find((n) => n.cls === "tj-tilt-value").text, "10");
  const net = nodes.find((n) => String(n.cls).startsWith("tj-tilt-impact-net"));
  assert.equal(net?.text, "+$30.00", "the adverse decision made $30");
  const meta = nodes.find((n) => n.cls === "tj-tilt-impact-meta");
  assert.equal(meta?.children[0].text, "Win 100% vs 78% rest");
});

test("the Tilt reads a direction against the previous period", () => {
  const rows = [
    trade({ id: "fast", date: "2026-09-01", entryTime: "10:00", exitTime: "10:00:30", pnl: 10 }),
    ...cleanRun("w", 2, 9),
  ];
  const prev = cleanRun("p", 1, 10);
  const nodes = tiltWidget(rows, prev);
  const delta = nodes.find((n) => String(n.cls).startsWith("tj-tilt-delta"));
  assert.equal(delta?.text, "↑ 3 vs prev", "one fast trade in ten is a 3-point mean rise");
  assert.ok(String(delta?.cls).includes("is-bad"));
});

test("the Tilt shares count decisions — a copied leg is not a second trade", () => {
  // One adverse decision copied into a second account: two rows, one decision.
  const base = trade({ id: "base", date: "2026-01-01", pnl: -10, psychology_tags: ["Frustrated"] });
  const copy = trade({ id: "copy", date: "2026-01-01", pnl: -10, psychology_tags: ["Frustrated"], isCopiedTrade: true, copyBaseKey: "base" });
  const rows = [base, copy, ...cleanRun("w", 1, 9)]; // 11 rows
  const counted = [base, ...cleanRun("w", 1, 9)]; // 10 decisions
  const nodes = tiltWidget(rows, [], counted);
  // 1 of 10 decisions is adverse — not 1 of 11 row legs.
  assert.equal(tiltRow(nodes, "Negative state"), "10%");
});

test("a severe score fills the state chip", () => {
  // Every decision carries an adverse state and a mistake, and every other is
  // fast — the mean lands in the Severe band.
  const rows = Array.from({ length: 10 }, (_, i) =>
    trade({
      id: `s${i}`,
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      entryTime: "10:00",
      exitTime: "10:00:30",
      pnl: i < 2 ? -10 : 10, // two losses, then a trade opened right after them
      mistake_tags: ["Overtrading"],
      psychology_tags: ["Frustrated"],
    }),
  );
  const nodes = tiltWidget(rows);
  const state = nodes.find((n) => String(n.cls).startsWith("tj-state"));
  assert.equal(state?.text, "Severe");
  assert.ok(String(state?.cls).includes("is-severe"));
});

/** Render the Revenge Trading widget against a stubbed body. */
const revengeWidget = (rows, windowMinutes) => {
  const view = Object.create(dash.WidgetGridView.prototype);
  view.plugin = {
    settings: {
      excludeDemosFromPortfolio: true,
      propAccounts: ACCOUNTS,
      timeZone: "America/New_York",
      reentryWindowMinutes: windowMinutes,
    },
    resolveAccountType: (label) =>
      ACCOUNTS.find((a) => a.name.trim().toLowerCase() === String(label).trim().toLowerCase())?.type ?? "unknown",
    mappedAccount: () => null,
    isArchivedTrade: () => false,
  };
  view._accountIds = [];
  view._accountTypes = [];
  view._finCache = new WeakMap();
  const body = fakeEl();
  body.clientHeight = 200;
  body.clientWidth = 400;
  view.renderRevengeWidget(body, rows);
  return flatten(body);
};

const rvValue = (nodes) => nodes.find((n) => n.cls === "tj-rv-value")?.text;
const rvSub = (nodes) => nodes.find((n) => n.cls === "tj-rv-sub")?.text;
const rvCompose = (nodes) => nodes.find((n) => n.cls === "tj-rv-compose-main")?.text;
const rvBoth = (nodes) => nodes.find((n) => n.cls === "tj-rv-compose-note")?.text;
const rvNet = (nodes) => {
  const node = nodes.find((n) => String(n.cls).startsWith("tj-rv-impact-net"));
  return { text: node?.text, cls: node?.cls };
};
const rvMeta = (nodes) => nodes.filter((n) => n.cls === "tj-rv-impact-item").map((n) => n.text);

test("the Revenge widget digests the cohort: share, make-up and impact", () => {
  const rows = [
    trade({ id: "loss", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 1, pnl: -100 }),
    trade({ id: "quick", date: "2026-09-01", entryTime: "10:10", exitTime: "10:15", symbol: "NQ", quantity: 1, pnl: 50 }),
    trade({ id: "tagged", date: "2026-09-02", entryTime: "11:00", exitTime: "11:05", symbol: "ES", quantity: 1, pnl: 10, mistake_tags: ["Revenge entry"] }),
  ];
  const nodes = revengeWidget(rows, 15);
  assert.equal(rvValue(nodes), "67%", "two of three decisions are revenge");
  assert.equal(rvSub(nodes), "2 of 3 trades");
  assert.equal(rvCompose(nodes), "1 by timing (≤15 min after a loss) · 1 you tagged");
  assert.equal(rvBoth(nodes), undefined, "no overlap here");
  // The two revenge decisions won (+50, +10) — but a paying revenge cluster is
  // still a flag, so its net is not painted green.
  assert.deepEqual(rvNet(nodes), { text: "+$60.00", cls: "tj-rv-impact-net" });
  assert.deepEqual(rvMeta(nodes), ["Win rate 100% vs 0% on the rest", "Avg R — vs —", "Held 5m vs 5m"]);
});

test("the window is the trader's: the same 10-minute gap counts at 15, not at 5", () => {
  const rows = [
    trade({ id: "loss", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 1, pnl: -100 }),
    trade({ id: "re", date: "2026-09-01", entryTime: "10:15", exitTime: "10:20", symbol: "NQ", quantity: 1, pnl: 50 }),
  ];
  assert.equal(rvValue(revengeWidget(rows, 5)), "0%");
  assert.equal(rvValue(revengeWidget(rows, 15)), "50%");
});

test("a decision found both ways shows the overlap instead of double counting", () => {
  const rows = [
    trade({ id: "loss", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 1, pnl: -100 }),
    trade({ id: "both", date: "2026-09-01", entryTime: "10:10", exitTime: "10:15", symbol: "NQ", quantity: 1, pnl: 50, mistake_tags: ["Revenge entry"] }),
  ];
  const nodes = revengeWidget(rows, 15);
  assert.equal(rvValue(nodes), "50%", "the union is one of two, not two of two");
  assert.equal(rvCompose(nodes), "1 by timing (≤15 min after a loss) · 1 you tagged");
  assert.equal(rvBoth(nodes), "(1 both)");
});

test("a re-entry that came in bigger than the loss is flagged, not scolded", () => {
  const rows = [
    trade({ id: "loss", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 2, pnl: -100 }),
    trade({ id: "re", date: "2026-09-01", entryTime: "10:10", exitTime: "10:15", symbol: "NQ", quantity: 3, pnl: 20 }),
  ];
  const nodes = revengeWidget(rows, 15);
  assert.equal(nodes.find((n) => n.cls === "tj-rv-esc-value").text, "1 of 1");
});

test("a copied decision counts once in the Revenge widget", () => {
  const rows = [
    trade({ id: "b1", account: "Live One", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 1, pnl: -100 }),
    trade({ id: "c1", account: "Live Two", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 1, pnl: -100, isCopiedTrade: true, copyBaseKey: "b1" }),
    trade({ id: "b2", account: "Live One", date: "2026-09-01", entryTime: "10:10", exitTime: "10:15", symbol: "NQ", quantity: 1, pnl: 50 }),
    trade({ id: "c2", account: "Live Two", date: "2026-09-01", entryTime: "10:10", exitTime: "10:15", symbol: "NQ", quantity: 1, pnl: 50, isCopiedTrade: true, copyBaseKey: "b2" }),
    trade({ id: "b3", account: "Live One", date: "2026-09-02", entryTime: "11:00", exitTime: "11:05", symbol: "ES", quantity: 1, pnl: 10 }),
  ];
  const nodes = revengeWidget(rows, 15);
  assert.equal(nodes.find((n) => n.cls === "tj-rv-sub").text, "1 of 3 trades", "five legs fold into three decisions");
});

const rvState = (nodes) => {
  const node = nodes.find((n) => String(n.cls).startsWith("tj-state"));
  return node ? { text: node.text, cls: node.cls } : null;
};

test("the Revenge state chip names the impact, not a score", () => {
  // Regular book earns; the revenge pair loses → the money leak.
  const leak = [
    trade({ id: "loss", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 1, pnl: -100 }),
    trade({ id: "re", date: "2026-09-01", entryTime: "10:10", exitTime: "10:15", symbol: "NQ", quantity: 1, pnl: -50 }),
    trade({ id: "win", date: "2026-09-02", entryTime: "11:00", exitTime: "11:05", symbol: "ES", quantity: 1, pnl: 200 }),
  ];
  assert.deepEqual(rvState(revengeWidget(leak, 15)), { text: "Leak", cls: "tj-state is-bad" });

  // No revenge at all → clear.
  const clear = [
    trade({ id: "a", date: "2026-09-01", symbol: "NQ", pnl: 50 }),
    trade({ id: "b", date: "2026-09-02", symbol: "ES", pnl: -20 }),
  ];
  assert.deepEqual(rvState(revengeWidget(clear, 15)), { text: "Clear", cls: "tj-state is-good" });

  // The revenge pair wins — still Watch, never a green "good".
  const positive = [
    trade({ id: "loss", date: "2026-09-01", entryTime: "10:00", exitTime: "10:05", symbol: "NQ", quantity: 1, pnl: -100 }),
    trade({ id: "re", date: "2026-09-01", entryTime: "10:10", exitTime: "10:15", symbol: "NQ", quantity: 1, pnl: 50 }),
  ];
  const positiveNodes = revengeWidget(positive, 15);
  assert.deepEqual(rvState(positiveNodes), { text: "Watch", cls: "tj-state is-warn" });
  const footer = positiveNodes.find((n) => String(n.cls).startsWith("tj-rv-footer"));
  assert.equal(footer?.text, "Revenge trades paid this period — a pattern, not an edge");
  assert.ok(String(footer?.cls).includes("is-warn"));
});
