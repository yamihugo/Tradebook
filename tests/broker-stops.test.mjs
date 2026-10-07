import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// A synthetic Tradovate Orders export. The columns are the real ones — an
// Orders file carries the ticket (Status, Type, Limit Price, Stop Price,
// Timestamp) next to the fill (Fill Time, Filled Qty, Avg Fill Price) — because
// the stop a trader worked is only ever visible on the ticket, and a fixture
// that dropped those columns would test nothing.
const HEADER = [
  "orderId",
  "Account",
  "B/S",
  "Contract",
  "Product",
  "Status",
  "Quantity",
  "Type",
  "Limit Price",
  "Stop Price",
  "Filled Qty",
  "Avg Fill Price",
  "Fill Time",
  "Timestamp",
].join(",");

const NY = "America/New_York";
const row = (o) =>
  [
    o.id ?? "",
    o.acct ?? "ACC-1",
    o.side,
    `${o.contract ?? "NQU6"}`,
    "NQ",
    o.status ?? (o.fillQty ? "Filled" : "Canceled"),
    o.qty ?? 1,
    o.type ?? "Limit",
    o.limit ?? "",
    o.stop ?? "",
    o.fillQty ?? "",
    o.fillPrice ?? "",
    o.fillTime ?? "",
    o.time,
  ].join(",");

const parse = (rows) =>
  csv.parseTradeovateCsv(`${HEADER}\n${rows.join("\n")}\n`, [], { sourceZone: NY, journalZone: NY });

const result = await build({
  entryPoints: { csv: new URL("../src/csv.ts", import.meta.url).pathname },
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
const csv = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

// ---- a working stop is the risk, even though it never traded -------------

test("a stop that was never hit is still the risk the trade carried", () => {
  const out = parse([
    // Long entry at 100, then the bracket's stop still working when the target filled.
    row({ side: "Buy", limit: 100, fillQty: 1, fillPrice: 100, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:58" }),
    row({ side: "Sell", type: "Stop", stop: 95, qty: 1, time: "01/15/2026 10:00:12" }),
    row({ side: "Sell", limit: 110, fillQty: 1, fillPrice: 110, fillTime: "01/15/2026 10:20:00", time: "01/15/2026 10:00:14" }),
  ]);

  assert.equal(out.trades.length, 1);
  const [trade] = out.trades;
  assert.equal(trade.stopLoss, 95, "the risk is read from the working stop, not only from fills");
  assert.equal(trade.stopSource, "broker", "and it says where it came from");
  assert.deepEqual(trade.stopLevels, [95]);
  assert.equal(trade.target, 110, "the bracket's target is read from the exit ticket");
  assert.equal(out.unfilled, 1, "the working stop is still counted as a ticket that never traded");
});

// ---- the stop on the entry side is a trigger, not a loss -----------------

test("a stop-entry trigger is never recorded as a stop loss", () => {
  const out = parse([
    // Bought a stop at 100, filled at 100.5. That 100 is the price the trader
    // asked to be filled at, not a loss they accepted.
    row({ side: "Buy", type: "Stop", stop: 100, fillQty: 1, fillPrice: 100.5, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:50" }),
    row({ side: "Sell", limit: 110, fillQty: 1, fillPrice: 110, fillTime: "01/15/2026 10:20:00", time: "01/15/2026 10:00:05" }),
  ]);

  const [trade] = out.trades;
  assert.ok(!trade.stopLoss, "no risk is invented out of the entry trigger");
  assert.deepEqual(trade.stopLevels ?? [], [], "and no level is claimed either");
  assert.equal(trade.target, 110);
});

// ---- a moved stop: the first level filed is the risk --------------------

test("when the stop was moved, the first level filed is the risk", () => {
  const out = parse([
    row({ side: "Buy", limit: 100, fillQty: 1, fillPrice: 100, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:58" }),
    row({ side: "Sell", type: "Stop", stop: 95, time: "01/15/2026 10:02:00" }),
    // Moved to break-even-plus and cancelled; the target filled instead.
    row({ side: "Sell", type: "Stop", stop: 100.25, time: "01/15/2026 10:10:00" }),
    row({ side: "Sell", limit: 110, fillQty: 1, fillPrice: 110, fillTime: "01/15/2026 10:20:00", time: "01/15/2026 10:00:20" }),
  ]);

  const [trade] = out.trades;
  assert.equal(trade.stopLoss, 95, "the risk is what the trade carried, not where the stop ended up");
  assert.deepEqual(trade.stopLevels, [95, 100.25], "both levels stay visible, in the order they were filed");
  assert.ok(
    out.warnings.some((w) => w.includes("stop moved")),
    `the move is reported: ${out.warnings.join(" | ")}`
  );
});

// ---- a stop already past break-even is not a risk -----------------------

test("a stop already at break-even leaves R empty instead of inventing one", () => {
  const out = parse([
    row({ side: "Buy", limit: 100, fillQty: 1, fillPrice: 100, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:58" }),
    // The trader moved the stop to break-even and it never got hit.
    row({ side: "Sell", type: "Stop", stop: 100, time: "01/15/2026 10:05:00" }),
    row({ side: "Sell", limit: 110, fillQty: 1, fillPrice: 110, fillTime: "01/15/2026 10:20:00", time: "01/15/2026 10:00:20" }),
  ]);

  const [trade] = out.trades;
  assert.ok(!trade.stopLoss, "a stop at the entry price is not a risk of one point");
  assert.deepEqual(trade.stopLevels, [100], "the level the file holds is still recorded");
  assert.equal(trade.stopSource, "broker", "so the UI can say what the file does and does not have");
  assert.ok(
    out.warnings.some((w) => w.includes("break-even")),
    `and the reader is told: ${out.warnings.join(" | ")}`
  );
});

// ---- a scaled exit at one stop is one level ----------------------------

test("scaled exits at the same stop are one level, not several", () => {
  const out = parse([
    row({ side: "Buy", limit: 100, fillQty: 3, fillPrice: 100, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:58" }),
    row({ side: "Sell", type: "Stop", stop: 95, qty: 1, fillPrice: 95, fillTime: "01/15/2026 10:10:00", time: "01/15/2026 10:00:05" }),
    row({ side: "Sell", type: "Stop", stop: 95, qty: 2, fillPrice: 95, fillTime: "01/15/2026 10:12:00", time: "01/15/2026 10:00:05" }),
  ]);

  assert.equal(out.trades.length, 1, "the three fills pair into one round trip");
  const [trade] = out.trades;
  assert.deepEqual(trade.stopLevels, [95], "one position at one stop is one level");
  assert.equal(trade.stopLoss, 95);
  assert.ok(!out.warnings.some((w) => w.includes("stop moved")), "and nothing is reported as a move");
});

// ---- a level between two open trades is left alone ----------------------

test("a level that two open positions could claim is not assigned to either", () => {
  // A stop filed two seconds before an entry is a bracket submitted with it —
  // unless the trader re-enters within the tolerance, in which case the level
  // sits equally far from two trades and the journal cannot prove either.
  const out = parse([
    row({ side: "Buy", limit: 100, fillQty: 1, fillPrice: 100, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:58" }),
    row({ side: "Sell", type: "Stop", stop: 95, time: "01/15/2026 09:59:58" }),
    row({ side: "Sell", limit: 110, fillQty: 1, fillPrice: 110, fillTime: "01/15/2026 10:00:05", time: "01/15/2026 10:00:03" }),
    row({ side: "Buy", limit: 112, fillQty: 1, fillPrice: 112, fillTime: "01/15/2026 10:00:10", time: "01/15/2026 10:00:08" }),
    row({ side: "Sell", limit: 120, fillQty: 1, fillPrice: 120, fillTime: "01/15/2026 10:00:40", time: "01/15/2026 10:00:38" }),
  ]);

  assert.equal(out.trades.length, 2);
  for (const trade of out.trades) {
    assert.ok(!trade.stopLoss, "neither trade claims a level it cannot prove");
  }
  assert.ok(
    out.warnings.some((w) => w.includes("left unassigned")),
    `and the ambiguity is reported rather than resolved by a coin flip: ${out.warnings.join(" | ")}`
  );
});

// ---- the level belongs to the trade whose window holds it --------------

test("a stop filed before the next entry stays with the trade it protected", () => {
  const out = parse([
    row({ side: "Buy", limit: 100, fillQty: 1, fillPrice: 100, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:58" }),
    row({ side: "Sell", type: "Stop", stop: 95, time: "01/15/2026 10:00:30" }),
    row({ side: "Sell", limit: 110, fillQty: 1, fillPrice: 110, fillTime: "01/15/2026 10:01:00", time: "01/15/2026 10:00:32" }),
    // The next trade opens two minutes later, long after that stop was cancelled.
    row({ side: "Buy", limit: 112, fillQty: 1, fillPrice: 112, fillTime: "01/15/2026 10:03:00", time: "01/15/2026 10:02:58" }),
    row({ side: "Sell", limit: 120, fillQty: 1, fillPrice: 120, fillTime: "01/15/2026 10:04:00", time: "01/15/2026 10:03:02" }),
  ]);

  assert.equal(out.trades.length, 2);
  assert.equal(out.trades[0].stopLoss, 95);
  assert.ok(!out.trades[1].stopLoss, "and the second trade does not inherit it");
});

// ---- the risk the journal then reports --------------------------------

test("the recorded stop makes R a real number in the journal's own money", () => {
  const out = parse([
    row({ side: "Buy", limit: 20000, fillQty: 2, fillPrice: 20000, fillTime: "01/15/2026 10:00:00", time: "01/15/2026 09:59:58" }),
    row({ side: "Sell", type: "Stop", stop: 19990, time: "01/15/2026 10:00:30" }),
    row({ side: "Sell", limit: 20020, fillQty: 2, fillPrice: 20020, fillTime: "01/15/2026 10:30:00", time: "01/15/2026 10:00:32" }),
  ]);

  const [trade] = out.trades;
  assert.equal(trade.stopLoss, 19990);
  // 10 points on 2 NQ at $20 a point.
  const risk = Math.abs(trade.entryPrice - trade.stopLoss) * 20 * trade.quantity;
  assert.equal(risk, 400);
  assert.equal(trade.pnl, 800, "20 points × $20 × 2");
  assert.equal(trade.pnl / risk, 2, "so the trade reads as +2R");
});
