import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

const TEST_JOURNAL_DATE = new Date().toISOString().slice(0, 10);

// Bundle PrintQueueView with printInbox and printGroup libs and an Obsidian stub.
const bundleResult = await build({
  stdin: {
    contents: [
      'export { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./src/views/printInboxView";',
      'export * from "./src/lib/printInbox";',
      'export * from "./src/lib/printGroup";',
    ].join("\n"),
    resolveDir: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    sourcefile: "print-queue-v2-entry.ts",
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
            "export function getResourcePath(file) { return `vault://${file.path}`; }",
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "printqueue-v2-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeStubEl() {
  const el = {
    attrs: {}, listeners: {}, children: [], classes: new Set(), text: "",
    setAttr(k, v) { this.attrs[k] = v; },
    getAttr(k) { return this.attrs[k]; },
    addClass(c) { c.split(/\s+/).forEach((x) => this.classes.add(x)); },
    removeClass(c) { this.classes.delete(c); },
    toggleClass(c, on) { if (on) this.addClass(c); else this.removeClass(c); },
    addEventListener(t, fn, _opts) { (this.listeners[t] ??= []).push(fn); },
    dispatch(t, evt = {}) { for (const fn of this.listeners[t] ?? []) fn(evt); },
    createEl(tag, opts) {
      const c = makeStubEl();
      c.tag = tag;
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

function findGroupCard(parent, groupId) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (node.attrs?.["data-group-id"] === groupId) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parent);
  return found;
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
  return {
    name,
    type: "image/png",
    arrayBuffer: async () => new ArrayBuffer(8),
  };
}

// =========================================================================
// 1. Event routing (Fast path = Hover / Focus, Fallback = Global Active)
// =========================================================================

test("hovered-card routing: Ctrl+V while hovering card B captures into B even when card A is active", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    // Create group A (active) and group B (pending)
    const now = new Date().toISOString();
    const gA = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);

    // Initial refresh to populate groups
    await view.refresh();

    // Verify A is active, B is pending
    const active = await vq.getActiveGroup(app, "");
    assert.equal(active.id, gA.id);

    // Find the rendered group card for group B
    const cardB = findGroupCard(view.listEl, gB.id);
    assert.ok(cardB, "group B card is rendered");

    // Simulate pointerover on card B
    cardB.dispatch("pointerover");
    assert.equal(cardB.classes.has("is-capture-target"), true);
    assert.equal(view.captureTargetGroupId, gB.id);

    // Trigger saveFiles via paste
    const file = makeMockImageFile("chart-b.png");
    await view.saveFiles([file], "paste");

    // Check that entry was added to group B, NOT group A
    const loadedA = await vq.loadPrintGroup(app, "", gA.id);
    const loadedB = await vq.loadPrintGroup(app, "", gB.id);
    assert.equal(loadedA.entryIds.length, 0, "Group A should have 0 entries");
    assert.equal(loadedB.entryIds.length, 1, "Group B should receive the captured entry");

    // Group A remains active invariant
    const currentActive = await vq.getActiveGroup(app, "");
    assert.equal(currentActive.id, gA.id, "Group A is still active");

    // Simulate pointerout on card B
    cardB.dispatch("pointerout");
    assert.equal(cardB.classes.has("is-capture-target"), false);
    assert.equal(view.captureTargetGroupId, "");
  });
});

test("focused-card routing: focusing card B captures into B", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    const now = new Date().toISOString();
    const gA = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);

    await view.refresh();

    const cardB = findGroupCard(view.listEl, gB.id);
    assert.ok(cardB);

    // Focus card B
    cardB.dispatch("focusin");
    assert.equal(view.captureTargetGroupId, gB.id);

    // Capture file
    const file = makeMockImageFile("focused.png");
    await view.saveFiles([file], "paste");

    const loadedA = await vq.loadPrintGroup(app, "", gA.id);
    const loadedB = await vq.loadPrintGroup(app, "", gB.id);
    assert.equal(loadedA.entryIds.length, 0);
    assert.equal(loadedB.entryIds.length, 1);

    // Blur card B
    cardB.dispatch("focusout");
    assert.equal(view.captureTargetGroupId, "");
  });
});

test("fallback routing: with no card hovered or focused, capture routes to the global active group", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    const now = new Date().toISOString();
    const gA = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);

    await view.refresh();
    assert.equal(view.captureTargetGroupId, "");

    // Capture without hover/focus
    const file = makeMockImageFile("fallback.png");
    await view.saveFiles([file], "paste");

    const loadedA = await vq.loadPrintGroup(app, "", gA.id);
    const loadedB = await vq.loadPrintGroup(app, "", gB.id);
    assert.equal(loadedA.entryIds.length, 1, "Fallback routes to active group A");
    assert.equal(loadedB.entryIds.length, 0);
  });
});

// =========================================================================
// 2. Discard Action for Empty Groups
// =========================================================================

test("discard action: trash-2 button appears ONLY on empty groups and moves sidecar to trash", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    const now = new Date().toISOString();
    const gEmpty = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Empty Trade · 09:00", 1);
    await vq.setGroupState(app, "", gEmpty.id, "pending");

    await view.refresh();

    // Verify empty group card has discard button
    const card = findGroupCard(view.listEl, gEmpty.id);
    assert.ok(card);
    const controls = card.children.find((c) => c.classes.has("tj-print-group-controls"));
    const header = card.children.find((c) => c.classes.has("tj-print-group-header"));
    const discardBtn = controls.children.find((c) => c.classes.has("tj-print-group-discard"));
    assert.ok(discardBtn, "Empty group has discard button");
    assert.equal(discardBtn.attrs["aria-label"], "Move empty group to trash");
    assert.equal(header.children.some((c) => c.classes.has("tj-print-group-discard")), false, "discard is not in the compact header");

    // Click discard button
    discardBtn.dispatch("click", { stopPropagation() {} });

    // Let the async discard settle; under load a fixed sleep is flaky.
    const sidecarPath = path.join(dir, "print-groups", `${gEmpty.id}.md`);
    for (let i = 0; i < 50 && existsSync(sidecarPath); i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // The original sidecar leaves the vault, while Obsidian trash retains it.
    assert.equal(existsSync(sidecarPath), false, "Original sidecar path is gone");
    assert.equal(existsSync(path.join(dir, ".trash", "print-groups", `${gEmpty.id}.md`)), true, "Sidecar is preserved in trash");

    const reloaded = await vq.loadPrintGroup(app, "", gEmpty.id);
    assert.equal(reloaded, null, "Group no longer exists");
  });
});

test("discard action: non-empty groups never show discard button and deletePrintGroup refuses them", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("p.png"), TEST_JOURNAL_DATE, "file");
    const gNotEmpty = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app, "", gNotEmpty.id, entry.id);

    await view.refresh();

    const card = findGroupCard(view.listEl, gNotEmpty.id);
    assert.ok(card);
    const controls = card.children.find((c) => c.classes.has("tj-print-group-controls"));
    const discardBtn = controls.children.find((c) => c.classes.has("tj-print-group-discard"));
    assert.equal(discardBtn, undefined, "Non-empty group must NOT have discard button");

    // Direct lib call should also refuse
    await assert.rejects(
      async () => { await vq.deletePrintGroup(app, "", gNotEmpty.id); },
      /Cannot discard a group that still holds prints/
    );
  });
});

test("last-entry removal: removing the last print of a group immediately reveals the discard button", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("last.png"), TEST_JOURNAL_DATE, "file");
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app, "", group.id, entry.id);

    await view.refresh();

    // Verify no discard button initially
    let card = findGroupCard(view.listEl, group.id);
    let controls = card.children.find((c) => c.classes.has("tj-print-group-controls"));
    assert.equal(controls.children.find((c) => c.classes.has("tj-print-group-discard")), undefined);

    // Remove the only entry
    await view.removeEntry(entry);

    // After refresh, group is now empty and discard button is visible
    card = findGroupCard(view.listEl, group.id);
    controls = card.children.find((c) => c.classes.has("tj-print-group-controls"));
    const discardBtn = controls.children.find((c) => c.classes.has("tj-print-group-discard"));
    assert.ok(discardBtn, "Removing last print immediately reveals discard button");
  });
});

// =========================================================================
// 3. Failed Capture Recovery & Atomicity
// =========================================================================

test("failed capture: per-file failure leaves group active and recoverable, no partial entry", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupRealView(dir);

    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Trade 1 · 09:00", 1);
    await vq.setActiveGroup(app, "", group.id);
    await view.refresh();

    // Non-image file triggers immediate notice and no modification
    const badFile = { name: "doc.txt", type: "text/plain", arrayBuffer: async () => new ArrayBuffer(0) };
    await view.saveFiles([badFile], "paste");

    const loaded = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(loaded.entryIds.length, 0, "No partial entry added");
    assert.equal(loaded.state, "active", "Group remains active");

    // Vault failure during image save
    const origCreateBinary = app.vault.createBinary;
    app.vault.createBinary = async () => { throw new Error("Disk full"); };

    const imgFile = makeMockImageFile("fail.png");
    await view.saveFiles([imgFile], "paste");

    app.vault.createBinary = origCreateBinary;

    const loadedAfterFail = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(loadedAfterFail.entryIds.length, 0, "Failed file was not added to group");
    assert.equal(loadedAfterFail.state, "active", "Group remains active and recoverable");

    // Now recapture successfully
    await view.saveFiles([imgFile], "paste");
    const loadedAfterRecover = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(loadedAfterRecover.entryIds.length, 1, "Recapture succeeds");
  });
});

// =========================================================================
// 4. Persistence across reload
// =========================================================================

test("persistence: groups and capture state persist across reload", async () => {
  await withTempDir(async (dir) => {
    const { view: view1, app: app1 } = setupRealView(dir);

    const now = new Date().toISOString();
    const g1 = await vq.createPrintGroup(app1, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const g2 = await vq.createPrintGroup(app1, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app1, "", g2.id);

    const entry = await vq.savePrintInboxEntry(app1, "Tradebook", makeMockImageFile("p1.png"), TEST_JOURNAL_DATE, "file");
    await vq.addEntryToGroup(app1, "", g2.id, entry.id);

    // Discard empty g1
    await view1.discardGroup(g1.id);

    // Simulate reload by creating a fresh view and fresh app
    const { view: view2, app: app2 } = setupRealView(dir);
    await view2.refresh();

    const groups = await vq.listPrintGroups(app2, "");
    assert.equal(groups.length, 1, "g1 remains discarded across reload");
    assert.equal(groups[0].id, g2.id);
    assert.equal(groups[0].state, "active");
    assert.deepEqual(groups[0].entryIds, [entry.id]);
  });
});

// =========================================================================
// 5. Visual acceptance criteria & CSS tokens
// =========================================================================

test("visual contract: CSS supports combined details, safe selection and unclipped capture actions", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  // Group name/time remains neutral and is edited through one keyboard-visible control.
  assert.match(css, /\.tj-print-group-details\s*\{[^}]*color:\s*var\(--text-normal\)/);
  assert.doesNotMatch(css, /\.tj-print-group-details\s*\{[^}]*interactive-accent/);
  assert.match(css, /\.tj-print-group-details-editor\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.tj-print-group-details:focus-visible/);

  // Group spacing and confirmation affordances remain accessible.
  assert.match(css, /\.tj-print-group\s*\{[^}]*margin:\s*0;/);
  assert.match(css, /\.tj-print-group-discard\s*\{[^}]*min-width:\s*28px/);
  assert.match(css, /\.tj-print-group-discard\s*\{[^}]*min-height:\s*28px/);
  assert.match(css, /\.tj-print-group-discard:focus-visible\s*\{[^}]*var\(--background-modifier-border-hover\)/);

  // Capture targeting is a quiet hover wash; status labels are not rendered.
  assert.match(css, /\.tj-print-group\.is-capture-target\s*\{[^}]*background:\s*var\(--background-modifier-hover\)/);
  assert.doesNotMatch(css, /\.tj-print-group-state/);

  // Paste and file selection are direct lane actions; only the separate More menu remains.
  assert.match(css, /\.tj-print-group-capture \.tj-print-group-paste/);
  assert.match(css, /\.tj-print-group-capture \.tj-print-group-choose/);
  assert.doesNotMatch(css, /tj-print-group-capture-menu/);
  assert.match(css, /\.tj-print-group-selected-more:not\(\[open\]\) \.tj-print-group-selected-menu\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.tj-print-group-selected-more\[hidden\]\s*\{[^}]*display:\s*none/);

  // Check the complete Print Queue styling range, including the new controls.
  const lines = css.split(/\r?\n/).slice(12669, 13120).join("\n");
  assert.doesNotMatch(lines, /purple|#8b5cf6|#7c3aed|#a78bfa|violet/i);
});
