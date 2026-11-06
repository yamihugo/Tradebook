import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

// Bundle the PrintQueueView together with its PrintInbox / PrintGroup libs and
// an Obsidian stub, so the view's public remove / reorder / move / keyboard
// flows can be executed against a real on-disk vault (behavioural evidence,
// not source-text sniffing).
const bundleResult = await build({
  stdin: {
    contents: [
      'export { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./src/views/printInboxView";',
      'export * from "./src/lib/printInbox";',
      'export * from "./src/lib/printGroup";',
    ].join("\n"),
    resolveDir: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    sourcefile: "print-queue-view-entry.ts",
  },
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
          contents: [
            "export const normalizePath = (p) => (p || '').replace(/^\\//, '');",
            "export class TFile { constructor(path){ this.path = path; this.name = (path||'').split('/').pop(); } }",
            "export class App {}",
            "export class WorkspaceLeaf {}",
            "export class Notice {}",
            "export class Modal { constructor(app){} open(){ this.onOpen?.(); } close(){ this.onClose?.(); } }",
            "export function setIcon() {}",
            "export class ItemView { constructor(leaf){ this.leaf = leaf; } containerEl = null; contentEl = null; registerDomEvent(){} registerEvent(){} }",
          ].join("\n"),
          loader: "js",
        }));
      },
    },
  ],
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
      create: async (p, content) => { await fsPromises.writeFile(path.join(root, p), content, "utf8"); },
      createBinary: async (p, buf) => { await fsPromises.writeFile(path.join(root, p), Buffer.from(buf)); },
      cachedRead: async (file) => { return await fsPromises.readFile(path.join(root, file.path), "utf8"); },
      modify: async (file, content) => { await fsPromises.writeFile(path.join(root, file.path), content, "utf8"); },
      delete: async (file) => { await fsPromises.unlink(path.join(root, file.path)); },
      getFiles: () => {
        const files = [];
        const walk = (dir) => {
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "printqueue-view-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeView(dir) {
  const app = makeApp(dir);
  const plugin = { app, getTradesFolder: () => "Tradebook", settings: { timeZone: "UTC" } };
  const view = new vq.PrintQueueView(null, plugin);
  // The view's refresh()/render() build Obsidian DOM; the public flows we
  // exercise here only need persistence, so stub the render cycle.
  view.refresh = async () => {};
  view.render = () => {};
  return { view, app };
}

async function createEntry(app, note) {
  const file = { name: `${crypto.randomUUID()}.png`, type: "image/png", arrayBuffer: async () => new ArrayBuffer(8) };
  return await vq.savePrintInboxEntry(app, "Tradebook", file, "2026-10-16", "file");
}
async function createGroupWithEntries(app, name, entryIds) {
  const now = new Date().toISOString();
  const group = await vq.createPrintGroup(app, "", "2026-10-16", now, name, 1);
  for (const id of entryIds) await vq.addEntryToGroup(app, "", group.id, id);
  return group;
}

test("removeEntry moves the inbox entry to trash and removes its group reference", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = makeView(dir);
    const entry = await createEntry(app);
    const group = await createGroupWithEntries(app, "Trade 1 · 09:42", [entry.id]);
    await view.removeEntry(entry);
    // group no longer references the entry
    const reloaded = await vq.loadPrintGroup(app, "", group.id);
    assert.deepEqual(reloaded.entryIds, []);
    // Queue paths are gone; both files are recoverable in the configured-trash test double.
    assert.equal(existsSync(path.join(dir, entry.imagePath)), false);
    assert.equal(existsSync(path.join(dir, entry.metadataPath)), false);
    assert.equal(existsSync(path.join(dir, ".trash", entry.imagePath)), true);
    assert.equal(existsSync(path.join(dir, ".trash", entry.metadataPath)), true);
  });
});

test("removeEntry aborts and leaves the inbox entry when group removal fails", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = makeView(dir);
    const entry = await createEntry(app);
    const group = await createGroupWithEntries(app, "Trade 1 · 09:42", [entry.id]);
    // Simulate a persistence failure on the group sidecar write.
    const originalModify = app.vault.modify.bind(app.vault);
    app.vault.modify = async (file, content) => { throw new Error("modify failed"); };
    await view.removeEntry(entry);
    app.vault.modify = originalModify;
    // inbox entry preserved
    assert.equal(existsSync(path.join(dir, entry.imagePath)), true);
    assert.equal(existsSync(path.join(dir, entry.metadataPath)), true);
    // group still references the entry (no dangling removal)
    const reloaded = await vq.loadPrintGroup(app, "", group.id);
    assert.deepEqual(reloaded.entryIds, [entry.id]);
  });
});

test("reorderEntry persists the new entryIds order", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = makeView(dir);
    const group = await createGroupWithEntries(app, "Trade 1 · 09:42", ["a", "b", "c"]);
    await view.reorderEntry(group.id, "b", -1);
    const reloaded = await vq.loadPrintGroup(app, "", group.id);
    assert.deepEqual(reloaded.entryIds, ["b", "a", "c"]);
  });
});

test("reorderEntry is a no-op when the target position does not change", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = makeView(dir);
    const group = await createGroupWithEntries(app, "Trade 1 · 09:42", ["a", "b", "c"]);
    await view.reorderEntry(group.id, "a", -1); // already first
    const reloaded = await vq.loadPrintGroup(app, "", group.id);
    assert.deepEqual(reloaded.entryIds, ["a", "b", "c"]);
  });
});

test("moveEntryBetweenGroups transfers an entry and persists on both sides", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = makeView(dir);
    const g1 = await createGroupWithEntries(app, "Trade 1 · 09:42", ["x"]);
    const g2 = await createGroupWithEntries(app, "Trade 2 · 10:00", []);
    await view.moveEntryBetweenGroups("x", g1.id, g2.id);
    const l1 = await vq.loadPrintGroup(app, "", g1.id);
    const l2 = await vq.loadPrintGroup(app, "", g2.id);
    assert.deepEqual(l1.entryIds, []);
    assert.deepEqual(l2.entryIds, ["x"]);
  });
});

test("moveEntryBetweenGroups is a no-op when dropping onto the same group", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = makeView(dir);
    const g1 = await createGroupWithEntries(app, "Trade 1 · 09:42", ["x"]);
    await view.moveEntryBetweenGroups("x", g1.id, g1.id);
    const reloaded = await vq.loadPrintGroup(app, "", g1.id);
    assert.deepEqual(reloaded.entryIds, ["x"]);
  });
});

test("keyboard: ArrowUp/Down delegate to reorderEntry with the correct delta", async () => {
  await withTempDir(async (dir) => {
    const { view } = makeView(dir);
    const entry = { id: "e1", title: "Chart", capturedAt: "2026-10-16T09:42:00.000Z" };
    const calls = [];
    view.reorderEntry = async (groupId, entryId, delta) => { calls.push({ groupId, entryId, delta }); };
    const ev = (key) => ({ key, preventDefault: () => {}, stopPropagation: () => {} });

    view.handleEntryKeydown(ev("ArrowUp"), entry, "g1");
    view.handleEntryKeydown(ev("ArrowDown"), entry, "g1");
    assert.deepEqual(calls, [
      { groupId: "g1", entryId: "e1", delta: -1 },
      { groupId: "g1", entryId: "e1", delta: 1 },
    ]);
  });
});

test("keyboard: Arrow keys are ignored for unsorted entries (no group)", async () => {
  await withTempDir(async (dir) => {
    const { view } = makeView(dir);
    const entry = { id: "e1", title: "Chart", capturedAt: "2026-10-16T09:42:00.000Z" };
    let called = false;
    view.reorderEntry = async () => { called = true; };
    view.handleEntryKeydown({ key: "ArrowUp", preventDefault: () => {} }, entry);
    view.handleEntryKeydown({ key: "ArrowDown", preventDefault: () => {} }, entry);
    assert.equal(called, false);
  });
});

test("keyboard: Delete/Backspace delegate to removeEntry", async () => {
  await withTempDir(async (dir) => {
    const { view } = makeView(dir);
    const entry = { id: "e1", title: "Chart", capturedAt: "2026-10-16T09:42:00.000Z" };
    const removed = [];
    view.removeEntry = async (e) => { removed.push(e); };
    view.handleEntryKeydown({ key: "Delete", preventDefault: () => {} }, entry);
    view.handleEntryKeydown({ key: "Backspace", preventDefault: () => {} }, entry);
    assert.equal(removed.length, 2);
    assert.equal(removed[0], entry);
    assert.equal(removed[1], entry);
  });
});

test("keyboard: Enter/Space select the entry (activation preserved)", async () => {
  await withTempDir(async (dir) => {
    const { view } = makeView(dir);
    const entry = { id: "e1", title: "Chart", capturedAt: "2026-10-16T09:42:00.000Z" };
    view.handleEntryKeydown({ key: "Enter", preventDefault: () => {} }, entry);
    assert.equal(view.selectedId, "e1");
    view.handleEntryKeydown({ key: " ", preventDefault: () => {} }, entry);
    assert.equal(view.selectedId, "e1");
  });
});

test("thumbnail drag and drag-over feedback use the visual filmstrip tokens", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tj-print-group-film-item\s*\{[^}]*cursor:\s*grab/);
  assert.match(css, /\.tj-print-group-film-thumb\s*\{[^}]*width:\s*190px/);
  assert.match(css, /\.tj-print-group-drag-over\s*\{/);
  assert.match(css, /\.tj-print-group-film-item\.is-drop-before\s*\{[^}]*box-shadow/);
  assert.match(css, /\.tj-print-group-film-item\.is-drop-after\s*\{[^}]*box-shadow/);
  assert.match(css, /var\(--text-normal\)/);
  assert.match(css, /min-(width|height):\s*28px/);
});