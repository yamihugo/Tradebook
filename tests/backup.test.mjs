import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

/**
 * The backup format is the one thing a person trusts with their whole journal,
 * so the contract is pinned here: what a file claims to be, what it refuses, and
 * that the counts a summary shows come from the file — never invented.
 */
const result = await build({
  entryPoints: { backup: new URL("../src/lib/backup.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  outdir: "bundle",
  write: false,
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        b.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents: "export const normalizePath = (p) => p;",
          loader: "js",
        }));
      },
    },
  ],
});
const backup = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const settings = {
  tradesFolder: "Tradebook",
  timeZone: "America/New_York",
  propAccounts: [{ id: "a1", name: "Eval", type: "eval", size: 50000 }],
  archivedAccounts: [{ id: "a0", name: "Old", type: "eval", size: 50000 }],
  payouts: [{ id: "p1", accountId: "a1", date: "2026-01-01", amount: 100, status: "paid" }],
  deposits: [],
  strategies: [{ id: "s1", name: "Reversal" }],
};

test("buildBackup stamps kind, version and counts", () => {
  const payload = backup.buildBackup({
    settings,
    pluginVersion: "0.5.0-beta.1",
    notes: [
      { path: "Tradebook/2026/09/trades/a.md", content: "---\ntype: trade\n---\n" },
      { path: "Tradebook/library/strategies/Reversal.md", content: "---\ntype: strategy\n---\n" },
    ],
  });
  assert.equal(payload.kind, backup.BACKUP_KIND);
  assert.equal(payload.version, backup.BACKUP_VERSION);
  assert.equal(payload.pluginVersion, "0.5.0-beta.1");
  assert.equal(payload.counts.accounts, 1);
  assert.equal(payload.counts.archived, 1);
  assert.equal(payload.counts.trades, 2, "counts every note carried, trades and strategies alike");
  assert.equal(payload.counts.payouts, 1);
  assert.equal(payload.counts.deposits, 0);
  assert.equal(payload.notes.length, 2);
  assert.ok(payload.exportedAt.length > 0);
});

test("buildBackup deep-copies settings (a later edit never mutates the file)", () => {
  const payload = backup.buildBackup({ settings, pluginVersion: "x", notes: [] });
  payload.settings.tradesFolder = "CHANGED";
  assert.equal(settings.tradesFolder, "Tradebook");
});

test("summariseBackup accepts our file and reads its counts", () => {
  const payload = backup.buildBackup({ settings, pluginVersion: "0.5.0-beta.1", notes: [{ path: "a.md", content: "x" }] });
  const summary = backup.summariseBackup(JSON.parse(JSON.stringify(payload)));
  assert.equal(summary.ok, true);
  assert.equal(summary.accounts, 1);
  assert.equal(summary.archived, 1);
  assert.equal(summary.trades, 1);
  assert.equal(summary.payouts, 1);
});

test("summariseBackup refuses anything that is not ours, clearly", () => {
  assert.equal(backup.summariseBackup(null).ok, false);
  assert.equal(backup.summariseBackup("nope").ok, false);
  const foreign = backup.summariseBackup({ hello: "world" });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /settings-only export/);
  const other = backup.summariseBackup({ kind: "something-else", settings: {} });
  assert.equal(other.ok, false);
  assert.match(other.error, /not created by this plugin/);
});

test("summariseBackup refuses a newer format instead of guessing", () => {
  const future = backup.summariseBackup({ kind: backup.BACKUP_KIND, version: 99, settings: {} });
  assert.equal(future.ok, false);
  assert.match(future.error, /newer version/);
});

test("summariseBackup refuses a file with no settings", () => {
  const empty = backup.summariseBackup({ kind: backup.BACKUP_KIND, version: 1 });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /no settings/);
});

test("summariseBackup falls back to the notes when counts are missing", () => {
  const summary = backup.summariseBackup({
    kind: backup.BACKUP_KIND,
    version: 1,
    settings: { propAccounts: [{}, {}], payouts: [{}] },
    notes: [{ path: "a.md", content: "x" }, { path: "b.md", content: "y" }, { path: "c.md", content: "z" }],
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.accounts, 2);
  assert.equal(summary.trades, 3);
  assert.equal(summary.payouts, 1);
});

test("backupFilename is dated and stable", () => {
  const name = backup.backupFilename(new Date("2026-09-30T12:00:00Z"));
  assert.equal(name, "tradebook-backup-2026-09-30.json");
});
