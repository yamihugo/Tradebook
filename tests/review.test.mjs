import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const stub = {
  name: "obsidian-test-stub",
  setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
    b.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
      contents: [
        "export const App = class {};",
        "export const TFile = class {};",
        "export const TFolder = class {};",
        "export const normalizePath = (p) => p;",
        "export const setIcon = () => {};",
      ].join("\n"),
      loader: "js",
    }));
  },
};

const load = async (name, rel) => {
  const result = await build({
    entryPoints: { [name]: new URL(rel, import.meta.url).pathname },
    bundle: true,
    format: "esm",
    platform: "browser",
    outdir: "bundle",
    write: false,
    plugins: [stub],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};

const { reviewStatus, reviewSummary } = await load("review", "../src/lib/review.ts");
const storage = await load("storage", "../src/storage.ts");
const { tradeRows } = await load("tradeTable", "../src/lib/tradeTable.ts");
const fees = await load("fees", "../src/lib/fees.ts");

const trade = (over = {}) => ({
  id: "t",
  date: "2026-09-01",
  entryTime: "10:00",
  exitTime: "10:30",
  symbol: "NQ",
  account: "Live",
  accountType: "live",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  commission: 0,
  fees: 0,
  pnl: 200,
  pnlPoints: 10,
  setup: "",
  mistake: "",
  review: "",
  screenshot: "",
  rating: 0,
  ...over,
});

const writtenUp = (over = {}) =>
  trade({ setup: "Breakout", screenshot: "chart.png", notes: "waited for the retest", rating: 4, ...over });

// ---- one word, two ways to the same verdict -----------------------------

test("a fully written-up trade is reviewed", () => {
  const s = reviewStatus(writtenUp());
  assert.equal(s.complete, true);
  assert.equal(s.writtenUp, true);
  assert.equal(s.label, "Reviewed");
  assert.deepEqual(s.missing, []);
});

test("marking reviewed closes a trade nobody wrote up", () => {
  const s = reviewStatus(trade({ reviewed: true }));
  assert.equal(s.complete, true, "the trader's word is enough to leave the queue");
  assert.equal(s.writtenUp, false, "but the journal does not pretend the note was written");
  assert.deepEqual(s.missing, ["Screenshot", "Strategy", "Review", "Rating"], "the gaps stay factual");
  assert.equal(s.label, "Reviewed");
});

test("nothing written and nothing marked is still in the queue", () => {
  const s = reviewStatus(trade());
  assert.equal(s.complete, false);
  assert.equal(s.unreviewed, true);
  assert.equal(s.label, "Needs review");
});

// ---- the trader keeps the last word, both ways --------------------------

test("unmarking a written-up trade puts it back in the queue", () => {
  const s = reviewStatus(writtenUp({ reviewed: false }));
  assert.equal(s.complete, false, "reviewed: false holds a trade open even with every field");
  assert.equal(s.writtenUp, true, "the fields are still there — only the verdict went back");
});

test("marking a trade the checklist cleared reopens it", () => {
  const s = reviewStatus(trade({ reviewed: true, rating: 5, screenshot: "x", setup: "A", notes: "n" }));
  assert.equal(s.complete, true);
  const reopened = reviewStatus(trade({ reviewed: false, rating: 5, screenshot: "x", setup: "A", notes: "n" }));
  assert.equal(reopened.complete, false);
});

// ---- coverage: one number, written-up only in the tooltip ----------------

test("coverage is one number, with the written-up count kept aside", () => {
  const trades = [
    writtenUp(),
    writtenUp(),
    trade({ reviewed: true }), // marked, not written
    trade(), // still open
  ];
  const s = reviewSummary(trades);
  assert.equal(s.total, 4);
  assert.equal(s.complete, 3);
  assert.equal(s.writtenUp, 2);
  assert.equal(s.unreviewed, 1);
  assert.equal(s.pct, 75);
});

test("coverage of an empty journal is zero, not a full bar", () => {
  const s = reviewSummary([]);
  assert.equal(s.total, 0);
  assert.equal(s.pct, 0);
});

// ---- the stop is still not a review step --------------------------------

test("a written-up trade with no stop is still reviewed", () => {
  const s = reviewStatus(writtenUp());
  assert.equal(s.needsPrint, false);
  assert.ok(!("stopLoss" in s), "the stop was never part of the checklist");
});

// ---- what the notes remember ---------------------------------------------

test("a note carrying the old `accepted` flag reads back as reviewed", () => {
  const md = [
    "---",
    "type: trade",
    "date: 2026-09-01",
    "symbol: NQ",
    "account: Live",
    "account_type: live",
    "direction: long",
    "quantity: 1",
    "entry_price: 20000",
    "exit_price: 20010",
    "pnl: 200",
    "pnl_points: 10",
    "reviewed: false",
    "accepted: true",
    "---",
    "",
  ].join("\n");
  const parsed = storage.parseTradeFromMarkdown(md);
  assert.equal(parsed.reviewed, true, "the short-lived accepted flag folds into reviewed");
});

test("marking reviewed is written as `reviewed`, never as `accepted`", () => {
  const md = storage.tradeToMarkdown(trade({ reviewed: true }));
  assert.match(md, /^reviewed: true$/m);
  assert.ok(!/^accepted:/m.test(md), "the accepted key is gone for good");
});

test("a moved stop keeps its levels and provenance through a note", () => {
  const md = storage.tradeToMarkdown(
    trade({ stopLoss: 19990, stopSource: "broker", stopLevels: [19990, 20020] })
  );
  const parsed = storage.parseTradeFromMarkdown(md);
  assert.equal(parsed.stopSource, "broker");
  assert.deepEqual(parsed.stopLevels, [19990, 20020]);
  assert.equal(parsed.stopLoss, 19990);
});

// ---- one universe: classification reads the decision, not a leg ----------

test("a reviewed decision with an unreviewed copy leg stays out of the queue", () => {
  const base = writtenUp({ id: "base", copyBaseKey: "K" });
  const leg = trade({ id: "leg", account: "Copier", isCopiedTrade: true, copyBaseKey: "K" });
  const rows = tradeRows([base, leg]);
  assert.equal(rows.length, 1, "the legs fold into one decision");
  assert.equal(rows[0].rep.id, "base", "the original stands forward");
  assert.equal(reviewStatus(rows[0].rep).complete, true, "the decision is reviewed");
  // On its own the copy leg reads as a gap — the exact reason a filter must
  // never classify by a leg, or a reviewed decision would reappear as pending.
  assert.equal(reviewStatus(leg).complete, false);
});

test("an incomplete decision counts once however many copies it has", () => {
  const base = trade({ id: "b", copyBaseKey: "K2" });
  const copies = [
    trade({ id: "l1", account: "C1", isCopiedTrade: true, copyBaseKey: "K2" }),
    trade({ id: "l2", account: "C2", isCopiedTrade: true, copyBaseKey: "K2" }),
    trade({ id: "l3", account: "C3", isCopiedTrade: true, copyBaseKey: "K2" }),
  ];
  const rows = tradeRows([base, ...copies]);
  assert.equal(rows.length, 1, "three copies of one decision are one row");
  assert.equal(reviewStatus(rows[0].rep).complete, false, "the decision's own verdict decides");
});

test("the row's Net (the decision) drives Result classification, not its copies", () => {
  const base = trade({ id: "base", copyBaseKey: "K", pnl: 100, commission: 0, fees: 0 });
  const copy = trade({
    id: "copy",
    account: "Copier",
    isCopiedTrade: true,
    copyBaseKey: "K",
    pnl: -300,
    commission: 0,
    fees: 0,
  });
  const rows = tradeRows([base, copy]);
  assert.equal(rows.length, 1, "base and copy fold into one decision row");
  const rep = rows[0].rep;
  // The Trade Log's Net column and its Result filter both read this number:
  // +100, a Win — even though the portfolio decision nets -200.
  assert.equal(fees.netPnl(rep), 100, "the row shows the original trade's own Net");
  assert.ok(fees.netPnl(rep) > 0, "and the filter classifies it as a Win");
  assert.equal(fees.netPnl(base) + fees.netPnl(copy), -200, "the portfolio decision is a different scope");
});
