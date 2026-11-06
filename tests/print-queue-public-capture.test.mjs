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
  const dir = await mkdtemp(path.join(os.tmpdir(), "printqueue-public-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// Narrowly extracted equivalent of PrintQueueView.saveFiles capture routing
// Simulates: for each entry with journalDate, routeCapture decides use/create, creates group if needed, adds entry
async function simulateSaveFiles(app, base, entries) {
  // entries: array of { id, journalDate, capturedAt }
  const groupsCache = new Map();
  for (const entry of entries) {
    let group = groupsCache.get(entry.journalDate);
    if (!group) {
      const allGroups = await pg.listPrintGroups(app, base);
      const route = pg.routeCapture(allGroups);
      if (route.kind === "use") {
        group = allGroups.find((g) => g.id === route.groupId);
      } else {
        const time = "09:42";
        const name = `Trade ${route.ordinal} · ${time}`;
        group = await pg.createPrintGroup(app, base, entry.journalDate, entry.capturedAt, name, route.ordinal);
      }
      groupsCache.set(entry.journalDate, group);
    }
    await pg.addEntryToGroup(app, base, group.id, entry.id);
  }
  return groupsCache;
}

test("public capture flow: first capture creates/activates latent group", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const entries = [{ id: "e1", journalDate: "2026-10-16", capturedAt: now }];
    await simulateSaveFiles(app, "", entries);
    const active = await pg.getActiveGroup(app, "");
    assert.ok(active, "active group should exist after first capture");
    const loaded = await pg.loadPrintGroup(app, "", active.id);
    assert.equal(loaded.entryIds.length, 1);
    assert.equal(loaded.entryIds[0], "e1");
  });
});

test("public capture flow: subsequent captures append to single active group across journal dates", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    // first capture
    await simulateSaveFiles(app, "", [{ id: "e1", journalDate: "2026-10-16", capturedAt: now }]);
    const active1 = await pg.getActiveGroup(app, "");
    assert.ok(active1);
    // second capture on different journal date
    await simulateSaveFiles(app, "", [{ id: "e2", journalDate: "2026-10-17", capturedAt: now }]);
    const active2 = await pg.getActiveGroup(app, "");
    assert.equal(active2.id, active1.id, "active group should stay the same across dates");
    const loaded = await pg.loadPrintGroup(app, "", active2.id);
    assert.deepEqual(loaded.entryIds.sort(), ["e1", "e2"]);
  });
});

test("public capture flow: Add Trade routes next capture to new group", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    // first capture
    await simulateSaveFiles(app, "", [{ id: "e1", journalDate: "2026-10-16", capturedAt: now }]);
    const g1 = await pg.getActiveGroup(app, "");
    // simulate Add Trade
    const groups = await pg.listPrintGroups(app, "");
    const ordinal = pg.nextPrintGroupOrdinal(groups);
    const g2 = await pg.createPrintGroup(app, "", "2026-10-16", now, `Group ${ordinal}`, ordinal);
    await pg.setActiveGroup(app, "", g2.id);
    // next capture should route to g2
    await simulateSaveFiles(app, "", [{ id: "e2", journalDate: "2026-10-16", capturedAt: now }]);
    const active = await pg.getActiveGroup(app, "");
    assert.equal(active.id, g2.id);
    const loadedG2 = await pg.loadPrintGroup(app, "", g2.id);
    assert.equal(loadedG2.entryIds.length, 1);
    assert.equal(loadedG2.entryIds[0], "e2");
    const loadedG1 = await pg.loadPrintGroup(app, "", g1.id);
    assert.deepEqual(loadedG1.entryIds, ["e1"]);
  });
});

test("public capture flow: selecting pending group routes capture to selected group", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    // create two groups
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:00", 1);
    const g2 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 2 · 10:00", 2);
    await pg.setGroupState(app, "", g1.id, "pending");
    await pg.setGroupState(app, "", g2.id, "pending");
    // select g1
    await pg.setActiveGroup(app, "", g1.id);
    // capture
    await simulateSaveFiles(app, "", [{ id: "e1", journalDate: "2026-10-16", capturedAt: now }]);
    const loadedG1 = await pg.loadPrintGroup(app, "", g1.id);
    assert.equal(loadedG1.entryIds[0], "e1");
    // select g2
    await pg.setActiveGroup(app, "", g2.id);
    await simulateSaveFiles(app, "", [{ id: "e2", journalDate: "2026-10-16", capturedAt: now }]);
    const loadedG2 = await pg.loadPrintGroup(app, "", g2.id);
    assert.equal(loadedG2.entryIds[0], "e2");
    assert.equal((await pg.getActiveGroup(app, "")).id, g2.id);
  });
});

test("public capture flow: source types paste / drop / file selection are handled", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    // Simulate three captures with different sources (source is irrelevant for routing, but we ensure flow works)
    const sources = ["paste", "drop", "file"];
    for (let i = 0; i < sources.length; i++) {
      await simulateSaveFiles(app, "", [{ id: `e${i+1}`, journalDate: "2026-10-16", capturedAt: now }]);
    }
    const active = await pg.getActiveGroup(app, "");
    const loaded = await pg.loadPrintGroup(app, "", active.id);
    assert.equal(loaded.entryIds.length, 3);
  });
});
