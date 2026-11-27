import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import path from "node:path";
const out=path.join(mkdtempSync(path.join(process.env.TMPDIR,"replay-honesty-")),"report.cjs");
buildSync({entryPoints:["src/lib/importReport.ts"],bundle:true,platform:"node",format:"cjs",outfile:out});
const report=createRequire(import.meta.url)(out);
test("Replay confirmation requires each new path and exact identity and facts",()=>{
 assert.equal(typeof report.confirmReplayWrites,"function");
 const a={id:"parsed-a",account:"Demo",dataSource:"replay",importKey:"replay:a",symbol:"ES",direction:"long",quantity:1,entryPrice:10,exitPrice:11,entryInstant:"x",exitInstant:"y",pnl:50,pnlPoints:1,commission:0,fees:0,costCoverage:{commission:true,fees:true}};
 const b={...a,id:"parsed-b",importKey:"replay:b",exitPrice:12};
 const old={...a,id:"old.md"}; const fresh={...a,id:"new.md"};
 assert.equal(report.confirmReplayWrites([a,b],["new.md"],[old,fresh]),1);
 assert.equal(report.confirmReplayWrites([a,b],["new.md","new2.md"],[old,fresh,{...b,id:"new2.md"}]),2);
 assert.equal(report.confirmReplayWrites([a,b],["new.md","new2.md"],[old,fresh,{...b,id:"new2.md",exitPrice:99}]),1);
});

test("Replay confirmation rejects changed or missing points and costs, while accepting exact known values",()=>{
 const expected={account:"Demo",dataSource:"replay",importKey:"replay:exact",symbol:"ES",direction:"long",quantity:1,entryPrice:10,exitPrice:11,pnl:50,pnlPoints:1,commission:0,fees:0};
 const note={...expected,id:"new.md",costCoverage:{commission:true,fees:true}};
 const confirm=(trade,actual)=>report.confirmReplayWrites([trade],["new.md"],[actual]);
 assert.equal(confirm(expected,note),1);
 assert.equal(confirm({...expected,pnlPoints:0,commission:2,fees:3},{...note,pnlPoints:0,commission:2,fees:3}),1);
 for (const change of [
  {pnlPoints:2},{pnlPoints:undefined},{commission:undefined},{fees:undefined},
  {commission:1},{fees:1},{costCoverage:undefined},
  {costCoverage:{commission:false,fees:true}},{costCoverage:{commission:true,fees:false}},
 ]) assert.equal(confirm(expected,{...note,...change}),0,JSON.stringify(change));
 for (const change of [{pnlPoints:undefined},{commission:undefined},{fees:undefined}, {costCoverage:{commission:false,fees:true}},{costCoverage:{commission:true,fees:false}}])
  assert.equal(confirm({...expected,...change},note),0,JSON.stringify(change));
});
