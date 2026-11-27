import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const obsidianStub = {
  name: "obsidian-test-stub",
  setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
    b.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
      contents: [
        "export class App {}",
        "export class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.extension = this.name.split('.').pop(); } }",
        "globalThis.__TradeBookTestTFile = TFile;",
        "export class TFolder {}",
        "export class ItemView {}",
        "export class Notice {}",
        "export const normalizePath = (p) => p;",
        "export const setIcon = () => {};",
        "export class MarkdownRenderer { static async render() {} }",
      ].join("\n"),
      loader: "js",
    }));
  },
};

async function load(name, entry) {
  const result = await build({
    entryPoints: { [name]: new URL(entry, import.meta.url).pathname },
    bundle: true,
    format: "esm",
    platform: "browser",
    outdir: "bundle",
    write: false,
    plugins: [obsidianStub],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const storage = await load("storage", "../src/storage.ts");
const richText = await load("richText", "../src/lib/reviewRichText.ts");
const detail = await load("detail", "../src/views/tradeDetailView.ts");
const TestTFile = globalThis.__TradeBookTestTFile;

function makeSyntheticStore() {
  const file = new TestTFile("synthetic/2026/11/test-trade.md");
  let content = [
    "---",
    "type: trade",
    "date: 2026-11-13",
    "symbol: TEST",
    'review_what_happened: "before REMOVE after"',
    'review_repeat_change: ""',
    'notes: "synthetic unrelated value"',
    "---",
    "# Synthetic trade only",
    "",
  ].join("\n");
  let queue = Promise.resolve();
  const app = {
    vault: {
      getAbstractFileByPath: (path) => path === file.path ? file : null,
      process: async (target, transform) => {
        assert.equal(target, file);
        const operation = queue.then(async () => {
          await Promise.resolve();
          content = transform(content);
        });
        queue = operation;
        await operation;
      },
    },
  };
  return {
    app,
    file,
    get content() { return content; },
    read() { return storage.parseTradeFromMarkdown(content); },
  };
}

function makeView(app) {
  const view = Object.create(detail.TradeDetailView.prototype);
  view.app = app;
  view.trade = { id: "synthetic/2026/11/test-trade.md" };
  view._saveTimers = {};
  view._pendingReviewWrites = new Set();
  view._reviewWriteQueue = Promise.resolve();
  view._failedReviewWrites = new Map();
  view._reviewSaveStatusNodes = new Map();
  return view;
}

function makeEditor(markdown) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.Node = dom.window.Node;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.document = dom.window.document;
  const editor = document.createElement("div");
  editor.contentEditable = "true";
  editor.innerHTML = richText.reviewMarkdownToHtml(markdown);
  return editor;
}

function occurrences(text, key) {
  return (text.match(new RegExp(`^${key}:`, "gm")) ?? []).length;
}

test("deleting a phrase in the Review editor saves once and stays deleted after reopen", async () => {
  const store = makeSyntheticStore();
  const editor = makeEditor(store.read().review_what_happened);
  const text = editor.querySelector("p").firstChild;
  const range = document.createRange();
  range.setStart(text, 7);
  range.setEnd(text, 14); // remove "REMOVE " while retaining one space
  range.deleteContents();
  assert.equal(richText.reviewHtmlToMarkdown(editor), "before after");

  const view = makeView(store.app);
  await view.saveField("review_what_happened", richText.reviewHtmlToMarkdown(editor), store.file.path);
  assert.equal(store.read().review_what_happened, "before after");
  assert.equal(occurrences(store.content, "review_what_happened"), 1);

  const reopened = makeEditor(store.read().review_what_happened);
  await view.saveField("review_what_happened", richText.reviewHtmlToMarkdown(reopened), store.file.path);
  assert.equal(store.read().review_what_happened, "before after");
  assert.equal(store.content.includes("REMOVE"), false);
});

test("clearing the whole Review field does not resurrect old text after reopen", async () => {
  const store = makeSyntheticStore();
  const editor = makeEditor(store.read().review_what_happened);
  editor.replaceChildren(); // equivalent to the editor after select-all + Delete
  const value = richText.reviewHtmlToMarkdown(editor);
  assert.equal(value, "");

  const view = makeView(store.app);
  await view.saveField("review_what_happened", value, store.file.path);
  assert.match(store.content, /^review_what_happened: ""$/m);
  assert.equal(richText.reviewMarkdownToHtml(store.read().review_what_happened ?? ""), "");
  const reopened = makeEditor(store.read().review_what_happened ?? "");
  await view.saveField("review_what_happened", richText.reviewHtmlToMarkdown(reopened), store.file.path);
  assert.match(store.content, /^review_what_happened: ""$/m);
  assert.equal(richText.reviewMarkdownToHtml(store.read().review_what_happened ?? ""), "");
  assert.equal(occurrences(store.content, "review_what_happened"), 1);
  assert.equal(store.content.includes("before REMOVE after"), false);
});

test("the visible `|-` text and multiline reflection round-trip without added copies", async () => {
  const store = makeSyntheticStore();
  const markerText = "|-\n\nline one\n\nline two";
  const editor = makeEditor(markerText);
  const edited = richText.reviewHtmlToMarkdown(editor);
  assert.equal(edited, markerText);

  const view = makeView(store.app);
  await view.saveField("review_what_happened", edited, store.file.path);
  assert.equal(store.read().review_what_happened, markerText);
  const reopened = makeEditor(store.read().review_what_happened);
  await view.saveField("review_what_happened", richText.reviewHtmlToMarkdown(reopened), store.file.path);
  assert.equal(store.read().review_what_happened, markerText);
  assert.equal(occurrences(store.content, "review_what_happened"), 1);
});

test("two Review fields saved concurrently keep both values and unrelated synthetic data", async () => {
  const store = makeSyntheticStore();
  const first = makeView(store.app);
  const second = makeView(store.app);
  await Promise.all([
    first.saveField("review_what_happened", "Synthetic event", store.file.path),
    second.saveField("review_repeat_change", "Synthetic next step", store.file.path),
  ]);

  const reopened = store.read();
  assert.equal(reopened.review_what_happened, "Synthetic event");
  assert.equal(reopened.review_repeat_change, "Synthetic next step");
  assert.equal(occurrences(store.content, "review_what_happened"), 1);
  assert.equal(occurrences(store.content, "review_repeat_change"), 1);
  assert.equal(store.content.includes('notes: "synthetic unrelated value"'), true);
});
