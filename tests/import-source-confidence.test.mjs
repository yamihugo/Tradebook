import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { test } from "node:test";

// Release confidence for the Tradovate CSV claim — the evidence that our own
// canonical exports go through the REAL import path, not only the parser.
//
// The three gates this pins:
//   1. csvKind, the door the Import CSV flow actually knocks on, agrees with the
//      reader about which report a file is. A signature the gate recognises but
//      the reader cannot find is a report that imports as nothing.
//   2. Cash History costs reach the trade that was actually charged, on both
//      report shapes, by identity and never by falling inside a time window.
//   3. One file may hold several accounts, and they stay apart — label, group,
//      identity and round trip.
//
// Fixtures are inline and canonical, like every other test in this project:
// hand-authored column sets, no file on disk. See the header of
// `broker-stops.test.mjs` for why the columns are the real ones.
//
// Tradovate is the ONLY source claimed. Nothing here widens that: the generic
// and Performance-shaped files at the bottom are asserted to be REFUSED, because
// documenting what we cannot read is as much of the contract as what we can.
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const result = await build({
  entryPoints: {
    csv: new URL("../src/csv.ts", import.meta.url).pathname,
    batch: new URL("../src/lib/importBatch.ts", import.meta.url).pathname,
    identity: new URL("../src/lib/importIdentity.ts", import.meta.url).pathname,
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  outdir: "bundle",
});
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [csv, batch, identity] = await Promise.all([loadBundle("csv"), loadBundle("batch"), loadBundle("identity")]);

// A fixed zone, so every instant below is reproducible on any machine: the
// importer is handed the zone the file was written in, exactly as the UI does.
const ZONES = { sourceZone: "UTC", journalZone: "UTC" };

const parse = (text, costs) => csv.parseTradeovateCsv(text, [], ZONES, costs);
const resolve = (label) => (label || "").trim().toLowerCase();

// ----------------------------------------------------------- canonical files

/** Tradovate → Reports → Orders. Every ticket, with its fill and its stop. */
const ORDERS_HEADER =
  "orderId,Account,B/S,Contract,Product,Status,Quantity,Type,Limit Price,Stop Price,Filled Qty,Avg Fill Price,Fill Time,Timestamp";
const ORDERS_ROWS = [
  "ORD-1,DEMO1,Buy,NQU6,NQ,Filled,1,Limit,,,1,20000,01/05/2026 10:00:00,01/05/2026 09:59:50",
  "ORD-2,DEMO1,Sell,NQU6,NQ,Filled,1,Limit,,,1,20010,01/05/2026 10:05:00,01/05/2026 10:04:50",
];
const ordersFile = (header = ORDERS_HEADER, rows = ORDERS_ROWS) => [header, ...rows].join("\n");

/** Tradovate → Reports → Fills. One row per execution, and no `Contract`. */
const FILLS_FILE = [
  "Fill ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  "FILL-1,01/05/2026 10:00:00,DEMO1,NQ,buy,1,20000",
  "FILL-2,01/05/2026 10:05:00,DEMO1,NQ,sell,1,20010",
].join("\n");

const cashRow = (kind, delta, contract, stamp, amount = "10000") =>
  `${kind},${delta},${contract},${stamp},${amount}`;
const cashFile = (rows) => ["Cash Change Type,Delta,Contract,Timestamp,Amount", ...rows].join("\n");

/** The cash history of the round trip above, as the platform wrote it. */
const CASH_FOR_NQ = cashFile([
  cashRow("Commission", "-2.00", "NQ", "01/05/2026 10:00:00"),
  cashRow("Exchange Fee", "-1.00", "NQ", "01/05/2026 10:00:00"),
  cashRow("Clearing Fee", "-0.50", "NQ", "01/05/2026 10:00:00"),
  cashRow("Commission", "-2.00", "NQ", "01/05/2026 10:05:00"),
  cashRow("Exchange Fee", "-1.00", "NQ", "01/05/2026 10:05:00"),
  cashRow("Clearing Fee", "-0.50", "NQ", "01/05/2026 10:05:00"),
]);

// =============================================================================
// 1. THE GATE — csvKind is what the Import CSV flow actually asks
// =============================================================================

test("an Orders export is recognised by the gate and parsed into a round trip", () => {
  const file = ordersFile();
  assert.equal(csv.csvKind(file), "orders", "the gate calls it an Orders report");

  const out = parse(file);
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].account, "DEMO1");
  assert.equal(out.trades[0].symbol, "NQ");
  assert.equal(out.trades[0].fillId, "ORD-1", "the order id is the identity an Orders export has");
  assert.deepEqual(out.accountsSeen, [{ name: "DEMO1", type: "demo" }]);
  assert.equal(out.unfilled, 0);
  assert.equal(out.skipped, 0);
});

test("the same Orders report is recognised when its order column is spelled orderId", () => {
  // The release-blocking one: this is the header the canonical stop tests use,
  // and the reader reads it. The gate has to agree, or the file our own fixture
  // describes would be refused by the flow that fixture exists for.
  assert.equal(csv.csvKind(ordersFile()), "orders");

  const out = parse(ordersFile());
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].fillId, "ORD-1");
  assert.equal(out.trades[0].pnl, 200, "10 points on NQ at $20 a point");
});

test("every order-id spelling the reader accepts is a spelling the gate accepts", () => {
  // One list, not two: these are EXEC_KEYS.orderId, the aliases the row reader
  // uses. If the gate ever grows its own list, this test stops meaning anything.
  const variants = {
    "Order ID": "Status,Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    orderId: "Status,orderId,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    OrderId: "Status,OrderId,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    OrderID: "Status,OrderID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    _orderId: "Status,_orderId,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    ordStatusID: "Status,ordStatusID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  };
  for (const [alias, header] of Object.entries(variants)) {
    assert.equal(csv.csvKind(ordersFile(header)), "orders", `Orders detected with "${alias}"`);
  }
});

test("a Fills export is recognised by the gate and parsed with its own fill id", () => {
  assert.equal(csv.csvKind(FILLS_FILE), "fills");

  const out = parse(FILLS_FILE);
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].fillId, "FILL-1", "the Fills export's own id, not an order id");
  assert.equal(out.trades[0].account, "DEMO1");
  assert.equal(out.trades[0].pnl, 200);
});

test("every fill-id spelling the reader accepts is a spelling the gate accepts", () => {
  const body = "Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price";
  const variants = {
    "Fill ID": `Fill ID,${body}`,
    FillId: `FillId,${body}`,
    fillId: `fillId,${body}`,
    fill_id: `fill_id,${body}`,
    "Execution ID": `Execution ID,${body}`,
    ExecutionId: `ExecutionId,${body}`,
    executionId: `executionId,${body}`,
    "Exec ID": `Exec ID,${body}`,
  };
  for (const [alias, header] of Object.entries(variants)) {
    assert.equal(csv.csvKind(FILLS_FILE.replace(/^[^\n]*/, header)), "fills", `Fills detected with "${alias}"`);
  }
});

test("a Cash History export is recognised by the gate and parsed into cost lines", () => {
  const file = cashFile([cashRow("Commission", "-2.00", "NQ", "01/05/2026 10:00:00")]);
  assert.equal(csv.csvKind(file), "cash");
  assert.equal(csv.isCashHistoryCsv(file), true);

  const costs = csv.parseCashHistoryCsv(file);
  assert.equal(costs.lines, 1);
  assert.equal(costs.charged, 2);
  assert.equal(costs.finalBalance, 10000, "the platform's own running balance");
});

test("a generic fills file with no identity column is refused by the gate today", () => {
  // The shape a fills file has when it carries no id at all. This is
  // intentional: without an identity column there is nothing to dedupe a
  // re-import against, so the journal says so instead of guessing.
  const generic = [
    "Fill Time,Account,Symbol,Side,Quantity,Price,Commission,Fees",
    "01/05/2026 10:00:00,TEST123,MNQ,Buy,4,21000,1.04,1.36",
    "01/05/2026 10:08:30,TEST123,MNQ,Sell,2,21010,0.52,0.68",
    "01/05/2026 10:12:00,TEST123,MNQ,Sell,2,21018,0.52,0.68",
  ].join("\n");

  assert.equal(csv.csvKind(generic), "unknown", "the real gate refuses it");
  assert.equal(
    parse(generic).trades.length,
    1,
    "…the reader alone would have paired it into one trade, which is exactly why the gate exists: " +
      "without an identity column a re-import could not be told from the first"
  );
});

test("a Performance-shaped report is refused by the gate", () => {
  // The UI promises this in words: the performance report "is a screen, not a
  // ledger". This is that promise, executed rather than asserted.
  const performance = [
    "Account,Symbol,Side,Quantity,Price,ProfitLoss,CumProfit,Date",
    "DEMO1,NQ,Long,1,20000,200,200,2026-01-05",
  ].join("\n");

  assert.equal(csv.csvKind(performance), "unknown");
});

test("the gate refuses near-miss spellings the reader would also not find", () => {
  // The fix aligned the gate with the reader; it did not widen either of them.
  // A column that reads as an id but is not one of the supported aliases is
  // still not readable, and must still be refused rather than half-read.
  const nearMisses = [
    "Status,Order Id,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    "Status,OrderID ,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    "Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    "Status,Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  ];
  assert.equal(csv.csvKind(nearMisses[0]), "unknown", '"Order Id" is not an alias');
  assert.equal(csv.csvKind(nearMisses[1]), "orders", "a trimmed cell is still the cell");
  assert.equal(csv.csvKind(nearMisses[2]), "unknown", "an Orders report without Status is not one");
  assert.equal(csv.csvKind(nearMisses[3]), "orders", "and the real thing stays accepted");
});

test("the report chip is labelled by the gate, not by a second reading of the header", () => {
  // The chip once asked its own question, with its own copy of the two id
  // strings. That is how a file the reader accepts ends up named "CSV" on
  // screen. The chip now asks `csvKind` — the gate that let it in.
  const ui = read("src/views/importUi.ts");
  const fileKind = ui.slice(ui.indexOf("private fileKind("), ui.indexOf("private batchKind("));

  assert.match(fileKind, /csvKind\(text\)/, "the chip label comes from the gate");
  assert.doesNotMatch(
    fileKind,
    /includes\("order id"\)|includes\("fill id"\)/,
    "and there is no second list of id spellings left to drift from the reader"
  );
});

// =============================================================================
// 2. CASH HISTORY → THE TRADE THAT WAS CHARGED
// =============================================================================

test("an Orders export attaches its cash history cost to the fill that was charged", () => {
  const out = parse(ordersFile(), csv.parseCashHistoryCsv(cashFile([
    cashRow("Commission", "-2.00", "NQU6", "01/05/2026 10:00:00"),
    cashRow("Exchange Fee", "-1.00", "NQU6", "01/05/2026 10:00:00"),
    cashRow("Commission", "-2.00", "NQU6", "01/05/2026 10:05:00"),
    cashRow("Exchange Fee", "-1.00", "NQU6", "01/05/2026 10:05:00"),
  ])));

  assert.equal(out.trades.length, 1);
  const t = out.trades[0];
  assert.equal(t.commission, 4, "2.00 on each of the two fills");
  assert.equal(t.fees, 2, "the exchange fee on each");
  assert.equal(t.pnl, 200, "P&L stays gross: a cost never rewrites the result");
  assert.equal(out.costs.recorded, 6, "what the trade picked up");
  assert.equal(out.costs.charged, 6, "and that is everything the file charged");
  assert.deepEqual(out.costs.orphans, [], "nothing was left over");
});

test("a Fills export attaches its cash history cost by identity, not by proximity", () => {
  // A Fills row has no `Contract` column, so its cost key is built from the
  // row's own symbol. Before that, the key was empty and every cost on a Fills
  // report could only be found by falling inside a trade's time window — which
  // is a guess. Here the cost is found by what it is.
  const out = parse(FILLS_FILE, csv.parseCashHistoryCsv(CASH_FOR_NQ));

  const t = out.trades[0];
  assert.equal(t.commission, 4);
  assert.equal(t.fees, 3, "exchange + clearing on both fills");
  assert.equal(out.costs.recorded, 7);
  assert.deepEqual(out.costs.orphans, [], "an exactly matched cost leaves nothing over — no window guessing");
});

test("the same cash line in two exports is charged once", () => {
  const one = csv.parseCashHistoryCsv(CASH_FOR_NQ);
  const merged = csv.mergeCashCosts([one, csv.parseCashHistoryCsv(CASH_FOR_NQ)]);

  assert.equal(merged.lines, 6, "six cost lines, not twelve");
  assert.equal(merged.charged, 7);

  const t = parse(FILLS_FILE, merged).trades[0];
  assert.equal(t.commission, 4, "the re-dropped export does not double the bill");
  assert.equal(t.fees, 3);
});

test("a cost written for another contract never reaches this trade", () => {
  const out = parse(FILLS_FILE, csv.parseCashHistoryCsv(cashFile([
    cashRow("Commission", "-2.00", "NQ", "01/05/2026 10:00:00"),
    cashRow("Commission", "-9.99", "ES", "01/05/2026 10:00:00"),
  ])));

  assert.equal(out.trades[0].commission, 2, "only the NQ money is on an NQ trade");
  assert.equal(out.trades[0].fees, 0);
  assert.equal(out.costs.recorded, 2);
  assert.deepEqual(
    out.costs.orphans.map((o) => [o.contract, o.amount]),
    [["ES", 9.99]],
    "the ES line is the platform's money and stays visible, dated on its own day"
  );
});

test("without the cash history no fee is invented", () => {
  const out = parse(FILLS_FILE);
  const t = out.trades[0];

  assert.equal(t.commission, 0, "a trade the broker never costed carries no cost");
  assert.equal(t.fees, 0);
  assert.equal(out.costs, undefined, "no cash history means no cost summary to report");
  assert.equal(t.pnl, 200);
});

test("the recorded total is what the trades picked up, and the rest is reported, not hidden", () => {
  const out = parse(FILLS_FILE, csv.parseCashHistoryCsv(cashFile([
    cashRow("Commission", "-2.00", "NQ", "01/05/2026 10:00:00"),
    cashRow("Commission", "-2.00", "NQ", "01/05/2026 10:05:00"),
    // Real money, stamped on no fill in this file.
    cashRow("Commission", "-5.00", "NQ", "03/05/2026 14:00:00"),
  ])));

  assert.equal(out.trades[0].commission, 4);
  assert.equal(out.costs.recorded, 4, "what the trade could claim");
  assert.equal(out.costs.charged, 9, "what the platform took in total");
  assert.deepEqual(out.costs.orphans, [{ date: "2026-03-05", amount: 5, contract: "NQ" }]);
  assert.ok(
    out.warnings.some((w) => /could not be tied to a trade/.test(w)),
    "the reader is told the bill did not fully land"
  );
});

test("a cost stamped for one account's fill does not reach another account", () => {
  // Same contract, one second apart — the money follows the stamp it was
  // written with, not the account that happens to be trading the same root.
  const file = [
    "Fill ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    "A1,01/05/2026 10:00:00,DEMOA,NQ,buy,1,20000",
    "A2,01/05/2026 10:05:00,DEMOA,NQ,sell,1,20010",
    "B1,01/05/2026 10:01:00,DEMOB,NQ,buy,1,20000",
    "B2,01/05/2026 10:06:00,DEMOB,NQ,sell,1,20010",
  ].join("\n");
  const out = parse(file, csv.parseCashHistoryCsv(cashFile([cashRow("Commission", "-5.00", "NQ", "01/05/2026 10:00:00")])));

  const byAccount = Object.fromEntries(out.trades.map((t) => [t.account, t.commission]));
  assert.deepEqual(byAccount, { DEMOA: 5, DEMOB: 0 }, "the cost landed on the fill it was stamped for");
  assert.equal(out.costs.recorded, 5);
});

// =============================================================================
// 3. ONE FILE, SEVERAL ACCOUNTS
// =============================================================================

/** One Orders report carrying a full round trip for each of two accounts. */
const TWO_ACCOUNTS = [
  "Status,Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  "Filled,A-1,01/05/2026 10:00:00,DEMOA,NQ,buy,1,20000",
  "Filled,A-2,01/05/2026 10:05:00,DEMOA,NQ,sell,1,20010",
  "Filled,B-1,01/05/2026 10:00:00,DEMOB,NQ,buy,1,20000",
  "Filled,B-2,01/05/2026 10:05:00,DEMOB,NQ,sell,1,20010",
].join("\n");

test("one file carrying two accounts keeps both labels through the gate and the parser", () => {
  assert.equal(csv.csvKind(TWO_ACCOUNTS), "orders", "one accepted file, two accounts in it");

  const out = parse(TWO_ACCOUNTS);
  assert.equal(out.trades.length, 2);
  assert.deepEqual(out.trades.map((t) => t.account).sort(), ["DEMOA", "DEMOB"]);

  // Identical in every other respect — same symbol, side, size, prices, instant.
  const shape = out.trades.map((t) => [t.symbol, t.direction, t.quantity, t.entryPrice, t.exitPrice, t.pnl]);
  assert.equal(new Set(shape.map(String)).size, 1, "the two trades really are indistinguishable except by account");

  assert.deepEqual(out.accountsSeen, [
    { name: "DEMOA", type: "demo" },
    { name: "DEMOB", type: "demo" },
  ]);
});

test("two accounts in one file group into exactly two detected accounts", () => {
  const trades = parse(TWO_ACCOUNTS).trades;
  const groups = batch.detectedAccounts([{ name: "March.csv", trades }]);

  assert.equal(groups.length, 2, "one group per account, not per file and not per row");
  assert.deepEqual(
    groups.map((g) => [g.name, g.tradeCount, g.firstDate, g.lastDate, g.files]),
    [
      ["DEMOA", 1, "2026-01-05", "2026-01-05", ["March.csv"]],
      ["DEMOB", 1, "2026-01-05", "2026-01-05", ["March.csv"]],
    ]
  );
});

test("identical trades in two accounts are not deduplicated", () => {
  const trades = parse(TWO_ACCOUNTS).trades;

  // Each account's trade answers to its own identities: its order id, and a
  // fallback that carries the account. Nothing here is a duplicate of anything.
  const idsFor = (t) => identity.importIdentities(t, resolve);
  assert.equal(
    idsFor(trades[0]).some((id) => idsFor(trades[1]).includes(id)),
    false,
    "the account is part of the identity, so two alike trades stay two trades"
  );

  const plan = batch.planBatch({
    files: [{ name: "March.csv", trades }],
    mapping: { DEMOA: "id-a", DEMOB: "id-b" },
    resolveAccount: resolve,
  });

  assert.equal(plan.detected, 2);
  assert.equal(plan.duplicates, 0, "matching symbol, direction, stamp, size and price is not a duplicate");
  assert.equal(plan.assigned, 2);
  assert.equal(plan.unassigned, 0);
  assert.equal(plan.detected, plan.duplicates + plan.assigned + plan.unassigned, "the receipt reconciles");
});

test("executions in two accounts never pair into one round trip", () => {
  // DEMOA buys and DEMOB sells the same contract in the same second. Read as
  // one account that is a closed round trip; read as two, it is two open ones.
  const file = [
    "Status,Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
    "Filled,X-1,01/05/2026 10:00:00,DEMOA,NQ,buy,1,20000",
    "Filled,X-2,01/05/2026 10:00:00,DEMOB,NQ,sell,1,20010",
  ].join("\n");

  const out = parse(file);
  assert.equal(out.trades.length, 0, "no round trip is invented across an account boundary");
  assert.equal(out.unpaired, 2, "both fills are reported as still open, not silently matched");
  assert.deepEqual(out.accountsSeen.map((a) => a.name), ["DEMOA", "DEMOB"]);
});

test("planning a batch writes nothing and mutates nothing", () => {
  // This is parser-and-planning proof only: the module is pure, and the
  // evidence for that is that the trades come back byte-identical.
  const trades = parse(TWO_ACCOUNTS).trades;
  const before = JSON.stringify(trades);

  const groups = batch.detectedAccounts([{ name: "March.csv", trades }]);
  const plan = batch.planBatch({
    files: [{ name: "March.csv", trades }],
    mapping: { DEMOA: "id-a", DEMOB: "id-b" },
    resolveAccount: resolve,
  });

  assert.equal(JSON.stringify(trades), before, "the parsed trades are untouched");
  assert.equal(groups.length, 2);
  assert.equal(plan.selected.length, 2);
  assert.equal(plan.selected[0].account, "DEMOA");
  assert.equal(plan.selected[1].account, "DEMOB");
});
