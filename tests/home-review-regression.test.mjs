import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { installElementHelpers, loadAnalyticsView, syntheticAnalyticsPlugin } from './support/analytics-view-host.mjs';

test('focused Home metric survives unrelated mouse movement until blur or Escape', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="outside"></div></body>', {pretendToBeVisual:true});
  global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(dom.window);
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({app:{}}, syntheticAnalyticsPlugin());
  const host = document.createElement('div'); document.body.append(host);
  home.renderMetricBody(host, [], 'm.besthour');
  const label = host.querySelector('.tj-metric-label');
  const description = document.getElementById(label.getAttribute('aria-describedby'));
  assert.match(description.textContent, /per decision/);
  home.renderMetricBody(host, [], 'm.worsthour');
  const other = host.querySelectorAll('.tj-metric-label')[1];
  label.focus();
  other.dispatchEvent(new window.MouseEvent('mouseenter', {clientX:40,clientY:50}));
  other.dispatchEvent(new window.MouseEvent('mousemove', {bubbles:true,clientX:40,clientY:50}));
  other.dispatchEvent(new window.MouseEvent('mouseleave'));
  assert.match(document.querySelector('.tj-tip')?.textContent ?? '', /Best Hour/);
  assert.equal(document.getElementById(label.getAttribute('aria-describedby')), description);
  label.dispatchEvent(new window.MouseEvent('mouseenter'));
  label.dispatchEvent(new window.MouseEvent('mouseleave'));
  document.querySelector('#outside').dispatchEvent(new window.MouseEvent('mousemove', {bubbles:true}));
  assert.match(document.querySelector('.tj-tip')?.textContent ?? '', /per decision/);
  label.blur(); assert.equal(document.querySelector('.tj-tip'), null);
  label.dispatchEvent(new window.MouseEvent('mouseenter', {clientX:40,clientY:50}));
  assert.match(document.querySelector('.tj-tip')?.textContent ?? '', /per decision/);
  document.querySelector('#outside').dispatchEvent(new window.MouseEvent('mousemove', {bubbles:true}));
  assert.equal(document.querySelector('.tj-tip'), null, 'mouse-only tooltip still dismisses');
  label.focus(); document.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.equal(document.querySelector('.tj-tip'), null);
  dom.window.close();
});

test('Focus grid can shrink below its preferred column width', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = css.match(/\.tj-focus-list\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /minmax\(min\(200px,\s*100%\),\s*1fr\)/);
});

test('zero-height Focus list yields hero space to a reachable row', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {pretendToBeVisual:true});
  global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(window);
  const proto = window.HTMLElement.prototype;
  proto.createSpan = function(options) { return this.createEl('span', options); };
  proto.setCssStyles = function(styles) { Object.assign(this.style, styles); };
  Object.defineProperty(proto, 'clientHeight', {configurable:true, get() {
    if (this.classList.contains('test-body')) return 100;
    if (this.classList.contains('tj-focus-list')) return this.previousElementSibling?.style.display === 'none' ? 45 : 0;
    return 0;
  }});
  Object.defineProperty(proto, 'scrollHeight', {configurable:true, get() {
    return this.classList.contains('tj-focus-list') ? this.children.length * 20 : 0;
  }});
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({app:{}}, syntheticAnalyticsPlugin());
  const t = {id:'synthetic', date:'2026-01-01', symbol:'TEST', account:'Example', direction:'long', quantity:1, entryPrice:100, exitPrice:101, pnl:1, setup:'', screenshot:'', review:'', thesis:''};
  home.trades = [t];
  const body = document.createElement('div'); body.className = 'test-body'; document.body.append(body);
  home.renderFocusAreasWidget(body, [t]);
  assert.equal(body.querySelector('.tj-focus-hero').style.display, 'none');
  const actions = [...body.querySelectorAll('.tj-focus-chip')];
  assert.ok(actions.length > 1, 'all gap actions remain available');
  assert.equal(body.querySelector('.tj-focus-note'), null, 'no non-interactive replacement for actions');
  const calls = [];
  home.plugin.openTradeLogView = async (options) => calls.push(options);
  for (const action of actions) action.click();
  assert.equal(calls.length, actions.length);
  for (let i = 0; i < actions.length; i++) {
    const flag = actions[i].dataset.flag;
    if (flag) assert.deepEqual(calls[i].quality, [flag]);
    else assert.equal(calls[i].lens.label, 'Unreviewed');
  }
  const wide = document.createElement('div'); document.body.append(wide);
  home.renderFocusAreasWidget(wide, [t]);
  assert.deepEqual(actions.map(el => el.textContent), [...wide.querySelectorAll('.tj-focus-chip')].map(el => el.textContent));
  dom.window.close();
});

test('a card too short for a row and overflow note retains scrollable rows', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(window);
  const proto = window.HTMLElement.prototype;
  proto.createSpan = function(options) { return this.createEl('span', options); };
  proto.setCssStyles = function(styles) { Object.assign(this.style, styles); };
  Object.defineProperty(proto, 'clientHeight', {configurable:true, get() { return this.classList.contains('test-body') ? 40 : this.classList.contains('tj-focus-list') ? 20 : 0; }});
  Object.defineProperty(proto, 'scrollHeight', {configurable:true, get() { return this.classList.contains('tj-focus-list') ? this.children.length * 20 : 0; }});
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({app:{}}, syntheticAnalyticsPlugin());
  const t = {id:'synthetic', date:'2026-01-01', symbol:'TEST', account:'Example', direction:'long', quantity:1, entryPrice:100, exitPrice:101, pnl:1, setup:'', screenshot:'', review:'', thesis:''};
  home.trades = [t];
  const body = document.createElement('div'); body.className = 'test-body'; document.body.append(body);
  home.renderFocusAreasWidget(body, [t]);
  assert.ok(body.querySelector('.tj-focus-chip'), 'do not replace every action with a note');
  dom.window.close();
});

test('Without stop explanation matches the stop-price filter', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {pretendToBeVisual:true});
  global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(window);
  window.HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
  window.HTMLElement.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
  const HomeView = await loadAnalyticsView();
  const home = new HomeView({app:{}}, syntheticAnalyticsPlugin());
  const trade = {id:'synthetic', date:'2026-01-01', symbol:'TEST', account:'Example', direction:'long', quantity:1, entryPrice:100, exitPrice:101, pnl:1};
  home.trades = [trade];
  const body = document.createElement('div'); document.body.append(body);
  home.renderFocusAreasWidget(body, [trade]);
  const row = body.querySelector('[data-flag="nostop"]');
  row.focus();
  const text = document.querySelector('.tj-tip')?.textContent ?? '';
  assert.match(text, /stop price/i);
  assert.doesNotMatch(text, /default risk.*not in this row/i);
  dom.window.close();
});
