import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { installElementHelpers, loadAnalyticsView, syntheticAnalyticsPlugin } from './support/analytics-view-host.mjs';

test('fully reviewed Focus keeps a restrained ring and centers its content', async () => {
  const dom = new JSDOM('<!doctype html><body><main></main></body>');
  global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
  installElementHelpers(window);
  const proto = window.HTMLElement.prototype;
  proto.createSpan = function(o) { return this.createEl('span', o); };
  proto.setCssStyles = function(o) { Object.assign(this.style, o); };
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get() {
    if (this.tagName === 'MAIN') return 400;
    if (this.classList.contains('tj-focus-list')) return 250;
    return 0;
  }});
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return this.classList.contains('tj-focus-clear') ? 36 : 0; }});
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return this.classList.contains('tj-focus-ring') ? Number.parseFloat(this.style.width) || 80 : 0; }});
  const Home = await loadAnalyticsView();
  const home = new Home({app:{}}, syntheticAnalyticsPlugin());
  const trade = {id:'synthetic', date:'2026-01-01', symbol:'TEST', account:'Example', direction:'long', quantity:1, entryPrice:100, exitPrice:101, pnl:1, reviewed:true};
  home.trades = [trade];
  const body = document.querySelector('main'); home.renderFocusAreasWidget(body, [trade]);
  const ring = body.querySelector('.tj-focus-ring');
  assert.ok(body.classList.contains('is-focus-complete'), 'completed state should use the balanced layout');
  assert.equal(ring.style.width, '', 'ring should retain its normal size instead of growing');
  assert.ok(body.querySelector('.tj-focus-clear'), 'retain the completion message');
  body.replaceChildren(); home.renderFocusAreasWidget(body, []);
  assert.equal(body.classList.contains('is-focus-complete'), false, 'empty state must not retain completed layout');
  dom.window.close();
});

test('completed-state message can wrap in narrow cards', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const rule = css.match(/\.tj-focus-clear\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /flex-wrap:\s*wrap/);
});
