import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: [new URL("../src/csv.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const csv = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const header = '"Time","Symbol","Qty","Side","Order Type","Limit Price","Stop Price","Avg Price","Commission","Status"';
const orders = (zone = "GMT+1") => [
  header,
  `"01/15/2026, 10:00:00 ${zone}","ES","2","Sell","Market","","","4002.00","0","Filled"`,
  `"01/15/2026, 09:59:00 ${zone}","ES","1","Buy","Market","","","4001.00","0","Filled"`,
  `"01/15/2026, 09:58:00 ${zone}","ES","1","Buy","Market","","","4000.00","0","Filled"`,
].join("\n");
const parse = (text) => csv.parseTradeovateCsv(text, [], { sourceZone: "UTC", journalZone: "UTC" });

test("synthetic TradeSea GMT+1 export passes the gate and pairs scale-ins", () => {
  const file = orders();
  assert.equal(csv.csvKind(file), "tradesea");
  const out = parse(file);
  assert.equal(out.skipped, 0);
  assert.equal(out.unfilled, 0);
  assert.equal(out.unpaired, 0);
  assert.equal(out.trades.length, 1);
  const trade = out.trades[0];
  assert.equal(trade.symbol, "ES");
  assert.equal(trade.direction, "long");
  assert.equal(trade.quantity, 2);
  assert.equal(trade.entryPrice, 4000.5);
  assert.equal(trade.exitPrice, 4002);
  assert.equal(trade.pnl, 150);
  assert.equal(trade.entryInstant, "2026-01-15T08:58:00.000Z");
  assert.equal(trade.exitInstant, "2026-01-15T09:00:00.000Z");
  assert.equal(trade.entryTime, "08:58:00");
  assert.equal(trade.instantSource, "offset");
  assert.equal(trade.fills.length, 3);
});

for (const [zone, expected] of [
  ["GMT-5", "2026-01-15T14:58:00.000Z"],
  ["UTC+05:30", "2026-01-15T04:28:00.000Z"],
  ["GMT+0530", "2026-01-15T04:28:00.000Z"],
  ["UTC+0", "2026-01-15T09:58:00.000Z"],
]) {
  test(`synthetic TradeSea ${zone} stamp uses its explicit fixed offset`, () => {
    const out = parse(orders(zone));
    assert.equal(out.trades.length, 1);
    assert.equal(out.trades[0].entryInstant, expected);
    assert.equal(out.trades[0].instantSource, "offset");
  });
}

for (const zone of ["GMT+15", "UTC+14:30", "GMT+1garbage", "UTC+02:99"]) {
  test(`synthetic TradeSea rejects malformed or out-of-range zone ${zone}`, () => {
    const file = orders(zone);
    assert.equal(csv.csvKind(file), "tradesea");
    assert.equal(parse(file).trades.length, 0);
  });
}
