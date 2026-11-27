import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

const root = path.resolve(import.meta.dirname, '..');

test('Home labels omit redundant decision suffix while tooltips retain scope', async () => {
  const source = await readFile(path.join(root, 'src/views/dashboard.ts'), 'utf8');
  const render = source.slice(source.indexOf('  renderMetricBody('), source.indexOf('  private drawEquityChart('));
  assert.doesNotMatch(render, /\$\{baseLabel\} \(decision\)/);
  assert.match(render, /Portfolio Net P&L/);
  assert.match(render, /m\.besthour[^\n]+per decision/);
  assert.match(render, /m\.worsthour[^\n]+per decision/);
});

test('Focus list anchors rows at its top while retaining scroll overflow', async () => {
  const css = await readFile(path.join(root, 'styles.css'), 'utf8');
  const rule = css.match(/\.tj-focus-list\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /align-content:\s*(?:safe\s+)?start\s*;/);
  assert.match(rule, /overflow-y:\s*auto\s*;/);
});

const browserAvailable = spawnSync(process.env.CHROMIUM_BIN || 'chromium', ['--version']).status === 0;
test('Focus rows stay grouped below the ring across card shapes and remain scrollable', { skip: browserAvailable ? false : 'Chromium unavailable' }, async () => {
  const css = await readFile(path.join(root, 'styles.css'), 'utf8');
  const dir = await mkdtemp(path.join(tmpdir(), 'home-layout-'));
  try {
    const html = `<!doctype html><style>*{box-sizing:border-box}body{font:14px sans-serif}.card{display:flex;flex-direction:column}.tj-focus-chip{height:26px}</style><style>${css}</style><main id="cases"></main><script>
      const cases=[];
      for(const width of [220, 500]) for(const height of [150, 350, 650]) for(const count of [0,1,5]) {
        const body=document.createElement('div');body.className='card';body.style.cssText='width:'+width+'px;height:'+height+'px';
        body.innerHTML='<div class="tj-focus-hero"><div class="tj-focus-ring"></div><div class="tj-focus-legend">Reviewed</div></div><div class="tj-focus-list"></div>';
        const list=body.lastElementChild;
        list.innerHTML=count ? Array.from({length:count},(_,i)=>'<button class="tj-focus-chip">Row '+i+'</button>').join('') : '<div class="tj-focus-clear">All caught up</div>';
        document.querySelector('main').append(body);
        const hero=body.firstElementChild.getBoundingClientRect(), first=list.firstElementChild.getBoundingClientRect();
        cases.push({width,height,count,gap:first.top-hero.bottom,overflow:getComputedStyle(list).overflowY});
      }
      document.body.dataset.results=JSON.stringify(cases);
    </script>`;
    const file = path.join(dir, 'test.html'); await writeFile(file, html);
    const result = spawnSync(process.env.CHROMIUM_BIN || 'chromium', ['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking',`--user-data-dir=${dir}/profile`,'--dump-dom',`file://${file}`], {encoding:'utf8',timeout:30000,maxBuffer:10_000_000});
    assert.equal(result.status, 0, result.stderr);
    const encoded = result.stdout.match(/data-results="([^"]+)"/)?.[1];
    assert.ok(encoded, 'browser results missing');
    const cases = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.equal(cases.length, 18);
    for (const c of cases) {
      assert.ok(c.gap >= -1 && c.gap <= 12, `unwanted gap: ${JSON.stringify(c)}`);
      assert.equal(c.overflow, 'auto', JSON.stringify(c));
    }
  } finally { await rm(dir, {recursive:true,force:true}); }
});
