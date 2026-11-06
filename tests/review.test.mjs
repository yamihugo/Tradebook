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

const { reviewStatus, reviewSummary, matchesReviewFilter, planDifferences, parsePlannedNumber, reviewRepresentativesForVisibleTrades } = await load("review", "../src/lib/review.ts");
const storage = await load("storage", "../src/storage.ts");
const { tradeRows } = await load("tradeTable", "../src/lib/tradeTable.ts");
const fees = await load("fees", "../src/lib/fees.ts");
const { tradeSelectionScopeKey, eligibleTradeIds, visibleDecisionTrades } = await load("tradeSelection", "../src/lib/tradeSelection.ts");
const { matchesTradeLogSearch, tradeMatchesStrategies } = await load("tradeLogFilters", "../src/lib/tradeLogFilters.ts");

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

test("bulk selection resolves only visible logical decisions and keeps copy-only rows selectable", () => {
  const base = trade({ id: "base", copyBaseKey: "decision" });
  const generated = trade({ id: "generated", copyBaseKey: "decision", isCopiedTrade: true });
  const imported = trade({ id: "imported", copyBaseKey: "decision", isCopiedTrade: true });
  const independent = trade({ id: "independent" });
  assert.deepEqual(visibleDecisionTrades([base, generated, imported, independent]).map((t) => t.id), ["base", "independent"]);
  assert.deepEqual([...eligibleTradeIds(visibleDecisionTrades([base, generated, imported, independent]), new Set(["base", "generated", "independent"]))], ["base", "independent"]);
  assert.deepEqual(visibleDecisionTrades([imported]).map((t) => t.id), ["imported"]);
});

const coreReviewed = (over = {}) =>
  trade({
    setup: "Breakout",
    rating: 4,
    psychologyAcknowledged: true,
    mistakesAcknowledged: true,
    review_what_happened: "Observed fact",
    review_repeat_change: "Actionable lesson",
    ...over,
  });

test("Trade Log review filters separate pending, automatic, and explicitly marked states", () => {
  const complete = coreReviewed();
  const explicit = trade({ reviewed: true });
  const pending = coreReviewed({ mistakesAcknowledged: false });
  const reopened = coreReviewed({ reviewed: false });
  assert.equal(matchesReviewFilter(complete, "complete"), true);
  assert.equal(matchesReviewFilter(complete, "explicit"), false);
  assert.equal(matchesReviewFilter(explicit, "explicit"), true);
  assert.equal(matchesReviewFilter(explicit, "complete"), false);
  assert.equal(matchesReviewFilter(pending, "pending"), true);
  assert.equal(matchesReviewFilter(reopened, "pending"), true);
  assert.equal(matchesReviewFilter(complete, "all"), true);
});

test("Trade Log search finds canonical reflections from a copy-only visible row", () => {
  const base = trade({ id: "base", copyBaseKey: "decision", review_what_happened: "closed early after the breakout", setups: ["Momentum", "ORB"] });
  const copy = trade({ id: "copy", account: "Copier account", isCopiedTrade: true, copyBaseKey: "decision" });
  assert.equal(matchesTradeLogSearch([copy, base], "closed early"), true);
  assert.equal(matchesTradeLogSearch([copy, base], "copier breakout"), true);
  assert.equal(matchesTradeLogSearch([copy, base], "not present"), false);
  assert.equal(tradeMatchesStrategies(base, ["orb"]), true);
  assert.equal(tradeMatchesStrategies(trade({ setup: "Legacy" }), ["legacy"]), true);
});

test("all six review signals complete automatically, while each missing signal stays visible", () => {
  const partial = reviewStatus(coreReviewed({ psychologyAcknowledged: false }));
  assert.equal(partial.complete, false);
  assert.equal(partial.requiredDone, 5);
  assert.equal(partial.requiredTotal, 6);
  assert.deepEqual(partial.missing, ["Psychology state"]);
  assert.equal(partial.state, "needs-review");

  const complete = reviewStatus(coreReviewed());
  assert.equal(complete.complete, true);
  assert.equal(complete.requiredDone, 6);
  assert.equal(complete.requiredTotal, 6);
  assert.equal(complete.state, "reviewed");
  assert.equal(complete.label, "Reviewed");
});

test("rating must be an integer from one through five", () => {
  for (const rating of [0, 6, 1.5]) assert.equal(reviewStatus(coreReviewed({ rating })).complete, false);
  for (const rating of [1, 5]) assert.equal(reviewStatus(coreReviewed({ rating })).complete, true);
});

test("the explicit missing-context declaration survives Markdown write and read", () => {
  const note = {
    id: "synthetic-review.md", date: "2026-01-01", entryTime: "00:00", exitTime: "00:01",
    symbol: "TEST", account: "Synthetic", accountType: "demo", direction: "long", quantity: 1,
    entryPrice: 1, exitPrice: 2, commission: 0, fees: 0, pnl: 1, pnlPoints: 1,
    setup: "", mistake: "", thesis: "", review: "", screenshot: "", rating: 0,
    tags: [], psychology_tags: [], mistake_tags: [], fills: [], review_context_unavailable: true,
  };
  const markdown = storage.tradeToMarkdown(note);
  assert.match(markdown, /^review_context_unavailable: true$/m);
  assert.equal(storage.parseTradeFromMarkdown(markdown).review_context_unavailable, true);
});

// ---- one word, two ways to the same verdict -----------------------------

test("legacy optional evidence does not substitute for the six-signal review contract", () => {
  const s = reviewStatus(writtenUp());
  assert.equal(s.complete, false);
  assert.equal(s.legacyWrittenUp, true);
  assert.equal(s.writtenUp, false);
  assert.equal(s.state, "needs-review");
  assert.equal(s.label, "Needs review");
  assert.deepEqual(s.missing, ["Psychology state", "Execution mistakes", "What happened", "Repeat or change"]);
});

test("legacy reviewed markers stay distinguishable from written evidence", () => {
  const s = reviewStatus(trade({ reviewed: true }));
  assert.equal(s.complete, true, "the legacy marker remains compatible");
  assert.equal(s.writtenUp, false, "but the journal does not pretend the note was written");
  assert.deepEqual(s.missing, ["Strategy", "Rating", "Psychology state", "Execution mistakes", "What happened", "Repeat or change"], "the missing signals remain factual");
  assert.equal(s.label, "Explicitly marked reviewed");
});

test("all six required review signals complete; plan adherence and screenshots stay optional", () => {
  const s = reviewStatus(trade({
    setup: "Breakout",
    rating: 4,
    psychologyAcknowledged: true,
    mistakesAcknowledged: true,
    stopLoss: 19990,
    target: 20030,
    review_plan_adherence: "followed",
    review_what_happened: "Entered after the retest and managed the position as planned.",
    review_repeat_change: "Repeat the patience; improve the exit decision.",
  }));
  assert.equal(s.complete, true);
  assert.equal(s.writtenUp, true);
  assert.equal(s.requiredDone, 6);
  assert.equal(s.requiredTotal, 6);
  assert.deepEqual(s.missing, []);
  assert.deepEqual(s.conditionalMissing, []);
});

test("human evidence alone does not complete an incomplete reflection", () => {
  const s = reviewStatus(trade({
    review_what_happened: "The trade followed the plan.",
    review_repeat_change: "   ",
  }));
  assert.equal(s.complete, false);
  assert.equal(s.evidence, "exists");
  assert.equal(s.state, "needs-review");
});

test("the legacy checklist remains descriptive rather than a completion gate", () => {
  const s = reviewStatus(trade({ setup: "Breakout", rating: 3 }));
  assert.equal(s.complete, false);
  assert.equal(s.evidence, "exists");
  assert.equal(s.requiredDone, 2);
  assert.equal(s.requiredTotal, 6);
  assert.deepEqual(s.missing, ["Psychology state", "Execution mistakes", "What happened", "Repeat or change"]);
});

test("actual stop and target do not create a manual plan or adherence requirement", () => {
  const s = reviewStatus(trade({
    setup: "Breakout",
    rating: 3,
    psychologyAcknowledged: true,
    mistakesAcknowledged: true,
    stopLoss: 19990,
    target: 20030,
    review_what_happened: "The trade was managed as planned.",
    review_repeat_change: "Keep the patience.",
  }));
  assert.equal(s.requiredDone, 6);
  assert.equal(s.requiredTotal, 6);
  assert.deepEqual(s.conditionalMissing, []);
  assert.equal(s.complete, true);
});

test("an explicit structured manual plan enables optional adherence context", () => {
  const s = reviewStatus(trade({ review_planned_entry: 19995 }));
  assert.deepEqual(s.conditionalMissing, ["Plan adherence"]);
  assert.equal(s.complete, false);
});

test("planned-vs-actual differences are neutral and require both sides", () => {
  assert.deepEqual(planDifferences(trade({ review_planned_entry: 19995, review_planned_target: 20020, target: 20010 })), [
    { key: "entry", label: "Entry variance", planned: 19995, actual: 20000, difference: 5, comparison: "actual-minus-planned", applicableTo: "all" },
    { key: "target", label: "Target level variance", planned: 20020, actual: 20010, difference: -10, comparison: "actual-minus-planned", applicableTo: "long" },
  ]);
  assert.deepEqual(planDifferences(trade({ review_planned_stop: 19990 })), []);
});

test("planned numeric fields require complete positive finite tokens", () => {
  for (const raw of ["12abc", "0", "-1", "NaN", "Infinity", "  "]) {
    assert.equal(parsePlannedNumber(raw, "review_planned_entry"), undefined, raw);
  }
  assert.equal(parsePlannedNumber("12.50", "review_planned_entry"), 12.5);
  assert.equal(parsePlannedNumber(".5", "review_planned_quantity"), 0.5);
});

test("manual plan timing is not inferred", () => {
  const t = trade({ review_planned_entry: 19995 });
  assert.equal(t.review_plan_timing, undefined);
});

test("plan and post-exit observation remain optional review depth", () => {
  const s = reviewStatus(trade({
    setup: "Breakout",
    rating: 4,
    psychologyAcknowledged: true,
    mistakesAcknowledged: true,
    review_what_happened: "The setup worked.",
    review_repeat_change: "Keep the entry; improve the exit.",
    review_plan: "Wait for confirmation at the level.",
    review_post_exit_observation: "Price continued another 8 points after exit.",
    review_post_exit_points: 8,
    review_post_exit_source: "manual",
    review_plan_adherence: "changed",
  }));
  assert.equal(s.complete, true);
});


test("explicitly reopening a completed reflection puts it back in the queue", () => {
  const s = reviewStatus(coreReviewed({ reviewed: false }));
  assert.equal(s.complete, false, "reviewed: false overrides both completed prompts");
  assert.equal(s.writtenUp, true, "the human reflection remains present");
});

test("marking a trade the checklist cleared reopens it", () => {
  const s = reviewStatus(trade({ reviewed: true, rating: 5, screenshot: "x", setup: "A", notes: "n" }));
  assert.equal(s.complete, true);
  const reopened = reviewStatus(trade({ reviewed: false, rating: 5, screenshot: "x", setup: "A", notes: "n" }));
  assert.equal(reopened.complete, false);
});

// ---- coverage: one number, written-up only in the tooltip ----------------

test("coverage reflects six-signal completion; explicit review markers remain compatible", () => {
  const trades = [
    coreReviewed(),
    coreReviewed(),
    trade({ reviewed: true }), // legacy-marked, not written
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

test("a reviewed reflection with no stop is still reviewed", () => {
  const s = reviewStatus(coreReviewed({ screenshot: "chart.png" }));
  assert.equal(s.complete, true);
  assert.equal(s.needsPrint, false);
  assert.ok(!("stopLoss" in s), "the stop is not part of the review core");
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
    "",
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

test("structured review fields round-trip through Markdown", () => {
  const md = storage.tradeToMarkdown(trade({
    review_plan: "Wait for the retest.",
    review_planned_entry: 20001,
    review_planned_stop: 19990,
    review_planned_target: 20030,
    review_planned_quantity: 2,
    review_plan_timing: "before-entry",
    review_plan_provenance: "manual",
    review_plan_adherence: "followed",
    review_what_happened: "The retest held and the entry was patient.",
    review_repeat_change: "Repeat the entry; improve the exit.",
    review_post_exit_observation: "Price continued after the exit.",
    review_post_exit_points: 8.25,
    review_post_exit_source: "manual",
  }));
  const parsed = storage.parseTradeFromMarkdown(md);
  assert.equal(parsed.review_plan, "Wait for the retest.");
  assert.equal(parsed.review_planned_entry, 20001);
  assert.equal(parsed.review_planned_stop, 19990);
  assert.equal(parsed.review_planned_target, 20030);
  assert.equal(parsed.review_planned_quantity, 2);
  assert.equal(parsed.review_plan_timing, "before-entry");
  assert.equal(parsed.review_plan_provenance, "manual");
  assert.equal(parsed.review_plan_adherence, "followed");
  assert.equal(parsed.review_what_happened, "The retest held and the entry was patient.");
  assert.equal(parsed.review_repeat_change, "Repeat the entry; improve the exit.");
  assert.equal(parsed.review_post_exit_observation, "Price continued after the exit.");
  assert.equal(parsed.review_post_exit_points, 8.25);
  assert.equal(parsed.review_post_exit_source, "manual");
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

test("failed review-field write leaves content retryable", async () => {
  let attempts = 0;
  let content = storage.tradeToMarkdown(trade());
  const app = { vault: {
    process: async (_file, transform) => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk full");
      content = transform(content);
      return content;
    },
  } };
  await assert.rejects(
    storage.updateTradeFields(app, {}, { review_what_happened: "Retryable observation" }),
    /disk full/,
  );
  assert.doesNotMatch(content, /Retryable observation/);
  await storage.updateTradeFields(app, {}, { review_what_happened: "Retryable observation" });
  assert.match(content, /review_what_happened: "Retryable observation"/);
});

test("visible copied-leg scopes retain the canonical representative from the full population", () => {
  const base = coreReviewed({ id: "base", copyBaseKey: "SCOPE" });
  const copy = trade({ id: "copy", account: "Copier", isCopiedTrade: true, copyBaseKey: "SCOPE" });
  const rows = tradeRows([base, copy]);
  const reps = reviewRepresentativesForVisibleTrades([base, copy], [copy], rows);
  assert.deepEqual(reps.map((t) => t.id), ["base"], "a visible copy leg must resolve to the reviewed base decision");
});

// ---- one universe: classification reads the decision, not a leg ----------

test("a reviewed decision with an unreviewed copy leg stays out of the queue", () => {
  const base = coreReviewed({ id: "base", copyBaseKey: "K" });
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
