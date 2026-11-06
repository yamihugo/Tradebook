import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const result = await build({
  entryPoints: {
    manual: new URL("src/lib/manualTradeFills.ts", root).pathname,
    fills: new URL("src/lib/fills.ts", root).pathname,
    storage: new URL("src/storage.ts", root).pathname,
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
const [manual, fills, storage] = await Promise.all([
  loadBundle("manual"),
  loadBundle("fills"),
  loadBundle("storage"),
]);
const panel = readFileSync(new URL("src/views/addTradePanel.ts", root), "utf8");

const trade = (over = {}) => ({
  id: "manual-scale-out",
  date: "2026-11-05",
  entryTime: "10:00:00",
  exitTime: "10:20:00",
  symbol: "NQ",
  account: "Synthetic account",
  accountType: "funded",
  direction: "long",
  quantity: 4,
  entryPrice: 20000,
  exitPrice: 0,
  commission: 2,
  fees: 1,
  pnl: 0,
  pnlPoints: 0,
  setup: "",
  mistake: "",
  review: "",
  screenshot: "",
  thesis: "",
  rating: 0,
  origin: "manual",
  dataSource: "manual",
  ...over,
});

// This is the form-to-record seam: the control asks for actual exits, and those
// exits enter the same fill ledger the rest of the journal already reads.
test("Manual Add Trade exposes actual exits and wires them into the fill ledger", () => {
  assert.match(panel, /Actual exits/);
  assert.match(panel, /Add exit/);
  assert.match(panel, /buildManualExitFills/);
});

test("multiple long exits retain quantities, weighted averages, automatic TP/BE labels and gross P&L", () => {
  const result = manual.buildManualExitFills(trade({ entryInstant: "2026-11-05T10:00:00.000Z" }), [
    { quantity: 1, price: 20000, time: "10:01:00", instant: "2026-11-05T10:01:00.000Z" },
    { quantity: 2, price: 20010, time: "10:02:00", instant: "2026-11-05T10:02:00.000Z" },
    { quantity: 1, price: 20020, time: "10:03:00", instant: "2026-11-05T10:03:00.000Z" },
  ]);

  assert.equal(result.ok, true, result.error);
  const saved = result.trade;
  const set = fills.fillSet(saved);
  assert.equal(saved.quantity, 4);
  assert.equal(saved.entryPrice, 20000);
  assert.equal(saved.exitPrice, 20010);
  assert.equal(saved.exitTime, "10:03:00");
  assert.equal(saved.pnl, 800);
  assert.equal(saved.pnlPoints, 10);
  assert.equal(set.exits.length, 3);
  assert.deepEqual(
    set.exits.map((exit, i) => fills.fillLabel(exit, i, set, 20)),
    ["BE", "TP1", "TP2"],
  );
});

test("multiple short exits use buy-side closes and preserve realized P&L", () => {
  const result = manual.buildManualExitFills(
    trade({ direction: "short", quantity: 2 }),
    [
      { quantity: 1, price: 19990, time: "10:01:00" },
      { quantity: 1, price: 20000, time: "10:02:00" },
    ],
  );

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.trade.fills.map((fill) => fill.side), ["sell", "buy", "buy"]);
  assert.equal(result.trade.pnl, 200);
  assert.equal(result.trade.pnlPoints, 5);
});

test("multiple exits require valid clocks and need a time-zone pin to cross midnight", () => {
  assert.equal(manual.isManualClock("10:01:00"), true);
  assert.equal(manual.isManualClock("24:01:00"), false);
  assert.equal(manual.isManualClock("10:61:00"), false);

  const overnight = trade({ entryTime: "23:50:00" });
  const unpinned = manual.buildManualExitFills(overnight, [
    { quantity: 2, price: 20010, time: "00:10:00" },
    { quantity: 2, price: 20020, time: "00:20:00" },
  ]);
  assert.equal(unpinned.ok, false);
  assert.match(unpinned.error, /cross midnight/i);

  const pinned = manual.buildManualExitFills(
    trade({ entryTime: "23:50:00", entryInstant: "2026-11-05T23:50:00.000Z" }),
    [
      { quantity: 2, price: 20010, time: "00:10:00", instant: "2026-11-06T00:10:00.000Z" },
      { quantity: 2, price: 20020, time: "00:20:00", instant: "2026-11-06T00:20:00.000Z" },
    ],
  );
  assert.equal(pinned.ok, true, pinned.error);
  assert.equal(pinned.trade.exitTime, "00:20:00");
  assert.equal(pinned.trade.exitInstant, "2026-11-06T00:20:00.000Z");
});

test("an exit ledger cannot over-close or leave contracts unaccounted for", () => {
  const original = trade();
  const tooFew = manual.buildManualExitFills(original, [
    { quantity: 1, price: 20010, time: "10:01:00" },
    { quantity: 2, price: 20020, time: "10:02:00" },
  ]);
  const tooMany = manual.buildManualExitFills(original, [
    { quantity: 2, price: 20010, time: "10:01:00" },
    { quantity: 3, price: 20020, time: "10:02:00" },
  ]);

  assert.equal(tooFew.ok, false);
  assert.match(tooFew.error, /must equal the trade quantity/i);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /must equal the trade quantity/i);
  assert.equal(original.fills, undefined, "a rejected draft does not mutate the trade");
});

test("multiple actual exits round-trip through the trade note", () => {
  const result = manual.buildManualExitFills(trade({ entryInstant: "2026-11-05T10:00:00.000Z" }), [
    { quantity: 3, price: 20005, time: "10:01:00", instant: "2026-11-05T10:01:00.000Z" },
    { quantity: 1, price: 20015, time: "10:02:00", instant: "2026-11-05T10:02:00.000Z" },
  ]);
  assert.equal(result.ok, true, result.error);

  const markdown = storage.tradeToMarkdown(result.trade);
  const reopened = storage.parseTradeFromMarkdown(markdown);
  assert.equal(reopened.fills.length, 3);
  assert.deepEqual(
    reopened.fills.map(({ side, qty, price, pnl }) => ({ side, qty, price, pnl })),
    [
      { side: "buy", qty: 4, price: 20000, pnl: undefined },
      { side: "sell", qty: 3, price: 20005, pnl: 300 },
      { side: "sell", qty: 1, price: 20015, pnl: 300 },
    ],
  );
  assert.equal(reopened.exitPrice, 20007.5);
  assert.equal(reopened.pnl, 600);
});
