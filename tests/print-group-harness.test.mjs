import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

const result = await build({
  entryPoints: { printGroup: new URL("../src/lib/printGroup.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents: 'export const normalizePath = (p) => p; export const TFile = class { constructor(path){this.path=path;this.name=path.split(\'/\').pop();} }; export const App = class {}; ',
          loader: "js",
        }));
      },
    },
  ],
});
const output = result.outputFiles[0];
const pg = await import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);

function makeApp(root) {
  return {
    vault: {
      getAbstractFileByPath(p) {
        if (!p) return null;
        const full = path.join(root, p);
        if (!existsSync(full)) return null;
        return new pg.TFile(p);
      },
      createFolder: async (p) => { await fsPromises.mkdir(path.join(root, p), { recursive: true }); },
      create: async (p, content) => { await fsPromises.writeFile(path.join(root, p), content, "utf8"); },
      cachedRead: async (file) => { return await fsPromises.readFile(path.join(root, file.path), "utf8"); },
      modify: async (file, content) => { await fsPromises.writeFile(path.join(root, file.path), content, "utf8"); },
      getFiles: () => {
        const files = [];
        const walk = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); }
            else if (e.isFile()) {
              files.push({ path: path.relative(root, full), name: e.name, extension: e.name.split(".").pop() });
            }
          }
        };
        walk(root);
        return files;
      },
    },
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "printgroup-harness-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("setActiveGroup promotes selected and demotes previous", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1");
    const g2 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 2");

    // g1 is active by default, promote g2
    await pg.setActiveGroup(app, "", g2.id);

    const l1 = await pg.loadPrintGroup(app, "", g1.id);
    const l2 = await pg.loadPrintGroup(app, "", g2.id);
    assert.ok(l1 && l2);
    assert.equal(l1.state, "pending");
    assert.equal(l2.state, "active");

    // single active invariant
    const active = await pg.getActiveGroup(app, "");
    assert.ok(active);
    assert.equal(active.id, g2.id);
  });
});

test("setActiveGroup is idempotent for already-active group", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1");
    const g2 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 2");

    await pg.setActiveGroup(app, "", g1.id); // already active
    const list = await pg.listPrintGroups(app, "");
    const states = list.map(g => g.state);
    const activeCount = states.filter(s => s === "active").length;
    assert.equal(activeCount, 1);
    const active = await pg.getActiveGroup(app, "");
    assert.equal(active.id, g1.id);
  });
});

test("setActiveGroup with no other active leaves target active", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1");
    await pg.setGroupState(app, "", g1.id, "pending");
    assert.equal((await pg.getActiveGroup(app, "")), null);
    await pg.setActiveGroup(app, "", g1.id);
    const reloaded = await pg.loadPrintGroup(app, "", g1.id);
    assert.equal(reloaded.state, "active");
  });
});

test("pendingGroupCount excludes attached groups", async () => {
  const groups = [
    { id: "1", state: "active" },
    { id: "2", state: "pending" },
    { id: "3", state: "latent" },
    { id: "4", state: "attached" },
    { id: "5", state: "attached" },
  ];
  const count = pg.pendingGroupCount(groups);
  assert.equal(count, 3);
});

test("routeCapture routes to global active group regardless of journal date", async () => {
  const groups = [
    { id: "a", journalDate: "2026-10-16", state: "active" },
    { id: "b", journalDate: "2026-10-16", state: "pending" },
  ];
  // Capture journal date differs, but global active group should win.
  const route = pg.routeCapture(groups);
  assert.equal(route.kind, "use");
  assert.equal(route.groupId, "a");
});

test("routeCapture allocates the next ordinal after queued groups, ignoring attached groups", async () => {
  const groups = [
    { id: "a", name: "Group 1", ordinal: 1, journalDate: "2026-10-16", state: "pending" },
    { id: "b", name: "Group 2", ordinal: 2, journalDate: "2026-10-16", state: "pending" },
    { id: "c", name: "NQ opening trade", ordinal: 3, journalDate: "2026-10-17", state: "attached" },
  ];
  const route = pg.routeCapture(groups); // no active group at all
  assert.equal(route.kind, "create");
  assert.equal(route.ordinal, 3, "attached groups do not keep a queue ordinal from being reused");
});

test("persistence across simulated sessions: state survives reload", async () => {
  await withTempDir(async (base) => {
    const app1 = makeApp(base);
    const now = new Date().toISOString();
    const g = await pg.createPrintGroup(app1, "", "2026-10-16", now, "Trade 1");
    await pg.setGroupState(app1, "", g.id, "pending");

    // Simulate new session by creating fresh app instance over same dir
    const app2 = makeApp(base);
    const loaded = await pg.loadPrintGroup(app2, "", g.id);
    assert.ok(loaded);
    assert.equal(loaded.state, "pending");
    assert.equal(loaded.name, "Trade 1");
  });
});

test("persistence across simulated sessions: entryIds survive reload", async () => {
  await withTempDir(async (base) => {
    const app1 = makeApp(base);
    const now = new Date().toISOString();
    const g = await pg.createPrintGroup(app1, "", "2026-10-16", now, "Trade 1");
    await pg.addEntryToGroup(app1, "", g.id, "entry-1");
    await pg.addEntryToGroup(app1, "", g.id, "entry-2");

    const app2 = makeApp(base);
    const loaded = await pg.loadPrintGroup(app2, "", g.id);
    assert.deepEqual(loaded.entryIds, ["entry-1", "entry-2"]);
  });
});

test("adding an entry twice is idempotent", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const group = await pg.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1");
    await pg.addEntryToGroup(app, "", group.id, "entry-1");
    await pg.addEntryToGroup(app, "", group.id, "entry-1");
    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.deepEqual(loaded.entryIds, ["entry-1"]);
  });
});


test("active-group selection state machine: exactly one active after multiple selections", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const groups = [];
    for (let i = 0; i < 5; i++) {
      const g = await pg.createPrintGroup(app, "", "2026-10-16", now, `Trade ${i}`);
      groups.push(g);
    }

    // Activate each in sequence
    for (const g of groups) {
      await pg.setActiveGroup(app, "", g.id);
      const active = await pg.getActiveGroup(app, "");
      assert.equal(active.id, g.id);
      const all = await pg.listPrintGroups(app, "");
      const activeCount = all.filter(x => x.state === "active").length;
      assert.equal(activeCount, 1);
    }
  });
});

test("Phase C: first capture materializes and activates latent group", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();

    // No active group yet
    assert.equal(await pg.getActiveGroup(app, ""), null);

    // RouteCapture returns create (no active)
    let groups = await pg.listPrintGroups(app, "");
    let route = pg.routeCapture(groups);
    assert.equal(route.kind, "create");
    assert.equal(route.ordinal, 1);

    // Create the latent group
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, `Trade ${route.ordinal} · 09:42`, route.ordinal);

    // It should now be active
    const active = await pg.getActiveGroup(app, "");
    assert.equal(active.id, g1.id);
  });
});

test("Phase C: subsequent captures append to global active group", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();

    // First capture → active group
    let group = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42", 1);
    assert.equal((await pg.getActiveGroup(app, ""))?.id, group.id);

    // Second capture: route to global active (same date or different)
    let groups = await pg.listPrintGroups(app, "");
    let route = pg.routeCapture(groups);
    assert.equal(route.kind, "use");
    assert.equal(route.groupId, group.id);

    // Add to the active group
    await pg.addEntryToGroup(app, "", route.groupId, "entry-2");

    // Verify group membership
    const reloaded = await pg.loadPrintGroup(app, "", group.id);
    assert.deepEqual(reloaded.entryIds, ["entry-2"]);
  });
});

test("Phase C: Add Trade creates next group and routes there", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();

    // First group active
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42", 1);
    await pg.setActiveGroup(app, "", g1.id);

    let groups = await pg.listPrintGroups(app, "");
    const active1 = await pg.getActiveGroup(app, "");
    assert.equal(active1?.id, g1.id);

    // Add Trade → creates next group B
    const ordinal = pg.nextPrintGroupOrdinal(groups);
    const g2 = await pg.createPrintGroup(app, "", "2026-10-16", now, `Group ${ordinal}`, ordinal);
    await pg.setActiveGroup(app, "", g2.id);

    // Third capture routes to g2 (the NEW active), not g1
    groups = await pg.listPrintGroups(app, "");
    let route = pg.routeCapture(groups);
    assert.equal(route.kind, "use");
    assert.equal(route.groupId, g2.id);

    // g1 still has its entries, g2 is active
    const active = await pg.getActiveGroup(app, "");
    assert.equal(active.id, g2.id);
    const reloadedG1 = await pg.loadPrintGroup(app, "", g1.id);
    assert.deepEqual(reloadedG1.entryIds, []);
  });
});

test("Phase C: reload preserves membership and active state", async () => {
  await withTempDir(async (base) => {
    const app1 = makeApp(base);
    const now = new Date().toISOString();

    // Create and populate group
    const g1 = await pg.createPrintGroup(app1, "", "2026-10-16", now, "Trade 1 · 09:42", 1);
    await pg.addEntryToGroup(app1, "", g1.id, "print-1");
    await pg.addEntryToGroup(app1, "", g1.id, "print-2");

    // Create second group and make it active
    const g2 = await pg.createPrintGroup(app1, "", "2026-10-16", now, "Trade 2 · 10:00", 2);
    await pg.setActiveGroup(app1, "", g2.id);
    await pg.addEntryToGroup(app1, "", g2.id, "print-3");

    // Simulate reload with fresh app instance
    const app2 = makeApp(base);
    const reloadedGroups = await pg.listPrintGroups(app2, "");
    assert.equal(reloadedGroups.length, 2);

    // Reconstructed load
    const reloadedG1 = await pg.loadPrintGroup(app2, "", g1.id);
    const reloadedG2 = await pg.loadPrintGroup(app2, "", g2.id);

    // Persistent membership
    assert.deepEqual(reloadedG1.entryIds, ["print-1", "print-2"]);
    assert.deepEqual(reloadedG2.entryIds, ["print-3"]);

    // Active state preserved
    const active = await pg.getActiveGroup(app2, "");
    assert.equal(active.id, g2.id);
  });
});

test("queue-only trade time hint persists without changing group creation time or membership", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const createdAt = "2026-10-16T15:42:00.000Z";
    const group = await pg.createPrintGroup(app, "", "2026-10-16", createdAt, "Trade 1 · 10:42", 1);
    await pg.addEntryToGroup(app, "", group.id, "print-1");

    await pg.setTradeTimeHint(app, "", group.id, "09:15", "America/Chicago");

    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.equal(loaded.tradeTimeHint, "09:15");
    assert.equal(loaded.tradeTimeHintZone, "America/Chicago");
    assert.equal(loaded.createdAt, createdAt);
    assert.deepEqual(loaded.entryIds, ["print-1"]);
    assert.equal(loaded.state, "active");
    assert.equal(loaded.attachedTradeId, undefined);

    await assert.rejects(pg.setTradeTimeHint(app, "", group.id, "24:00", "America/Chicago"), /Invalid trade-time hint/);
    assert.equal((await pg.loadPrintGroup(app, "", group.id)).tradeTimeHint, "09:15");

    await pg.setTradeTimeHint(app, "", group.id, undefined);
    const cleared = await pg.loadPrintGroup(app, "", group.id);
    assert.equal(cleared.tradeTimeHint, undefined);
    assert.equal(cleared.tradeTimeHintZone, undefined);
    assert.equal(cleared.createdAt, createdAt);
    assert.deepEqual(cleared.entryIds, ["print-1"]);
  });
});

test("renaming a group persists a safe label and ordinal without changing its trade data", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const createdAt = "2026-10-16T15:42:00.000Z";
    const group = await pg.createPrintGroup(app, "", "2026-10-16", createdAt, "Group 2", 2);
    await pg.addEntryToGroup(app, "", group.id, "print-1");
    await pg.setTradeTimeHint(app, "", group.id, "09:15", "America/Chicago");

    await pg.renamePrintGroup(app, "", group.id, "  NQ's   opening move  ", 2);

    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.equal(loaded.name, "NQ's opening move");
    assert.equal(loaded.ordinal, 2);
    assert.equal(loaded.createdAt, createdAt);
    assert.deepEqual(loaded.entryIds, ["print-1"]);
    assert.equal(loaded.state, "active");
    assert.equal(loaded.tradeTimeHint, "09:15");
    assert.equal(loaded.tradeTimeHintZone, "America/Chicago");
    assert.equal(loaded.attachedTradeId, undefined);

    await assert.rejects(pg.renamePrintGroup(app, "", group.id, "   ", 2), /name cannot be empty/i);
    assert.equal((await pg.loadPrintGroup(app, "", group.id)).name, "NQ's opening move");
  });
});

test("new group ordinals stay unique after a renamed group is attached", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const first = await pg.createPrintGroup(app, "", "2026-10-16", now, "Group 1", 1);
    const second = await pg.createPrintGroup(app, "", "2026-10-16", now, "Group 2", 2);
    await pg.renamePrintGroup(app, "", first.id, "NQ opening trade", 1);
    await pg.attachGroupSidecar(app, "", first.id, "trade-1");
    await pg.setGroupState(app, "", second.id, "pending");

    assert.deepEqual(pg.routeCapture(await pg.listPrintGroups(app, "")), { kind: "create", ordinal: 3 });
    const third = await pg.createPrintGroup(app, "", "2026-10-16", now, "Group 3");
    assert.equal(third.ordinal, 3);
  });
});

test("attached groups do not hold queue ordinals after pending groups are cleared", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    for (let ordinal = 1; ordinal <= 4; ordinal++) {
      const group = await pg.createPrintGroup(app, "", "2026-10-16", now, `Group ${ordinal}`, ordinal);
      await pg.attachGroupSidecar(app, "", group.id, `trade-${ordinal}`);
    }

    assert.deepEqual(pg.routeCapture(await pg.listPrintGroups(app, "")), { kind: "create", ordinal: 1 });
  });
});
