import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const bundle = await build({
  entryPoints: {
    csv: new URL("../src/csv.ts", import.meta.url).pathname,
    batch: new URL("../src/lib/importBatch.ts", import.meta.url).pathname,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  outdir: "bundle",
});
const loadBundle = (name) => {
  const output = bundle.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [csv, batch] = await Promise.all([loadBundle("csv"), loadBundle("batch")]);

const HEADER = "Time,Symbol,Qty,Side,Order Type,Limit Price,Stop Price,Avg Price,Commission,Status";
const ZONES = { sourceZone: "UTC", journalZone: "UTC" };
const tradeSea = (...rows) => [HEADER, ...rows].join("\n");
const row = (time, symbol, qty, side, type, limit, stop, avg, commission, status) =>
  `"07/15/2026, ${time} EDT",${symbol},${qty},${side},${type},${limit},${stop},${avg},${commission},${status}`;
const parse = (text) => csv.parseTradeovateCsv(text, [], ZONES);

test("TradeSea recognition requires its complete signature and ignores header case", () => {
  assert.equal(csv.csvKind(tradeSea()), "tradesea");
  assert.equal(csv.csvKind(tradeSea().replace(HEADER, HEADER.toLowerCase())), "tradesea");

  const generic = [
    "Time,Symbol,Qty,Side,Status",
    '"07/15/2026, 09:30:00 EDT",ES,1,Buy,Filled',
  ].join("\n");
  assert.equal(csv.csvKind(generic), "unknown");
  assert.equal(csv.csvKind(tradeSea().replace(HEADER, `${HEADER},Order ID`)), "orders");
  assert.equal(csv.csvKind(tradeSea().replace(HEADER, `${HEADER},Fill ID`)), "fills");
});

test("a synthetic TradeSea round trip imports gross P&L without fabricated costs", () => {
  const input = tradeSea(
    row("09:31:00", "CME:ES", 1, "Sell", "Market", "", "", "5002.00", "0.75", "Filled"),
    row("09:30:00", "CME:ES", 1, "Buy", "Market", "", "", "5000.00", "0.75", "Filled"),
    row("09:32:00", "CME:ES", 1, "Sell", "Stop", "4999.00", "4998.00", "", "0.75", "Cancelled"),
  );
  const out = parse(input);
  assert.equal(out.trades.length, 1);
  assert.equal(out.unfilled, 1);
  assert.equal(out.skipped, 0);
  assert.equal(out.trades[0].symbol, "ES");
  assert.equal(out.trades[0].direction, "long");
  assert.equal(out.trades[0].quantity, 1);
  assert.equal(out.trades[0].entryPrice, 5000);
  assert.equal(out.trades[0].exitPrice, 5002);
  assert.equal(out.trades[0].pnl, 100);
  assert.equal(out.trades[0].commission, 0);
  assert.equal(out.trades[0].fees, 0);
  assert.equal(out.trades[0].account, "TradeSea");
  assert.equal(out.unpaired, 0);
  assert.deepEqual(out.accountsSeen.map((account) => account.name), ["TradeSea"]);
});

test("non-TradeSea rows keep their existing root-symbol parsing", () => {
  const input = [
    "Timestamp,Account,Symbol,Side,Quantity,Filled Qty,Avg Fill Price,Order ID,Order Type,Status",
    "01/15/2026 09:30:00,account,ES:U,Buy,1,1,5000.00,order-1,Market,Filled",
    "01/15/2026 09:31:00,account,ES:U,Sell,1,1,5002.00,order-2,Market,Filled",
  ].join(String.fromCharCode(10));
  assert.equal(csv.csvKind(input), "orders");
  const out = parse(input);
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].symbol, "ES");
});

test("a single filled TradeSea row remains unpaired rather than becoming a trade", () => {
  const out = parse(tradeSea(row("09:30:00", "ES", 1, "Buy", "Market", "", "", "5000.00", "0.75", "Filled")));
  assert.equal(out.trades.length, 0);
  assert.equal(out.unpaired, 1);
});

test("a TradeSea file with only cancelled tickets is recognized and imports no trades", () => {
  const input = tradeSea(row("09:30:00", "ES", 1, "Sell", "Stop", "", "4998.00", "", "", "Cancelled"));
  assert.equal(csv.csvKind(input), "tradesea");
  const out = parse(input);
  assert.equal(out.trades.length, 0);
  assert.equal(out.unfilled, 1);
});

test("the file's explicit offset overrides the selected source zone through the importer", () => {
  const input = tradeSea(
    row("09:31:00", "CME:ES", 1, "Sell", "Market", "", "", "5002.00", "0.75", "Filled"),
    row("09:30:00", "CME:ES", 1, "Buy", "Market", "", "", "5000.00", "0.75", "Filled"),
  );
  const out = csv.parseTradeovateCsv(input, [], {
    sourceZone: "Europe/Lisbon",
    journalZone: "Europe/Lisbon",
    systemSource: true,
  });
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].entryInstant, "2026-07-15T13:30:00.000Z");
  assert.equal(out.trades[0].instantSource, "offset");
  assert.equal(out.trades[0].sourceZone, undefined);
  assert.equal(out.trades[0].entryTime, "14:30:00");
});

test("an unknown TradeSea zone is refused rather than interpreted in the selected zone", () => {
  const input = tradeSea(row("09:30:00", "CME:ES", 1, "Buy", "Market", "", "", "5000.00", "0.75", "Filled"))
    .replace("EDT", "XYZ");
  const out = parse(input);
  assert.equal(out.trades.length, 0);
  assert.equal(out.timeIssues.unknownZone, 1);
  assert.equal(out.timeIssues.noZone, 0);
});

test("a batch cannot combine multiple TradeSea files under the same placeholder account", () => {
  assert.equal(csv.hasTradeSeaBatchConflict(["tradesea", "tradesea"]), true);
  assert.equal(csv.hasTradeSeaBatchConflict(["tradesea", "orders"]), false);
  assert.equal(csv.hasTradeSeaBatchConflict(["tradesea"]), false);
});

test("reimporting a synthetic TradeSea file is deduped after account mapping", () => {
  const input = tradeSea(
    row("09:30:00", "CME:ES", 1, "Buy", "Market", "", "", "5000.00", "0.75", "Filled"),
    row("09:31:00", "CME:ES", 1, "Sell", "Market", "", "", "5002.00", "0.75", "Filled"),
  );
  const trades = parse(input).trades;
  const plan = (existing = []) =>
    batch.planBatch({
      files: [{ name: "synthetic-tradesea.csv", trades }],
      existing,
      mapping: { TradeSea: "account-a" },
    });

  const first = plan();
  assert.equal(first.assigned, 1);
  assert.equal(first.selected.length, 1);

  const second = plan(first.selected);
  assert.equal(second.duplicates, 1);
  assert.equal(second.importable, 0);
  assert.equal(second.selected.length, 0);
});
