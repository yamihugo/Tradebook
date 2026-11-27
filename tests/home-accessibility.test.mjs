import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installElementHelpers, loadAnalyticsView, syntheticAnalyticsPlugin } from './support/analytics-view-host.mjs';

test('rendered Home metric exposes its existing scope on focus without a native tooltip', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(dom.window);
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({ app: {} }, syntheticAnalyticsPlugin());
  const descriptions = [];
  for (const [id, name] of [['m.besthour', 'Best Hour'], ['m.worsthour', 'Worst Hour'], ['m.sharpe', 'Sharpe Ratio'], ['m.besthour', 'Best Hour']]) {
    const host = document.createElement('div'); document.body.append(host);
    home.renderMetricBody(host, [], id);
    const label = host.querySelector('.tj-metric-label');
    assert.ok(label.textContent.startsWith(name));
    assert.equal(label.tabIndex, 0, `${name} must be keyboard focusable`);
    assert.equal(label.hasAttribute('aria-label'), false);
    assert.equal(label.hasAttribute('title'), false);
    const descId = label.getAttribute('aria-describedby');
    assert.ok(descId, `${name} has an accessible description`);
    const desc = document.getElementById(descId);
    assert.ok(desc && desc.classList.contains('tj-sr-only'));
    assert.match(desc.textContent, /per decision/);
    assert.ok(!descriptions.includes(descId), 'descriptions are unique across rendered instances');
    descriptions.push(descId);
    label.focus();
    assert.equal(document.activeElement, label);
    assert.equal(document.querySelectorAll('.tj-tip').length, 1);
    assert.match(document.querySelector('.tj-tip').textContent, /per decision/);
    label.blur();
    assert.equal(document.querySelectorAll('.tj-tip').length, 0);
  }
  dom.window.close();
});

test('Home tooltip remains reachable during slow gap traversal and dismisses away', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = window.document; global.HTMLElement = window.HTMLElement;
  installElementHelpers(window);
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({ app: {} }, syntheticAnalyticsPlugin());
  const host = document.createElement('div'); document.body.append(host);
  home.renderMetricBody(host, [], 'm.sharpe');
  const label = host.querySelector('.tj-metric-label');
  label.getBoundingClientRect = () => ({ left: 100, right: 200, top: 100, bottom: 120 });
  const mouse = (target, type, x, y) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  mouse(label, 'mouseenter', 150, 110);
  const tip = document.querySelector('.tj-tip');
  assert.ok(tip);
  tip.getBoundingClientRect = () => ({ left: 162, right: 282, top: 28, bottom: 98 });
  mouse(label, 'mouseleave', 150, 100);
  mouse(document.body, 'mousemove', 165, 99);
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.equal(document.querySelector('.tj-tip'), tip, 'slow movement through the gap must not dismiss');
  mouse(tip, 'mouseenter', 166, 97);
  mouse(tip, 'mouseleave', 150, 60);
  mouse(document.body, 'mousemove', 150, 60);
  assert.equal(document.querySelector('.tj-tip'), null, 'outside the travel corridor dismisses even inside its bounding box');
  dom.window.close();
});

test('Home focus tooltip stays inside viewport at edges and Escape dismisses it', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = window.document; global.HTMLElement = window.HTMLElement;
  installElementHelpers(window);
  Object.defineProperty(window, 'innerWidth', { value: 320 });
  Object.defineProperty(window, 'innerHeight', { value: 200 });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return this.classList.contains('tj-tip') ? 120 : 0; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return this.classList.contains('tj-tip') ? 60 : 0; } });
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({ app: {} }, syntheticAnalyticsPlugin());
  const host = document.createElement('div'); document.body.append(host);
  home.renderMetricBody(host, [], 'm.sharpe');
  const label = host.querySelector('.tj-metric-label');
  for (const rect of [{left: 300, right: 320, top: 180, bottom: 198}, {left: 0, right: 20, top: 0, bottom: 20}]) {
    label.getBoundingClientRect = () => rect;
    label.focus();
    const tip = document.querySelector('.tj-tip');
    assert.ok(tip);
    const left = parseFloat(tip.style.left), top = parseFloat(tip.style.top);
    assert.ok(left >= 0 && left + 120 <= 320, `horizontal position ${left}`);
    assert.ok(top >= 0 && top + 60 <= 200, `vertical position ${top}`);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(document.querySelector('.tj-tip'), null);
    label.blur();
  }
  dom.window.close();
});

test('Home tooltips switch hovered anchors but preserve a focused anchor', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = window.document; global.HTMLElement = window.HTMLElement;
  installElementHelpers(window);
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({ app: {} }, syntheticAnalyticsPlugin());
  const host = document.createElement('div'); document.body.append(host);
  home.renderMetricBody(host, [], 'm.besthour');
  home.renderMetricBody(host, [], 'm.sharpe');
  const [first, second] = host.querySelectorAll('.tj-metric-label');
  const enter = el => el.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true, clientX: 50, clientY: 50 }));
  enter(first);
  const original = document.querySelector('.tj-tip');
  assert.ok(original);
  enter(second);
  assert.notEqual(document.querySelector('.tj-tip'), original);
  assert.equal(document.querySelectorAll('.tj-tip').length, 1);
  first.focus();
  const focused = document.querySelector('.tj-tip');
  enter(second);
  document.body.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 300 }));
  assert.equal(document.querySelector('.tj-tip'), focused);
  first.blur();
  assert.equal(document.querySelector('.tj-tip'), null);
  dom.window.close();
});

test('attached and direct hover tips stay within a small viewport after flipping', async () => {
  const dom = new JSDOM('<!doctype html><body><button></button></body>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = window.document; global.HTMLElement = window.HTMLElement;
  installElementHelpers(window);
  Object.defineProperty(window, 'innerWidth', { value: 320 });
  Object.defineProperty(window, 'innerHeight', { value: 200 });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return this.classList.contains('tj-tip') ? 200 : 0; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return this.classList.contains('tj-tip') ? 120 : 0; } });
  const { build } = await import('esbuild');
  const result = await build({ entryPoints: ['src/lib/tip.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
  const tips = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const anchor = document.querySelector('button');
  tips.attachTip(anchor, { title: 'Example' });
  const event = new window.MouseEvent('mouseenter', { clientX: 160, clientY: 100 });
  anchor.dispatchEvent(event);
  const check = () => {
    const tip = document.querySelector('.tj-tip');
    assert.ok(tip);
    const x = parseFloat(tip.style.left), y = parseFloat(tip.style.top);
    assert.ok(x >= 0 && x + 200 <= 320, `horizontal ${x}`);
    assert.ok(y >= 0 && y + 120 <= 200, `vertical ${y}`);
  };
  check();
  tips.killTip();
  tips.showTip({ title: 'Direct' });
  tips.moveTip(event);
  check();
  tips.killTip();
  dom.window.close();
});

test('Focus heading, ring and action expose their explanations to keyboard users', async () => {
  const dom = new JSDOM('<!doctype html><body><header><h3>Focus Areas</h3></header><main></main></body>', {pretendToBeVisual:true});
  global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(window);
  window.HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
  window.HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({app:{}}, syntheticAnalyticsPlugin());
  const trade = {id:'synthetic',date:'2026-01-01',symbol:'TEST',account:'Example',direction:'long',quantity:1,entryPrice:100,exitPrice:101,pnl:1};
  home.trades = [trade];
  home.renderFocusAreasWidget(document.querySelector('main'), [trade], document.querySelector('header'));
  for (const el of [document.querySelector('h3'), document.querySelector('.tj-focus-ring'), document.querySelector('[data-flag="nostop"]')]) {
    assert.equal(el.tabIndex, 0);
    const id = el.getAttribute('aria-describedby');
    assert.ok(id && document.getElementById(id)?.textContent, 'accessible description');
    assert.equal(el.hasAttribute('aria-label'), false);
  }
  assert.match(document.getElementById(document.querySelector('[data-flag="nostop"]').getAttribute('aria-describedby')).textContent, /stop price/i);
  dom.window.close();
});


test('overflowing focused tooltip remains open when keyboard focus enters it', async () => {
  const dom = new JSDOM('<!doctype html><body><button>Help</button></body>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = window.document; global.HTMLElement = window.HTMLElement;
  installElementHelpers(window);
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {get() { return this.classList.contains('tj-tip') ? 400 : 0; }});
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {get() { return this.classList.contains('tj-tip') ? 100 : 0; }});
  const { build } = await import('esbuild');
  const result = await build({entryPoints:['src/lib/tip.ts'], bundle:true, write:false, platform:'node', format:'esm'});
  const tips = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const anchor = document.querySelector('button'); tips.attachTip(anchor, {sub:'Long explanation'}); anchor.focus();
  const tip = document.querySelector('.tj-tip');
  assert.equal(tip.tabIndex, 0, 'overflowing content must be keyboard focusable');
  tip.focus(); assert.equal(document.activeElement, tip); assert.ok(tip.isConnected, 'focus transfer must keep it open');
  tip.blur(); assert.equal(document.querySelector('.tj-tip'), null);
  dom.window.close();
});


test('Escape from an overflow tooltip restores focus without reopening it', async () => {
  const dom = new JSDOM('<!doctype html><body><button>Help</button></body>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = window.document; global.HTMLElement = window.HTMLElement;
  installElementHelpers(window);
  Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', {get() { return this.classList.contains('tj-tip') ? 400 : 0; }});
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {get() { return this.classList.contains('tj-tip') ? 100 : 0; }});
  const { build } = await import('esbuild');
  const result = await build({entryPoints:['src/lib/tip.ts'], bundle:true, write:false, platform:'node', format:'esm'});
  const tips = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#escape-focus`);
  const anchor = document.querySelector('button');
  tips.attachTip(anchor, {sub:'Long explanation'});
  anchor.focus();
  const tip = document.querySelector('.tj-tip');
  assert.equal(tip.tabIndex, 0);
  anchor.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
  assert.equal(document.activeElement, tip);
  // Browsers blur a focused node synchronously during removal; jsdom does not.
  // Emulate that lifecycle including the outer removal's captured parent.
  const errors = [];
  window.addEventListener('error', event => { errors.push(event.error); event.preventDefault(); });
  tip.remove = function() {
    const parent = this.parentNode;
    if (!parent) return;
    if (document.activeElement === this) this.blur();
    parent.removeChild(this);
  };
  tip.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.deepEqual(errors, [], 'removing a focused tip must not re-enter removal');
  assert.equal(document.activeElement, anchor, 'focus returns to the original anchor');
  assert.equal(document.querySelector('.tj-tip'), null, 'restoring focus must not reopen the tooltip');
  anchor.blur();
  anchor.focus();
  assert.ok(document.querySelector('.tj-tip'), 'a later focus opens normally');
  dom.window.close();
});

test('short all-caught-up Focus state yields hero space to its message', async () => {
 const dom = new JSDOM('<!doctype html><body><main></main></body>');
 global.window=dom.window; global.document=window.document; global.HTMLElement=window.HTMLElement; installElementHelpers(window);
 const proto=window.HTMLElement.prototype;
 proto.createSpan=function(o){return this.createEl('span',o)}; proto.setCssStyles=function(s){Object.assign(this.style,s)};
 Object.defineProperty(proto,'clientHeight',{configurable:true,get(){if(this.tagName==='MAIN')return 90; if(this.classList.contains('tj-focus-list'))return this.previousElementSibling?.style.display==='none'?50:0; return 0}});
 Object.defineProperty(proto,'offsetHeight',{configurable:true,get(){return this.classList.contains('tj-focus-clear')?36:0}});
 const HomeView=await loadAnalyticsView(); const home=new HomeView({app:{}},syntheticAnalyticsPlugin());
 const trade={id:'synthetic',date:'2026-01-01',symbol:'TEST',account:'Example',direction:'long',quantity:1,entryPrice:100,exitPrice:101,pnl:1,reviewed:true}; home.trades=[trade];
 const body=document.querySelector('main'); home.renderFocusAreasWidget(body,[trade]);
 assert.ok(body.querySelector('.tj-focus-clear')); assert.equal(body.querySelector('.tj-focus-hero').style.display,'none');
 dom.window.close();
});
