import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

/**
 * The TradeSea import, end to end through the real reader.
 *
 * TradeSea exports one file and it is an *orders* file: a flat list of tickets
 * with no order id, no fill id and no account column, its stamps comma-separated
 * with a zone abbreviation (`EDT`, `MEZ`), and its `Avg Price` cell — empty on
 * everything that never traded — the only thing that says which tickets filled.
 * So the journal has to name the file at the gate, read its columns, strip the
 * exchange prefix off its symbols, give its rows the one account label the
 * mapping screen can point at, and then pair them with the same round-trip logic
 * every other export already goes through.
 *
 * Synthetic export-shaped fixture: dates and prices are invented.
 * The original exports remain outside this repository and are tested locally.
 * Ten order rows, newest first: five `Filled`, five `Cancelled (by trader)`.
 * Inline canonical fixtures, like every other test in this project.
 */

const TRADESEA_HEADER =
  `"Time","Symbol","Qty","Side","Order Type","Limit Price","Stop Price","Avg Price","Commission","Status"`;

const TRADESEA = [
  TRADESEA_HEADER,
  `"4/8/2026, 10:10:05 AM EDT","CME:ES","2","Sell","Market","","","5824","3.5","Filled"`,
  `"4/8/2026, 10:09:05 AM EDT","CME:ES","2","Buy","Market","","","5824","3.5","Filled"`,
  `"4/8/2026, 10:04:42 AM EDT","CME:ES","2","Sell","Limit","5825.75","","5825.75","3.5","Filled"`,
  `"4/8/2026, 10:04:42 AM EDT","CME:ES","2","Sell","Stop","","5821.75","","","Cancelled (by trader)"`,
  `"4/8/2026, 10:03:39 AM EDT","CME:ES","2","Sell","Limit","5829.75","","","","Cancelled (by trader)"`,
  `"4/8/2026, 10:03:01 AM EDT","CME:ES","2","Buy","Market","","","5825.75","3.5","Filled"`,
  `"4/8/2026, 9:51:23 AM EDT","CME:ES","2","Sell","Limit","5828","","5828","3.5","Filled"`,
  `"4/8/2026, 9:47:30 AM EDT","CME:ES","2","Sell","Stop","","5829.5","","","Cancelled (by trader)"`,
  `"4/8/2026, 9:47:18 AM EDT","CME:ES","2","Sell","Stop","","5820.75","","","Cancelled (by trader)"`,
  `"4/8/2026, 9:47:07 AM EDT","CME:ES","2","Sell","Stop","","5824","","","Cancelled (by trader)"`,
].join("\n");

const result = await build({
  entryPoints: {
    csv: new URL("../src/csv.ts", import.meta.url).pathname,
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
const [csv, identity] = await Promise.all([loadBundle("csv"), loadBundle("identity")]);

// A fixed zone, handed in exactly as the import screen hands it: 8 April 2026
// is still on US summer time, so `EDT` is UTC−4 and every instant below is four
// hours later than its wall clock.
const NY = "America/New_York";
const ZONES = { sourceZone: NY, journalZone: NY };
const parse = (text, zones = ZONES) => csv.parseTradeovateCsv(text, [], zones);

// The two closed trades, oldest entry first (the reader's own order):
// short 5828 → 5825.75, then short 5825.75 → 5824.
const trades = (out) => out.trades;

// ------------------------------------------------------------------- the gate

test("the gate accepts the TradeSea orders export", () => {
  assert.equal(csv.csvKind(TRADESEA), "tradesea", "the file the import is built for is a file the gate lets in");
});

test("the gate still refuses the id-less fills file, and did not widen", () => {
  // The shape a fills export has when it names no execution: the same
  // symbol/side/qty/price columns, no id. It stays refused — a re-import could
  // not be told from the first — which is exactly why the TradeSea signature
  // asks for its own column names and for both ids to be *absent*.
  const generic = [
    "Fill Time,Account,Symbol,Side,Quantity,Price,Commission,Fees",
    "01/05/2026 10:00:00,TEST123,MNQ,Buy,4,21000,1.04,1.36",
    "01/05/2026 10:08:30,TEST123,MNQ,Sell,2,21010,0.52,0.68",
    "01/05/2026 10:12:00,TEST123,MNQ,Sell,2,21018,0.52,0.68",
  ].join("\n");
  assert.equal(csv.csvKind(generic), "unknown");
});

test("a TradeSea-shaped header that carries an order id is an Orders export, not a TradeSea one", () => {
  // The signature is exact in both directions: the moment a file names an order,
  // it is the report that is already read, and its id keeps being its identity.
  const withId = TRADESEA.replace(TRADESEA_HEADER, `"Order ID",${TRADESEA_HEADER}`);
  assert.equal(csv.csvKind(withId), "orders");
});

test("the existing Tradovate Orders export classifies exactly as before", () => {
  const ORDERS = [
    "orderId,Account,B/S,Contract,Product,Status,Quantity,Type,Limit Price,Stop Price,Filled Qty,Avg Fill Price,Fill Time,Timestamp",
    "ORD-1,DEMO1,Buy,NQU6,NQ,Filled,1,Limit,,,1,20000,01/05/2026 10:00:00,01/05/2026 09:59:50",
    "ORD-2,DEMO1,Sell,NQU6,NQ,Filled,1,Limit,,,1,20010,01/05/2026 10:05:00,01/05/2026 10:04:50",
  ].join("\n");
  assert.equal(csv.csvKind(ORDERS), "orders", "the gate did not move for Tradovate");

  const out = csv.parseTradeovateCsv(ORDERS, [], { sourceZone: "UTC", journalZone: "UTC" });
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].fillId, "ORD-1");
  assert.equal(out.trades[0].account, "DEMO1", "a file that names its account keeps it — no TradeSea label is added");
  assert.equal(out.trades[0].symbol, "NQ", "no colon, so nothing is stripped");
  assert.equal(out.trades[0].pnl, 200, "10 points on NQ at $20 a point");
});

// --------------------------------------------------------------- the two trades

test("the filled rows pair into two closed short ES trades of 2", () => {
  const out = parse(TRADESEA);
  assert.equal(out.trades.length, 2);
  assert.equal(out.skipped, 0, "nothing in this file is unreadable any more");
  for (const t of out.trades) {
    assert.equal(t.symbol, "ES", "CME: is stripped before rootSymbol, or ES is priced at $1 a point");
    assert.equal(t.direction, "short");
    assert.equal(t.quantity, 2);
    assert.equal(t.account, "TradeSea", "one fallback label, so the mapping screen has one row to point at");
    assert.equal(t.origin, "broker");
    assert.equal(t.date, "2026-04-08");
  }
  assert.deepEqual(
    out.accountsSeen.map((a) => a.name),
    ["TradeSea"],
    "a file with no account column still produces exactly one detected account"
  );
});

test("trade A: short 5828 → 5825.75, +2.25 points, $225 gross", () => {
  const [a] = trades(parse(TRADESEA));
  assert.equal(a.entryPrice, 5828);
  assert.equal(a.exitPrice, 5825.75);
  assert.equal(a.pnlPoints, 2.25);
  assert.equal(a.pnl, 225, "2.25 pts × $50 × 2 contracts — the file's prices, not the broker's report");
  assert.equal(a.commission, 0, "costs still come only from a Cash History");
  assert.equal(a.fees, 0);
  assert.equal(a.entryTime, "09:51:23");
  assert.equal(a.exitTime, "10:03:01");
  assert.equal(a.entryInstant, "2026-04-08T13:51:23.000Z");
  assert.equal(a.exitInstant, "2026-04-08T14:03:01.000Z");
  assert.equal(a.sourceZone, NY, "the zone the file stated for itself");
});

test("trade B: short 5825.75 → 5824, +1.75 points, $175 gross", () => {
  const [, b] = trades(parse(TRADESEA));
  assert.equal(b.entryPrice, 5825.75);
  assert.equal(b.exitPrice, 5824);
  assert.equal(b.pnlPoints, 1.75);
  assert.equal(b.pnl, 175);
  assert.equal(b.entryInstant, "2026-04-08T14:04:42.000Z");
  assert.equal(b.exitInstant, "2026-04-08T14:09:05.000Z");
});

test("the five cancelled tickets are unfilled orders, never trades", () => {
  const out = parse(TRADESEA);
  assert.equal(out.unfilled, 5, "four Sell Stop + one Sell Limit — the file's row count, not a guess");
  assert.equal(out.trades.length, 2);
  // The 9:47:07 ticket's stamp is on no trade, and 9:47:07 is unambiguous —
  // 10:04:42 is not usable here, because a filled row carries it too.
  const stamps = out.trades.flatMap((t) => [t.entryInstant, t.exitInstant]).map((s) => Date.parse(s));
  assert.ok(!stamps.includes(Date.parse("2026-04-08T13:47:07.000Z")));
});

test("the last sell is an unpaired open fill, not a third trade", () => {
  const out = parse(TRADESEA);
  assert.equal(out.unpaired, 1);
  assert.equal(out.trades.length, 2, "an unpaired fill is never rounded up into a round trip");
  assert.deepEqual(out.warnings, [], "a file that reads cleanly says nothing");
});

// ------------------------------------------------------------------- identity

test("both trades carry a deterministic identity, so a re-import dedupes", () => {
  // No order id and no fill id exist in the file, so identity falls to the
  // fallback key — which needs the entry instant, the reason the stamp reader
  // had to learn this dialect before any of this could be dedupable.
  const out = parse(TRADESEA);
  for (const t of out.trades) {
    assert.equal(identity.brokerIdentity(t), null, "the file names no fill id");
    const ids = identity.importIdentities(t);
    assert.equal(ids.length, 1);
    assert.ok(ids[0].startsWith("fallback:"), ids[0]);
    assert.ok(ids[0].includes("|ES|short|2|2026-04-08T"));
  }
});

// ------------------------------------------------------------------- the zone

test("the file's own zone wins over the zone the screen was given", () => {
  const out = parse(TRADESEA, { sourceZone: "UTC", journalZone: "UTC" });
  const [, b] = trades(out);
  assert.equal(
    b.entryInstant,
    "2026-04-08T14:04:42.000Z",
    "10:04:42 EDT is 14:04:42Z — the file's EDT, not the dropdown's UTC"
  );
});

// ---------------------------------------------------- what the file cannot say

test("the cancelled sell-side stops do not reach a short trade — today's rule, an open decision", () => {
  // Recorded, not endorsed. Every cancelled ticket in this file is a *sell*
  // stop or a sell limit, while the two trades pair as *short*, whose closing
  // side is a buy; `attachRecordedStops` reads the closing side only, so
  // nothing attaches and the file's only record of the risk is dropped. The
  // file alone cannot settle which is wrong — the pairing direction or the
  // side rule — so the reader keeps its rule and this test keeps the fact
  // visible. Do not "fix" it by widening the side rule without a decision.
  const out = parse(TRADESEA);
  for (const t of out.trades) {
    assert.equal(t.stopSource, undefined);
    assert.equal(t.stopLevels, undefined);
  }
  // What did happen to those tickets: they are order facts, counted as unfilled.
  assert.equal(out.unfilled, 5);
});

// ------------------------------------------- the screen's own default, in full

test("on the screen's default (systemSource true) a stamp that names its own zone keeps source-zone", () => {
  // The shape the import screen actually sends when the trader has not picked a
  // zone: `sourceZone` is this computer's and `systemSource` is true. A dated
  // stamp names its own zone, so neither may relabel the trade — the note must
  // not claim the computer's zone as the file's.
  const out = parse(TRADESEA, {
    sourceZone: "Europe/Lisbon",
    journalZone: "Europe/Lisbon",
    systemSource: true,
  });
  assert.equal(out.trades.length, 2);
  const [a, b] = out.trades;
  assert.equal(a.instantSource, "source-zone", "the file stated EDT; the screen's zone is not the source");
  assert.equal(a.sourceZone, NY, "the zone the file stated, not the dropdown");
  assert.equal(
    a.entryInstant,
    "2026-04-08T13:51:23.000Z",
    "09:51:23 EDT is the instant, whichever zone the screen holds"
  );
  assert.equal(b.instantSource, "source-zone");
  assert.equal(b.sourceZone, NY);
  assert.equal(b.entryInstant, "2026-04-08T14:04:42.000Z");
});

// ------------------------------------- an abbreviation the journal does not know

test("an unknown zone abbreviation is its own refusal, never 'no zone chosen'", () => {
  const out = parse(TRADESEA.replace(/EDT/g, "XYZ"));
  assert.equal(out.trades.length, 0, "a zone the journal cannot read is refused, not guessed");
  assert.equal(
    out.timeIssues.unknownZone,
    10,
    "every row names the unknown zone — the five filled and the five cancelled alike"
  );
  assert.equal(out.timeIssues.noZone, 0, "no row is told the file carried no zone — the file named one");
  assert.equal(out.unfilled, 0, "a cancelled ticket naming an unknown zone is that problem, not merely unfilled");
  assert.ok(
    out.warnings.some((w) => w.includes("does not know") && w.includes("XYZ")),
    `the receipt names the zone it could not read: ${JSON.stringify(out.warnings)}`
  );
  assert.ok(
    !out.warnings.some((w) => w.includes("carry no zone and none was chosen")),
    "and never offers a remedy that cannot help"
  );
});

test("a cancelled row with a known zone is still an unfilled order", () => {
  // The reorder is targeted: it lifts the unknown abbreviation out of the
  // unfilled count and changes nothing for a ticket whose clock reads fine.
  const rows = [
    TRADESEA_HEADER,
    `"4/8/2026, 9:47:30 AM EDT","CME:ES","2","Sell","Stop","","5829.5","","","Cancelled (by trader)"`,
  ].join("\n");
  const out = parse(rows);
  assert.equal(out.unfilled, 1);
  assert.equal(out.timeIssues, undefined, "a readable stamp leaves the time counts untouched");
});

test("a cancelled row with an unknown zone is a zone problem, not an unfilled order", () => {
  const rows = [
    TRADESEA_HEADER,
    `"4/8/2026, 9:47:30 AM XYZ","CME:ES","2","Sell","Stop","","5829.5","","","Cancelled (by trader)"`,
  ].join("\n");
  const out = parse(rows);
  assert.equal(out.unfilled, 0, "the ticket is not filed as merely unfilled");
  assert.equal(out.timeIssues.unknownZone, 1);
  assert.equal(out.timeIssues.noZone, 0);
});

// ------------------------------------------- a recognised file that holds nothing

test("a TradeSea file that yields no executions still says so", () => {
  // Every ticket cancelled: the header is still the TradeSea signature, so the
  // file is recognised — and an empty file must say it is empty. It is never
  // folded into "could not recognize this CSV" (a file the gate names), and it
  // is never announced as read-and-fine.
  const rows = [
    TRADESEA_HEADER,
    `"4/8/2026, 9:47:30 AM EDT","CME:ES","2","Sell","Stop","","5829.5","","","Cancelled (by trader)"`,
  ].join("\n");
  assert.equal(csv.csvKind(rows), "tradesea");
  const out = parse(rows);
  assert.equal(out.trades.length, 0);
  assert.equal(out.unfilled, 1);
  assert.ok(
    out.warnings.some((w) => w.includes("recognised but holds no executions")),
    `an empty but recognised TradeSea file must say so: ${JSON.stringify(out.warnings)}`
  );
});
