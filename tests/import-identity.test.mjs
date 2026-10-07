import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 2 — import identity. These tests pin the dedupe contract exactly as the
// importer uses it: broker ids first, a conservative deterministic fallback
// second, and accounts always kept apart.
const result = await build({
  entryPoints: {
    csv: new URL("../src/csv.ts", import.meta.url).pathname,
    identity: new URL("../src/lib/importIdentity.ts", import.meta.url).pathname,
    storage: new URL("../src/storage.ts", import.meta.url).pathname,
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  outdir: "bundle",
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents:
            "export const App = class {};" +
            "export const TFile = class {};" +
            "export const TFolder = class {};" +
            "export const Notice = class {};" +
            "export const Modal = class {};" +
            "export const Setting = class {};" +
            "export const ItemView = class {};" +
            "export const Plugin = class {};" +
            "export const PluginSettingTab = class {};" +
            "export const addIcon = () => {};" +
            "export const apiVersion = '1.0.0';" +
            "export const normalizePath = (p) => p;" +
            "export const setIcon = () => {};",
          loader: "js",
        }));
      },
    },
  ],
});
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [csv, identity, storage] = await Promise.all([
  loadBundle("csv"),
  loadBundle("identity"),
  loadBundle("storage"),
]);

const ORDER_CSV = [
  "Status,Order ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  "Filled,ORD-1,2026-01-05 10:00:00,DEMO1,NQ,buy,1,20000",
  "Filled,ORD-2,2026-01-05 10:05:00,DEMO1,NQ,sell,1,20010",
].join("\n");

const FILL_CSV = [
  "Fill ID,Fill Time,Account,Symbol,Side,Filled Qty,Avg Fill Price",
  "FILL-1,2026-01-05 10:00:00,DEMO1,NQ,buy,1,20000",
  "FILL-2,2026-01-05 10:05:00,DEMO1,NQ,sell,1,20010",
].join("\n");

const parseTrades = (text) => csv.parseTradeovateCsv(text, [], { sourceZone: "UTC", journalZone: "UTC" });
const resolve = (label) => (label === "DEMO1" ? "id-demo1" : (label || "").trim().toLowerCase());
const ids = (t) => identity.importIdentities(t, resolve);

/** The importer's dedupe pass, reproduced so the contract can be asserted. */
const dedupe = (existing, incoming) => {
  const seen = new Set();
  for (const t of existing) for (const id of ids(t)) seen.add(id);
  const importable = [];
  let duplicates = 0;
  for (const t of incoming) {
    const list = ids(t);
    if (list.some((id) => seen.has(id))) {
      duplicates += 1;
      continue;
    }
    for (const id of list) seen.add(id);
    importable.push(t);
  }
  return { importable, duplicates };
};

test("reimporting the same Fills export creates no duplicates", () => {
  const first = parseTrades(FILL_CSV).trades;
  assert.equal(first.length, 1);
  assert.equal(first[0].fillId, "FILL-1", "the Fill ID column is now read");
  const second = parseTrades(FILL_CSV).trades;

  const pass1 = dedupe([], first);
  assert.equal(pass1.importable.length, 1);
  assert.equal(pass1.duplicates, 0);

  const pass2 = dedupe(pass1.importable, second);
  assert.equal(pass2.importable.length, 0);
  assert.equal(pass2.duplicates, 1, "the second import recognises the first");
});

test("an Orders export and a Fills export of one trade reconcile on the fallback identity", () => {
  const fromOrders = parseTrades(ORDER_CSV).trades[0];
  const fromFills = parseTrades(FILL_CSV).trades[0];

  // Their broker ids live in different namespaces…
  assert.equal(fromOrders.fillId, "ORD-1");
  assert.equal(fromFills.fillId, "FILL-1");
  // …but the exact fallback identity is shared.
  const shared = ids(fromOrders).filter((id) => ids(fromFills).includes(id));
  assert.equal(shared.length, 1);
  assert.ok(shared[0].startsWith("fallback:"));

  const result = dedupe([fromOrders], [fromFills]);
  assert.equal(result.duplicates, 1, "the Fills row is the same trade, not a new one");
  assert.equal(result.importable.length, 0);
});

test("the fallback keeps two identical trades in different accounts apart", () => {
  const base = {
    symbol: "NQ",
    direction: "long",
    quantity: 1,
    entryInstant: "2026-01-05T10:00:00.000Z",
    entryPrice: 20000,
  };
  const accountA = { ...base, account: "A" };
  const accountB = { ...base, account: "B" };
  const byId = { A: "id-a", B: "id-b" };
  const resolved = (label) => byId[label];

  const idA = identity.fallbackIdentity(accountA, resolved);
  const idB = identity.fallbackIdentity(accountB, resolved);
  assert.notEqual(idA, idB);

  const result = dedupe([accountA], [{ ...accountB }]);
  assert.equal(result.duplicates, 0);
  assert.equal(result.importable.length, 1);
});

test("the fallback does not join two legitimate trades in the same minute", () => {
  const first = {
    account: "A",
    symbol: "NQ",
    direction: "long",
    quantity: 1,
    entryInstant: "2026-01-05T10:00:05.000Z",
    entryPrice: 20000,
  };
  const second = { ...first, entryInstant: "2026-01-05T10:00:55.000Z" };
  const third = { ...first, entryPrice: 20000.25 };

  assert.notEqual(identity.fallbackIdentity(first), identity.fallbackIdentity(second));
  assert.notEqual(identity.fallbackIdentity(first), identity.fallbackIdentity(third));
  const result = dedupe([first], [second, third]);
  assert.equal(result.duplicates, 0);
  assert.equal(result.importable.length, 2);
});

test("a broker id is preferred over the fallback, and both travel together", () => {
  const t = {
    account: "A",
    fillId: "FILL-9",
    symbol: "NQ",
    direction: "long",
    quantity: 1,
    entryInstant: "2026-01-05T10:00:00.000Z",
    entryPrice: 20000,
  };
  const list = identity.importIdentities(t);
  assert.ok(list.includes("broker:FILL-9"));
  assert.ok(list.some((id) => id.startsWith("fallback:")));
  assert.equal(identity.primaryImportIdentity(t), "broker:FILL-9");
});

const legacyTrade = (over = {}) => ({
  id: "legacy",
  date: "2026-01-05",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "DEMO1",
  accountType: "funded",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  stopLoss: 0,
  target: 0,
  commission: 0,
  fees: 0,
  pnl: 200,
  pnlPoints: 10,
  setup: "",
  mistake: "",
  thesis: "",
  review: "",
  screenshot: "",
  rating: 0,
  reviewed: false,
  tags: [],
  psychology_tags: [],
  mistake_tags: [],
  ...over,
});

test("a legacy note opens without an import key, and gains one only from its fields", () => {
  const markdown = storage.tradeToMarkdown(
    legacyTrade({ entryInstant: "2026-01-05T10:00:00.000Z", origin: "broker" })
  );
  assert.ok(!markdown.includes("import_key:"), "nothing is invented for a legacy note");
  const back = storage.parseTradeFromMarkdown(markdown);
  assert.equal(back.importKey, undefined);
  // The fallback still recognises it, computed from the note's own fields.
  const list = identity.importIdentities(back, resolve);
  assert.equal(list.length, 1);
  assert.ok(list[0].startsWith("fallback:"));

  // A legacy note with no instant has no fallback and never throws.
  const noInstant = storage.parseTradeFromMarkdown(storage.tradeToMarkdown(legacyTrade()));
  assert.deepEqual(identity.importIdentities(noInstant, resolve), []);
});

test("an import key written to Markdown round-trips", () => {
  const markdown = storage.tradeToMarkdown(
    legacyTrade({ entryInstant: "2026-01-05T10:00:00.000Z", importKey: "fallback:id-demo1|NQ|long|1|2026-01-05T10:00:00.000Z|20000" })
  );
  assert.ok(markdown.includes("import_key:"));
  const back = storage.parseTradeFromMarkdown(markdown);
  assert.equal(back.importKey, "fallback:id-demo1|NQ|long|1|2026-01-05T10:00:00.000Z|20000");
});
