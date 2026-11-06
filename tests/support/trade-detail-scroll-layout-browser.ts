import { TradeDetailView } from "../../src/views/tradeDetailView";
import { TFile } from "obsidian";
import { parseTradeFromMarkdown } from "../../src/storage";

Object.assign(HTMLElement.prototype, {
  createEl(this: HTMLElement, tag: string, options: any = {}) { const e = document.createElement(tag); if (options.cls) e.className=options.cls; if(options.text)e.textContent=options.text;Object.entries(options.attr||{}).forEach(([k,v])=>e.setAttribute(k,String(v)));this.append(e);return e; },
  createDiv(this: HTMLElement, options: any={}) { return this.createEl("div",options); },
  createSpan(this: HTMLElement, options: any={}) { return this.createEl("span",options); },
  setText(this: HTMLElement, text: string) {this.textContent=text;},
  setAttr(this: HTMLElement,k:string,v:string){this.setAttribute(k,v);},
  setAttrs(this:HTMLElement,attrs:Record<string,string>){Object.entries(attrs).forEach(([k,v])=>this.setAttribute(k,v));},
  toggleClass(this:HTMLElement,k:string,on:boolean){this.classList.toggle(k,on);},
  addClass(this:HTMLElement,...names:string[]){this.classList.add(...names);},
  removeClass(this:HTMLElement,...names:string[]){this.classList.remove(...names);},
  empty(this:HTMLElement){this.replaceChildren();},
  setCssStyles(this:HTMLElement,styles:object){Object.assign(this.style,styles);},
  setCssProps(this:HTMLElement,styles:Record<string,string>){Object.entries(styles).forEach(([k,v])=>this.style.setProperty(k,v));},
});
const tick = (ms=60)=>new Promise(r=>setTimeout(r,ms));
const image = (n:number) => "data:image/svg+xml,"+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${n%2?1200:500}" height="${n%2?600:1000}"><rect width="100%" height="100%" fill="${n%2?'#224455':'#332244'}"/><text x="20" y="80" fill="white" font-size="40">Synthetic print ${n}</text></svg>`);
async function runDetailLayoutCases(width:number) {
  document.body.replaceChildren();
  const outer=document.body.createDiv({cls:"view-content"});
  const root=outer.createDiv();
  let content='---\nsymbol: MES\nside: long\ndate: 2026-11-06\ntime: "10:00:00"\nentry_price: 100\nexit_price: 101\nquantity: 1\npnl: 5\ncommission: 0\nfees: 0\n---\n';
  const file=Object.assign(new TFile(),{path:"synthetic-review.md",extension:"md"});
  const trade:any={...parseTradeFromMarkdown(content),id:file.path,symbol:'MES',direction:'long',side:'long',date:'2026-11-06',entryTime:'2026-11-06T10:00:00Z',exitTime:'2026-11-06T10:01:00Z',entryPrice:100,exitPrice:101,quantity:1,pnl:5,commission:0,fees:0,screenshots:Array.from({length:12},(_,i)=>({file:`synthetic-${i}.png`}))};
  const plugin:any={settings:{timeZone:'UTC',setups:['Synthetic'],propAccounts:[],reviewOptions:{psychology:['Focused'],mistakes:['Entered early']}},loadTrades:async()=>[trade],loadTradesExpanded:async()=>[trade],knownSetups:async()=>['Synthetic'],mappedAccount:()=>null};
  const app:any={vault:{getAbstractFileByPath:(p:string)=>p===file.path?file:null,process:async(_:unknown,change:(s:string)=>string)=>{content=change(content);},adapter:{exists:async()=>false}},metadataCache:{getFirstLinkpathDest:()=>null}};
  const view:any=new TradeDetailView({app,contentEl:root} as any,plugin);
  view.app=app;view.trade=trade;view.allTrades=[trade];view.index=0;view.setupOptions=['Synthetic'];
  view.resolveImage=(file:string)=>image(Number(file.match(/\d+/)?.[0]||0));
  view.resolveImageFile=()=>null;
  view.render();await tick();
  const failures:string[]=[];const checks:object[]=[];
  const check=(ok:boolean,label:string,detail:unknown)=>{checks.push({label,ok,detail});if(!ok)failures.push(`${width}: ${label} ${JSON.stringify(detail)}`);};
  const tiles=[...root.querySelectorAll<HTMLElement>('.tj-td-shot-thumb')];
  check(tiles.length===12,'twelve thumbnail tiles',tiles.length);
  for(const [i,tile] of tiles.entries()){
    const tr=tile.getBoundingClientRect(),show=tile.querySelector('button')!.getBoundingClientRect(),img=tile.querySelector('img')!.getBoundingClientRect(),label=tile.querySelector('.tj-td-shot-thumb-label')!.getBoundingClientRect();
    check(img.bottom<=tr.bottom+1 && label.bottom<=tr.bottom+1 && show.bottom<=tr.bottom+1,`tile ${i} contains its image and label`,{tileHeight:tr.height,imageBottom:img.bottom-tr.top,labelBottom:label.bottom-tr.top,showHeight:show.height});
  }
  for(let i=0;i<tiles.length-1;i++){
    const a=tiles[i].getBoundingClientRect(),b=tiles[i+1].getBoundingClientRect();
    check(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,`tiles ${i}/${i+1} do not overlap`,{a:a.toJSON(),b:b.toJSON()});
  }
  const left=root.querySelector<HTMLElement>('.tj-td-left')!;
  const main=root.querySelector<HTMLElement>('.tj-app-main')!;
  left.scrollTop=240;main.scrollTop=160;outer.scrollTop=80;
  const before={left:left.scrollTop,main:main.scrollTop,outer:outer.scrollTop};
  check(before.left>0||before.main>0||before.outer>0,'fixture has a scrollable review region',before);
  await view.refresh();await tick();
  const positions=()=>({left:root.querySelector<HTMLElement>('.tj-td-left')!.scrollTop,main:root.querySelector<HTMLElement>('.tj-app-main')!.scrollTop,outer:outer.scrollTop});
  const after=positions();
  check(JSON.stringify(before)===JSON.stringify(after),'same-trade background refresh retains all scroll regions',{before,after});
  for(const group of ['psychology','mistakes']) {
    const button=root.querySelector<HTMLButtonElement>(`[data-review-control="ack"][data-review-group="${group}"]`) || [...root.querySelectorAll<HTMLButtonElement>('.tj-td-ack')][group==='psychology'?0:1];
    check(!!button,`${group} control exists`,!!button);
    button?.click();await tick(1800);await view.refresh();await tick();
    check(JSON.stringify(before)===JSON.stringify(positions()),`${group} save followed by delayed refresh retains scroll`,{before,after:positions()});
  }
  // A new trade must not inherit a previous trade's nested scroll or stale rAF callbacks.
  view.render();
  view.trade={...trade,id:'synthetic-second.md'};
  view.render();await tick();
  check(root.querySelector<HTMLElement>('.tj-td-left')!.scrollTop===0,'trade switch resets the review rail',positions());
  await view.onClose();
  return {width,checks,failures};
}
Object.assign(window,{runDetailLayoutCases});
