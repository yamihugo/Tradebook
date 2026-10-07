import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Phase 5 — batch import. These tests pin the pure plan: one analysis for many
// files, grouped by detected account, globally deduped, and never inventing a
// trade for an account the batch does not contain.
const result = await build({
  entryPoints: {
    batch: new URL("../src/lib/importBatch.ts", import.meta.url).pathname,
    csv: new URL("../src/csv.ts", import.meta.url).pathname,
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  outdir: "bundle",
});
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [batch, csv] = await Promise.all([loadBundle("batch"), loadBundle("csv")]);

const resolve = (label) => (label || "").trim().toLowerCase();

let seq = 0;
const trade = (over = {}) => {
  seq += 1;
  const mm = String(Math.floor(seq / 60) % 60).padStart(2, "0");
  const ss = String(seq % 60).padStart(2, "0");
  return {
    id: `t${seq}`,
    date: "2025-01-05",
    entryTime: "10:00",
    exitTime: "10:05",
    symbol: "NQ",
    account: "PA1",
    accountType: "funded",
    direction: "long",
    quantity: 1,
    entryPrice: 20000,
    exitPrice: 20010,
    pnl: 200,
    fillId: `F${seq}`,
    // A distinct instant by default, so two fixture trades are two trades; the
    // fallback identity is exact and must not merge them.
    entryInstant: `2025-01-05T10:${mm}:${ss}.000Z`,
    ...over,
  };
};

const filesOf = (map) => Object.entries(map).map(([name, trades]) => ({ name, trades }));

test("three files across two accounts produce one plan and a reconciling receipt", () => {
  const files = filesOf({
    "Jan.csv": [trade({ account: "PA1" }), trade({ account: "PA1" })],
    "Feb.csv": [trade({ account: "PA2" })],
    "Mar.csv": [trade({ account: "PA1" })],
  });
  const plan = batch.planBatch({
    files,
    mapping: { PA1: "id-1", PA2: "id-2" },
    resolveAccount: resolve,
  });

  assert.equal(plan.detected, 4);
  assert.equal(plan.duplicates, 0);
  assert.equal(plan.importable, 4);
  assert.equal(plan.assigned, 4);
  assert.equal(plan.unassigned, 0);
  assert.equal(plan.selected.length, 4);
  // The receipt reconciles: detected = duplicates + assigned + unassigned.
  assert.equal(plan.detected, plan.duplicates + plan.assigned + plan.unassigned);

  const pa1 = plan.groups.find((g) => g.name === "PA1");
  const pa2 = plan.groups.find((g) => g.name === "PA2");
  assert.equal(pa1.tradeCount, 3);
  assert.deepEqual(pa1.files, ["Jan.csv", "Mar.csv"]);
  assert.equal(pa1.mappedAccountId, "id-1");
  assert.equal(pa2.tradeCount, 1);
  assert.deepEqual(pa2.files, ["Feb.csv"]);
});

test("importing the same batch twice creates zero new trades", () => {
  const files = filesOf({ "Jan.csv": [trade({ account: "PA1" }), trade({ account: "PA1" })] });
  const first = batch.planBatch({ files, mapping: { PA1: "id-1" }, resolveAccount: resolve });
  assert.equal(first.selected.length, 2);

  // The second run sees the written notes as existing.
  const second = batch.planBatch({
    files,
    existing: first.selected,
    mapping: { PA1: "id-1" },
    resolveAccount: resolve,
  });
  assert.equal(second.assigned, 0);
  assert.equal(second.selected.length, 0);
  assert.equal(second.duplicates, 2);
});

test("multiple files of the same account are grouped together", () => {
  const files = filesOf({
    "Jan.csv": [trade({ account: "PA1", date: "2025-01-01" })],
    "Feb.csv": [trade({ account: "PA1", date: "2025-02-01" })],
    "Mar.csv": [trade({ account: "PA1", date: "2025-03-01" })],
  });
  const groups = batch.detectedAccounts(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tradeCount, 3);
  assert.deepEqual(groups[0].files, ["Jan.csv", "Feb.csv", "Mar.csv"]);
  assert.equal(groups[0].firstDate, "2025-01-01");
  assert.equal(groups[0].lastDate, "2025-03-01");
});

test("fifty detected accounts are grouped correctly and written once each", () => {
  const trades = [];
  for (let i = 0; i < 50; i++) trades.push(trade({ account: `PA${i}`, fillId: `F-${i}` }));
  const files = [{ name: "All.csv", trades }];
  const mapping = Object.fromEntries(trades.map((t) => [t.account, `id-${t.account}`]));

  const plan = batch.planBatch({ files, mapping, resolveAccount: resolve });
  assert.equal(plan.groups.length, 50);
  assert.equal(plan.detected, 50);
  assert.equal(plan.assigned, 50);
  assert.equal(plan.selected.length, 50);
  assert.equal(new Set(plan.selected.map((t) => t.account)).size, 50, "one write per account");

  // Running it again writes nothing.
  const again = batch.planBatch({ files, existing: plan.selected, mapping, resolveAccount: resolve });
  assert.equal(again.selected.length, 0);
  assert.equal(again.duplicates, 50);
});

test("a partial mapping reports the unmapped account and imports the mapped ones", () => {
  const files = filesOf({
    "All.csv": [
      trade({ account: "A" }),
      trade({ account: "B" }),
      trade({ account: "C" }),
    ],
  });
  const plan = batch.planBatch({ files, mapping: { A: "id-a", B: "id-b" }, resolveAccount: resolve });

  assert.equal(plan.detected, 3);
  assert.equal(plan.assigned, 2);
  assert.equal(plan.unassigned, 1);
  assert.equal(plan.selected.length, 2);
  assert.deepEqual(plan.skipped.map((t) => t.account), ["C"]);
  const c = plan.groups.find((g) => g.name === "C");
  assert.equal(c.mappedAccountId, "", "C is clearly unmapped, not silently dropped");
});

test("overlapping files dedupe globally", () => {
  const shared = trade({ account: "PA1", fillId: "SHARED", entryInstant: "2025-01-10T09:00:00.000Z" });
  const files = filesOf({
    "Jan.csv": [trade({ account: "PA1", fillId: "A" }), shared],
    "Jan-Feb.csv": [shared, trade({ account: "PA1", fillId: "B" })],
  });
  const plan = batch.planBatch({ files, mapping: { PA1: "id-1" }, resolveAccount: resolve });

  assert.equal(plan.detected, 4);
  assert.equal(plan.duplicates, 1, "the shared trade is counted once");
  assert.equal(plan.importable, 3);
  assert.equal(plan.assigned, 3);
});

test("a copy group with a missing follower is not silently reconstructed", () => {
  const accounts = [
    { id: "Lid", name: "Leader", copyRole: "base" },
    { id: "Aid", name: "Follower A", copyRole: "copier", copyBaseId: "Lid" },
    { id: "Bid", name: "Follower B", copyRole: "copier", copyBaseId: "Lid" },
  ];
  const files = filesOf({
    "Leader.csv": [trade({ account: "Leader" })],
    "FollowerA.csv": [trade({ account: "Follower A" })],
  });
  const plan = batch.planBatch({
    files,
    mapping: { Leader: "Lid", "Follower A": "Aid" },
    resolveAccount: resolve,
  });

  // Only what the batch actually contains is selected; Follower B is absent.
  assert.deepEqual(plan.selected.map((t) => t.account).sort(), ["Follower A", "Leader"]);
  assert.equal(plan.groups.some((g) => g.name === "Follower B"), false);

  const missing = batch.missingCopiers(accounts, new Set(["Lid", "Aid"]));
  assert.deepEqual(missing.map((a) => a.id), ["Bid"], "Follower B is reported as missing data");
});

// --- Phase 5.1 hardening -------------------------------------------------

test("a reconstructed copy leg never blocks a real broker follower import", () => {
  // A generated leg: a model of the leader's trade, no broker id of its own.
  const model = trade({
    account: "Copier",
    isCopiedTrade: true,
    copyOrigin: "generated",
    dataSource: "reconstructed",
    fillId: undefined,
  });
  // The follower's own fill, with the same fallback fields as the model.
  const incoming = trade({
    account: "Copier",
    origin: "broker",
    dataSource: "broker",
    fillId: "REAL-1",
    entryInstant: model.entryInstant,
    entryPrice: model.entryPrice,
  });

  const plan = batch.planBatch({
    files: [{ name: "Follower.csv", trades: [incoming] }],
    existing: [model],
    mapping: { Copier: "id-copier" },
    resolveAccount: resolve,
  });

  assert.equal(plan.duplicates, 0, "the model does not suppress the actual");
  assert.equal(plan.selected.length, 1);
  assert.equal(plan.selected[0].fillId, "REAL-1");
});

test("a real broker duplicate is still deduped", () => {
  const existing = trade({
    account: "Copier",
    origin: "broker",
    dataSource: "broker",
    fillId: "F-EXIST",
    entryInstant: "2025-01-05T11:00:00.000Z",
  });
  const incoming = trade({
    account: "Copier",
    origin: "broker",
    dataSource: "broker",
    fillId: "F-EXIST",
    entryInstant: existing.entryInstant,
    entryPrice: existing.entryPrice,
  });

  const plan = batch.planBatch({
    files: [{ name: "F.csv", trades: [incoming] }],
    existing: [existing],
    mapping: { Copier: "id-copier" },
    resolveAccount: resolve,
  });
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.selected.length, 0);
});

test("the financial preview uses only trades with a confirmed account", () => {
  const files = filesOf({
    "All.csv": [trade({ account: "A", pnl: 100 }), trade({ account: "B", pnl: 999 })],
  });
  const plan = batch.planBatch({ files, mapping: { A: "id-a" }, resolveAccount: resolve });

  assert.equal(plan.assigned, 1);
  assert.equal(plan.unassigned, 1);
  const previewNet = plan.selected.reduce((sum, t) => sum + t.pnl, 0);
  assert.equal(previewNet, 100, "only the mapped trade moves the Net");
  assert.notEqual(previewNet, [...plan.selected, ...plan.skipped].reduce((sum, t) => sum + t.pnl, 0));
  assert.deepEqual(plan.skipped.map((t) => t.account), ["B"]);
});

test("a suggested account does not change identity before the mapping is confirmed", () => {
  // The resolver stands in for aliases: both the stored name "A" and the CSV
  // label "PA1" resolve to the same journal account "A".
  const resolveWithSuggestion = (label) => (label === "PA1" || label === "A" ? "A" : (label || "").trim().toLowerCase());
  const existing = trade({
    account: "A",
    origin: "broker",
    dataSource: "broker",
    fillId: "A-FILL",
    entryInstant: "2025-01-05T12:00:00.000Z",
  });
  const incoming = trade({
    account: "PA1",
    origin: "broker",
    dataSource: "broker",
    fillId: "NEW",
    entryInstant: existing.entryInstant,
    entryPrice: existing.entryPrice,
  });
  const files = [{ name: "pa1.csv", trades: [incoming] }];

  // Unconfirmed: the suggestion must not make the row look like account A.
  const unconfirmed = batch.planBatch({
    files,
    existing: [existing],
    mapping: {},
    resolveAccount: resolveWithSuggestion,
  });
  assert.equal(unconfirmed.duplicates, 0, "not treated as A before confirmation");
  assert.equal(unconfirmed.selected.length, 0, "still unassigned");
  assert.equal(unconfirmed.unassigned, 1);

  // Confirmed: now it is A's trade, so the real note dedupes it.
  const confirmed = batch.planBatch({
    files,
    existing: [existing],
    mapping: { PA1: "A" },
    resolveAccount: resolveWithSuggestion,
  });
  assert.equal(confirmed.duplicates, 1);
  assert.equal(confirmed.selected.length, 0);
});

test("the same cash rows in a batch are counted once", () => {
  const cash = [
    "Cash Change Type,Delta,Contract,Timestamp,Amount",
    "Commission,-1.50,NQ,01/05/2026 10:00:00,10000",
    "Exchange Fee,-0.50,NQ,01/05/2026 10:00:00,10000",
  ].join("\n");
  const one = csv.parseCashHistoryCsv(cash);
  assert.equal(one.lines, 2);
  assert.equal(one.charged, 2);

  const overlap = [
    "Cash Change Type,Delta,Contract,Timestamp,Amount",
    "Commission,-1.50,NQ,01/05/2026 10:00:00,10000",
    "Clearing Fee,-0.25,NQ,01/05/2026 10:00:00,10000",
  ].join("\n");

  // The same export three ways: twice whole, once overlapping by one row.
  const merged = csv.mergeCashCosts([one, csv.parseCashHistoryCsv(cash), csv.parseCashHistoryCsv(overlap)]);
  assert.equal(merged.lines, 3, "commission + exchange + clearing, once each");
  assert.equal(merged.charged, 2.25);
  const fill = merged.byFill.get("2026-01-05 10:00:00|NQ");
  assert.equal(fill.commission, 1.5);
  assert.equal(fill.exchange, 0.5);
  assert.equal(fill.clearing, 0.25);
});
