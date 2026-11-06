import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: { risk: new URL("../src/lib/risk.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  outdir: "bundle",
  write: false,
  plugins: [
    {
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
    },
  ],
});
const { applyAssumedRisk, assumedStop } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

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
  thesis: "",
  review: "",
  screenshot: "",
  rating: 0,
  ...over,
});

// ---- points: the distance the trader works in --------------------------

test("a rule in points stands that distance from the entry, on the risk side", () => {
  const long = assumedStop(trade(), { NQ: { points: 15 } });
  assert.equal(long, 19985, "a long's assumed stop sits below the entry");
  const short = assumedStop(trade({ direction: "short" }), { NQ: { points: 15 } });
  assert.equal(short, 20015, "a short's sits above it");
});

test("a rule in dollars is the same risk whatever the size", () => {
  // $200 on one NQ is 10 points ($20 a point); on ten MNQ it is 10 points too
  // ($2 a point × 10), which is the whole point of writing it in money.
  const oneBig = assumedStop(trade({ symbol: "NQ", quantity: 1 }), { NQ: { dollars: 200 } });
  const tenSmall = assumedStop(trade({ symbol: "MNQ", quantity: 10 }), { MNQ: { dollars: 200 } });
  assert.equal(oneBig, 19990);
  assert.equal(tenSmall, 19990, "$200 of risk is $200 on an NQ and on ten MNQ");
  // And the two rules are separate, because the mini and the micro are.
  assert.equal(assumedStop(trade({ symbol: "MNQ" }), { NQ: { dollars: 200 } }), null);
});

// ---- a rule never overwrites a fact ------------------------------------

test("a stop the platform filed is never replaced by a rule", () => {
  const recorded = trade({ stopLoss: 19950, stopSource: "broker", stopLevels: [19950] });
  assert.equal(assumedStop(recorded, { NQ: { points: 5 } }), null);
});

test("a hand-written stop is left alone as well", () => {
  assert.equal(assumedStop(trade({ stopLoss: 19950 }), { NQ: { points: 5 } }), null);
});

// ---- the case the rule actually exists for -----------------------------

test("a file whose only stop sits at break-even still gets the rule's risk", () => {
  // What the import leaves: the levels are there to be seen, but none of them is
  // an initial risk. The rule fills that gap and leaves the levels alone.
  const t = trade({ stopLevels: [20000], stopSource: "broker" });
  const res = applyAssumedRisk([t], { NQ: { points: 10 } });
  assert.equal(res.applied, 1);
  assert.equal(t.stopLoss, 19990);
  assert.equal(t.stopSource, "assumed", "the trade now says the stop is a stand-in");
  assert.deepEqual(t.stopLevels, [20000], "and the level the platform did file is still there");
});

// ---- where a rule must stay silent -------------------------------------

test("no rule, no stop: the trade keeps saying it has none", () => {
  const t = trade();
  const res = applyAssumedRisk([t], { ES: { points: 10 } });
  assert.equal(res.applied, 0);
  assert.equal(t.stopLoss, undefined);
  assert.deepEqual(res.withoutRule, ["NQ"]);
  assert.equal(res.withoutRuleCount, 1);
});

test("a trade with no entry price has nothing to measure a risk from", () => {
  const noEntry = trade({ entryPrice: NaN });
  assert.equal(assumedStop(noEntry, { NQ: { points: 10 } }), null);
  const noPrices = trade({ entryPrice: NaN, symbol: "NQ" });
  assert.equal(assumedStop(noPrices, { NQ: { dollars: 200 } }), null);
});

test("a contract the journal cannot price gets no dollar stand-in", () => {
  // $1 a point would be a made-up number dressed as a rule.
  assert.equal(assumedStop(trade({ symbol: "ZZZZ" }), { ZZZZ: { dollars: 200 } }), null);
});

test("an empty or nonsensical rule applies nothing", () => {
  for (const rule of [{}, { points: 0 }, { dollars: -5 }, { points: NaN }, { dollars: NaN }]) {
    assert.equal(assumedStop(trade(), { NQ: rule }), null, `rule ${JSON.stringify(rule)} applies nothing`);
  }
});

// ---- what the reader is told -------------------------------------------

test("the import reports what the rules did and what they left out", () => {
  const trades = [
    trade({ id: "1", symbol: "NQ" }), // rule → filled
    trade({ id: "2", symbol: "NQ", stopLoss: 19950, stopSource: "broker" }), // kept
    trade({ id: "3", symbol: "MNQ" }), // rule → filled ($200 at $2 a point = 100 points)
    trade({ id: "4", symbol: "ES" }), // no rule
    trade({ id: "5", symbol: "ES" }), // no rule
  ];
  const res = applyAssumedRisk(trades, { NQ: { points: 10 }, MNQ: { dollars: 200 } });
  assert.equal(res.applied, 2);
  assert.equal(res.keptRecorded, 1);
  assert.deepEqual(res.withoutRule, ["ES"], "one name, not two rows of the same");
  assert.equal(res.withoutRuleCount, 2);
  assert.equal(trades[0].stopLoss, 19990);
  assert.equal(trades[2].stopLoss, 19900, "$200 on one MNQ is 100 points, not the 10 it is on an NQ");
});
