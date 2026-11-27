import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { test } from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("Import CSV Light palette is scoped to its host modal and detached dropdown", () => {
  const palette = css.match(
    /body\.theme-light \.tj-import-modal,\s*body\.theme-light:has\(\.tj-import-modal\) \.tj-mg-dd-list\.is-portal\s*\{([^}]+)\}/
  );
  assert.ok(palette, "Light palette covers the modal and its body-ported dropdown");
  for (const token of [
    "--tj-fg-1: var(--text-normal)",
    "--tj-fg-2: var(--text-muted)",
    "--tj-fg-3: color-mix(in srgb, var(--text-normal) 66%, var(--background-primary))",
    "--tj-tone-good: #187A43",
    "--tj-tone-mid: #805000",
    "--tj-tone-bad: #B3261E",
    "--color-green-bright: var(--tj-tone-good)",
    "--color-red-bright: var(--tj-tone-bad)",
  ]) {
    assert.ok(palette[1].includes(token), `Light palette includes ${token}`);
  }

  const dom = new JSDOM(`<!doctype html><html><body class="theme-light">
    <div class="modal-container"><div class="modal tj-import-modal">
      <span class="tj-import-side is-long"></span><span class="tj-import-net pos"></span>
    </div></div>
    <div class="tj-mg-dd-list is-portal"><div class="tj-mg-dd-item is-active"></div></div>
  </body></html>`);
  const { document } = dom.window;
  assert.equal(document.querySelectorAll("body.theme-light .tj-import-modal .tj-import-side.is-long").length, 1);
  assert.equal(document.querySelectorAll("body.theme-light:has(.tj-import-modal) .tj-mg-dd-list.is-portal").length, 1);

  assert.match(css, /body\.theme-light \.tj-import-modal \.tj-import-side\.is-long/);
  assert.match(css, /body\.theme-light \.tj-import-modal \.tj-import-side\.is-short/);
  assert.match(css, /body\.theme-light:has\(\.tj-import-modal\) \.tj-mg-dd-item:hover/);
  assert.match(css, /body\.theme-light:has\(\.tj-import-modal\) \.tj-mg-dd-item\.is-active/);
  assert.match(css, /body\.theme-light \.tj-import-modal \.tj-mg-dd-btn:hover/);
  assert.match(css, /body\.theme-light \.tj-import-modal \.tj-success/);
  assert.doesNotMatch(css, /body\.theme-dark[^{}]*\.tj-import-modal/);
});
