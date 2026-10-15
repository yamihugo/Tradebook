import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: [new URL("../src/csv.ts", import.meta.url).pathname],
  bundle: true, format: "esm", platform: "node", write: false,
});
const csv = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const header = '"Time","Symbol","Qty","Side","Order Type","Limit Price","Stop Price","Avg Price","Commission","Status"';
// Synthetic scaled-position export: same format, not a user's trading record.
const orders = (zone = "GMT+1") => [
  header,
  `"4/8/2026, 2:36:00 PM ${zone}","CME-Delayed:NQ","2","Sell","Market","","","21010","5","Filled"`,
  `"4/8/2026, 2:36:00 PM ${zone}","CME-Delayed:NQ","2","Sell","Limit","21020","","","","Cancelled (by trader)"`,
  `"4/8/2026, 2:31:26 PM ${zone}","CME-Delayed:NQ","1","Buy","Market","","","21002","2.5","Filled"`,
  `"4/8/2026, 2:29:35 PM ${zone}","CME-Delayed:NQ","1","Buy","Market","","","21000","2.5","Filled"`,
].join("\n");
const parse = (text) => csv.parseTradeovateCsv(text, [], { sourceZone: "Asia/Tokyo", journalZone: "Europe/Lisbon", systemSource: true });

test("TradeSea GMT+1 export passes the gate, pairs scale-ins and ignores a cancelled ticket", () => {
  const file = orders();
  assert.equal(csv.csvKind(file), "tradesea");
  const out = parse(file);
  assert.equal(out.skipped, 0);
  assert.equal(out.unfilled, 1);
  assert.equal(out.unpaired, 0);
  assert.equal(out.trades.length, 1);
  const trade = out.trades[0];
  assert.equal(trade.symbol, "NQ");
  assert.equal(trade.direction, "long");
  assert.equal(trade.quantity, 2);
  assert.equal(trade.entryPrice, 21001);
  assert.equal(trade.exitPrice, 21010);
  assert.equal(trade.pnl, 360);
  assert.equal(trade.entryInstant, "2026-04-08T13:29:35.000Z");
  assert.equal(trade.exitInstant, "2026-04-08T13:36:00.000Z");
  assert.equal(trade.entryTime, "14:29:35");
  assert.equal(trade.instantSource, "offset");
  assert.equal(trade.fills.length, 3);
});

for (const [zone, expected] of [
  ["GMT-5", "2026-04-08T19:29:35.000Z"],
  ["UTC+05:30", "2026-04-08T08:59:35.000Z"],
  ["GMT+0530", "2026-04-08T08:59:35.000Z"],
  ["UTC+0", "2026-04-08T14:29:35.000Z"],
]) {
  test(`TradeSea ${zone} is applied as a fixed offset`, () => {
    const out = parse(orders(zone));
    assert.equal(out.trades.length, 1);
    assert.equal(out.trades[0].entryInstant, expected);
  });
}
for (const zone of ["GMT+15", "UTC+14:30", "GMT+1garbage", "UTC+02:99"]) {
  test(`TradeSea rejects malformed or out-of-range zone ${zone}`, () => {
    assert.equal(parse(orders(zone)).trades.length, 0);
  });
}
