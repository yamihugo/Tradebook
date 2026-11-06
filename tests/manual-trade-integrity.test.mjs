import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// The manual-trade audit found three correctness bugs that no surface test
// covered, because they live between the form and the note:
//
//   1. every hand-typed note was written with `reviewed: false`, and `false`
//      means "the trader's word holds this open" — so a fully written-up trade
//      could never leave the review queue on its own;
//   2. a hand-typed note carried no provenance at all, so the trade page had
//      nothing to show and the note read as a legacy one;
//   3. the copy-group note in the form promised a leg the engine would skip,
//      and quoted a ratio from the wrong date.
//
// These are the contracts that keep those from coming back.
const result = await build({
  entryPoints: {
    storage: new URL("../src/storage.ts", import.meta.url).pathname,
    review: new URL("../src/lib/review.ts", import.meta.url).pathname,
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
  },
  outdir: "bundle",
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents:
            "export const App = class {};" +
            "export const TFile = class {};" +
            "export const TFolder = class {};" +
            "export const normalizePath = (p) => p;" +
            "export const setIcon = () => {};" +
            "export function moment(x) { return { toDate: () => new Date(x) }; }",
          loader: "js",
        }));
      },
    },
  ],
});
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [storage, review, copy] = await Promise.all([loadBundle("storage"), loadBundle("review"), loadBundle("copy")]);

const trade = (over = {}) => ({
  id: "t1",
  date: "2026-09-10",
  entryTime: "10:00",
  exitTime: "10:20",
  symbol: "NQ",
  account: "Apex",
  accountType: "funded",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20050,
  commission: 2,
  fees: 1,
  pnl: 47,
  pnlPoints: 50,
  setup: "Breakout",
  mistake: "",
  review: "",
  screenshot: "shot.png",
  thesis: "",
  rating: 4,
  ...over,
});

/** Write a note and read it back, exactly as the vault does. */
const roundTrip = (t) => storage.parseTradeFromMarkdown(storage.tradeToMarkdown(t));

test("an unset review flag is decided by the reflection core, not held open", () => {
  const completeReflection = trade({
    setup: "Breakout",
    screenshot: "shot.png",
    rating: 4,
    psychologyAcknowledged: true,
    mistakesAcknowledged: true,
    review: "waited for it",
    review_what_happened: "The entry followed the retest.",
    review_repeat_change: "Keep the patience; improve the exit.",
  });
  assert.equal(review.reviewStatus(completeReflection).writtenUp, true, "both reflection prompts are present");
  assert.equal(review.reviewStatus(completeReflection).complete, true, "so it is reviewed without a manual flag");

  const note = roundTrip(completeReflection);
  assert.equal(note.reviewed, undefined, "the flag is absent, not false");
  assert.equal(review.reviewStatus(note).complete, true, "the reflection remains complete after Markdown read-back");
  assert.deepEqual(review.reviewStatus(note).missing, [], "the new human core is present");

  assert.equal(review.reviewStatus(roundTrip(trade({ ...completeReflection, reviewed: false }))).complete, false, "an explicit false reopens it");
  assert.equal(review.reviewStatus(roundTrip(trade({ ...completeReflection, reviewed: true }))).complete, true, "an explicit true closes it");

  const incomplete = roundTrip(trade({
    screenshot: "",
    setup: "",
    rating: 0,
    review: "",
    review_what_happened: "",
    review_repeat_change: "",
  }));
  assert.equal(review.reviewStatus(incomplete).complete, false, "an incomplete reflection stays pending");
  assert.deepEqual(review.reviewStatus(incomplete).missing, ["Strategy", "Rating", "Psychology state", "Execution mistakes", "What happened", "Repeat or change"], "identifies every review signal still needed");
});

test("the written note carries the review flag only when the trader decided", () => {
  const md = storage.tradeToMarkdown(trade());
  assert.equal(/^reviewed:/m.test(md), false, "an unset flag is not written at all");
  assert.equal(/^reviewed: true$/m.test(storage.tradeToMarkdown(trade({ reviewed: true }))), true);
  assert.equal(/^reviewed: false$/m.test(storage.tradeToMarkdown(trade({ reviewed: false }))), true);
  // A legacy note that already carries `reviewed: false` keeps its meaning.
  const legacy = storage.parseTradeFromMarkdown(
    storage.tradeToMarkdown(trade()).replace("rating: 4", "rating: 4\nreviewed: false")
  );
  assert.equal(legacy.reviewed, false, "a stored false is read back as false");
  assert.equal(review.reviewStatus(legacy).complete, false, "and still holds the trade open");
});

test("a hand-typed trade declares where it came from", () => {
  // The panel stamps these; the contract is that a typed trade is 'manual' and
  // never a broker fill, never a model.
  const manual = trade({ origin: "manual", dataSource: "manual" });
  const note = roundTrip(manual);
  assert.equal(note.origin, "manual");
  assert.equal(note.dataSource, "manual");
  const source = note.dataSource ?? note.origin;
  assert.equal(source, "manual");
  assert.notEqual(source, "reconstructed", "a typed trade is never a model");
  assert.notEqual(source, "broker", "a typed trade is never a broker fill");
});

test("a generated copy leg stays a model, and says so", () => {
  const leader = trade({ account: "Apex", copyRole: "base", copyBaseKey: "ck_1" });
  const copier = { id: "c1", name: "Topstep", firmId: "topstep", programId: "xfa", size: 50000, type: "funded", createdAt: "2026-01-01" };
  const leg = copy.buildLeg(leader, copier, { ratio: 2 });
  assert.equal(leg.dataSource, "reconstructed", "a generated leg is a model");
  assert.equal(leg.origin, undefined, "and does not claim to be typed or imported");
  assert.equal(leg.isCopiedTrade, true, "it is marked as copied");
  assert.equal(leg.copyBaseKey, "ck_1", "and linked to the leader trade");
  assert.equal(review.reviewStatus(leg).complete, false, "a generated leg is never reviewed on the trader's behalf");
});

// ---- the copy-group promise: what the form says must be what the engine writes ----
const copierAccount = (over = {}) => ({
  id: "c1",
  name: "Topstep",
  firmId: "topstep",
  programId: "xfa",
  size: 50000,
  type: "funded",
  createdAt: "2026-01-01",
  copyRole: "copier",
  copyBaseId: "Apex",
  copyConfigHistory: [{ from: "2026-01-01", ratio: 1 }, { from: "2026-06-01", ratio: 2 }],
  copyPeriods: [{ start: "2026-01-01", baseId: "Apex", multiplier: 1 }],
  ...over,
});

test("a back-dated trade only reaches the copiers that were copying then", () => {
  // A copier that joined later is not copying on an earlier date: the form must
  // not promise it a leg.
  const late = copierAccount({
    createdAt: "2026-08-01",
    copyPeriods: [{ start: "2026-08-01", baseId: "Apex", multiplier: 1 }],
    copyConfigHistory: [{ from: "2026-08-01", ratio: 1 }],
  });
  assert.equal(copy.isActiveCopier(late, "Apex", "2026-08-15"), true, "it copies from its own start");
  assert.equal(copy.isActiveCopier(late, "Apex", "2026-07-15"), false, "and not a month before it existed");

  // The ratio the engine writes is the ratio for THAT date, not today's.
  const acc = copierAccount({
    copyPeriods: [{ start: "2026-03-01", end: "2026-06-01", baseId: "Apex", multiplier: 1 }, { start: "2026-06-01", baseId: "Apex", multiplier: 2 }],
    copyConfigHistory: [{ from: "2026-01-01", ratio: 1 }, { from: "2026-06-01", ratio: 2 }],
  });
  assert.equal(copy.effectiveCopyConfig(acc, "2026-04-01").ratio, 1, "a March trade copies at ×1");
  assert.equal(copy.effectiveCopyConfig(acc, "2026-09-01").ratio, 2, "a September trade copies at ×2");
  // The account page reads the *current* ratio; the form reads the dated one.
  assert.equal(copy.copierPresentation(acc).ratio, 2);
});

test("the tracking boundary is unaffected by any of it", () => {
  // A trade dated before an account's tracking start is history: it is stored,
  // visible, and out of every calculated figure. Provenance and review changes
  // must not change that.
  const t = trade({ date: "2026-07-01", origin: "manual", dataSource: "manual" });
  const note = roundTrip(t);
  assert.equal(note.date, "2026-07-01", "an old hand-typed note keeps its date");
  assert.equal(note.dataSource, "manual", "and its provenance");
});

test("Strategy and Market context declarations round-trip without mixing dimensions", () => {
  const note = roundTrip(trade({
    setup: "Reversal",
    setups: ["Reversal", "Opening range breakout"],
    market_context_timing: ["event-approaching-in-trade", "event-released-in-trade"],
    market_context_effect: ["management-changed", "exit-changed"],
    market_context_ref: "2026-10-30-NQ-session",
    psychology_tags: [],
    mistake_tags: [],
    exit_reason: "market/news context changed",
    rating: 4,
  }));
  assert.deepEqual(note.setups, ["Reversal", "Opening range breakout"]);
  assert.deepEqual(note.market_context_timing, ["event-approaching-in-trade", "event-released-in-trade"]);
  assert.deepEqual(note.market_context_effect, ["management-changed", "exit-changed"]);
  assert.equal(note.market_context_ref, "2026-10-30-NQ-session");
  assert.deepEqual(note.psychology_tags, []);
  assert.deepEqual(note.mistake_tags, []);
  assert.equal(note.exit_reason, "market/news context changed");
  assert.equal(note.rating, 4);
});