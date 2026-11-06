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

const TEST_JOURNAL_DATE = new Date().toISOString().slice(0, 10);

const bundleResult = await build({
  stdin: {
    contents: [
      'export { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./src/views/printInboxView";',
      'export * from "./src/lib/printInbox";',
      'export * from "./src/lib/printGroup";',
      'export { modalInstances } from "obsidian";',
    ].join("\n"),
    resolveDir: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    sourcefile: "print-queue-lane-entry.ts",
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
            "export const modalInstances=[]; export class Modal { constructor(app){ this.app=app; modalInstances.push(this); } open(){ this.isOpen=true; } close(){ this.isOpen=false; } }",
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

const viewSource = readFileSync(new URL("../src/views/printInboxView.ts", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

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
        const source = path.join(root, file.path);
        const trash = path.join(root, ".trash");
        await fsPromises.mkdir(trash, { recursive: true });
        await fsPromises.rename(source, path.join(trash, path.basename(file.path)));
      },
    },
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "printqueue-lane-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeStubEl() {
  const el = {
    attrs: {}, listeners: {}, children: [], classes: new Set(), text: "", value: "", files: null,
    rect: { left: 0, top: 0, width: 164, height: 108 },
    setAttr(k, v) { this.attrs[k] = v; },
    getAttr(k) { return this.attrs[k]; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addClass(c) { c.split(/\s+/).forEach((x) => this.classes.add(x)); },
    removeClass(c) { c.split(/\s+/).forEach((x) => this.classes.delete(x)); },
    toggleClass(c, on) { if (on) this.addClass(c); else this.removeClass(c); },
    closest(selector) {
      const selectors = selector.split(",").map((part) => part.trim());
      let node = this;
      while (node) {
        if (selectors.some((part) => part.startsWith(".") && node.classes.has(part.slice(1)))) return node;
        node = node.parent;
      }
      return null;
    },
    contains(candidate) {
      let node = candidate;
      while (node) {
        if (node === this) return true;
        node = node.parent;
      }
      return false;
    },
    appendChild(child) {
      if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child);
      child.parent = this;
      this.children.push(child);
      return child;
    },
    focus() { this.focused = true; },
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
    dispatch(t, evt = {}) { for (const fn of this.listeners[t] ?? []) fn(evt); },
    click() { this.dispatch("click", { stopPropagation() {}, preventDefault() {} }); },
    getBoundingClientRect() { return this.rect; },
    querySelectorAll(selector) {
      const found = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (selector === "[data-entry-id]" && child.attrs["data-entry-id"] !== undefined) found.push(child);
          if (selector === "[data-move-context]" && child.attrs["data-move-context"] !== undefined) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    },
    createEl(tag, opts) {
      const c = makeStubEl();
      c.parent = this;
      c._tag = tag;
      if (opts?.cls) c.addClass(opts.cls);
      if (opts?.attr) Object.assign(c.attrs, opts.attr);
      if (opts?.text) c.text = opts.text;
      this.children.push(c);
      return c;
    },
    createDiv(opts) { return this.createEl("div", opts); },
    createSpan(opts) { return this.createEl("span", opts); },
    querySelector(selector) {
      let found = null;
      const visit = (node) => {
        for (const child of node.children) {
          if (selector.startsWith("#") && child.attrs.id === selector.slice(1)) { found = child; return; }
          if (!found) visit(child);
          if (found) return;
        }
      };
      visit(this);
      return found;
    },
    empty() { this.children = []; },
    setText(t) { this.text = t; },
    setCssStyles() {},
  };
  return el;
}

function setupView(dir) {
  const app = makeApp(dir);
  const plugin = { app, getTradesFolder: () => "Tradebook", settings: { timeZone: "UTC" } };
  const view = new vq.PrintQueueView(null, plugin);
  view.app = app;
  view.contentEl = makeStubEl();
  view.containerEl = makeStubEl();
  view.containerEl.isConnected = true;
  view.containerEl.getClientRects = () => [view.containerEl.rect];
  view.containerEl.matches = () => false;
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

function findAllByClass(el, cls) {
  const found = [];
  walkStub(el, (node) => { if (node.classes.has(cls)) found.push(node); });
  return found;
}

function directChildIndex(parent, child) {
  return parent.children.indexOf(child);
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 80; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function utcDate(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftUtcDate(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDate(date);
}

function makePasteEvent(file) {
  return {
    clipboardData: {
      items: [{ kind: "file", getAsFile: () => file }],
    },
    preventDefault() {},
    stopPropagation() {},
  };
}

test("welcome empty state: small Print Queue heading, one useful sentence, then only the two actions", async () => {
  await withTempDir(async (dir) => {
    const { view } = setupView(dir);
    view.entries = [];
    view.groups = [];
    view.render();

    const empty = findByClass(view.contentEl, "tj-print-inbox-empty");
    assert.ok(empty, "empty state is rendered");
    const title = findByClass(empty, "tj-print-inbox-empty-title");
    assert.equal(title.text, "Print Queue");
    const hint = findByClass(empty, "tj-print-inbox-empty-hint");
    assert.match(hint.text, /live-market chart prints/i);

    const actions = findByClass(empty, "tj-print-inbox-empty-actions");
    assert.deepEqual(actions.children.map((c) => c.text), ["Paste clipboard", "Choose print"]);
    assert.deepEqual(empty.children.map((c) => c.classes.has("tj-print-inbox-empty-brand") ? "brand" : c.classes.has("tj-print-inbox-empty-hint") ? "hint" : c.classes.has("tj-print-inbox-empty-actions") ? "actions" : "other"), ["brand", "hint", "actions"]);
    assert.match(viewSource, /setIcon\(icon, "images"\)/);

    const classes = collectClasses(view.contentEl);
    assert.ok(!classes.includes("tj-print-inbox-new-lane"), "empty state has no new-lane action");
    assert.ok(!classes.includes("tj-print-inbox-footer"), "empty state has no footer");
  });
});

test("after first capture: no global Paste/Choose controls above the lanes", async () => {
  await withTempDir(async (dir) => {
    const { view } = setupView(dir);
    await view.refresh();
    await view.saveFiles([makeMockImageFile("first.png")], "paste");

    const classes = collectClasses(view.contentEl);
    assert.ok(!classes.includes("tj-print-inbox-paste"), "global paste control is gone");
    assert.ok(!classes.includes("tj-print-inbox-choose"), "global choose control is gone");
    assert.ok(!classes.includes("tj-print-inbox-footer"), "no fixed footer");
    assert.ok(classes.includes("tj-print-group-paste"), "paste lives on the lane");
    assert.ok(classes.includes("tj-print-group-choose"), "choose lives on the lane");
  });
});

test("capture without a hovered or focused lane uses the globally active group", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const now = new Date().toISOString();
    const first = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const active = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", active.id);
    await view.refresh();
    assert.equal(view.captureTargetGroupId, "", "no lane is hovered or focused before capture");

    await view.saveFiles([makeMockImageFile("fallback.png")], "paste");

    assert.equal((await vq.loadPrintGroup(app, "", first.id)).entryIds.length, 0);
    assert.equal((await vq.loadPrintGroup(app, "", active.id)).entryIds.length, 1);
    assert.equal(view.captureTargetGroupId, "", "fallback capture does not create a lingering pointer target");
  });
});

test("lane header combines group name and journal time without visible status badges", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("chart.png"), TEST_JOURNAL_DATE, "file");
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, "2026-10-20T10:15:00.000Z", "Group 2 · 10:15", 2);
    await vq.addEntryToGroup(app, "", group.id, entry.id);
    await vq.setTradeTimeHint(app, "", group.id, "09:15", "UTC");
    await view.refresh();

    const card = findByClass(view.contentEl, "tj-print-group");
    const header = findByClass(card, "tj-print-group-header");
    const details = findByClass(header, "tj-print-group-details");
    assert.equal(collectTexts(details).join(""), "Group 2 · 09:15");
    assert.equal(details._tag, "button");
    assert.equal(details.attrs.title, undefined, "the header does not show a delayed tooltip");
    assert.equal(details.attrs["aria-label"], undefined, "the visible header text remains the control name");
    assert.equal(card.attrs["aria-label"], undefined, "the group does not expose a hover-tooltip label");
    assert.equal(card.attrs["aria-labelledby"], details.attrs.id, "the group keeps an accessible name without a hover tooltip");
    assert.equal(findByClass(header, "tj-print-group-state"), null, "status badges are not rendered");
    assert.equal(findByClass(header, "tj-print-group-count"), null, "no print count in the header");
    assert.ok(!collectTexts(header).some((text) => /New trade/.test(text)));
    assert.ok(!collectTexts(header).some((text) => /Active|Capture target|Group time/.test(text)));
  });
});

test("one Save commits group name and time, reorders the queue, and Cancel discards both", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const groupDate = utcDate(new Date());
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("chart.png"), groupDate, "file");
    const createdAt = new Date().toISOString();
    const group = await vq.createPrintGroup(app, "", groupDate, createdAt, "Group 2 · 10:20", 2);
    const earlier = await vq.createPrintGroup(app, "", groupDate, createdAt, "Group 1 · 10:00", 1);
    await vq.addEntryToGroup(app, "", group.id, entry.id);
    await vq.setTradeTimeHint(app, "", group.id, "10:20", "UTC");
    await vq.setTradeTimeHint(app, "", earlier.id, "10:00", "UTC");
    await vq.setActiveGroup(app, "", group.id);
    await view.refresh();

    let card = findAllByClass(view.contentEl, "tj-print-group").find((candidate) => candidate.attrs["data-group-id"] === group.id);
    const detailsButton = findByClass(card, "tj-print-group-details");
    card.dispatch("pointerover", { target: detailsButton, relatedTarget: null });
    assert.equal(view.captureTargetGroupId, "", "hovering the editor control does not retarget capture");
    assert.equal(card.attrs["aria-label"], undefined, "hovering never adds a tooltip label");
    assert.equal(card.attrs["aria-labelledby"], detailsButton.attrs.id, "hover behavior does not remove the accessible group name");
    detailsButton.click();
    const editor = findByClass(card, "tj-print-group-details-editor");
    assert.equal(editor.hidden, false);
    assert.equal(findByClass(editor, "tj-print-group-name-input").value, "Group 2", "legacy time suffix is separated from the name");
    const timePicker = findByClass(editor, "tj-print-group-time-picker");
    const timeTrigger = findByClass(timePicker, "tj-print-group-time-trigger");
    assert.equal(timeTrigger.attrs["aria-expanded"], "false");
    assert.equal(findByClass(timeTrigger, "tj-print-group-time-display-hour").text, "10");
    assert.equal(findByClass(timeTrigger, "tj-print-group-time-display-minute").text, "20");
    assert.equal(findByClass(timeTrigger, "tj-print-group-time-separator").text, ":", "the separator stays fixed in the trigger");
    timeTrigger.click();
    const timeMenu = findByClass(timePicker, "tj-print-group-time-menu");
    assert.equal(timeMenu.hidden, false, "the custom picker opens without a native dropdown");
    const save = findByClass(timeMenu, "tj-print-group-details-save");
    assert.equal(save.text, "Save", "the picker replaces Clear with the same group-details Save action");
    assert.equal(save.parent.classes.has("tj-print-group-time-menu-header"), true);
    assert.equal(findByClass(timeMenu, "tj-print-group-time-clear"), null);
    const hourOptions = findByClass(timeMenu, "tj-print-group-time-hour-options");
    const minuteOptions = findByClass(timeMenu, "tj-print-group-time-minute-options");
    assert.equal(hourOptions.children.length, 24, "hour column offers 00 through 23");
    assert.equal(minuteOptions.children.length, 60, "minute column offers 00 through 59");
    const optionFor = (list, value) => list.children.find((option) => option.attrs["data-time-value"] === value);
    assert.equal(optionFor(hourOptions, "10").attrs["aria-selected"], "true");
    assert.equal(optionFor(minuteOptions, "20").attrs["aria-selected"], "true");
    assert.equal(findByClass(timePicker, "tj-print-group-time-select"), null, "the picker does not use native select controls");
    assert.equal(view.captureTargetGroupId, "", "opening the editor does not select a capture target");
    hourOptions.dispatch("keydown", {
      key: "ArrowUp",
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(optionFor(hourOptions, "09").attrs["aria-selected"], "true", "keyboard arrows can change the active hour");
    findByClass(editor, "tj-print-group-name-input").value = "NQ opening";
    optionFor(hourOptions, "09").click();
    optionFor(minuteOptions, "50").click();
    assert.equal(findByClass(timeTrigger, "tj-print-group-time-display-hour").text, "09");
    assert.equal(findByClass(timeTrigger, "tj-print-group-time-display-minute").text, "50");
    save.click();

    await waitFor(async () => {
      const updated = await vq.loadPrintGroup(app, "", group.id);
      const rendered = collectTexts(findByClass(view.contentEl, "tj-print-group-details")).join("");
      return updated.name === "NQ opening" && updated.tradeTimeHint === "09:50" && rendered === "NQ opening · 09:50";
    }, "group name and time update in storage and view");
    const updated = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(updated.ordinal, 2);
    assert.equal(updated.createdAt, createdAt);
    assert.deepEqual(updated.entryIds, [entry.id]);
    assert.equal(updated.state, "active");
    assert.equal(updated.tradeTimeHintZone, "UTC");
    assert.equal(updated.attachedTradeId, undefined);
    assert.equal((await vq.listPrintInboxEntries(app, "Tradebook"))[0].capturedAt, entry.capturedAt);
    assert.equal(collectTexts(findByClass(view.contentEl, "tj-print-group-details")).join(""), "NQ opening · 09:50");

    const renderedCards = findAllByClass(view.contentEl, "tj-print-group");
    assert.equal(renderedCards[0].attrs["data-group-id"], group.id, "saving an earlier time moves the group to the top of its date");
    card = renderedCards.find((candidate) => candidate.attrs["data-group-id"] === group.id);
    assert.equal((await vq.getActiveGroup(app, ""))?.id, group.id, "sorting leaves the active destination unchanged");
    assert.equal(view.contentEl.querySelector(`#print-group-details-${group.id}`).focused, true, "focus returns to the moved group after save");
    assert.match(findByClass(view.contentEl, "tj-print-inbox-status").text, /moved earlier/i);

    const refreshedCard = card;
    findByClass(refreshedCard, "tj-print-group-details").click();
    const reopenedEditor = findByClass(refreshedCard, "tj-print-group-details-editor");
    findByClass(reopenedEditor, "tj-print-group-name-input").value = "Discarded name";
    findByClass(reopenedEditor, "tj-print-group-time-trigger").click();
    findByClass(reopenedEditor, "tj-print-group-time-hour-options").children.find((option) => option.attrs["data-time-value"] === "11").click();
    findByClass(reopenedEditor, "tj-print-group-details-cancel").click();
    const cancelled = await vq.loadPrintGroup(app, "", group.id);
    assert.equal(cancelled.name, "NQ opening", "Cancel discards the draft name");
    assert.equal(cancelled.tradeTimeHint, "09:50", "Cancel discards the draft time");
    assert.equal(cancelled.tradeTimeHintZone, "UTC");
  });
});

test("queue is date-first, sorts by displayed time, and keeps later additions with the original group date", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const today = utcDate(new Date());
    const yesterday = shiftUtcDate(today, -1);
    const twoDaysAgo = shiftUtcDate(today, -2);
    const makeGroup = async (date, name, ordinal, time) => {
      const group = await vq.createPrintGroup(app, "", date, `${date}T08:00:00.000Z`, name, ordinal);
      if (time) await vq.setTradeTimeHint(app, "", group.id, time, "UTC");
      return group;
    };
    const late = await makeGroup(today, "Late", 1, "10:00");
    const early = await makeGroup(today, "Early", 2, "09:50");
    const tieFirst = await makeGroup(today, "Tie first", 3, "09:50");
    const tieSecond = await makeGroup(today, "Tie second", 4, "09:50");
    const untimed = await makeGroup(today, "Untimed", 5, "");
    const previous = await makeGroup(yesterday, "Yesterday group", 1, "10:15");
    const older = await makeGroup(twoDaysAgo, "Older group", 2, "09:00");

    const previousPrint = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("previous.png"), yesterday, "file");
    const laterPrint = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("later.png"), today, "file");
    await vq.addEntryToGroup(app, "", previous.id, previousPrint.id);
    await vq.addEntryToGroup(app, "", previous.id, laterPrint.id);
    const currentUnsorted = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("current-unsorted.png"), today, "file");
    const previousUnsorted = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("previous-unsorted.png"), yesterday, "file");
    await view.refresh();

    const currentDay = findByClass(view.contentEl, "tj-print-inbox-current-day");
    const currentIds = findAllByClass(currentDay, "tj-print-group").map((card) => card.attrs["data-group-id"]);
    assert.deepEqual(currentIds, [early.id, tieFirst.id, tieSecond.id, late.id, untimed.id]);
    const previousDays = findByClass(view.contentEl, "tj-print-inbox-previous-days");
    assert.equal(previousDays._tag, "details");
    assert.equal(previousDays.open, false, "previous days start collapsed but remain visible");
    const previousSummary = previousDays.children.find((child) => child._tag === "summary");
    assert.match(collectTexts(previousSummary).join(" "), /Previous days/i);
    assert.match(collectTexts(previousSummary).join(" "), /2 groups/i);
    assert.match(collectTexts(previousSummary).join(" "), /3 prints/i);
    const previousIds = findAllByClass(previousDays, "tj-print-group").map((card) => card.attrs["data-group-id"]);
    assert.deepEqual(previousIds, [previous.id, older.id], "prior dates are newest-first and groups remain on their original date");
    const previousDayHeadings = findAllByClass(previousDays, "tj-print-inbox-day-heading").map((heading) => heading.text);
    assert.match(previousDayHeadings[0], /1 group · 3 prints/);
    assert.match(previousDayHeadings[1], /1 group · 0 prints/);
    assert.equal(findAllByClass(view.contentEl, "tj-print-group").filter((card) => card.attrs["data-group-id"] === previous.id).length, 1);
    assert.match(collectTexts(findByClass(previousDays, "tj-print-group")).join(" "), /Later prints/i);
    assert.equal((await vq.loadPrintGroup(app, "", previous.id)).journalDate, yesterday);
    previousDays.open = true;
    previousDays.dispatch("toggle");
    await view.refresh();
    assert.equal(findByClass(view.contentEl, "tj-print-inbox-previous-days").open, true, "an expanded previous-days section stays open after a queue refresh");

    const unsortedDates = findAllByClass(view.contentEl, "tj-print-inbox-unsorted").map((section) => section.attrs["data-journal-date"]);
    assert.deepEqual(unsortedDates, [today, yesterday], "unsorted prints are grouped under their own dates");
    assert.ok(currentUnsorted.id && previousUnsorted.id, "both date-specific unsorted prints remain available");
  });
});

test("Clear all copy states that queued prints from every date are included", () => {
  assert.match(viewSource, /from every date/);
  assert.match(viewSource, /Attached trades will stay untouched/);
});

test("Clear previous days option removes only past-date queue data and preserves today's and attached data", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const today = TEST_JOURNAL_DATE;
    const yesterday = shiftUtcDate(today, -1);

    const priorEntry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("prior-group.png"), yesterday, "file");
    const priorGroup = await vq.createPrintGroup(app, "", yesterday, new Date().toISOString(), "Prior group", 1);
    await vq.addEntryToGroup(app, "", priorGroup.id, priorEntry.id);
    const laterEntry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("later-addition.png"), today, "file");
    await vq.addEntryToGroup(app, "", priorGroup.id, laterEntry.id);

    const currentPastEntry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("current-group-past-print.png"), yesterday, "file");
    const currentGroup = await vq.createPrintGroup(app, "", today, new Date().toISOString(), "Current group", 2);
    await vq.addEntryToGroup(app, "", currentGroup.id, currentPastEntry.id);
    const priorUnsorted = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("prior-unsorted.png"), yesterday, "file");

    const attachedEntry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("attached-prior.png"), yesterday, "file");
    const attached = await vq.createPrintGroup(app, "", yesterday, new Date().toISOString(), "Attached prior group", 3);
    await vq.addEntryToGroup(app, "", attached.id, attachedEntry.id);
    await vq.attachGroupSidecar(app, "", attached.id, "trade-attached");
    await view.refresh();

    const previousDays = findByClass(view.contentEl, "tj-print-inbox-previous-days");
    const previousContent = findByClass(previousDays, "tj-print-inbox-previous-days-content");
    const clearPrevious = findByClass(previousContent, "tj-print-inbox-clear-previous");
    assert.ok(clearPrevious, "the clear-previous-days action is inside the Previous days section");
    assert.equal(clearPrevious.attrs["aria-label"], "Clear queued prints from previous days only");
    assert.equal(findByClass(findByClass(view.contentEl, "tj-print-inbox-queue-actions"), "tj-print-inbox-clear-previous"), null, "it is not shown beside Clear all");
    const modalCount = vq.modalInstances.length;
    clearPrevious.click();
    assert.equal(vq.modalInstances.length, modalCount + 1, "clearing previous days asks for confirmation");
    assert.equal(vq.modalInstances.at(-1).isOpen, true);
    assert.ok(await vq.loadPrintGroup(app, "", priorGroup.id), "the action does not delete anything before confirmation");

    await view.performClearPreviousDays();

    assert.equal(await vq.loadPrintGroup(app, "", priorGroup.id), null, "a prior-date pending group is removed");
    assert.equal((await vq.loadPrintGroup(app, "", currentGroup.id)).entryIds[0], currentPastEntry.id, "a current-date group stays, even if one print was captured earlier");
    assert.equal((await vq.loadPrintGroup(app, "", attached.id)).state, "attached", "an attached group from a prior date stays untouched");
    const remainingIds = new Set((await vq.listPrintInboxEntries(app, "Tradebook")).map((entry) => entry.id));
    assert.equal(remainingIds.has(priorEntry.id), false);
    assert.equal(remainingIds.has(laterEntry.id), false, "all prints in a prior-date group are cleared together");
    assert.equal(remainingIds.has(priorUnsorted.id), false, "prior-date unsorted prints are cleared");
    assert.equal(remainingIds.has(currentPastEntry.id), true, "a past-dated print grouped today is preserved");
    assert.equal(remainingIds.has(attachedEntry.id), true, "an attached print from a previous date is preserved");
  });
});

test("first print seeds editable group time from capture instant in the selected journal zone", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    view.plugin.settings.timeZone = "America/New_York";
    const groupCreatedAt = "2020-01-15T11:00:00.000Z";
    const group = await vq.createPrintGroup(app, "", "2020-01-15", groupCreatedAt, "Group 1", 1);
    await view.refresh();

    await view.saveFiles([makeMockImageFile("first.png")], "paste", group.id);
    const [firstEntry] = await vq.listPrintInboxEntries(app, "Tradebook");
    const seeded = await vq.loadPrintGroup(app, "", group.id);
    const expected = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(firstEntry.capturedAt));
    assert.equal(seeded.tradeTimeHint, expected);
    assert.equal(seeded.tradeTimeHintZone, "America/New_York");
    assert.equal(seeded.createdAt, groupCreatedAt, "group creation provenance is unchanged");
    assert.ok(Number.isFinite(Date.parse(firstEntry.capturedAt)), "print capture provenance remains present");

    await vq.setTradeTimeHint(app, "", group.id, "09:15", "America/New_York");
    await view.saveFiles([makeMockImageFile("second.png")], "paste", group.id);
    assert.equal((await vq.loadPrintGroup(app, "", group.id)).tradeTimeHint, "09:15", "later prints do not overwrite an edited time");
  });
});

test("group time picker and editor actions keep selected controls unfilled", () => {
  const menuStart = cssSource.indexOf(".tj-print-group-time-menu {");
  const columnsStart = cssSource.indexOf(".tj-print-group-time-columns {");
  const optionsStart = cssSource.indexOf(".tj-print-group-time-options {");
  const triggerStart = cssSource.indexOf(".tj-print-group-time-trigger {");
  const triggerHoverStart = cssSource.indexOf(".tj-print-group-time-trigger:hover {");
  const selectedStart = cssSource.indexOf('.tj-print-group-time-option[aria-selected="true"] {');
  const optionHoverStart = cssSource.indexOf(".tj-print-group-time-option:hover, .tj-print-group-time-option:focus-visible {");
  const actionsStart = cssSource.indexOf(".tj-print-group-details-actions .tj-mini, .tj-print-group-time-menu-header .tj-print-group-details-save {");
  const hoverStart = cssSource.indexOf(".tj-print-group-details-actions .tj-mini:hover, .tj-print-group-details-actions .tj-mini:focus-visible, .tj-print-group-time-menu-header .tj-print-group-details-save:hover, .tj-print-group-time-menu-header .tj-print-group-details-save:focus-visible {");
  assert.notEqual(menuStart, -1, "picker menu has a dedicated style rule");
  assert.notEqual(columnsStart, -1, "hour and minute are presented as separate columns");
  assert.notEqual(optionsStart, -1, "picker option columns have a dedicated style rule");
  assert.notEqual(triggerStart, -1, "time trigger has a dedicated style rule");
  assert.notEqual(triggerHoverStart, -1, "time trigger hover has a dedicated style rule");
  assert.notEqual(selectedStart, -1, "selected time values have a dedicated style rule");
  assert.notEqual(optionHoverStart, -1, "option hover and focus have a dedicated style rule");
  assert.ok(cssSource.slice(columnsStart, cssSource.indexOf("}", columnsStart)).includes("grid-template-columns: 1fr 1fr"));
  const optionsRule = cssSource.slice(optionsStart, cssSource.indexOf("}", optionsStart));
  assert.ok(optionsRule.includes("max-height: 140px"));
  assert.ok(optionsRule.includes("overflow-y: auto"));
  for (const start of [triggerStart, triggerHoverStart, selectedStart, optionHoverStart]) {
    const rule = cssSource.slice(start, cssSource.indexOf("}", start));
    assert.ok(rule.includes("background: transparent !important"), "time selection controls stay unfilled");
  }
  assert.notEqual(actionsStart, -1, "group editor actions have a dedicated style rule");
  assert.notEqual(hoverStart, -1, "group editor action hover has a dedicated style rule");
  const actionsRule = cssSource.slice(actionsStart, cssSource.indexOf("}", actionsStart));
  const hoverRule = cssSource.slice(hoverStart, cssSource.indexOf("}", hoverStart));
  assert.ok(actionsRule.includes("background: transparent !important"));
  assert.ok(actionsRule.includes("box-shadow: none !important"));
  assert.ok(hoverRule.includes("background: transparent !important"));
});

test("filmstrip is horizontal, overflow-scrolled, and uses larger side-by-side prints", () => {
  assert.match(cssSource, /\.tj-print-group-entries\s*\{[^}]*flex-direction:\s*row/);
  assert.match(cssSource, /\.tj-print-group-entries\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(cssSource, /\.tj-print-group-entries\s*\{[^}]*overflow-x:\s*auto/);
  const width = /\.tj-print-group-film-thumb\s*\{[^}]*width:\s*(\d+)px/.exec(cssSource);
  const height = /\.tj-print-group-film-thumb\s*\{[^}]*height:\s*(\d+)px/.exec(cssSource);
  assert.ok(width && Number(width[1]) >= 150, "thumbnail width is larger than the old 116px strip");
  assert.ok(height && Number(height[1]) >= 100, "thumbnail height is larger than the old 78px strip");
  assert.match(cssSource, /\.tj-print-group\s*\{[^}]*height:\s*auto/);
  assert.match(cssSource, /\.tj-print-group\s*\{[^}]*min-height:\s*0/);
  assert.match(cssSource, /\.tj-print-group\s*\{[^}]*overflow:\s*visible/);
  assert.match(cssSource, /\.tj-print-group-entries\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(cssSource, /\.tj-print-group-controls\s*\{[^}]*margin-top/);
  assert.match(cssSource, /\.tj-print-inbox-list\s*\{[^}]*overflow-y:\s*auto/);
});

test("lane shows Paste and Choose file as separate visible actions", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const now = new Date().toISOString();
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("chart.png"), TEST_JOURNAL_DATE, "file");
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    await vq.addEntryToGroup(app, "", group.id, entry.id);
    await view.refresh();

    const card = findByClass(view.contentEl, "tj-print-group");
    const entries = findByClass(card, "tj-print-group-entries");
    const controls = findByClass(card, "tj-print-group-controls");
    assert.ok(entries && controls, "lane renders content and controls");
    assert.ok(directChildIndex(card, entries) < directChildIndex(card, controls), "controls follow the prints");

    const paste = findByClass(controls, "tj-print-group-paste");
    const choose = findByClass(controls, "tj-print-group-choose");
    const capture = findByClass(controls, "tj-print-group-capture");
    assert.equal(paste.text, "Paste");
    assert.equal(choose.text, "Choose file");
    assert.equal(paste.parent, capture);
    assert.equal(choose.parent, capture, "file selection is a visible sibling action");
    assert.equal(findByClass(controls, "tj-print-group-capture-more"), null, "there is no clipped popover");
    assert.equal(findByClass(controls, "tj-print-group-capture-trigger"), null);

    const targets = [];
    view.pasteFromClipboard = async (groupId) => { targets.push(groupId); };
    paste.click();
    assert.deepEqual(targets, [group.id]);

    view.pickerEl = { value: "", click() {} };
    choose.click();
    assert.equal(view.pickerTargetGroupId, group.id);
  });
});

test("each print keeps its own trash action; bulk selection controls are absent", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const entries = [];
    for (const name of ["one.png", "two.png"]) {
      entries.push(await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile(name), TEST_JOURNAL_DATE, "file"));
    }
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Group 1", 1);
    for (const entry of entries) await vq.addEntryToGroup(app, "", group.id, entry.id);
    await view.refresh();

    const card = findByClass(view.contentEl, "tj-print-group");
    assert.equal(findByClass(card, "tj-print-group-select"), null);
    assert.equal(findByClass(card, "tj-print-group-selection-controls"), null);
    assert.equal(findByClass(card, "tj-print-group-select-checkbox"), null);
    assert.equal(findByClass(card, "tj-print-group-delete-selected"), null);
    const removeButtons = findAllByClass(card, "tj-print-group-film-remove");
    assert.equal(removeButtons.length, 2);
    assert.ok(removeButtons.every((button) => !button.hidden), "each print has its individual trash action");

    removeButtons[0].click();
    await waitFor(async () => (await vq.listPrintInboxEntries(app, "Tradebook")).length === 1, "one print moved to trash");
    assert.deepEqual((await vq.loadPrintGroup(app, "", group.id)).entryIds, [entries[1].id]);
    assert.equal((await vq.listPrintInboxEntries(app, "Tradebook"))[0].id, entries[1].id);
  });
});

test("Clear previous days is hidden when a previous date has no queued prints", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const yesterday = shiftUtcDate(TEST_JOURNAL_DATE, -1);
    await vq.createPrintGroup(app, "", yesterday, new Date().toISOString(), "Empty prior group", 1);
    await view.refresh();

    const previousDays = findByClass(view.contentEl, "tj-print-inbox-previous-days");
    assert.ok(previousDays, "the dated section remains available for an empty group");
    assert.match(collectTexts(previousDays).join(" "), /0 prints/);
    assert.equal(findByClass(view.contentEl, "tj-print-inbox-clear-previous"), null, "the delete option appears only when prior-date prints exist");
  });
});

test("Clear previous days confirmation is limited to prior dates and preserves current and attached trades", () => {
  assert.match(viewSource, /Clear queued prints from previous days only/);
  assert.match(viewSource, /Move queued prints and groups from previous days to your configured trash\?/);
  assert.match(viewSource, /Today's queue and attached trades will stay untouched/);
});

test("Clear all starts a fresh queue at Group 1 while attached groups remain untouched", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const now = new Date().toISOString();
    for (let ordinal = 1; ordinal <= 4; ordinal++) {
      const attached = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, `Group ${ordinal}`, ordinal);
      await vq.attachGroupSidecar(app, "", attached.id, `trade-${ordinal}`);
    }
    const pending = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Group 5", 5);
    const beforeClear = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("before-clear.png"), TEST_JOURNAL_DATE, "file");
    await vq.addEntryToGroup(app, "", pending.id, beforeClear.id);
    await view.refresh();

    await view.performClearAll([]);
    await view.saveFiles([makeMockImageFile("after-clear.png")], "paste");

    const groups = await vq.listPrintGroups(app, "");
    const active = groups.find((group) => group.state === "active");
    assert.ok(active);
    assert.equal(active.name, "Group 1");
    assert.equal(active.ordinal, 1);
    assert.equal(groups.filter((group) => group.state === "attached").length, 4);
  });
});

test("selected print More menu moves a print to another group without dragging", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("move.png"), TEST_JOURNAL_DATE, "file");
    const gA = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);
    await vq.addEntryToGroup(app, "", gA.id, entry.id);
    await view.refresh();

    const cardA = findAllByClass(view.contentEl, "tj-print-group").find((node) => node.attrs["data-group-id"] === gA.id);
    const more = findByClass(cardA, "tj-print-group-selected-more");
    assert.equal(more.hidden, true, "move alternative stays hidden until a print is selected");
    findByClass(cardA, "tj-print-group-film-item").click();
    assert.equal(more.hidden, false, "selecting a print reveals its contextual More menu");
    assert.equal(findByClass(more, "tj-print-group-selected-trigger").attrs["aria-label"], "More actions for selected print");

    more.open = true;
    const move = findByClass(more, "tj-print-group-film-move");
    move.value = gB.id;
    move.dispatch("change", { stopPropagation() {} });
    await waitFor(async () => (await vq.loadPrintGroup(app, "", gB.id)).entryIds.includes(entry.id), "print moved to the selected group");

    assert.deepEqual((await vq.loadPrintGroup(app, "", gA.id)).entryIds, []);
    assert.deepEqual((await vq.loadPrintGroup(app, "", gB.id)).entryIds, [entry.id]);
  });
});

test("selected unsorted print More menu can place a legacy print into a group", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const entry = await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile("unsorted.png"), TEST_JOURNAL_DATE, "file");
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Trade 1 · 09:00", 1);
    await view.refresh();

    const unsorted = findByClass(view.contentEl, "tj-print-inbox-unsorted");
    const more = findByClass(unsorted, "tj-print-group-selected-more");
    assert.equal(more.hidden, true);
    findByClass(unsorted, "tj-print-group-film-item").click();
    assert.equal(more.hidden, false);
    more.open = true;
    const move = findByClass(more, "tj-print-group-film-move");
    move.value = group.id;
    move.dispatch("change", { stopPropagation() {} });

    await waitFor(async () => (await vq.loadPrintGroup(app, "", group.id)).entryIds.includes(entry.id), "unsorted print grouped");
    assert.deepEqual((await vq.loadPrintGroup(app, "", group.id)).entryIds, [entry.id]);
  });
});

test("New group follows the last lane and moves down as lanes are added", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    await view.refresh();
    await view.saveFiles([makeMockImageFile("one.png")], "paste");

    let list = findByClass(view.contentEl, "tj-print-inbox-list");
    let currentDay = findByClass(list, "tj-print-inbox-current-day");
    let groups = findAllByClass(currentDay, "tj-print-group");
    let newLane = findByClass(currentDay, "tj-print-inbox-new-lane");
    assert.equal(directChildIndex(currentDay, newLane), directChildIndex(currentDay, groups[groups.length - 1]) + 1, "new lane directly follows the only lane");

    newLane.click();
    await waitFor(async () => (await vq.listPrintGroups(app, "")).length === 2, "second lane");
    await waitFor(() => findAllByClass(view.contentEl, "tj-print-group").length === 2, "second lane render");

    list = findByClass(view.contentEl, "tj-print-inbox-list");
    currentDay = findByClass(list, "tj-print-inbox-current-day");
    groups = findAllByClass(currentDay, "tj-print-group");
    newLane = findByClass(currentDay, "tj-print-inbox-new-lane");
    assert.equal(groups.length, 2);
    assert.equal(directChildIndex(currentDay, newLane), directChildIndex(currentDay, groups[groups.length - 1]) + 1, "new lane moved below the new last lane");
    assert.equal(findByClass(view.contentEl, "tj-print-inbox-footer"), null);
  });
});

test("document paste listener handles first capture once even when the container also receives the event", async () => {
  await withTempDir(async (dir) => {
    assert.match(viewSource, /document\.addEventListener\("paste"/);
    assert.match(viewSource, /handledPasteEvents/);
    const { view, app } = setupView(dir);
    await view.refresh();

    view.containerEl.matches = (selector) => selector === ":hover";
    const saveFiles = view.saveFiles.bind(view);
    const savePromises = [];
    view.saveFiles = (...args) => {
      const promise = saveFiles(...args);
      savePromises.push(promise);
      return promise;
    };
    const event = makePasteEvent(makeMockImageFile("document.png"));
    view.onPaste(event);
    view.onPaste(event);

    assert.equal(savePromises.length, 1, "the same paste event starts one save operation");
    await Promise.all(savePromises);
    const groups = await vq.listPrintGroups(app, "");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].entryIds.length, 1, "the saved print is filed exactly once");
  });
});

test("hover routing: repeated document pastes go into the hovered lane only", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const now = new Date().toISOString();
    const gA = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 1 · 09:00", 1);
    const gB = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, now, "Trade 2 · 10:00", 2);
    await vq.setActiveGroup(app, "", gA.id);
    await view.refresh();

    const cardB = findAllByClass(view.contentEl, "tj-print-group").find((el) => el.attrs["data-group-id"] === gB.id);
    assert.ok(cardB);
    view.containerEl.matches = (selector) => selector === ":hover";
    cardB.dispatch("pointerover", { target: cardB, relatedTarget: null });
    assert.equal(view.captureTargetGroupId, gB.id);
    assert.ok(cardB.classes.has("is-capture-target"), "the hovered lane remains visibly highlighted");
    assert.equal(findByClass(cardB, "tj-print-group-state"), null, "no capture-target text badge is shown");

    view.onPaste(makePasteEvent(makeMockImageFile("hover-1.png")));
    await waitFor(async () => {
      const loaded = await vq.loadPrintGroup(app, "", gB.id);
      return !!loaded && loaded.entryIds.length === 1;
    }, "first hovered paste");
    view.onPaste(makePasteEvent(makeMockImageFile("hover-2.png")));
    await waitFor(async () => {
      const loaded = await vq.loadPrintGroup(app, "", gB.id);
      return !!loaded && loaded.entryIds.length === 2;
    }, "second hovered paste");

    assert.equal((await vq.loadPrintGroup(app, "", gA.id)).entryIds.length, 0, "active lane never receives hovered pastes");
    assert.equal((await vq.getActiveGroup(app, "")).id, gA.id, "hover routing does not change the active lane");
    assert.equal(view.captureTargetGroupId, gB.id, "repeated pastes keep targeting the hovered lane");

    cardB.dispatch("pointerout", { target: cardB, relatedTarget: null });
    assert.equal(view.captureTargetGroupId, "", "leaving the lane clears the capture target");
    assert.equal(cardB.classes.has("is-capture-target"), false);
  });
});

test("dragging a thumbnail within its lane reorders in place with an insertion indicator and no duplicate", async () => {
  await withTempDir(async (dir) => {
    const { view, app } = setupView(dir);
    const files = ["a.png", "b.png", "c.png"];
    const entries = [];
    for (const name of files) {
      entries.push(await vq.savePrintInboxEntry(app, "Tradebook", makeMockImageFile(name), TEST_JOURNAL_DATE, "file"));
    }
    const group = await vq.createPrintGroup(app, "", TEST_JOURNAL_DATE, new Date().toISOString(), "Trade 1 · 09:00", 1);
    for (const entry of entries) await vq.addEntryToGroup(app, "", group.id, entry.id);
    await view.refresh();

    const entriesEl = findByClass(view.contentEl, "tj-print-group-entries");
    const items = entriesEl.children.filter((child) => child.classes.has("tj-print-group-film-item"));
    assert.equal(items.length, 3);
    const [first, , third] = items;
    third.rect = { left: 300, top: 0, width: 164, height: 108 };

    const dt = { data: {}, effectAllowed: "", setData(type, value) { this.data[type] = value; }, getData(type) { return this.data[type] ?? ""; } };
    let dragStopped = 0;
    first.dispatch("dragstart", { dataTransfer: dt, stopPropagation() { dragStopped += 1; } });
    assert.equal(dragStopped, 1, "thumbnail drag does not bubble into a whole-group drag");
    assert.deepEqual(JSON.parse(dt.data["text/plain"]), { entryId: entries[0].id, fromGroupId: group.id });

    let prevented = 0;
    third.dispatch("dragover", {
      dataTransfer: dt,
      clientX: 460,
      preventDefault() { prevented += 1; },
      stopPropagation() {},
    });
    assert.equal(prevented, 1);
    assert.equal(third.classes.has("is-drop-after"), true, "insertion indicator shows the drop position");

    third.dispatch("drop", {
      dataTransfer: dt,
      clientX: 460,
      preventDefault() {},
      stopPropagation() {},
    });

    await waitFor(async () => {
      const loaded = await vq.loadPrintGroup(app, "", group.id);
      return !!loaded && loaded.entryIds[0] === entries[1].id && loaded.entryIds[2] === entries[0].id;
    }, "same-lane reorder");

    const loaded = await vq.loadPrintGroup(app, "", group.id);
    assert.deepEqual(loaded.entryIds, [entries[1].id, entries[2].id, entries[0].id]);
    assert.equal(new Set(loaded.entryIds).size, 3, "no print was duplicated or copied");
    assert.equal((await vq.listPrintInboxEntries(app, "Tradebook")).length, 3, "the inbox still holds exactly three prints");
  });
});

test("reorder source keeps direct drag wiring and no move-up/down buttons", () => {
  assert.match(viewSource, /private async reorderEntryTo/);
  assert.match(viewSource, /is-drop-before/);
  assert.match(viewSource, /is-drop-after/);
  assert.doesNotMatch(viewSource, /move-up|move-down|Move up|Move down/);
  assert.doesNotMatch(viewSource, /tj-print-group-count/);
  assert.doesNotMatch(viewSource, /tj-print-inbox-footer/);
});
