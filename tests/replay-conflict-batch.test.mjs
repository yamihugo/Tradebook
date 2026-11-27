import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'replay-conflict-')), 'batch.cjs');
await build({stdin:{contents:"export {parseTradingViewReplayCsv} from './src/lib/tradingViewReplay'; export {planBatch} from './src/lib/importBatch'; export {tradeToMarkdown,parseTradeFromMarkdown} from './src/storage';",resolveDir:root},bundle:true,platform:'node',format:'cjs',outfile:out,plugins:[{name:'host',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class TFile {} export const normalizePath = x => x; export const setIcon = () => {}'}));}}]});
const {parseTradingViewReplayCsv,planBatch,tradeToMarkdown,parseTradeFromMarkdown}=createRequire(import.meta.url)(out);
const header='Trade number,Type,Date and time,Signal,Price USD,Size (qty),Net PnL USD,Commission USD';
const parse=(exit='5001',net='50',zone='UTC',number='1',entry='2026-11-12 09:30:00')=>parseTradingViewReplayCsv([header,`${number},Entry long,${entry},Entry long,5000,1,0,0`,`${number},Exit long,2026-11-12 09:31:00,Exit long,${exit},1,${net},0`].join('\n'),'Replay_Trading_CME_MINI_ES1!_2026-11-12_d3cea.csv',{sourceZone:zone,journalZone:'UTC'}).trades[0];
const original=parse();
const existing={...original,account:'Demo',review:'keep this old note'};
const plan=(trade,account='demo')=>planBatch({files:[{name:'synthetic.csv',trades:[trade]}],existing:[existing],mapping:{'TradingView Replay':account},resolveAccount:()=> 'demo'});
test('Replay zero costs survive a saved-note roundtrip as proven zero',()=>{
  const saved=parseTradeFromMarkdown(tradeToMarkdown(existing));
  const p=planBatch({files:[{name:'file',trades:[parse()]}],existing:[saved],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'});
  assert.equal(p.duplicates,1); assert.equal(p.conflicts,0);
});
test('legacy Replay notes missing costs stay uncertain after a save',()=>{
  const markdown=tradeToMarkdown(existing).replace(/^commission:.*\n/m,'').replace(/^fees:.*\n/m,'');
  const legacy=parseTradeFromMarkdown(markdown);
  const saved=parseTradeFromMarkdown(tradeToMarkdown(legacy));
  assert.deepEqual(saved.costCoverage,{commission:false,fees:false});
  const p=planBatch({files:[{name:'file',trades:[parse()]}],existing:[saved],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'});
  assert.equal(p.conflicts,1); assert.equal(p.duplicates,0);
});
test('edited stored results and missing cost evidence are held',()=>{
  for (const edit of [{pnl:99},{pnlPoints:99},{commission:2},{fees:3},{costCoverage:{commission:false,fees:true}},{costCoverage:{commission:true,fees:false}}]) {
    const p=planBatch({files:[{name:'file',trades:[parse()]}],existing:[{...existing,...edit}],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'});
    assert.equal(p.conflicts,1,JSON.stringify(edit)); assert.equal(p.duplicates,0);
  }
});
test('same facts and resolved instants are duplicate',()=>{const p=plan(parse()); assert.equal(p.duplicates,1); assert.equal(p.conflicts,0); assert.equal(p.selected.length,0);});
test('changed exit is held as a conflict without modifying the original',()=>{const p=plan(parse('5002','100')); assert.equal(p.conflicts,1); assert.equal(p.duplicates,0); assert.equal(p.selected.length,0); assert.equal(existing.review,'keep this old note');});
test('same source times interpreted as different instants are conflict',()=>{const p=plan(parse('5001','50','America/Chicago')); assert.equal(p.conflicts,1); assert.equal(p.duplicates,0); assert.equal(p.selected.length,0);});
test('stored edited execution facts are held instead of silently skipped',()=>{
  const edited={...existing,entryPrice:4999};
  const p=planBatch({files:[{name:'file',trades:[parse()]}],existing:[edited],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'});
  assert.equal(p.conflicts,1); assert.equal(p.duplicates,0);
});
test('changed entry facts with the same source number are held',()=>{
  const changed={...parse(),quantity:2,importKey:parse().importKey.replace('|1|2026','|2|2026')};
  const p=plan(changed); assert.equal(p.conflicts,1); assert.equal(p.selected.length,0);
});
test('distinct mapped account and genuinely new entry remain importable',()=>{assert.equal(plan(parse(),'other').assigned,1); assert.equal(plan(parse('5001','50','UTC','2')).assigned,1);});
test('legacy missing or malformed keys hold potentially matching Replay trades',()=>{
  for (const importKey of [undefined, 'replay:broken', 'replay:ES|9|bad|1|x|y|5000|5001', 'replay:ES|9|long|NaN|x|y|5000|5001']) {
    const p=planBatch({files:[{name:'file',trades:[parse()]}],existing:[{...existing,importKey}],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'});
    assert.equal(p.conflicts,1); assert.equal(p.selected.length,0);
  }
});
for (const [name, changed] of [
  ['direction', {...original,direction:'short'}],
  ['timestamp', {...original,entryInstant:'2026-11-12T10:30:00.000Z'}],
  ['price', {...original,entryPrice:4999}],
  ['unresolved timestamp', {...original,timeUnresolved:true,entryInstant:undefined,exitInstant:undefined}],
]) test(`changed ${name} is held individually`,()=>{const p=plan(changed); assert.equal(p.conflicts,1); assert.equal(p.selected.length,0);});
test('multiple matches including a changed one are held',()=>{
  const p=planBatch({files:[{name:'file',trades:[parse()]}],existing:[existing,{...existing,entryPrice:4999}],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'});
  assert.equal(p.conflicts,1); assert.equal(p.selected.length,0);
});
test('previously scoped keys and in-batch conflicts retain their identities',()=>{
  const stored={...existing,importKey:`replay:demo:${original.importKey.slice(7)}`};
  const options={existing:[stored],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'};
  const old=planBatch({...options,files:[{name:'old',trades:[parse()]}]});
  assert.equal(old.duplicates,1); assert.equal(stored.importKey,`replay:demo:${original.importKey.slice(7)}`);
  const batch=planBatch({...options,existing:[],files:[{name:'first',trades:[parse()]},{name:'changed',trades:[parse('5002','100')]}]});
  assert.equal(batch.assigned,0); assert.equal(batch.conflicts,2); assert.equal(batch.detected,batch.assigned+batch.unassigned+batch.duplicates+batch.conflicts);
});

test('invalid encoded legacy timestamps are ambiguous rather than trusted',()=>{
  const malformed=original.importKey.replace('2026-11-12%2009%3A30%3A00','not-a-time');
  assert.notEqual(malformed,original.importKey);
  const p=planBatch({files:[{name:'file',trades:[parse('5001','50','UTC','2')]}],existing:[{...existing,importKey:malformed}],mapping:{'TradingView Replay':'demo'},resolveAccount:()=> 'demo'});
  assert.equal(p.conflicts,1); assert.equal(p.selected.length,0);
});
