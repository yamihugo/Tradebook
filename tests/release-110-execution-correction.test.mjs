import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:{manual:new URL('../src/lib/manualTradeFills.ts',import.meta.url).pathname,storage:new URL('../src/storage.ts',import.meta.url).pathname},bundle:true,format:'esm',platform:'browser',outdir:'bundle',write:false,plugins:[{name:'host',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'host'}));b.onLoad({filter:/.*/,namespace:'host'},()=>({contents:'export class App{};export class TFile{};export class TFolder{};export const normalizePath=x=>x;export const setIcon=()=>{};export const moment=()=>{};'}));}}]});
const load=name=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles.find(f=>f.path.endsWith('/'+name+'.js')).text).toString('base64'));
const [manual,storage]=await Promise.all(['manual','storage'].map(load));
const trade={id:'synthetic.md',date:'2026-11-05',entryTime:'10:00:00',exitTime:'10:02:00',symbol:'NQ',account:'Synthetic',accountType:'funded',direction:'long',quantity:4,entryPrice:20000,exitPrice:20010,pnl:800,pnlPoints:10,commission:2,fees:1,setup:'',mistake:'',review:'',thesis:'',screenshot:'',rating:0,origin:'manual',dataSource:'manual'};
test('manual execution correction persists fills and summary together, preserving unrelated text',async()=>{
 const original=manual.buildManualExitFills(trade,[{quantity:2,price:20010,time:'10:01:00'},{quantity:2,price:20020,time:'10:02:00'}]).trade;
 let text=storage.tradeToMarkdown(original)+'\nPrivate synthetic annotation\n';
 const app={vault:{process:async(_file,fn)=>{text=fn(text);}}};
 await storage.updateManualTradeExecutions(app,{},original,{quantity:4,entryPrice:20000,entryTime:'10:00:00'},[{quantity:1,price:20010,time:'10:01:00'},{quantity:3,price:20020,time:'10:02:00'}]);
 const reopened=storage.parseTradeFromMarkdown(text);
 assert.equal(reopened.quantity,4);assert.equal(reopened.exitPrice,20017.5);assert.equal(reopened.pnl,1400);assert.equal(reopened.fills.length,3);assert.equal(reopened.commission,2);assert.match(text,/Private synthetic annotation/);
});
test('imported, stale and invalid execution corrections reject without writing',async()=>{
 let text=storage.tradeToMarkdown(trade);const before=text;const app={vault:{process:async(_file,fn)=>{text=fn(text);}}};
 await assert.rejects(()=>storage.updateManualTradeExecutions(app,{}, {...trade,origin:'csv',dataSource:'tradovate'},{quantity:4,entryPrice:20000,entryTime:'10:00:00'},[{quantity:4,price:20010,time:'10:01:00'}]),/manual/i);
 assert.equal(text,before);
 await assert.rejects(()=>storage.updateManualTradeExecutions(app,{},trade,{quantity:4,entryPrice:20000,entryTime:'10:00:00'},[{quantity:3,price:20010,time:'10:01:00'}]),/quantity|quantities/i);
 assert.equal(text,before);
 const changed={...trade,entryPrice:20001};
 await assert.rejects(()=>storage.updateManualTradeExecutions(app,{},changed,{quantity:4,entryPrice:20000,entryTime:'10:00:00'},[{quantity:4,price:20010,time:'10:01:00'}]),/changed/i);
 assert.equal(text,before);
});
test('manual corrections retain recorded per-fill costs',async()=>{
 const original=manual.buildManualExitFills(trade,[{quantity:2,price:20010,time:'10:01:00'},{quantity:2,price:20020,time:'10:02:00'}]).trade;
 original.fills[1].fees=1;original.fills[2].fees=2;
 let text=storage.tradeToMarkdown(original);const app={vault:{process:async(_,fn)=>{text=fn(text);}}};
 await storage.updateManualTradeExecutions(app,{},original,{quantity:4,entryPrice:20000,entryTime:'10:00:00'},[{quantity:2,price:20011,time:'10:01:00'},{quantity:2,price:20021,time:'10:02:00'}]);
 const saved=storage.parseTradeFromMarkdown(text);assert.equal(saved.fills[1].fees,1);assert.equal(saved.fills[2].fees,2);
});
test('trade cost edits preserve fill costs and literal reflection text',async()=>{
 const original={...trade,commission:0,fees:0,fills:[{side:'buy',qty:4,price:20000,time:'10:00:00'},{side:'sell',qty:4,price:20010,time:'10:02:00',pnl:800,fees:2}]};
 let text=storage.tradeToMarkdown(original);const app={vault:{process:async(_,fn)=>{text=fn(text);}}};
 await storage.updateTradeFields(app,{}, {fees:'12',review_what_happened:'Risk $& is literal'});
 let saved=storage.parseTradeFromMarkdown(text);assert.equal(saved.fees,12);assert.equal(saved.fills[1].fees,2);assert.equal(saved.review_what_happened,'Risk $& is literal');
 await storage.updateTradeFields(app,{}, {review_what_happened:'Repeat $1 and $& literally'});
 saved=storage.parseTradeFromMarkdown(text);assert.equal(saved.review_what_happened,'Repeat $1 and $& literally');
});
