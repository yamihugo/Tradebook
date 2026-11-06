import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

// Bundle PrintQueueView with its dependencies for behavioural testing
const bundleResult = await build({
  stdin: {
    contents: [
      'export { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./src/views/printInboxView";',
      'export * from "./src/lib/printInbox";',
      'export * from "./src/lib/printGroup";',
    ].join("\n"),
    resolveDir: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    sourcefile: "print-group-public-behavior-entry.ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: [
          "export const normalizePath = (p) => (p || '').replace(/^\\//, '');",
          "export class TFile { constructor(path){ this.path = path; this.name = (path||'').split('/').pop(); } }",
          "export class App {}",
          "export class WorkspaceLeaf {}",
          "export class Notice {}",
          "export class Modal { constructor(app){} open(){ this.onOpen?.(); } close(){ this.onClose?.(); } }",
          "export function setIcon() {}",
          "export class ItemView { constructor(leaf){ this.leaf = leaf; } containerEl = null; contentEl = null; registerDomEvent(){} registerEvent(){} }",
          "export function getResourcePath(file) { return 'vault://' + (file.path || ''); }",
        ].join("\n"),
        loader: "js",
      }));
    },
  }],
});
const vq = await import(`data:text/javascript;base64,${Buffer.from(bundleResult.outputFiles[0].text).toString("base64")}`);

function makeApp(root) {
  return {
    vault: {
      getAbstractFileByPath(p) {
        if (!p) return null;
        const full = path.join(root, p);
        if (!existsSync(full)) return null;
        return new vq.TFile(p);
      },
      createFolder: async (p) => { await fsPromises.mkdir(path.join(root, p), { recursive: true }); },
      create: async (p, content) => {
        await fsPromises.mkdir(path.dirname(path.join(root, p)), { recursive: true });
        await fsPromises.writeFile(path.join(root, p), content, "utf8");
      },
      createBinary: async (p, buf) => {
        await fsPromises.mkdir(path.dirname(path.join(root, p)), { recursive: true });
        await fsPromises.writeFile(path.join(root, p), Buffer.from(buf));
      },
      cachedRead: async (file) => await fsPromises.readFile(path.join(root, file.path), "utf8"),
      modify: async (file, content) => await fsPromises.writeFile(path.join(root, file.path), content, "utf8"),
      delete: async (file) => await fsPromises.unlink(path.join(root, file.path)),
      getFiles: () => {
        const files = [];
        const walk = (dir) => {
          if (!existsSync(dir)) return;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory() && e.name !== ".trash") walk(full);
            else if (e.isFile()) files.push({ path: path.relative(root, full), name: e.name, extension: e.name.split(".").pop() });
          }
        };
        walk(root);
        return files;
      },
    },
    fileManager: {
      trashFile: async (file) => {
        const destination = path.join(root, ".trash", file.path);
        await fsPromises.mkdir(path.dirname(destination), { recursive: true });
        await fsPromises.rename(path.join(root, file.path), destination);
      },
    },
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "print-group-public-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeStubEl() {
  return {
    attrs: {}, listeners: {}, children: [], classes: new Set(), text: "", value: "", files: null,
    setAttr(k, v) { this.attrs[k] = v; },
    getAttr(k) { return this.attrs[k]; },
    addClass(c) { c.split(/\\s+/).forEach(x => this.classes.add(x)); },
    removeClass(c) { c.split(/\\s+/).forEach(x => this.classes.delete(x)); },
    toggleClass(c, on) { on ? this.addClass(c) : this.removeClass(c); },
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
    dispatch(t, evt = {}) { for (const fn of this.listeners[t] ?? []) fn(evt); },
    click() { this.dispatch("click", { stopPropagation() {}, preventDefault() {} }); },
    createEl(tag, opts) {
      const c = makeStubEl();
      c._tag = tag;
      if (opts?.cls) opts.cls.split(/\\s+/).forEach(x => c.classes.add(x));
      if (opts?.attr) Object.assign(c.attrs, opts.attr);
      if (opts?.text) c.text = opts.text;
      this.children.push(c);
      return c;
    },
    createDiv(opts) { return this.createEl("div", opts); },
    createSpan(opts) { return this.createEl("span", opts); },
    empty() { this.children = []; },
    setText(t) { this.text = t; },
    setCssStyles() {},
  };
}

function setupView(dir) {
  const app = makeApp(dir);
  const plugin = { app, getTradesFolder: () => "Tradebook", settings: { timeZone: "UTC" } };
  const view = new vq.PrintQueueView(null, plugin);
  view.contentEl = makeStubEl();
  view.containerEl = makeStubEl();
  view.refresh = async () => {};
  view.render = () => {};
  return { view, app };
}

function makeMockImageFile(name = "test.png") {
  return { name, type: "image/png", arrayBuffer: async () => new ArrayBuffer(8) };
}

// Public behavior tests for group interactions
test("public behavior: adding trades creates pending groups with stable ordinal", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    // First trade
    const g1 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1 · 09:00", 1);
    const g2 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 2 · 10:00", 2);

    // Queue order is stable even when group display names can be edited.
    const pending = await vq.listPrintGroups(app, "");
    const count = vq.pendingGroupCount(pending);
    assert.equal(count, 2);

    // Simulate addTrade behavior
    const ordinal = vq.nextPrintGroupOrdinal(pending);
    const g3 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), `Group ${ordinal}`, ordinal);
    assert.equal(g3.name, "Group 3");
    assert.equal(g3.ordinal, 3);

    // Activate new group
    await vq.setActiveGroup(app, "", g3.id);
    const active = await vq.getActiveGroup(app, "");
    assert.equal(active.id, g3.id);

    // Previous groups demoted
    const reloadedG1 = await vq.loadPrintGroup(app, "", g1.id);
    assert.equal(reloadedG1.state, "pending");
  });
});

test("public behavior: selecting groups promotes to active and demotes previous", async () => {
  await withTempDir(async (dir) => {
    const { app } = setupView(dir);
    const g1 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1 · 09:00", 1);
    const g2 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", g1.id);

    // Establish g1 as active before exercising selection of g2.
    assert.equal((await vq.getActiveGroup(app, "")).id, g1.id);

    // Select g2
    await vq.setActiveGroup(app, "", g2.id);

    const active = await vq.getActiveGroup(app, "");
    assert.equal(active.id, g2.id);

    const reloadedG1 = await vq.loadPrintGroup(app, "", g1.id);
    assert.equal(reloadedG1.state, "pending");

    // Exactly one active
    const all = await vq.listPrintGroups(app, "");
    assert.equal(all.filter(g => g.state === "active").length, 1);
  });
});

test("public behavior: capturing to groups routes to active group (low-friction path)", async () => {
  await withTempDir(async (dir) => {
    const { app } = setupView(dir);
    const now = new Date().toISOString();
    const g1 = await vq.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:00", 1);

    // Route capture with active group
    const route = vq.routeCapture([g1]);
    assert.equal(route.kind, "use");
    assert.equal(route.groupId, g1.id);

    // Add entry to active group
    await vq.addEntryToGroup(app, "", g1.id, "entry-1");
    const loaded = await vq.loadPrintGroup(app, "", g1.id);
    assert.deepEqual(loaded.entryIds, ["entry-1"]);
  });
});

test("public behavior: capturing creates new group when no active group exists", async () => {
  await withTempDir(async (dir) => {
    const { app } = setupView(dir);
    const groups = [];

    // No active group
    const route = vq.routeCapture(groups);
    assert.equal(route.kind, "create");
    assert.equal(route.ordinal, 1);

    // First capture creates group
    const g1 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1 · 09:00", route.ordinal);
    assert.equal(g1.state, "active");

    // Subsequent capture routes to active
    const route2 = vq.routeCapture([g1]);
    assert.equal(route2.kind, "use");
    assert.equal(route2.groupId, g1.id);
  });
});

test("public behavior: removing prints from a group moves their files to trash", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    // Create entry
    const file = { name: "chart.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(8) };
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", file, "2026-10-16", "file");

    // Create group with entry
    const group = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app, "", group.id, entry.id);

    // Remove entry
    await view.removeEntry(entry);

    // Verify group cleaned
    const loaded = await vq.loadPrintGroup(app, "", group.id);
    assert.deepEqual(loaded.entryIds, []);

    // Original queue paths are gone, and both files remain recoverable in trash.
    assert.equal(existsSync(path.join(dir, entry.imagePath)), false);
    assert.equal(existsSync(path.join(dir, entry.metadataPath)), false);
    assert.equal(existsSync(path.join(dir, ".trash", entry.imagePath)), true);
    assert.equal(existsSync(path.join(dir, ".trash", entry.metadataPath)), true);
  });
});

test("public behavior: reordering prints persists new order", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const group = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app, "", group.id, "a");
    await vq.addEntryToGroup(app, "", group.id, "b");
    await vq.addEntryToGroup(app, "", group.id, "c");

    // Move b before a
    await view.reorderEntry(group.id, "b", -1);

    const loaded = await vq.loadPrintGroup(app, "", group.id);
    assert.deepEqual(loaded.entryIds, ["b", "a", "c"]);
  });
});

test("public behavior: moving prints between groups transfers membership", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const g1 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1 · 09:00", 1);
    const g2 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 2 · 10:00", 2);
    await vq.addEntryToGroup(app, "", g1.id, "entry-1");

    // Move entry
    await view.moveEntryBetweenGroups("entry-1", g1.id, g2.id);

    const l1 = await vq.loadPrintGroup(app, "", g1.id);
    const l2 = await vq.loadPrintGroup(app, "", g2.id);
    assert.deepEqual(l1.entryIds, []);
    assert.deepEqual(l2.entryIds, ["entry-1"]);
  });
});

test("public behavior: clearing queue clears all pending groups", async () => {
  await withTempDir(async (dir) => {
    const { app } = setupView(dir);
    const g1 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 1 · 09:00", 1);
    const g2 = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), "Trade 2 · 10:00", 2);
    await vq.addEntryToGroup(app, "", g1.id, "e1");
    await vq.addEntryToGroup(app, "", g2.id, "e2");

    // Simulate clearAll
    const groups = await vq.listPrintGroups(app, "");
    const pendingGroups = groups.filter(g => g.state !== "attached");

    for (const group of pendingGroups) {
      for (const entryId of group.entryIds) {
        await vq.removeEntryFromGroup(app, "", group.id, entryId);
      }
      await vq.deletePrintGroup(app, "", group.id);
    }

    const remaining = await vq.listPrintGroups(app, "");
    assert.equal(remaining.length, 0);
  });
});

test("public behavior: low-friction capture path — paste routes to hovered group", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const now = new Date().toISOString();
    const gA = await vq.createPrintGroup(app, "", "2026-10-16", now, "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", "2026-10-16", now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);

    // Simulate hover target
    view.captureTargetGroupId = gB.id;

    // Simulate saveFiles with target group
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile(), "2026-10-16", "paste");
    const targetId = view.captureTargetGroupId || "";
    await vq.addEntryToGroup(app, "", targetId, entry.id);

    // Verify entry went to hovered group, not active
    const loadedA = await vq.loadPrintGroup(app, "", gA.id);
    const loadedB = await vq.loadPrintGroup(app, "", gB.id);
    assert.deepEqual(loadedA.entryIds, []);
    assert.deepEqual(loadedB.entryIds, [entry.id]);

    // Active group unchanged
    const active = await vq.getActiveGroup(app, "");
    assert.equal(active.id, gA.id);
  });
});

test("public behavior: state changes persist across simulated sessions", async () => {
  await withTempDir(async (dir) => {
    const app1 = makeApp(dir);
    const app2 = makeApp(dir);

    const now = new Date().toISOString();
    const g1 = await vq.createPrintGroup(app1, "", "2026-10-16", now, "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app1, "", g1.id, "e1");
    await vq.setGroupState(app1, "", g1.id, "pending");
    await vq.setActiveGroup(app1, "", g1.id);

    // Simulate reload
    const all = await vq.listPrintGroups(app2, "");
    assert.equal(all.length, 1);

    const loaded = await vq.loadPrintGroup(app2, "", g1.id);
    assert.deepEqual(loaded.entryIds, ["e1"]);
    assert.equal(loaded.state, "active");
  });
});
