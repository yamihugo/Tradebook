import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const built = await build({
  entryPoints: [new URL("../src/lib/importBatch.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const batch = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

const account = "TradingView Replay";
const encodeKey = (exitPrice) => "replay:" + [
  "ES", "42", "long", 1, "2026-11-06 09:30:00", "2026-11-06 09:31:00", 5000, exitPrice,
].map((part) => encodeURIComponent(String(part))).join("|");
const replayTrade = (exitPrice, pnl, pnlPoints) => ({
  id: `replay-42-${exitPrice}`,
  type: "trade",
  origin: "replay",
  dataSource: "replay",
  account,
  accountType: "demo",
  importKey: encodeKey(exitPrice),
  date: "2026-11-06",
  entryTime: "09:30:00",
  exitTime: "09:31:00",
  timeUnresolved: true,
  symbol: "ES",
  direction: "long",
  quantity: 1,
  entryPrice: 5000,
  exitPrice,
  pnl,
  pnlPoints,
  commission: 0,
  fees: 0,
});

test("same Replay trade number with conflicting facts is held instead of choosing a file winner", () => {
  const plan = batch.planBatch({
    files: [
      { name: "first.csv", trades: [replayTrade(5001, 50, 1)] },
      { name: "revised.csv", trades: [replayTrade(5002, 100, 2)] },
    ],
    mapping: { [account]: "id-replay-demo" },
  });

  assert.equal(plan.detected, 2);
  assert.equal(plan.conflicts, 2);
  assert.equal(plan.duplicates, 0);
  assert.equal(plan.importable, 0);
  assert.deepEqual(plan.selected, []);
});

test("a valid Replay trade stays importable instead of being marked ambiguous", () => {
  const trade = replayTrade(5001, 50, 1);
  const plan = batch.planBatch({
    files: [{ name: "one.csv", trades: [trade] }],
    mapping: { [account]: "id-replay-demo" },
  });

  assert.equal(plan.conflicts, 0);
  assert.equal(plan.importable, 1);
  assert.equal(plan.assigned, 1);
  assert.equal(plan.selected[0]?.importKey, trade.importKey);
});

test("the same Replay note in two files becomes one import and one duplicate", () => {
  const trade = replayTrade(5001, 50, 1);
  const plan = batch.planBatch({
    files: [
      { name: "first.csv", trades: [trade] },
      { name: "overlap.csv", trades: [{ ...trade, id: "replay-42-copy" }] },
    ],
    mapping: { [account]: "id-replay-demo" },
  });

  assert.equal(plan.conflicts, 0);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.importable, 1);
  assert.equal(plan.selected.length, 1);
});
