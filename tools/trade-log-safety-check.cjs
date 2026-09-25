// Isolated regressions for Trade Log selection boundaries and note updates.
// All trades/notes below are in-memory fixtures; no vault is opened.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relativePath, dependencies = {}) {
  const filename = path.join(__dirname, "..", relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: (id) => dependencies[id] ?? {},
    console,
  };
  vm.runInNewContext(compiled, context, { filename });
  return module.exports;
}

async function testStorageIntegrity() {
  class TFile {}
  const storage = loadTs("src/storage.ts", {
    obsidian: { TFile, normalizePath: (value) => value },
    "./lib/dates": { formatDateFile: (value) => value },
    "./lib/tradeTable": { normalizeOrderType: (value) => value },
    "./tz": { fmtPrice: (value) => String(value) },
  });

  const before = [
    "---",
    "type: trade",
    "rating: 4",
    'notes: "old reflection"',
    'review: "legacy reflection"',
    "reviewed: false",
    "tags: [focus, patience]",
    "custom_flag: keep-me",
    "---",
    "# Trade review",
    "Body remains byte-for-byte unchanged.",
    "notes: body text that resembles frontmatter",
    "review: another body line",
    "custom_flag: body content",
    "",
  ].join("\n");
  const file = new TFile();
  let after = before;
  const app = { vault: { process: async (_file, transform) => { after = transform(after); } } };

  await storage.updateTradeFields(app, file, { notes: "updated reflection\nsecond line" });
  const expected = before.replace('notes: "old reflection"', 'notes: "updated reflection\\nsecond line"');
  assert.equal(after, expected, "only the intended frontmatter value changes; body bytes are preserved");
  assert.match(after, /review: "legacy reflection"/, "legacy Review field remains intact");
  assert.match(after, /reviewed: false/, "boolean field type/value remains intact");
  assert.match(after, /tags: \[focus, patience\]/, "array field remains intact");
  assert.match(after, /custom_flag: keep-me/, "unrelated frontmatter remains intact");
  assert.equal(after.slice(after.indexOf("# Trade review")), before.slice(before.indexOf("# Trade review")), "Markdown body matches byte-for-byte");
  console.log("PASS storage frontmatter/body integrity (suspected overwrite not reproduced)");
}

function testSelectionBoundaries() {
  const selection = loadTs("src/lib/tradeSelection.ts");
  const viewSource = fs.readFileSync(path.join(__dirname, "..", "src/views/tradeLogView.ts"), "utf8");
  const baseScope = { search: "", period: "all", review: "all", quality: [] };
  const key = selection.tradeSelectionScopeKey(baseScope);
  assert.equal(selection.tradeSelectionScopeKey({ ...baseScope }), key, "ordinary rerender preserves population identity");
  assert.notEqual(selection.tradeSelectionScopeKey({ ...baseScope, search: "NQ" }), key, "search changes population identity");
  assert.notEqual(selection.tradeSelectionScopeKey({ ...baseScope, review: "pending" }), key, "review queue plus other filters gets a distinct population");
  assert.notEqual(selection.tradeSelectionScopeKey({ ...baseScope, accountType: "eval" }), key, "contextual/account-type destination gets a distinct population");
  assert.notEqual(selection.tradeSelectionScopeKey({ ...baseScope, customFrom: "2026-01-01", customTo: "2026-01-31" }), key, "custom bounds change population identity");
  assert.notEqual(
    selection.tradeSelectionScopeKey({ ...baseScope, review: "pending", quality: ["nosetup"] }),
    key,
    "review queue plus simultaneous Missing Strategy filter changes population identity"
  );
  assert.match(viewSource, /if \(this\._selectionScope && this\._selectionScope !== selectionScope\)\s*\{\s*this\.selected\.clear\(\);\s*this\._lastPicked = null;/,
    "render clears old selection only when the filter population changes");
  assert.match(viewSource, /const eligible = this\.eligibleSelectedIds\(\);[\s\S]*?for \(const id of eligible\)/,
    "bulk actions operate over validated selected IDs");
  assert.doesNotMatch(viewSource, /selectionScopeKey\(\)[\s\S]{0,120}sort:|selectionScopeKey\(\)[\s\S]{0,120}limit:/,
    "sorting and pagination do not enter the selection identity");

  const all = Array.from({ length: 120 }, (_, index) => ({ id: `trade-${index}`, date: "2026-01-01" }));
  const selected = new Set(["trade-0", "trade-70", "no-longer-allowed"]);
  const allowed = selection.eligibleTradeIds(all.slice(0, 60), selected);
  assert.deepEqual([...allowed], ["trade-0"], "bulk eligibility checks entire filtered population, independent of current page");
  const sorted = all.slice().reverse();
  assert.deepEqual([...selection.eligibleTradeIds(sorted, selected)], ["trade-0", "trade-70"], "sorting preserves selected IDs");

  const copiedDecision = [
    { id: "base", copyBaseKey: "decision-1", isCopiedTrade: false },
    { id: "leg-a", copyBaseKey: "decision-1", isCopiedTrade: true },
    { id: "leg-b", copyBaseKey: "decision-1", isCopiedTrade: true },
  ];
  const oneRowSelected = selection.eligibleTradeIds(copiedDecision, new Set(["leg-a"]));
  assert.deepEqual([...oneRowSelected], ["leg-a"], "selection remains row/note-level; it does not silently expand to copy legs");
  console.log("PASS selection scope, filter eligibility, sort/page stability and copied-leg semantics");
}

testSelectionBoundaries();
testStorageIntegrity().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
