import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const result = await build({
  entryPoints: Object.fromEntries(['fills', 'manual', 'storage'].map((name) => [name,
    new URL(name === 'manual' ? '../src/lib/manualTradeFills.ts' : name === 'fills' ? '../src/lib/fills.ts' : '../src/storage.ts', import.meta.url).pathname])),
  bundle: true, format: 'esm', platform: 'browser', outdir: 'bundle', write: false,
  plugins: [{ name: 'host', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export class App{};export class TFile{};export class TFolder{};export const normalizePath=x=>x;export const setIcon=()=>{};export const moment=()=>{};' }));
  } }],
});
const load = (name) => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles.find((file) => file.path.endsWith('/' + name + '.js')).text).toString('base64'));
const [fills, manual, storage] = await Promise.all(['fills', 'manual', 'storage'].map(load));
const trade = { id: 'synthetic.md', date: '2026-11-05', entryTime: '10:00:00', exitTime: '10:02:00', symbol: 'NQ', account: 'Synthetic', accountType: 'funded', direction: 'long', quantity: 4, entryPrice: 20000, exitPrice: 20010, pnl: 800, pnlPoints: 10, commission: 0, fees: 0, setup: '', mistake: '', review: '', thesis: '', screenshot: '', rating: 0, origin: 'manual', dataSource: 'manual' };
const labels = (trade) => { const set = fills.fillSet(trade); return set.exits.map((fill, index) => fills.fillLabel(fill, index, set, 20)); };
const buildTrade = (base, exits) => { const result = manual.buildManualExitFills(base, exits); assert.equal(result.ok, true, result.error); return result.trade; };

test('actual long exits automatically display TP and SL without manual classification', () => {
  const saved = buildTrade(trade, [{ quantity: 2, price: 20010, time: '10:01:00' }, { quantity: 2, price: 19990, time: '10:02:00' }]);
  assert.deepEqual(labels(saved), ['TP1', 'SL1']);
  assert.deepEqual(labels(storage.parseTradeFromMarkdown(storage.tradeToMarkdown(saved))), ['TP1', 'SL1']);
});

test('automatic short exits reverse price direction and preserve chronological TP numbering around BE', () => {
  const saved = buildTrade(tradeWith({ direction: 'short' }), [
    { quantity: 1, price: 19990, time: '10:01:00' }, { quantity: 1, price: 20000, time: '10:02:00' },
    { quantity: 1, price: 20010, time: '10:03:00' }, { quantity: 1, price: 19980, time: '10:04:00' },
  ]);
  assert.deepEqual(labels(saved), ['TP1', 'BE', 'SL1', 'TP2']);
});
function tradeWith(overrides) { return { ...trade, ...overrides }; }

test('older per-exit metadata is preserved without overriding automatic executed-result labels', () => {
  const saved = buildTrade(trade, [{ quantity: 2, price: 20010, time: '10:01:00', exitType: 'sl' }, { quantity: 2, price: 19990, time: '10:02:00', exitType: 'tp' }]);
  const reopened = storage.parseTradeFromMarkdown(storage.tradeToMarkdown({ ...saved, exit_reason: 'mixed/multiple reasons' }));
  assert.deepEqual(labels(reopened), ['TP1', 'SL1']);
  assert.equal(reopened.fills[1].exitTypeSource, 'manual');
});

test('flat actual execution is BE and a positive non-flat execution remains TP', () => {
  const saved = buildTrade(trade, [{ quantity: 2, price: 20000, time: '10:01:00' }, { quantity: 2, price: 20000.25, time: '10:02:00' }]);
  assert.deepEqual(labels(saved), ['BE', 'TP1']);
  assert.equal(manual.buildManualExitFills(trade, [{ quantity: 2, price: 20010, time: '10:01:00', exitType: 'be' }, { quantity: 2, price: 20000, time: '10:02:00' }]).ok, false);
});

test('single-exit records classify automatically before costs without rewriting trade data', () => {
  for (const [exitPrice, pnl, expected] of [[20010, 800, 'TP1'], [19990, -800, 'SL1'], [20000, 0, 'BE']]) {
    const original = tradeWith({ exitPrice, pnl, fees: 1000, commission: 1000 });
    const snapshot = JSON.stringify(original);
    assert.deepEqual(labels(original), [expected]);
    assert.equal(JSON.stringify(original), snapshot);
  }
});

test('imported fills classify automatically too; flat exits do not consume TP numbers', () => {
  const saved = buildTrade(trade, [{ quantity: 1, price: 20000, time: '10:01:00' }, { quantity: 1, price: 20005, time: '10:02:00' }, { quantity: 2, price: 20010, time: '10:03:00' }]);
  const imported = { ...saved, origin: 'import', dataSource: 'tradovate' };
  const before = JSON.stringify(imported);
  assert.deepEqual(labels(imported), ['BE', 'TP1', 'TP2']);
  assert.equal(JSON.stringify(imported), before);
});

test('Trade Detail has no added execution-correction panel; Manual Add Trade asks only for actual exits', () => {
  const detail = readFileSync(new URL('../src/views/tradeDetailView.ts', import.meta.url), 'utf8');
  const add = readFileSync(new URL('../src/views/addTradePanel.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(detail, /renderManualExecutionCorrection|Correct manual executions|Exit type unknown/);
  assert.doesNotMatch(add, /Type unknown|choose TP, SL or BE|draft\.exitType|Exit type unknown/);
  assert.match(add, /Actual exits/);
  assert.match(add, /buildManualExitFills/);
});
