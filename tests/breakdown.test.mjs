import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: [new URL("../src/lib/breakdown.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: "export const App = class {}; export const TFile = class {}; export const normalizePath = (p) => p; export const setIcon = () => {};",
        loader: "js",
      }));
    },
  }],
});
const breakdown = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const row = (id, pnl, opts = {}) => ({
  id,
  date: "2026-01-05",
  entryTime: "09:00:00",
  exitTime: "10:00:00",
  symbol: "NQ",
  account: "A",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20001,
  commission: 0,
  fees: 0,
  costCoverage: { commission: true, fees: true },
  pnl,
  ...opts,
});

test("a bucket's win rate is Net-positive ÷ decided, the product's one formula", () => {
  const win = row("w", 10);
  const loss = row("l", -8);
  // Gross positive, Net negative once the recorded cost is applied: a loss.
  const grossWinNetLoss = row("g", 1, { commission: 5 });
  // A genuine break-even: counted in the bucket, kept out of the rate.
  const breakeven = row("b", 0);
  const rows = [win, loss, grossWinNetLoss, breakeven];

  const tiles = breakdown.dimensionTiles(rows, (t) => t.symbol, {});
  assert.equal(tiles.length, 1);
  const tile = tiles[0];
  assert.equal(tile.count, 4, "four decisions in the bucket");
  assert.equal(tile.wins, 1, "only the Net win counts as a win");
  assert.equal(tile.decided, 3, "the break-even stays out of the denominator");
  assert.match(tile.tip.sub, /33% Net win rate/, tile.tip.sub);
});

test("a bucket with no decided result says so instead of inventing a 0%", () => {
  const breakeven = row("b", 0);
  const tiles = breakdown.dimensionTiles([breakeven], (t) => t.symbol, {});
  assert.equal(tiles[0].count, 1);
  assert.equal(tiles[0].decided, 0);
  assert.match(tiles[0].tip.sub, /no decided results/, tiles[0].tip.sub);
});
