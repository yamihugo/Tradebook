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
  const read=file=>`---\ndate: ${file.meta?.date ?? "2026-11-06"}\nsymbol: ${file.meta?.symbol ?? "MES"}\ndirection: ${file.meta?.direction ?? "long"}\nentry_time: "${file.meta?.time ?? "10:00:00"}"\nscreenshot: ${JSON.stringify(file.data?.screenshot||'')}\nscreenshots:\n${(file.data?.screenshots||[]).map(s=>`  - file: ${JSON.stringify(s.file)}\n    note: ${JSON.stringify(s.note||'')}\n`).join('')}unrelated: untouched\n---\n${file.body||''}`;
  const move=async(file,to)=>{if(options.failMove===to)throw Error('synthetic move failure');assert.ok(!files.has(to),'never overwrite');files.delete(file.path);file.path=to;files.set(to,file);};
  const app={metadataCache:{resolvedLinks:{},unresolvedLinks:{}},vault:{getFiles:()=>[...files.values()],getAbstractFileByPath:p=>files.get(p),cachedRead:async f=>read(f),read:async f=>read(f),rename:move,modify:async(file,text)=>{file.restored=text;}},fileManager:{renameFile:move,processFrontMatter:async(file,change)=>{if(options.failReferenceWrite)throw Error('synthetic reference-write failure');change(file.data);}}};
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

test('rename planner leaves attachments from a similarly prefixed trade with their own note',async()=>{
 const f=fixture();
 const otherBase=`${oldBase} print 2 profile`,otherNotePath=`Journal/2026/11/trades/${otherBase}.md`,otherPrintPath=`${printDir}/${otherBase} print.png`;
 const otherNote=new TFile(otherNotePath);otherNote.metadata={date:'2026-11-06',symbol:'NQ',direction:'short',entryTime:'10:15:00'};otherNote.data={screenshot:`${otherBase} print.png`,screenshots:[{file:`${otherBase} print.png`,note:'Other trade print'}]};
 f.files.set(otherNotePath,otherNote);f.files.set(otherPrintPath,new TFile(otherPrintPath));
 const plan=await f.product.planFileRename();
 const current=plan.items.find(item=>item.from===noteFrom),other=plan.items.find(item=>item.from===otherNotePath);
 assert.ok(current);assert.ok(other);
 for(const move of f.moves)assert.ok(current.printMoves.some(planned=>planned.from===move.from),`referenced print family member is planned: ${move.from}`);
 assert.ok(!current.printMoves.some(move=>move.from===otherPrintPath),'prefix similarity alone must not claim another trade’s attachment');
 assert.ok(other.printMoves.some(move=>move.from===otherPrintPath),'the owning trade keeps its own print family');
});

test('rename planner skips a family referenced by another trade',async()=>{
 const f=fixture();
 const otherPath='Journal/2026/11/trades/2026-11-06 NQ SHORT 1015.md';
 const otherNote=new TFile(otherPath);otherNote.metadata={date:'2026-11-06',symbol:'NQ',direction:'short',entryTime:'10:15:00'};otherNote.data={screenshot:`${oldBase} print.png`,screenshots:[{file:`${oldBase} print.png`,note:'Shared print'}]};
 f.files.set(otherPath,otherNote);
 const plan=await f.product.planFileRename();
 assert.equal(plan.items.some(item=>item.from===noteFrom),false,'shared references keep the source trade and print family unchanged');
 assert.ok(plan.skipped>=1);
});

test('rename planner skips a whole note and print family if any destination collides',async()=>{
 const f=fixture();f.files.set(f.moves[1].to,new TFile(f.moves[1].to));
 const plan=await f.product.planFileRename();
 assert.equal(plan.items.some(item=>item.from===noteFrom),false,'no partial rename plan should be produced');
 assert.equal(plan.skipped,1);
});

test('missing planned source skips the family before any rename',async()=>{
 const f=fixture();f.files.delete(f.moves[1].from);
 const result=await f.product.applyFileRename(f.plan);
 assert.equal(result.renamed,0);assert.equal(result.prints,0);assert.ok(f.files.has(noteFrom));
 assert.ok(f.files.has(f.moves[0].from));
});


test('planner and apply preserve multi-digit print slots',async()=>{
 const f=fixture(); for(const n of [10,11,100]) { const name=`${oldBase} print ${n}.png`; f.files.set(`${printDir}/${name}`,new TFile(`${printDir}/${name}`)); f.data.screenshots.push({file:name,note:`slot ${n}`}); }
 const plan=await f.product.planFileRename(); const item=plan.items.find(x=>x.from===noteFrom); assert.ok(item);
 for(const n of [10,11,100]) assert.ok(item.printMoves.some(x=>x.from===`${printDir}/${oldBase} print ${n}.png`));
 await f.product.applyFileRename(plan); for(const n of [10,11,100]) { assert.ok(f.files.has(`${printDir}/${newBase} print ${n}.png`)); assert.ok(f.data.screenshots.some(x=>x.file===`${newBase} print ${n}.png`)); }
});
test('unreadable other markdown prevents potentially shared print moves',async()=>{
 const f=fixture(); const other=new TFile('Journal/2026/11/trades/unreadable.md'); f.files.set(other.path,other); const read=f.product.app.vault.cachedRead; f.product.app.vault.cachedRead=f.product.app.vault.read=async file=>{if(file===other)throw Error('synthetic unreadable');return read(file)};
 const plan=await f.product.planFileRename(); assert.equal(plan.items.some(x=>x.from===noteFrom),false);
});
test('a new shared reference after preview leaves the whole family unmoved',async()=>{
 const f=fixture(); const plan=await f.product.planFileRename(); assert.ok(plan.items.some(x=>x.from===noteFrom));
 const other=new TFile('Elsewhere/new-reference.md'); other.data={screenshot:`${oldBase} print.png`,screenshots:[]}; f.files.set(other.path,other); f.product.app.metadataCache.resolvedLinks[other.path]={[f.moves[0].from]:1};
 const result=await f.product.applyFileRename(plan);
 assert.equal(result.renamed,0); assert.ok(result.skipped>=1); assert.ok(f.files.has(noteFrom));
 for(const move of f.moves) assert.ok(f.files.has(move.from));
});

test('outside markdown referencing a print prevents its family moving',async()=>{
 const f=fixture(); const other=new TFile('Elsewhere/note.md'); other.data={screenshot:`${oldBase} print.png`,screenshots:[]}; f.files.set(other.path,other); f.product.app.metadataCache.resolvedLinks[other.path]={[f.moves[0].from]:1};
 const plan=await f.product.planFileRename(); assert.equal(plan.items.some(x=>x.from===noteFrom),false);
});

test('unavailable metadata skips print families',async()=>{ const f=fixture(); delete f.product.app.metadataCache; assert.equal((await f.product.planFileRename()).items.some(x=>x.from===noteFrom),false); });
test('encoded outside resolved link blocks family',async()=>{ const f=fixture(); const other=new TFile('Elsewhere/encoded.md'); f.files.set(other.path,other); f.product.app.metadataCache.resolvedLinks[other.path]={[f.moves[0].from]:1}; other.body='![x](2026-11-06%20MES%20LONG%201000%20print.png)'; assert.equal((await f.product.planFileRename()).items.some(x=>x.from===noteFrom),false); });
test('same basename resolved elsewhere does not claim family',async()=>{ const f=fixture(); const other=new TFile('Elsewhere/note.md'); f.files.set(other.path,other); f.product.app.metadataCache.resolvedLinks[other.path]={[`Elsewhere/${oldBase} print.png`]:1}; assert.ok((await f.product.planFileRename()).items.some(x=>x.from===noteFrom)); });
test('relevant unresolved link blocks family',async()=>{ const f=fixture(); f.product.app.metadataCache.unresolvedLinks['Elsewhere/note.md']={[`${oldBase} print.png`]:1}; assert.equal((await f.product.planFileRename()).items.some(x=>x.from===noteFrom),false); });

test('preview rejects changed naming inputs without moving note or attachments',async()=>{
 for(const [key,value] of [['symbol','NQ'],['direction','short'],['time','11:00:00'],['date','2026-11-07'],['format','YYYY-MM-DD']]) {
  const f=fixture(); const plan=await f.product.planFileRename(); assert.ok(plan.items.some(x=>x.from===noteFrom));
  if(key==='format') f.product.settings.dateFormat=value; else f.note.meta={[key]:value};
  const before=f.read(f.note); const result=await f.product.applyFileRename(plan);
  assert.equal(result.renamed,0,key); assert.equal(result.prints,0,key); assert.ok(result.skipped>=1,key);
  assert.equal(f.read(f.note),before,key); assert.ok(f.files.has(noteFrom),key); assert.ok(!f.files.has(noteTo),key);
  for(const move of f.moves){assert.ok(f.files.has(move.from),key); assert.ok(!f.files.has(move.to),key);}
 }
});

test('unchanged preview preserves collision suffix and renames its family',async()=>{
 const f=fixture(); const occupied=new TFile(noteTo); occupied.data={screenshots:[]}; f.files.set(noteTo,occupied);
 const plan=await f.product.planFileRename(); const item=plan.items.find(x=>x.from===noteFrom); assert.ok(item);
 assert.equal(item.to,noteTo.replace(/\.md$/,'_2.md'));
 const result=await f.product.applyFileRename(plan); assert.equal(result.renamed,1); assert.equal(result.prints,4);
 assert.ok(f.files.has(item.to)); assert.equal(f.files.get(noteTo),occupied);
 for(const move of item.printMoves){assert.ok(f.files.has(move.to)); assert.ok(!f.files.has(move.from));}
});
