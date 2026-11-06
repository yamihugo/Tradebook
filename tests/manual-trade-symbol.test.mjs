import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { test } from "node:test";

// Manual Trade → Symbol. Two questions this file answers: what the field
// suggests, and what it starts on. The suggestion set and the default-symbol
// rule are pure (src/futures.ts) and are run here; the wiring that puts them on
// the field is DOM, so it is pinned against the source and rendered for real in
// the harness (smoke.js, "Add Trade").

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const result = await build({
  entryPoints: { futures: new URL("src/futures.ts", root).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  outdir: "bundle",
  write: false,
});
const { CORE_SYMBOLS, supportedDefaultSymbol } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const panel = read("src/views/addTradePanel.ts");

// ---- the field starts empty unless the trader configured a symbol ---------

test("no configured default leaves the symbol empty", () => {
  // A, and the reason the field used to open on NQ: the factory hard-coded it,
  // so a settings value that was empty still produced a contract.
  assert.equal(supportedDefaultSymbol(undefined), "");
  assert.equal(supportedDefaultSymbol(null), "");
  assert.equal(supportedDefaultSymbol(""), "");
  assert.equal(supportedDefaultSymbol("   "), "");
  assert.doesNotMatch(panel, /symbol:\s*"NQ"/, "the default trade carries no contract");
});

test("a configured supported default fills the field", () => {
  for (const symbol of CORE_SYMBOLS) {
    assert.equal(supportedDefaultSymbol(symbol), symbol, `${symbol} is a default the trader can set`);
  }
  assert.equal(supportedDefaultSymbol("mnq"), "MNQ", "case is the trader's to type, not ours to refuse");
  assert.equal(supportedDefaultSymbol(" NQ "), "NQ");
  assert.equal(supportedDefaultSymbol("NQU6"), "NQU6", "a dated contract is still the instrument it belongs to");
  assert.match(panel, /t\.symbol = supportedDefaultSymbol\(st\.defaultSymbol\)/);
});

// ---- an unsupported default is ignored, never swapped for NQ -------------

test("an old or invalid default starts empty instead of falling back to NQ", () => {
  // C. The rule is one line: no configured core contract means an empty field,
  // and NQ is not what an unrecognised value becomes.
  for (const bad of ["XYZ", "6E", "ZC", "QQQ", "not a symbol", "MBT", "HE"]) {
    const got = supportedDefaultSymbol(bad);
    assert.notEqual(got, "NQ", `${bad} must not become NQ`);
    assert.equal(got, "", `${bad} is not a contract this journal supports`);
  }
  // And the panel has no other NQ to fall back on: neither a factory value, nor
  // a blank field rewritten to one, nor a point value borrowed from it.
  assert.doesNotMatch(panel, /\|\|\s*"NQ"/, "no `|| \"NQ\"` anywhere in the panel");
  assert.doesNotMatch(panel, /t\.symbol\s*\|\|\s*"NQ"/);
});

// ---- the picker suggests the supported set, and only that ----------------

test("the symbol field is built from the canonical supported set", () => {
  // D. CORE_SYMBOLS is the one list: the picker reads it, it is not a second
  // copy of it, and nothing in the panel offers the rest of the registry.
  assert.match(panel, /for \(const sym of CORE_SYMBOLS\)/, "the datalist is filled from CORE_SYMBOLS");
  assert.match(
    panel,
    /import \{[\s\S]*?CORE_SYMBOLS,[\s\S]*?\} from "\.\.\/futures"/,
    "CORE_SYMBOLS comes from futures.ts, not a local list"
  );
  assert.doesNotMatch(panel, /pickerSections/, "the two-section picker is gone");
  assert.doesNotMatch(panel, /Show all instruments|Show the common instruments/, "no 'all instruments' escape hatch");
  assert.equal(new Set(CORE_SYMBOLS).size, CORE_SYMBOLS.length, "each supported contract is offered once");
});

// ---- an empty symbol waits; it is priced by nothing ----------------------

test("an empty symbol is priced by no contract at all", () => {
  // Money per point is the contract's. With none named there is nothing to
  // multiply by — not NQ's $20, not the $1 placeholder — and the risk the trader
  // configured stays in its field until a contract arrives.
  assert.match(panel, /const priced = knownFuturesSpec\(t\.symbol \|\| ""\)/);
  assert.match(panel, /const pointValue = priced \? priced\.pointValue : null/);
  assert.match(panel, /if \(pricedValue === null\) return;/, "no stop distance without a contract");
  assert.match(panel, /if \(pointValue !== null && Number\.isFinite\(risk\)/, "typing a risk waits too");
  assert.match(panel, /pointValue !== null && t\.stopLoss && t\.entryPrice/, "the risk strip waits as well");
  assert.match(panel, /if \(!symbol\) return;/, "an empty field is not called out as a wrong contract");
  // A stop the trader typed is theirs: only the derived one follows the symbol.
  assert.match(panel, /if \(t\.stopSource === "assumed"\)/);
  assert.match(
    panel,
    /if \(t\.stopSource === "assumed"\) \{\s*\n\s*delete t\.stopLoss;\s*\n\s*delete t\.stopSource;\s*\n\s*\}\s*\n\s*deriveStopFromRisk\?\.\(knownFuturesSpec\(t\.symbol\)\?\.pointValue \?\? null\);/,
    "a contract is chosen → the stop is derived against it; changed or cleared → the derived one is re-read or dropped"
  );
  // The field still accepts free text and still refuses nothing: saving checks
  // that a symbol was chosen, not that we support it.
  assert.match(panel, /if \(!t\.account \|\| !t\.symbol\)/);
  assert.doesNotMatch(panel, /CORE_SYMBOLS\.includes\(t\.symbol\)/, "no membership test that could refuse a contract");
});