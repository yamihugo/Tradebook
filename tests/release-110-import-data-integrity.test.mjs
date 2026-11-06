import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Public CSV -> trade -> Markdown -> reload seams; only the Obsidian host is synthetic.
const result = await build({
  entryPoints: { csv: new URL('../src/csv.ts', import.meta.url).pathname, storage: new URL('../src/storage.ts', import.meta.url).pathname },
  bundle: true, format: 'esm', platform: 'browser', outdir: 'bundle', write: false,
  plugins: [{ name: 'synthetic-host', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export class App{};export class TFile{};export class TFolder{};export const normalizePath=x=>x;export const setIcon=()=>{};' }));
  } }],
});
const load = n => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles.find(f => f.path.endsWith('/' + n + '.js')).text).toString('base64'));
const [csv, storage] = await Promise.all(['csv', 'storage'].map(load));
const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
const header = 'Status,Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price,Order Type';
const row = (side, qty, price, type = 'Market', minute = '00') => ['Filled', side + minute, `2026-01-05 10:${minute}:00`, 'SYNTHETIC', 'ES', side, qty, price, type].map(cell).join(',');
const fixture = (price = '100', qty = '1', type = 'Market') => [header, row('buy', qty, price, type), row('sell', '1', '101', 'Market', '01')].join('\n');
const parse = text => csv.parseTradeovateCsv(text, [], { sourceZone: 'UTC', journalZone: 'UTC' });

test('R1 malformed nonempty execution price is rejected and counted, never fabricated as zero', () => {
  const out = parse(fixture('SENTINEL'));
  assert.equal(out.skipped, 1);
  assert.equal(out.trades.length, 0);
});

test('R2 CSV quote and backslash survive valid YAML scalar serialization and public reload', () => {
  const sentinel = 'SENTINEL"BROKEN\\n: harmless';
  const imported = parse(fixture('100', '1', sentinel)).trades[0];
  assert.ok(imported);
  const markdown = storage.tradeToMarkdown(imported);
  const scalar = markdown.match(/^order_type: (.*)$/m)[1];
  // quoteYaml emits JSON-compatible double-quoted YAML: use the real decoder, not an escape mock.
  assert.equal(JSON.parse(scalar), sentinel);
  assert.equal(storage.parseTradeFromMarkdown(markdown).orderType, sentinel);
});

for (const bad of ['NaN', 'Infinity', '-Infinity', '100junk', '1e3', '0x10', '1,00', '1.2.3', '--1', '$', '9'.repeat(400)]) {
  test(`R1 rejects and counts malformed/nonfinite execution price ${bad.slice(0, 24)}`, () => {
    const out = parse(fixture(bad));
    assert.equal(out.skipped, 1);
    assert.equal(out.trades.length, 0);
  });
}
for (const bad of ['0', '-1', '0.5', '1.5', 'NaN', 'Infinity', '1tail', '1,00', '9007199254740993']) {
  test(`R1 requires positive integral representable execution quantity: ${bad}`, () => {
    const out = parse(fixture('100', bad));
    assert.equal(out.skipped, 1);
    assert.equal(out.trades.length, 0);
  });
}
for (const [raw, expected] of [['0', 0], ['-1.25', -1.25], ['+100.50', 100.5], ['$1,000.25', 1000.25], ['-$1,000.25', -1000.25], ['$-1,000.25', -1000.25], ['.5', 0.5]]) {
  test(`R1 preserves complete finite execution price ${raw}`, () => {
    const out = parse(fixture(raw));
    assert.equal(out.skipped, 0);
    assert.equal(out.trades[0].entryPrice, expected);
  });
}
test('standard futures pair retains exact prices, quantity and P&L', () => {
  const out = parse(fixture('100', '+1.0'));
  assert.equal(out.skipped, 0);
  assert.equal(out.trades[0].quantity, 1);
  assert.equal(out.trades[0].entryPrice, 100);
  assert.equal(out.trades[0].exitPrice, 101);
  assert.equal(out.trades[0].pnl, 50);
  assert.equal(csv.csvKind(fixture()), 'orders');
});
test('malformed authoritative price does not fall back to a valid lower-priority Price cell', () => {
  const text = fixture('100junk').split('\n').map((line, i) => line + (i === 0 ? ',Price' : ',100')).join('\n');
  const out = parse(text);
  assert.equal(out.skipped, 1);
  assert.equal(out.trades.length, 0);
});
test('cancelled unfilled order retains planned stop metadata without becoming an execution', () => {
  const text = fixture() + '\n' + ['Cancelled', 'STOP', '2026-01-05 10:00:30', 'SYNTHETIC', 'ES', 'sell', '', '', 'Stop'].map(cell).join(',');
  const withStop = text.split('\n').map((line, i) => line + (i === 0 ? ',Stop Price' : i === 3 ? ',95' : ',')).join('\n');
  const out = parse(withStop);
  assert.equal(out.skipped, 0);
  assert.equal(out.unfilled, 1);
  assert.equal(out.trades.length, 1);
  assert.equal(out.trades[0].recordedOrderFacts.find(fact => fact.orderId === 'STOP').stopPrice, 95);
});
test('R2 actual newline and colon sentinel round-trips through supported Markdown seam', () => {
  const trade = parse(fixture()).trades[0];
  const sentinel = 'Synthetic: harmless\nnot_a_key: "quoted"\\tail';
  const markdown = storage.tradeToMarkdown({ ...trade, orderType: sentinel });
  assert.equal(JSON.parse(markdown.match(/^order_type: (.*)$/m)[1]), sentinel);
  assert.equal(storage.parseTradeFromMarkdown(markdown).orderType, sentinel);
});
test('R2 quoted order types on imported partial exits remain valid YAML and round-trip', () => {
  const sentinel = 'SENTINEL"quoted\\tail';
  const text = [header, row('buy', '2', '100'), row('sell', '1', '101', sentinel, '01'), row('sell', '1', '102', sentinel, '02')].join('\n');
  const imported = parse(text).trades[0];
  assert.ok(imported.fills.length >= 2);
  assert.ok(imported.fills.some(fill => fill.orderType === sentinel));
  const markdown = storage.tradeToMarkdown(imported);
  const scalars = [...markdown.matchAll(/^    order_type: (.*)$/gm)].map(match => JSON.parse(match[1]));
  assert.ok(scalars.includes(sentinel));
  assert.deepEqual(storage.parseTradeFromMarkdown(markdown).fills.map(fill => fill.orderType), imported.fills.map(fill => fill.orderType));
});
test('R2 nested fill text with an actual newline stays a scalar after save and reload', () => {
  const sentinel = 'Synthetic: harmless\nnot_a_key: "quoted"\\tail';
  const imported = parse(fixture()).trades[0];
  const trade = { ...imported, fills: [{ side: 'sell', time: '10:01:00', qty: 1, price: 101, orderType: sentinel }] };
  const markdown = storage.tradeToMarkdown(trade);
  assert.equal(JSON.parse(markdown.match(/^    order_type: (.*)$/m)[1]), sentinel);
  assert.equal(storage.parseTradeFromMarkdown(markdown).fills[0].orderType, sentinel);
});
test('valid zero execution prices remain zero in generated Entry and Exit summaries', () => {
  const imported = parse(fixture('0')).trades[0];
  const markdown = storage.tradeToMarkdown({ ...imported, exitPrice: 0 });
  assert.match(markdown, /^\| Entry \| 0 @ /m);
  assert.match(markdown, /^\| Exit \| 0 @ /m);
  const reloaded = storage.parseTradeFromMarkdown(markdown);
  assert.equal(reloaded.entryPrice, 0);
  assert.equal(reloaded.exitPrice, 0);
});
