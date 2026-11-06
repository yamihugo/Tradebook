import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: `export { default as Product } from './src/main'; export { TFile } from 'obsidian'; export { remapPrintReference } from './src/lib/renamePrintReferences';`, resolveDir: new URL('..',import.meta.url).pathname, loader:'ts' },
  bundle:true,write:false,format:'esm',platform:'node',loader:{'.png':'dataurl','.svg':'dataurl'},
  plugins:[{name:'isolated-rename-host',setup(b){
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'host'}));
    b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:`
      export class App {} export class Plugin {} export class PluginManifest {} export class ItemView {}
      export class Modal {} export class PluginSettingTab {} export class Setting {} export class Menu {}
      export class SuggestModal {} export class FuzzySuggestModal {} export class Component {} export class MarkdownRenderChild {}
      export class TFile { constructor(path) { this.path=path; } get name(){return this.path.split('/').pop();} get extension(){return this.name.split('.').pop();} get parent(){return {path:this.path.slice(0,this.path.lastIndexOf('/'))};} }
      export class TFolder {} export class Notice {}
      export const normalizePath=p=>p.replace(/\\\\/g,'/').replace(/\\/+/g,'/');
      export const setIcon=()=>{}; export const addIcon=()=>{}; export const debounce=fn=>fn; export const apiVersion='synthetic';
      export const moment=()=>{}; export const MarkdownRenderer={}; export const Platform={isDesktop:true,isMobile:false};
      export const requestUrl=()=>{throw Error('Network forbidden')};
    `}));
  }}]
});
const { Product,TFile,remapPrintReference }=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const oldBase='2026-11-06 MES LONG 1000', newBase='06-11-2026 MES LONG 1000';
const noteFrom=`Journal/2026/11/trades/${oldBase}.md`,noteTo=`Journal/2026/11/trades/${newBase}.md`;
const printDir='Journal/2026/attachments';
function fixture(options={}) {
  const files=new Map();const data={screenshot:`${oldBase} print.png`,screenshots:[{file:`${oldBase} print.png`,note:'Synthetic caption'},{file:`${printDir}/${oldBase} print 2-annotated.png`,note:'Second caption'}],unrelated:'untouched'};
  const note=new TFile(noteFrom);note.data=data;note.body='\nSynthetic body remains unchanged.\n';
  files.set(noteFrom,note);
  const moves=[' print.png',' print 2.png',' print 2.json',' print 2-annotated.png'].map(suffix=>({from:`${printDir}/${oldBase}${suffix}`,to:`${printDir}/${newBase}${suffix}`}));
  for(const move of moves)files.set(move.from,Object.assign(new TFile(move.from),{bytes:'synthetic-image-or-sidecar'}));
  const read=file=>`---\ndate: 2026-11-06\nsymbol: MES\ndirection: long\nentry_time: "10:00:00"\nscreenshot: ${JSON.stringify(file.data?.screenshot||'')}\nscreenshots:\n${(file.data?.screenshots||[]).map(s=>`  - file: ${JSON.stringify(s.file)}\n    note: ${JSON.stringify(s.note||'')}\n`).join('')}unrelated: untouched\n---\n${file.body||''}`;
  const move=async(file,to)=>{if(options.failMove===to)throw Error('synthetic move failure');assert.ok(!files.has(to),'never overwrite');files.delete(file.path);file.path=to;files.set(to,file);};
  const app={vault:{getFiles:()=>[...files.values()],getAbstractFileByPath:p=>files.get(p),cachedRead:async f=>read(f),read:async f=>read(f),rename:move,modify:async(file,text)=>{file.restored=text;}},fileManager:{renameFile:move,processFrontMatter:async(file,change)=>{if(options.failReferenceWrite)throw Error('synthetic reference-write failure');change(file.data);}}};
  const product=Object.create(Product.prototype);product.app=app;product.settings={tradesFolder:'Journal',dateFormat:'DD/MM/YYYY'};product.clearTradeCache=()=>{};product.reloadAllViews=async()=>{};
  const plan={items:[{from:noteFrom,to:noteTo,oldBase,newName:newBase,screenshot:data.screenshot,printMoves:moves}],skipped:0};
  return {product,files,data,note,moves,plan,read};
}

test('renaming prints updates every structured entry as well as the legacy scalar',async()=>{
 const f=fixture();const result=await f.product.applyFileRename(f.plan);
 assert.equal(result.renamed,1);assert.equal(result.prints,4);
 assert.equal(f.data.screenshot,`${newBase} print.png`);
 assert.equal(f.data.screenshots[0].file,`${newBase} print.png`);
 assert.equal(f.data.screenshots[1].file,`${printDir}/${newBase} print 2-annotated.png`);
 assert.equal(f.data.screenshots[0].note,'Synthetic caption');assert.equal(f.data.unrelated,'untouched');
 assert.equal(f.note.body,'\nSynthetic body remains unchanged.\n');
 for(const mv of f.moves){assert.ok(f.files.has(mv.to));assert.ok(!f.files.has(mv.from));}
});

test('stale rename plans with an occupied target leave the entire trade and print family untouched',async()=>{
 const f=fixture();f.files.set(f.moves[1].to,new TFile(f.moves[1].to));
 await f.product.applyFileRename(f.plan);
 assert.ok(f.files.has(noteFrom),'note must not be renamed for a stale plan');
 for(const mv of f.moves)assert.ok(f.files.has(mv.from),'source print family stays together');
});

test('reference-write failure does not leave moved prints behind broken references',async()=>{
 const f=fixture({failReferenceWrite:true});
 const result=await f.product.applyFileRename(f.plan);
 assert.equal(result.renamed,0);assert.equal(result.prints,0);assert.equal(result.skipped,1);
 assert.ok(f.files.has(noteFrom),'failed item rolls its note back');
 for(const mv of f.moves){assert.ok(f.files.has(mv.from));assert.ok(!f.files.has(mv.to));}
});

test('a mid-family move failure reverses earlier moves without overwriting files',async()=>{
 const f=fixture({failMove:`${printDir}/${newBase} print 2.json`});
 const result=await f.product.applyFileRename(f.plan);
 assert.equal(result.renamed,0);assert.equal(result.prints,0);
 assert.ok(f.files.has(noteFrom));
 for(const mv of f.moves){assert.ok(f.files.has(mv.from));assert.ok(!f.files.has(mv.to));}
});

test('structured screenshots update even when the legacy scalar is absent',async()=>{
 const f=fixture();delete f.data.screenshot;
 assert.equal((await f.product.applyFileRename(f.plan)).renamed,1);
 assert.equal(f.data.screenshots[0].file,`${newBase} print.png`);
});

test('reference mapping supports exact, relative and wiki targets without substring guesses',()=>{
 const f=fixture(),old=`${oldBase} print.png`,next=`${newBase} print.png`;
 for(const [before,after] of [[old,next],[`${printDir}/${old}`,`${printDir}/${next}`],[`../../attachments/${old}`,`../../attachments/${next}`],[`![[${old}|caption]]`,`![[${next}|caption]]`],[`Other/${old}`,`Other/${old}`],[`prefix ${old}`,`prefix ${old}`]])assert.equal(remapPrintReference(before,f.moves,noteTo),after);
});

test('legacy delimited scalar references retain their separators and update every moved file',async()=>{
 const f=fixture();f.data.screenshot=`${oldBase} print.png; ${printDir}/${oldBase} print 2-annotated.png`;
 assert.equal((await f.product.applyFileRename(f.plan)).renamed,1);
 assert.equal(f.data.screenshot,`${newBase} print.png; ${printDir}/${newBase} print 2-annotated.png`);
});

test('missing planned source skips the family before any rename',async()=>{
 const f=fixture();f.files.delete(f.moves[1].from);
 const result=await f.product.applyFileRename(f.plan);
 assert.equal(result.renamed,0);assert.equal(result.prints,0);assert.ok(f.files.has(noteFrom));
 assert.ok(f.files.has(f.moves[0].from));
});
