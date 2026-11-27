import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(mkdtempSync(path.join(process.env.TMPDIR, 'replay-writer-')), 'main.cjs');
await build({entryPoints:[path.join(root,'src/main.ts')],bundle:true,platform:'node',format:'cjs',outfile:out,loader:{'.png':'dataurl'},plugins:[{name:'obsidian',setup(b){
 b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},()=>({loader:'js',contents:`export class Modal {} export class Plugin {} export class ItemView {} export class PluginSettingTab {} export class Notice {} export class TFile {} export class TFolder {} export class Setting {} export class Menu {} export class MarkdownView {} export class FuzzySuggestModal {} export class SuggestModal {} export class Component {} export class View {} export class App {} export const normalizePath=x=>x, setIcon=()=>{}, addIcon=()=>{}, debounce=x=>x, requestUrl=()=>{}, apiVersion='1', Platform={}, MarkdownRenderer={};`}));
}}]});
const Plugin = createRequire(import.meta.url)(out).default;
const trade = n => ({date:'2026-11-12',symbol:'ES',account:'Demo',accountType:'demo',direction:'long',entryTime:`09:3${n}`,exitTime:'09:45',quantity:1,entryPrice:5000,exitPrice:5001,pnl:50,pnlPoints:1,commission:0,fees:0,dataSource:'replay',importKey:`replay:${n}`});
for (const createThenReject of [false,true]) test(`production writer reports confirmed paths when second create ${createThenReject?'creates then rejects':'rejects'}`,async()=>{
 const files=new Map(); let attempts=0; let reloaded=0;
 const vault={getAbstractFileByPath:p=>files.get(p),async createFolder(p){files.set(p,{path:p});},async create(p,content){attempts++; if(attempts===2){if(createThenReject) files.set(p,{path:p,content}); throw Error('synthetic failure');} files.set(p,{path:p,content});}};
 const plugin=Object.create(Plugin.prototype); plugin.app={vault}; plugin.settings={dateFormat:'YYYY-MM-DD'}; plugin.getTradesFolder=()=> 'synthetic'; plugin.reloadAllViews=async()=>{reloaded++;};
 const result=await plugin.storeReplayTrades([trade(0),trade(1)]);
 assert.equal(result.failed,true); assert.equal(result.paths.length,1); assert.ok(files.get(result.paths[0]).content.includes('pnl: 50'));
 assert.equal([...files.values()].filter(x=>x.content).length,createThenReject?2:1); assert.equal(attempts,2); assert.equal(reloaded,0);
});
