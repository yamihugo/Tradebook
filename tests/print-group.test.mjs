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
        // Return a TFile instance to satisfy instanceof checks
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
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("create and load a PrintGroup", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const group = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.ok(loaded);
    assert.equal(loaded.name, "Trade 1 · 09:42");
    assert.equal(loaded.entryIds.length, 0);
  });
});

test("add entry to a group persists", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const group = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    await pg.addEntryToGroup(app, "", group.id, "print-abc");
    const loaded = await pg.loadPrintGroup(app, "", group.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.entryIds, ["print-abc"]);
  });
});

test("list groups returns created groups", async () => {
  await withTempDir(async (base) => {
    const app = makeApp(base);
    const now = new Date().toISOString();
    const g1 = await pg.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:42");
    const g2 = await pg.createPrintGroup(app, "", "2026-10-17", now, "Trade 2 · 10:00");
    const list = await pg.listPrintGroups(app, "");
    const ids = list.map((g) => g.id);
    assert.ok(ids.includes(g1.id));
    assert.ok(ids.includes(g2.id));
  });
});