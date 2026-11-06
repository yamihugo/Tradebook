import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

// Phase E: explicit whole-group filing into Trade Detail. The bundle keeps the
// real seams — the PrintQueueView group card (drag payload), the TradeDetailView
// drop/attach seam, and the printGroup/printGroupAttach/storage libs — against a
// real on-disk vault with an Obsidian stub, so the tests exercise public
// behaviour rather than helper internals.
const bundleResult = await build({
  stdin: {
    contents: [
      'export { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./src/views/printInboxView";',
      'export { TradeDetailView, TRADE_DETAIL_VIEW_TYPE } from "./src/views/tradeDetailView";',
      'export * from "./src/lib/printInbox";',
      'export * from "./src/lib/printGroup";',
      'export * from "./src/lib/printGroupAttach";',
    ].join("\n"),
    resolveDir: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    sourcefile: "print-queue-attach-entry.ts",
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
            "export class TFile { constructor(path){ this.path = path; this.name = (path||'').split('/').pop(); this.extension=(path||'').split('.').pop(); } }",
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

const TRADE_ID = "Tradebook/2026/attachments/trade.md";

function makeApp(root) {
  const app = {
    vault: {
      getAbstractFileByPath(p) {
        if (!p) return null;
        const full = path.join(root, p);
        if (!existsSync(full)) return null;
        return new vq.TFile(p);
      },
      createFolder: async (p) => { await fsPromises.mkdir(path.join(root, p), { recursive: true }); },
      create: async (p, content) => { await fsPromises.mkdir(path.dirname(path.join(root, p)), { recursive: true }); await fsPromises.writeFile(path.join(root, p), content, "utf8"); },
      createBinary: async (p, buf) => { await fsPromises.mkdir(path.dirname(path.join(root, p)), { recursive: true }); await fsPromises.writeFile(path.join(root, p), Buffer.from(buf)); },
      cachedRead: async (file) => await fsPromises.readFile(path.join(root, file.path), "utf8"),
      read: async (file) => await fsPromises.readFile(path.join(root, file.path), "utf8"),
      modify: async (file, content) => { await fsPromises.writeFile(path.join(root, file.path), content, "utf8"); },
      process: async (file, fn) => {
        const current = await fsPromises.readFile(path.join(root, file.path), "utf8");
        await fsPromises.writeFile(path.join(root, file.path), fn(current), "utf8");
      },
      delete: async (file) => { await fsPromises.unlink(path.join(root, file.path)); },
      getResourcePath: (file) => `vault://${file.path}`,
      getFiles: () => {
        const files = [];
        const walk = (dir) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile()) files.push({ path: path.relative(root, full), name: e.name, extension: e.name.split(".").pop() });
          }
        };
        walk(root);
        return files;
      },
    },
    metadataCache: { getFirstLinkpathDest: () => null },
  };
  return app;
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "printqueue-attach-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeTradeDetail(dir, app, trade) {
  const plugin = { app, getTradesFolder: () => "Tradebook", settings: { timeZone: "UTC" } };
  const view = new vq.TradeDetailView(null, plugin);
  view.app = app;
  view.contentEl = { ownerDocument: globalThis.document ?? { defaultView: null } };
  view.trade = trade;
  view.render = () => {};
  return view;
}

async function createEntry(app, name) {
  const file = { name: `${name}.png`, type: "image/png", arrayBuffer: async () => new ArrayBuffer(8) };
  return await vq.savePrintInboxEntry(app, "Tradebook", file, "2026-10-16", "file");
}

async function createPendingGroup(app, name, entryIds) {
  const group = await vq.createPrintGroup(app, "", "2026-10-16", new Date().toISOString(), name, 1);
  for (const id of entryIds) await vq.addEntryToGroup(app, "", group.id, id);
  await vq.setGroupState(app, "", group.id, "pending");
  return group;
}

function seedTradeNote(dir, frontmatter) {
  const p = path.join(dir, TRADE_ID);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, frontmatter ?? "---\ntype: trade\ndate: 2026-10-16\nsymbol: MNQ\nscreenshot: ''\n---\n\n# MNQ trade\n", "utf8");
  return p;
}

// ---- drag payload (public seam: the view emits it, Trade Detail accepts it) ----

test("drag payload carries only the group id under the private MIME type", () => {
  const raw = vq.makePrintGroupDragPayload("pg-1");
  assert.equal(JSON.parse(raw).groupId, "pg-1");
  assert.equal(vq.PRINT_GROUP_MIME, "application/x-tradebook-print-group");
});

test("drag payload parse rejects foreign, malformed and empty data", () => {
  assert.equal(vq.parsePrintGroupDragPayload(""), null);
  assert.equal(vq.parsePrintGroupDragPayload("not json"), null);
  assert.equal(vq.parsePrintGroupDragPayload(JSON.stringify({ entryId: "e1" })), null);
  assert.equal(vq.parsePrintGroupDragPayload(JSON.stringify({ v: 2, groupId: "pg-1" })), null);
  assert.deepEqual(vq.parsePrintGroupDragPayload(JSON.stringify({ v: 1, groupId: "pg-1" })), { v: 1, groupId: "pg-1" });
});

test("print queue group card is draggable and emits the private MIME payload", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    const entry = await createEntry(app, "chart");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const plugin = { app, getTradesFolder: () => "Tradebook", settings: { timeZone: "UTC" } };
    const view = new vq.PrintQueueView(null, plugin);
    view.app = app;
    view.entries = [entry];
    view.refresh = async () => {};

    // Minimal DOM stub: enough for renderGroup to attach its listeners.
    const makeEl = () => {
      const el = {
        attrs: {}, listeners: {}, children: [], classes: new Set(),
        setAttr(k, v) { this.attrs[k] = v; }, getAttr(k) { return this.attrs[k]; },
        addClass(c) { c.split(/\s+/).forEach((x) => this.classes.add(x)); }, removeClass(c) { this.classes.delete(c); },
        toggleClass(c, on) { if (on) this.addClass(c); else this.removeClass(c); },
        addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
        createEl(_tag, opts) { const c = makeEl(); if (opts?.cls) opts.cls.split(/\s+/).forEach((x) => c.classes.add(x)); this.children.push(c); return c; },
        createDiv(opts) { const c = makeEl(); if (opts?.cls) opts.cls.split(/\s+/).forEach((x) => c.classes.add(x)); this.children.push(c); return c; },
        createSpan(opts) { const c = makeEl(); if (opts?.cls) opts.cls.split(/\s+/).forEach((x) => c.classes.add(x)); this.children.push(c); return c; },
        empty() {}, setText() {}, setCssStyles() {},
      };
      return el;
    };
    const parent = makeEl();
    view.renderGroup(parent, group);
    const card = parent.children[0];
    assert.ok(card, "renderGroup created the group card");
    assert.ok(card.classes.has("tj-print-group"), "created element is the group card");

    assert.equal(card.attrs.draggable, "true");
    const dt = { data: {}, effectAllowed: "", setData(type, value) { this.data[type] = value; }, getData(type) { return this.data[type] ?? ""; } };
    card.listeners.dragstart[0]({ target: { closest: () => null }, dataTransfer: dt });
    assert.equal(dt.data[vq.PRINT_GROUP_MIME], vq.makePrintGroupDragPayload(group.id));

    // A drag started on an entry row belongs to the row, not the whole group.
    const rowDt = { data: {}, setData(t, v) { this.data[t] = v; }, getData(t) { return this.data[t] ?? ""; } };
    card.listeners.dragstart[0]({ target: { closest: (s) => (s === ".tj-print-inbox-entry" ? {} : null) }, dataTransfer: rowDt });
    assert.equal(rowDt.data[vq.PRINT_GROUP_MIME], undefined);
  });
});

// ---- secondary attach action ----

test("secondary attach lists exactly the pending groups (attached ones are gone)", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    const e1 = await createEntry(app, "a");
    const g1 = await createPendingGroup(app, "Trade 1 · 09:42", [e1.id]);
    const e2 = await createEntry(app, "b");
    const g2 = await createPendingGroup(app, "Trade 2 · 10:02", [e2.id]);
    await vq.attachGroupSidecar(app, "", g2.id, TRADE_ID);
    const pending = await vq.listPendingAttachGroups(app, "");
    assert.deepEqual(pending.map((g) => g.id), [g1.id]);
  });
});

test("secondary attach appends group prints without carrying queue-only time or label into the Trade", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    const notePath = seedTradeNote(dir, "---\ntype: trade\ndate: 2026-10-16\nsymbol: MNQ\nentry_time: '14:32'\nscreenshot: ''\n---\n\n# MNQ trade\n");
    const e1 = await createEntry(app, "a");
    const e2 = await createEntry(app, "b");
    const group = await createPendingGroup(app, "Queue-only matching label", [e1.id, e2.id]);
    await vq.setTradeTimeHint(app, "", group.id, "09:42", "America/New_York");
    const originalEntryTime = "14:32";
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", entryTime: originalEntryTime, screenshot: "", screenshots: [] };
    const view = makeTradeDetail(dir, app, trade);
    const outcome = await view.attachPrintGroup(group.id);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.idempotent, false);
    assert.equal(outcome.screenshotCount, 2);
    assert.equal(trade.entryTime, originalEntryTime, "attaching prints leaves Trade entry time unchanged");
    const note = readFileSync(notePath, "utf8");
    assert.match(note, new RegExp(`- file: "${e1.imagePath}"`));
    assert.match(note, new RegExp(`- file: "${e2.imagePath}"`));
    assert.ok(note.indexOf(e1.imagePath) < note.indexOf(e2.imagePath), "appended in group order");
    assert.match(note, /entry_time: '14:32'/, "the saved Trade time is unchanged");
    assert.doesNotMatch(note, /Queue-only matching label|trade_time_hint|trade_time_hint_zone/);
  });
});

// ---- drop seam ----

test("drop of a valid group payload files the group and updates the trade note", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    seedTradeNote(dir);
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "", screenshots: [] };
    const view = makeTradeDetail(dir, app, trade);
    await view.handlePrintGroupDrop(vq.makePrintGroupDragPayload(group.id));
    const reloaded = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(reloaded.state, "attached");
    assert.equal(reloaded.attachedTradeId, TRADE_ID);
    assert.equal(trade.screenshots.length, 1);
  });
});

test("drop of a foreign payload is rejected without touching the queue or the note", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    const notePath = seedTradeNote(dir);
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "", screenshots: [] };
    const view = makeTradeDetail(dir, app, trade);
    await view.handlePrintGroupDrop("text/html:<img>");
    const reloaded = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(reloaded.state, "pending");
    assert.equal(readFileSync(notePath, "utf8").includes(entry.imagePath), false);
  });
});

// ---- append / idempotence / legacy scalar ----

test("attach appends to existing screenshots instead of overwriting", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    seedTradeNote(dir, "---\ntype: trade\ndate: 2026-10-16\nsymbol: MNQ\nscreenshot: 'old.png'\nscreenshots:\n  - file: \"old.png\"\n---\n\n# MNQ trade\n");
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = {
      id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "old.png",
      screenshots: [{ file: "old.png" }],
    };
    const outcome = await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");
    assert.equal(outcome.ok, true);
    assert.deepEqual(trade.screenshots.map((s) => s.file), ["old.png", entry.imagePath]);
    assert.equal(trade.screenshot, "old.png", "legacy scalar stays on the first screenshot");
  });
});

test("re-attaching an attached group is an idempotent no-op with no duplicates", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    const notePath = seedTradeNote(dir);
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "", screenshots: [] };
    const first = await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");
    assert.equal(first.ok, true);
    assert.equal(first.idempotent, false);
    const before = readFileSync(notePath, "utf8");
    const second = await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");
    assert.equal(second.ok, true);
    assert.equal(second.idempotent, true);
    assert.equal(second.screenshotCount, 0);
    assert.equal(readFileSync(notePath, "utf8"), before, "note unchanged on a no-op");
    assert.equal(trade.screenshots.length, 1);
  });
});

test("attach references the existing vault image and never moves or copies it", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    seedTradeNote(dir);
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "", screenshots: [] };
    await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");
    assert.ok(existsSync(path.join(dir, entry.imagePath)), "original image file preserved");
    assert.ok(existsSync(path.join(dir, entry.metadataPath)), "print metadata sidecar preserved");
    assert.equal(trade.screenshots[0].file, entry.imagePath, "trade references the existing vault path");
    const sidecar = readFileSync(path.join(dir, entry.metadataPath), "utf8");
    assert.match(sidecar, /status: unassigned/, "entry status left intact for legacy readers");
  });
});

test("attach preserves legacy prints that live only in the screenshot scalar", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    seedTradeNote(dir, "---\ntype: trade\ndate: 2026-10-16\nsymbol: MNQ\nscreenshot: 'legacy.png'\n---\n\n# MNQ trade\n");
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "legacy.png", screenshots: [] };
    const outcome = await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");
    assert.equal(outcome.ok, true);
    assert.deepEqual(trade.screenshots.map((s) => s.file), ["legacy.png", entry.imagePath]);
    // The legacy scalar keeps pointing at the FIRST screenshot (spec §94).
    assert.equal(trade.screenshot, "legacy.png");
    const note = readFileSync(path.join(dir, TRADE_ID), "utf8");
    assert.match(note, /- file: "legacy.png"/, "legacy print survives in the note block");
  });
});

// ---- persistence / reload ----

test("attached state survives reload and the group leaves the pending queue", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    seedTradeNote(dir);
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "", screenshots: [] };
    await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");

    // Reload the whole sidecar set from disk, as a fresh plugin activation does.
    const groups = await vq.listPrintGroups(makeApp(dir), "");
    const filed = groups.find((g) => g.id === group.id);
    assert.equal(filed.state, "attached");
    assert.equal(filed.attachedTradeId, TRADE_ID);
    const pending = await vq.listPendingAttachGroups(makeApp(dir), "");
    assert.equal(pending.some((g) => g.id === group.id), false);
    const sidecarText = readFileSync(path.join(dir, "print-groups", `${group.id}.md`), "utf8");
    assert.match(sidecarText, new RegExp(`attached_trade: '${TRADE_ID}'`));
  });
});

// ---- rollback on failure ----

test("failed trade write rolls the group back to pending and keeps it recoverable", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    const notePath = seedTradeNote(dir);
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const originalProcess = app.vault.process;
    app.vault.process = async () => { throw new Error("disk full"); };
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "", screenshots: [] };
    const outcome = await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");
    app.vault.process = originalProcess;

    assert.equal(outcome.ok, false);
    assert.equal(outcome.rolledBack, false);
    assert.match(outcome.error, /disk full/);
    assert.match(outcome.error, /group remains available in the queue/);
    const reloaded = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(reloaded.state, "pending", "group left pending and recoverable");
    assert.equal(reloaded.attachedTradeId, undefined, "trade link cleared on rollback");
    assert.deepEqual(trade.screenshots, [], "in-memory trade untouched");
    assert.equal(readFileSync(notePath, "utf8").includes(entry.imagePath), false, "note not partially rewritten");
    assert.ok(existsSync(path.join(dir, entry.imagePath)), "evidence still on disk");

    // Recoverable: the same group can be attached again successfully.
    const retry = await vq.attachGroupToTrade(app, trade, TRADE_ID, group.id, "", "Tradebook");
    assert.equal(retry.ok, true);
    assert.equal(retry.screenshotCount, 1);
    assert.equal((await vq.loadPrintGroup(app, "", group.id)).state, "attached");
  });
});

test("attach refuses a missing group or missing trade note without side effects", async () => {
  await withTempDir(async (dir) => {
    const app = makeApp(dir);
    seedTradeNote(dir);
    const entry = await createEntry(app, "entry");
    const group = await createPendingGroup(app, "Trade 1 · 09:42", [entry.id]);
    const trade = { id: TRADE_ID, date: "2026-10-16", symbol: "MNQ", screenshot: "", screenshots: [] };
    const missing = await vq.attachGroupToTrade(app, trade, TRADE_ID, "pg-does-not-exist", "", "Tradebook");
    assert.equal(missing.ok, false);
    assert.equal((await vq.loadPrintGroup(app, "", group.id)).state, "pending");

    const noNote = await vq.attachGroupToTrade(app, trade, "Tradebook/2026/attachments/absent.md", group.id, "", "Tradebook");
    assert.equal(noNote.ok, false);
    assert.equal(noNote.rolledBack, false);
    assert.equal((await vq.loadPrintGroup(app, "", group.id)).state, "pending", "validation happens before any write");
  });
});

// ---- wiring + CSS ----

test("Trade Detail dropzone wires the private Print Queue MIME drop path", () => {
  const src = readFileSync(new URL("../src/views/tradeDetailView.ts", import.meta.url), "utf8");
  assert.match(src, /getData\(PRINT_GROUP_MIME\)/, "drop handler reads the private MIME");
  assert.match(src, /handlePrintGroupDrop\(groupRaw\)/, "drop delegates to the attach seam");
  assert.doesNotMatch(src, /openAttachPicker\(attachBtn\)/, "no redundant attach button in the trade panel");
  assert.match(src, /attachPrintGroup\(g\.id\)/, "queue drop uses the same attach seam");
});


test("Trade Detail preserves every pending review editor through refreshes", () => {
  const src = readFileSync(new URL("../src/views/tradeDetailView.ts", import.meta.url), "utf8");
  assert.match(src, /const editorStates =[^;]*querySelectorAll<HTMLTextAreaElement>\("\.tj-td-textarea"\)/s);
  assert.match(src, /selectionStart: area\.selectionStart/);
  assert.match(src, /scrollTop: area\.scrollTop/);
  assert.match(src, /for \(const editorState of editorStates\)/);
  assert.match(src, /if \(editorState\.active\) nextEditor\.focus\(\{ preventScroll: true \}\)/);
  assert.match(src, /preservedScroll = root\.childElementCount > 0/);
  assert.match(src, /scrollHost\.scrollTop = preservedScroll\.top/);
});

test("Trade Detail screenshot thumbs support drag reorder without arrow controls", () => {
  const src = readFileSync(new URL("../src/views/tradeDetailView.ts", import.meta.url), "utf8");
  assert.match(src, /reorderScreenshots\(from: number, to: number\)/);
  assert.match(src, /application\/x-tradebook-screenshot-index/);
  assert.match(src, /tradebook-screenshot:/);
  assert.match(src, /thumb\.addEventListener\("dragenter"/);
  assert.match(src, /thumb\.addEventListener\("drop"/);
  assert.match(src, /await this\.saveScreenshotsNow\(\)/);
  assert.doesNotMatch(src, /Move print .* earlier/);
  assert.doesNotMatch(src, /tj-td-shot-order/);
});

test("Trade Detail visual analysis actions remain explicit and accessible", () => {
  const src = readFileSync(new URL("../src/views/tradeDetailView.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(src, /text: "Attach from Print Queue"/);
  assert.match(src, /text: "Mark up"/);
  assert.doesNotMatch(src, /text: "Annotate"/);
  assert.doesNotMatch(src, /text: "Enlarge"/);
  assert.match(src, /wheel zooms around the pointer/);
  assert.match(src, /dragging pans the image/);
  assert.match(src, /Scroll to zoom · drag to pan · Esc to close/);
  assert.match(src, /tj-td-shot-remove-icon/);
  assert.match(css, /\.tj-td-dropzone-actions \.tj-td-media-action[\s\S]*background: transparent/);
  assert.match(css, /\.tj-td-shot-remove-icon/);
  assert.match(css, /\.tj-td-cols[\s\S]*align-items: stretch/);
});
test("group drag and picker styles use existing tokens with a visible hit target", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tj-print-group-dragging\s*\{/);
  assert.match(css, /\.tj-td-tagpop\s*\{/);
  assert.match(css, /\.tj-td-tagpop-row\s*\{/);
});