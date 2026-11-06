import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

const TEST_JOURNAL_DATE = new Date().toISOString().slice(0, 10);

const bundleResult = await build({
  stdin: {
    contents: [
      'export { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./src/views/printInboxView";',
      'export * from "./src/lib/printInbox";',
      'export * from "./src/lib/printGroup";',
      'export * from "./src/lib/printGroupAttach";',
    ].join("\n"),
    resolveDir: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    sourcefile: "print-queue-regression-entry.ts",
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
            "export const normalizePath = (p) => p || '';",
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
    },
  ],
});
const vq = await import(`data:text/javascript;base64,${Buffer.from(bundleResult.outputFiles[0].text).toString("base64")}`);

const viewSource = fs.readFileSync(new URL("../src/views/printInboxView.ts", import.meta.url), "utf8");

function makeApp(root) {
  return {
    vault: {
      getAbstractFileByPath(p) {
        if (!p) return null;
        const full = path.join(root, p);
        if (!fs.existsSync(full)) return null;
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
      getResourcePath: (file) => `vault://${file.path}`,
      getFiles: () => {
        const files = [];
        const walk = (dir) => {
          if (!fs.existsSync(dir)) return;
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
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "printqueue-regression-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeStubEl() {
  const el = {
    attrs: {},
    listeners: {},
    children: [],
    classes: new Set(),
    text: "",
    value: "",
    files: null,
    setAttr(k, v) { this.attrs[k] = v; },
    getAttr(k) { return this.attrs[k]; },
    addClass(c) { c.split(/\s+/).forEach((x) => this.classes.add(x)); },
    removeClass(c) { this.classes.delete(c); },
    toggleClass(c, on) { if (on) this.addClass(c); else this.removeClass(c); },
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
    dispatch(t, evt = {}) { for (const fn of this.listeners[t] ?? []) fn(evt); },
    click() { this.clicked = (this.clicked ?? 0) + 1; this.dispatch("click", { stopPropagation() {}, preventDefault() {} }); },
    createEl(tag, opts) {
      const c = makeStubEl();
      c._tag = tag;
      if (opts?.cls) opts.cls.split(/\s+/).forEach((x) => c.classes.add(x));
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
  return el;
}

function setupRealView(dir) {
  const app = makeApp(dir);
  const plugin = { app, getTradesFolder: () => "Tradebook", settings: { timeZone: "UTC" } };
  const view = new vq.PrintQueueView(null, plugin);
  view.app = app;
  view.contentEl = makeStubEl();
  view.containerEl = makeStubEl();
  return { view, app };
}

function makeMockImageFile(name = "test.png") {
  return { name, type: "image/png", arrayBuffer: async () => new ArrayBuffer(8) };
}

function walkStub(el, visitor) {
  visitor(el);
  for (const child of el.children) walkStub(child, visitor);
}

function collectClasses(el) {
  const out = [];
  walkStub(el, (node) => { for (const cls of node.classes) out.push(cls); });
  return out;
}

function collectTexts(el) {
  const out = [];
  walkStub(el, (node) => { if (node.text) out.push(node.text); });
  return out;
}

function findByClass(el, cls) {
  let found = null;
  walkStub(el, (node) => { if (!found && node.classes.has(cls)) found = node; });
  return found;
}

function findByText(el, text) {
  let found = null;
  walkStub(el, (node) => { if (!found && node.text === text) found = node; });
  return found;
}

function dispatchClick(el) {
  el.dispatch("click", { stopPropagation() {}, preventDefault() {} });
}

test("empty state shows only Paste clipboard and Choose print", async () => {
  await withTempDir(async (dir) => {
    const { view } = setupRealView(dir);
    view.entries = [];
    view.groups = [];
    view.render();

    const classes = collectClasses(view.contentEl);
    const texts = collectTexts(view.contentEl);

    assert.ok(classes.includes("tj-print-inbox-empty"), "empty card must be present");
    assert.ok(classes.includes("tj-print-inbox-paste"), "Paste clipboard button must be present");
    assert.ok(classes.includes("tj-print-inbox-choose"), "Choose print button must be present");
    assert.ok(texts.includes("Paste clipboard"), "empty state must label the clipboard action");
    assert.ok(texts.includes("Choose print"), "empty state must label the file action");

    // No extra empty-state furniture and no rejected controls.
    assert.ok(!classes.includes("tj-print-inbox-new-lane"), "empty state must not offer a new-lane action");
    assert.ok(!classes.includes("tj-print-inbox-header"), "empty state must not render a header");
    assert.ok(!classes.includes("tj-print-inbox-capture"), "old capture control must be gone");
    assert.ok(!classes.includes("tj-print-inbox-add-trade"), "old Add Trade control must be gone");
    for (const rejected of [/new print group/i, /capture screenshot/i, /print note/i, /open image/i, /paste or choose a print/i, /paste an image from the clipboard/i]) {
      assert.ok(!texts.some((t) => rejected.test(t)), `empty state must not contain ${rejected}`);
    }
  });
});

test("first paste creates the first visual lane automatically", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);
    await view.refresh();
    assert.equal((await vq.listPrintGroups(app, "")).length, 0, "queue starts empty");

    await view.saveFiles([makeMockImageFile("1.png")], "paste");

    const groups = await vq.listPrintGroups(app, "");
    assert.equal(groups.length, 1, "first paste creates one lane");
    assert.equal(groups[0].name, "Group 1", "first lane uses a neutral editable group label");
    assert.equal(groups[0].state, "active", "first lane is active");
    assert.equal(groups[0].entryIds.length, 1, "first print is filed into the lane");

    const classes = collectClasses(view.contentEl);
    assert.ok(classes.includes("tj-print-group"), "first lane renders as a group card");
    assert.ok(classes.includes("tj-print-group-film-item"), "first lane renders an image-first filmstrip item");
    assert.ok(classes.includes("tj-print-group-film-thumb"), "filmstrip item renders a thumbnail");
    assert.ok(classes.includes("tj-print-inbox-new-lane"), "new-lane action appears once a lane exists");
    assert.ok(!classes.includes("tj-print-inbox-empty"), "empty state is replaced by the lane");
  });
});

test("repeated paste: paste #1 creates lane, paste #2 and #3 append to the same lane in order", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    await view.refresh();
    await view.saveFiles([makeMockImageFile("1.png")], "paste");
    const groupId1 = (await vq.getActiveGroup(app, "")).id;

    await view.saveFiles([makeMockImageFile("2.png")], "paste");
    await view.saveFiles([makeMockImageFile("3.png")], "paste");

    const active = await vq.getActiveGroup(app, "");
    assert.equal(active.id, groupId1, "active lane is unchanged across pastes");
    const loaded = await vq.loadPrintGroup(app, "", active.id);
    assert.equal(loaded.entryIds.length, 3, "all three prints stay in the intended lane");
    assert.equal(new Set(loaded.entryIds).size, 3, "each print is a distinct entry");
  });
});

test("hover routing: Ctrl+V over a lane routes the capture into that lane only", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);
    const now = new Date().toISOString();
    const gA = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);
    await view.refresh();

    const currentDay = findByClass(view.listEl, "tj-print-inbox-current-day");
    const cardB = currentDay?.children.find((c) => c.attrs["data-group-id"] === gB.id);
    assert.ok(cardB, "lane B card is rendered");
    cardB.dispatch("pointerover");
    assert.equal(view.captureTargetGroupId, gB.id);

    await view.saveFiles([makeMockImageFile("hover.png")], "paste");

    assert.equal((await vq.loadPrintGroup(app, "", gA.id)).entryIds.length, 0, "hovered lane B wins over active lane A");
    assert.equal((await vq.loadPrintGroup(app, "", gB.id)).entryIds.length, 1);
    assert.equal((await vq.getActiveGroup(app, "")).id, gA.id, "hover routing does not change the active lane");

    cardB.dispatch("pointerout");
    assert.equal(view.captureTargetGroupId, "");
  });
});

test("focus routing: focusing a lane routes the capture into that lane only", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);
    const now = new Date().toISOString();
    const gA = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);
    await view.refresh();

    const currentDay = findByClass(view.listEl, "tj-print-inbox-current-day");
    const cardB = currentDay?.children.find((c) => c.attrs["data-group-id"] === gB.id);
    cardB.dispatch("focusin");
    assert.equal(view.captureTargetGroupId, gB.id);

    await view.saveFiles([makeMockImageFile("focus.png")], "paste");
    assert.equal((await vq.loadPrintGroup(app, "", gA.id)).entryIds.length, 0);
    assert.equal((await vq.loadPrintGroup(app, "", gB.id)).entryIds.length, 1);

    cardB.dispatch("focusout");
    assert.equal(view.captureTargetGroupId, "");
  });
});

test("every lane exposes paste and choose-file affordances targeted at that lane", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);
    const now = new Date().toISOString();
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("chart.png"), TEST_JOURNAL_DATE, "file");
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app, "", group.id, entry.id);
    await view.refresh();

    const card = findByClass(view.contentEl, "tj-print-group");
    const pasteBtn = findByClass(card, "tj-print-group-paste");
    const chooseBtn = findByClass(card, "tj-print-group-choose");
    assert.ok(pasteBtn, "lane has a paste affordance");
    assert.ok(chooseBtn, "lane has a choose-file affordance");
    assert.equal(pasteBtn.text, "Paste");
    assert.equal(chooseBtn.text, "Choose file");

    const targets = [];
    view.pasteFromClipboard = async (groupId) => { targets.push(groupId); };
    dispatchClick(pasteBtn);
    assert.deepEqual(targets, [group.id], "lane paste targets its own lane");

    view.pickerEl = { value: "", click() {} };
    dispatchClick(chooseBtn);
    assert.equal(view.pickerTargetGroupId, group.id, "lane choose targets its own lane");
  });
});

test("new-lane action is minimal, appears only after the first lane, and creates an active lane", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);
    await view.refresh();
    assert.equal(findByClass(view.contentEl, "tj-print-inbox-new-lane"), null, "no new-lane action while empty");

    await view.saveFiles([makeMockImageFile("first.png")], "paste");
    const newLane = findByClass(view.contentEl, "tj-print-inbox-new-lane");
    assert.ok(newLane, "new-lane action appears after the first lane");
    assert.deepEqual(collectTexts(newLane), ["New group"]);

    dispatchClick(newLane);
    for (let i = 0; i < 80; i += 1) {
      const current = await vq.getActiveGroup(app, "");
      if ((await vq.listPrintGroups(app, "")).length >= 2 && current?.name === "Group 2") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const groups = await vq.listPrintGroups(app, "");
    assert.equal(groups.length, 2, "new-lane action creates a second lane");
    const active = await vq.getActiveGroup(app, "");
    assert.equal(active.name, "Group 2", "new group becomes active");
  });
});

test("internal drags never enter the file-drop importer", () => {
  assert.match(viewSource, /if \(this\.readEntryDrag\(event\) \|\| event\.dataTransfer\?\.getData\(PRINT_GROUP_MIME\)\) return;/);
});


test("clear confirmation is compact and ghost-styled", () => {
  const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.tj-print-clear-modal\s*\{[^}]*width:\s*min\(390px/);
  assert.match(css, /\.tj-print-clear-modal-icon\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.tj-print-clear-modal \.tj-confirm-actions button\s*\{[^}]*background:\s*transparent !important/);
});


test("clear-all action resets pending queue without leaving empty lanes", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);
    await view.saveFiles([makeMockImageFile("first.png")], "paste");
    const clear = findByClass(view.contentEl, "tj-print-inbox-clear-all");
    assert.ok(clear, "clear-all appears once the queue has content");
    assert.match(viewSource, /new ClearPrintQueueModal\(this\.app/);
    assert.doesNotMatch(viewSource, /window\.confirm/);
    assert.match(viewSource, /class ClearPrintQueueModal extends Modal/);
    assert.match(viewSource, /Attached trades will stay untouched/);
  });
});


test("rejected controls and primary filenames never render", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);
    const now = new Date().toISOString();
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("TopSecretFileName.png"), TEST_JOURNAL_DATE, "file");
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app, "", group.id, entry.id);
    await view.refresh();

    const texts = collectTexts(view.contentEl);
    assert.ok(!texts.some((t) => /TopSecretFileName/i.test(t)), "filenames are not primary content");
    assert.ok(!texts.some((t) => /\.png$/i.test(t)), "no filename text node is rendered");
    for (const rejected of [/new print group/i, /capture screenshot/i, /print note/i, /open image/i]) {
      assert.ok(!texts.some((t) => rejected.test(t)), `${rejected} must not appear`);
    }

    // Source-level rejections: no legacy control classes, no radio/broadcast icon.
    assert.doesNotMatch(viewSource, /tj-print-inbox-add-trade/);
    assert.doesNotMatch(viewSource, /tj-print-inbox-capture/);
    assert.doesNotMatch(viewSource, /tj-print-group-active-badge/);
    assert.doesNotMatch(viewSource, /setIcon\([^)]*"radio"/);
    assert.doesNotMatch(viewSource, /New print group/);
    assert.doesNotMatch(viewSource, /Capture screenshot/);
    assert.doesNotMatch(viewSource, /Print note/);
    assert.doesNotMatch(viewSource, /Open image/);
  });
});

test("persistence: lanes, prints and active state survive a view reload", async () => {
  await withTempDir(async (dir) => {
    const { view: view1 } = setupRealView(dir);
    await view1.refresh();
    await view1.saveFiles([makeMockImageFile("a.png")], "paste");
    await view1.saveFiles([makeMockImageFile("b.png")], "paste");
    const groupId = (await vq.getActiveGroup(makeApp(dir), "")).id;
    const before = await vq.loadPrintGroup(makeApp(dir), "", groupId);

    const { view: view2, app: app2 } = setupRealView(dir);
    await view2.refresh();

    const groups = await vq.listPrintGroups(app2, "");
    assert.equal(groups.length, 1, "one lane persists across reload");
    assert.equal(groups[0].id, groupId);
    assert.equal(groups[0].state, "active");
    assert.deepEqual(groups[0].entryIds, before.entryIds, "print membership and order persist");

    const classes = collectClasses(view2.contentEl);
    assert.ok(classes.includes("tj-print-group"), "reloaded lane renders");
    assert.ok(classes.includes("tj-print-group-film-item"), "reloaded prints render");
  });
});
