import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const result = await build({ entryPoints: [new URL('../src/csv.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const csv = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const canonical = ['Time','Symbol','Qty','Side','Order Type','Limit Price','Stop Price','Avg Price','Commission','Status'];
const rows = [
 '"1/8/2026, 10:00:00 AM EDT","CME:ES","2","Buy","Market","","","5800","3.5","Filled"',
 '"1/8/2026, 10:05:00 AM EDT","CME:ES","2","Sell","Limit","5802","","5802","3.5","Filled"',
];
const fixture = (headers) => [headers.map(h => JSON.stringify(h)).join(','), ...rows].join('\n');
const parse = (headers) => csv.parseTradeovateCsv(fixture(headers), [], { sourceZone: 'America/New_York', journalZone: 'America/New_York' });
test('the host-reproduced mixed-case TradeSea export parses the complete trade, not just the header', () => {
 const headers = ['tImE','symbol','qty','side','order type','limit price','stop price','avg price','commission','status'];
 assert.equal(csv.csvKind(fixture(headers)), 'tradesea');
 const out = parse(headers);
 assert.equal(out.trades.length, 1);
 assert.equal(out.trades[0].symbol, 'ES');
 assert.equal(out.trades[0].pnl, 200);
 assert.deepEqual(out, parse(canonical));
});
for (const [label, headers] of [
 ['lowercase', canonical.map(h => h.toLowerCase())],
 ['uppercase', canonical.map(h => h.toUpperCase())],
 ...canonical.map((_, index) => [`column ${index + 1}`, canonical.map((h, i) => i === index ? h.toUpperCase() : h)]),
]) {
 test(`TradeSea ${label} headers preserve the complete canonical result`, () => {
  assert.deepEqual(parse(headers), parse(canonical));
 });
}
test('case normalization preserves cancelled-ticket handling and planned metadata', () => {
 const cancelled = '"1/8/2026, 9:59:00 AM EDT","CME:ES","2","Sell","Stop","","5799","","","Cancelled (by trader)"';
 const withCancelled = (headers) => [fixture(headers), cancelled].join('\n');
 const read = (headers) => csv.parseTradeovateCsv(withCancelled(headers), [], { sourceZone: 'America/New_York', journalZone: 'America/New_York' });
 const actual = read(canonical.map(h => h.toLowerCase()));
 assert.equal(actual.trades.length, 1);
 assert.equal(actual.trades[0].pnl, 200);
 assert.deepEqual(actual, read(canonical));
});
