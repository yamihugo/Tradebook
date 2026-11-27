import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { installElementHelpers, loadAnalyticsView, syntheticAnalyticsPlugin } from './support/analytics-view-host.mjs';

function setup() {
  const dom = new JSDOM('<!doctype html><body><div id="outside"></div><header><h3>Focus Areas</h3></header><main></main></body>', {pretendToBeVisual:true});
  global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(window);
  window.HTMLElement.prototype.createSpan = function(o) { return this.createEl('span', o); };
  window.HTMLElement.prototype.setCssStyles = function(o) { Object.assign(this.style, o); };
  return dom;
}

test('mouse can cross from heading to tip, and leaving both dismisses it', async () => {
  const dom = setup(); const Home = await loadAnalyticsView(); const home = new Home({app:{}}, syntheticAnalyticsPlugin());
  const trade = {id:'synthetic', date:'2026-01-01', symbol:'TEST', account:'Example', direction:'long', quantity:1, entryPrice:100, exitPrice:101, pnl:1};
  home.trades = [trade]; home.renderFocusAreasWidget(document.querySelector('main'), [trade], document.querySelector('header'));
  const heading = document.querySelector('h3');
  // jsdom has no layout: give the heading and tip actual, separated rectangles
  // and move through their gap rather than dispatching everything at (0, 0).
  heading.getBoundingClientRect = () => ({left: 100, right: 200, top: 100, bottom: 120});
  heading.dispatchEvent(new window.MouseEvent('mouseenter', {clientX:150,clientY:110}));
  const tip = document.querySelector('.tj-tip'); assert.ok(tip);
  tip.getBoundingClientRect = () => ({left: 162, right: 282, top: 28, bottom: 98});
  const outside = document.querySelector('#outside');
  heading.dispatchEvent(new window.MouseEvent('mouseleave', {clientX:165,clientY:100,relatedTarget:outside}));
  outside.dispatchEvent(new window.MouseEvent('mousemove', {bubbles:true,clientX:165,clientY:99}));
  await new Promise(r => setTimeout(r, 250));
  assert.equal(document.querySelector('.tj-tip'), tip, 'slow crossing through the gap keeps the card open');
  tip.dispatchEvent(new window.MouseEvent('mouseenter', {clientX:166,clientY:97,relatedTarget:outside}));
  tip.dispatchEvent(new window.MouseEvent('mousemove', {bubbles:true,clientX:166,clientY:97}));
  assert.equal(document.querySelector('.tj-tip'), tip);
  tip.dispatchEvent(new window.MouseEvent('mouseleave', {clientX:150,clientY:60,relatedTarget:outside}));
  outside.dispatchEvent(new window.MouseEvent('mousemove', {bubbles:true,clientX:150,clientY:60}));
  assert.equal(document.querySelector('.tj-tip'), null, 'leaving the corridor dismisses it');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css.match(/\.tj-tip\s*\{([^}]*)\}/)[1], /pointer-events:\s*auto/);
  dom.window.close();
});

test('persistent Focus heading updates its existing description and visible tip on scope change', async () => {
  const dom = setup(); const Home = await loadAnalyticsView(); const home = new Home({app:{}}, syntheticAnalyticsPlugin());
  const trade = {id:'synthetic', date:'2026-01-01', symbol:'TEST', account:'Example', direction:'long', quantity:1, entryPrice:100, exitPrice:101, pnl:1};
  home.trades = [trade]; let scope = 'First scope'; home.homeTaskScopeLabel = () => scope;
  const body = document.querySelector('main'), header = document.querySelector('header'), title = header.querySelector('h3');
  home.renderFocusAreasWidget(body, [trade], header);
  const id = title.getAttribute('aria-describedby'); assert.match(document.getElementById(id).textContent, /First scope/);
  title.focus(); assert.match(document.querySelector('.tj-tip').textContent, /First scope/);
  scope = 'Second scope'; body.replaceChildren(); home.renderFocusAreasWidget(body, [trade], header);
  assert.equal(title.getAttribute('aria-describedby'), id); assert.match(document.getElementById(id).textContent, /Second scope/);
  assert.match(document.querySelector('.tj-tip').textContent, /Second scope/);
  assert.equal(header.querySelectorAll('.tj-sr-only').length, 1);
  dom.window.close();
});

test('ResizeObserver redraws the actual Focus body after zero size becomes visible', async () => {
  const dom = setup(); let observer; let height = 0;
  global.ResizeObserver = class { constructor(cb) { this.cb = cb; observer = this; } observe() {} disconnect() {} };
  window.HTMLElement.prototype.toggleClass = function(name, on) { this.classList.toggle(name, on); };
  window.HTMLElement.prototype.empty = function() { this.replaceChildren(); };
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {configurable:true, get() { return this.classList.contains('tj-gridcard-body') ? height : 0; }});
  const Home = await loadAnalyticsView(); const home = new Home({app:{}}, syntheticAnalyticsPlugin());
  const trade = {id:'synthetic', date:'2026-01-01', symbol:'TEST', account:'Example', direction:'long', quantity:1, entryPrice:100, exitPrice:101, pnl:1};
  home.trades = [trade]; home._intro = false;
  home.storedLayout = () => [{i:'focus', x:0, y:0, w:4, h:4}];
  home.recentScoreInput = () => ({trades:[],label:''});
  home.baseTrades = () => [trade]; home.previousPeriodTrades = () => [];
  const root = document.querySelector('main'); home.renderLayout(root, [trade]);
  const body = root.querySelector('.tj-gridcard-body'); assert.ok(body?.querySelector('.tj-focus-chip'));
  const oldAction = body.querySelector('.tj-focus-chip'); height = 200;
  observer.cb([{target:body}]); await new Promise(r => window.requestAnimationFrame(r));
  assert.notEqual(body.querySelector('.tj-focus-chip'), oldAction, 'actual Focus renderer redrew');
  assert.ok(body.querySelector('.tj-focus-chip'));
  delete global.ResizeObserver; dom.window.close();
});
