import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as fs from "node:fs";
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
          contents: "export const normalizePath = (p) => p; export const TFile = class { constructor(path){this.path=path;this.name=path.split('/').pop();} }; export const App = class {}; ",
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "printgroup-test-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("remove entry from group persists", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const group = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    await pg.addEntryToGroup(app, "", group.id, "print-abc");
    await pg.removeEntryFromGroup(app, "", group.id, "print-abc");
    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.entryIds, []);
  });
});

test("reorder entries in group persists", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const group = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    await pg.addEntryToGroup(app, "", group.id, "a");
    await pg.addEntryToGroup(app, "", group.id, "b");
    await pg.addEntryToGroup(app, "", group.id, "c");
    await pg.reorderGroupEntries(app, "", group.id, ["c", "a", "b"]);
    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.entryIds, ["c", "a", "b"]);
  });
});

test("reorder repairs duplicate persisted entry ids", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const group = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    const corrupted = { ...group, entryIds: ["a", "b", "b", "c"] };
    const file = app.vault.getAbstractFileByPath(`print-groups/${group.id}.md`);
    await app.vault.modify(file, pg.groupMarkdown(corrupted));
    await pg.reorderGroupEntries(app, "", group.id, ["c", "a", "b"]);
    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.entryIds, ["c", "a", "b"]);
  });
});


test("move entry between groups persists", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    const g2 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 2 · 10:00");
    await pg.addEntryToGroup(app, "", g1.id, "print-xyz");
    await pg.moveEntryToGroup(app, "", g1.id, g2.id, "print-xyz");
    const l1 = await pg.loadPrintGroup(app, "", g1.id);
    const l2 = await pg.loadPrintGroup(app, "", g2.id);
    assert.ok(l1 && l2);
    assert.deepEqual(l1.entryIds, []);
    assert.deepEqual(l2.entryIds, ["print-xyz"]);
  });
});

test("set group state and get active group", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const g = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    await pg.setGroupState(app, "", g.id, "pending");
    const active = await pg.getActiveGroup(app, "");
    assert.equal(active, null);
    await pg.setGroupState(app, "", g.id, "active");
    const active2 = await pg.getActiveGroup(app, "");
    assert.ok(active2);
    assert.equal(active2.id, g.id);
  });
});
