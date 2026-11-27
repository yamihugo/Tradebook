import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const obsidianStub = {
  name: "obsidian-test-stub",
  setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
    b.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
      contents: [
        "export class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.extension = this.name.split('.').pop(); } }",
        "globalThis.__TradeBookTestTFile = TFile;",
        "export class ItemView {}",
        "export class Notice {}",
        "export const normalizePath = (p) => p;",
        "export const setIcon = () => {};",
        "export class MarkdownRenderer { static async render(){ } }",
      ].join("\n"),
      loader: "js",
    }));
  },
};

const bundle = await build({
  entryPoints: { detail: process.env.TRADE_DETAIL_ENTRY ?? new URL("../src/views/tradeDetailView.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [obsidianStub],
});
const detail = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeView() {
  const view = Object.create(detail.TradeDetailView.prototype);
  view._saveTimers = {};
  view._pendingReviewWrites = new Set();
  view._reviewWriteQueue = Promise.resolve();
  view._failedReviewWrites = new Map();
  view._reviewSaveStatusNodes = new Map();
  view._refreshRetry = null;
  view._lightboxCleanup = null;
  view._pasteCleanups = [];
  view.keydownHandler = () => {};
  return view;
}

test("independent views save different review fields without clobbering the latest note", async () => {
  const file = new globalThis.__TradeBookTestTFile("Tradebook/2026/11/trades/shared.md");
  let content = "---\ntype: trade\nsymbol: MES\nreview_what_happened: \"\"\nreview_repeat_change: \"\"\nnotes: keep me\n---\n";
  let processQueue = Promise.resolve();
  let activeProcesses = 0;
  let maxConcurrentProcesses = 0;
  const app = {
    vault: {
      getAbstractFileByPath: (path) => path === file.path ? file : null,
      process: async (_target, transform) => {
        const operation = processQueue.then(async () => {
          activeProcesses++;
          maxConcurrentProcesses = Math.max(maxConcurrentProcesses, activeProcesses);
          await new Promise((resolve) => setTimeout(resolve, 5));
          content = transform(content);
          activeProcesses--;
        });
        processQueue = operation;
        await operation;
      },
    },
  };
  const firstView = makeView();
  const secondView = makeView();
  firstView.app = app;
  secondView.app = app;

  await Promise.all([
    firstView.saveField("review_what_happened", "The setup held through the pullback.", file.path),
    secondView.saveField("review_repeat_change", "Wait for the confirming close.", file.path),
  ]);

  assert.match(content, /review_what_happened:.*The setup held through the pullback/);
  assert.match(content, /review_repeat_change:.*Wait for the confirming close/);
  assert.ok(content.includes("notes: keep me"));
  assert.equal(maxConcurrentProcesses, 1, "Obsidian's per-file process is the merge boundary across separate views");
});

test("switching trades waits for the pending debounced review write", async () => {
  const gate = deferred();
  const oldTrade = { id: "old.md", date: "2026-11-01", symbol: "NQ", direction: "long", quantity: 1, entryPrice: 100, exitPrice: 110, pnl: 10 };
  const nextTrade = { ...oldTrade, id: "next.md" };
  const view = makeView();
  view.trade = oldTrade;
  view.allTrades = [oldTrade, nextTrade];
  view.plugin = { knownSetups: async () => [] };
  view.render = () => {};
  globalThis.window = { clearTimeout: () => {} };
  let started = false;
  view._saveTimers.review = { timer: 11, run: () => { started = true; return gate.promise; } };

  const switching = view.setTrade(nextTrade);
  assert.equal(view.trade, oldTrade, "the active trade must not change before its edit is saved");
  await Promise.resolve();
  assert.equal(started, true, "flush should start the pending write immediately");
  assert.equal(view.trade, oldTrade, "the view must wait for the write to finish");

  gate.resolve();
  await switching;
  assert.equal(view.trade, nextTrade);
});

test("flush serializes pending review field writes and waits for every one", async () => {
  const first = deferred();
  const second = deferred();
  const secondStarted = deferred();
  const view = makeView();
  globalThis.window = { clearTimeout: () => {} };
  const started = [];
  let flushed = false;
  view._saveTimers.first = { timer: 31, run: () => { started.push("first"); return first.promise; } };
  view._saveTimers.second = { timer: 32, run: () => { started.push("second"); secondStarted.resolve(); return second.promise; } };

  const flushing = view.flushReviewSaves().then(() => { flushed = true; });
  await Promise.resolve();
  assert.deepEqual(started, ["first"], "same-note frontmatter writes should not race each other");
  first.resolve();
  await secondStarted.promise;
  assert.deepEqual(started, ["first", "second"]);
  assert.equal(flushed, false, "flush must wait for the final write too");
  second.resolve();
  await flushing;
  assert.equal(flushed, true);
});

test("closing before debounce expiry persists the final reflection to the Markdown note", async () => {
  const view = makeView();
  const file = new globalThis.__TradeBookTestTFile("Tradebook/2026/11/trades/synthetic.md");
  const writeGate = deferred();
  const processStarted = deferred();
  let persistedText = "---\ntype: trade\nreview_what_happened: \"\"\n---\n# Synthetic trade\n";
  let timerCallback;
  globalThis.window = {
    setTimeout: (callback) => { timerCallback = callback; return 41; },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  view.trade = { id: file.path };
  view.app = {
    vault: {
      getAbstractFileByPath: (path) => path === file.path ? file : null,
      process: async (target, transform) => {
        assert.equal(target, file);
        const nextText = transform(persistedText);
        processStarted.resolve();
        await writeGate.promise;
        persistedText = nextText;
      },
    },
  };

  view.debounceReview("review_what_happened", () => view.persistTradeField(
    "review_what_happened",
    "I waited for the trade to confirm.",
    file.path,
  ));
  assert.equal(persistedText.includes("I waited for the trade to confirm."), false);
  assert.equal(typeof timerCallback, "function");

  let closed = false;
  const closing = view.onClose().then(() => { closed = true; });
  await processStarted.promise;
  await Promise.resolve();
  assert.equal(closed, false, "view close must wait for the actual frontmatter write");
  assert.equal(persistedText.includes("I waited for the trade to confirm."), false);

  writeGate.resolve();
  await closing;
  assert.match(persistedText, /review_what_happened:.*I waited for the trade to confirm/);
  assert.deepEqual(Object.keys(view._saveTimers), []);
});

test("trade switching retries one failed review write before changing records", async () => {
  const view = makeView();
  const oldTrade = { id: "old.md", date: "2026-11-01", symbol: "NQ", direction: "long", quantity: 1, entryPrice: 100, exitPrice: 110, pnl: 10 };
  const nextTrade = { ...oldTrade, id: "next.md" };
  let attempts = 0;
  view.trade = oldTrade;
  view.allTrades = [oldTrade, nextTrade];
  view.plugin = { knownSetups: async () => [], settings: { setups: [] } };
  view.render = () => {};
  globalThis.window = { clearTimeout: () => {} };
  view._saveTimers.review_what_happened = {
    timer: 52,
    run: async () => { attempts++; if (attempts === 1) throw new Error("transient vault failure"); },
  };

  await view.setTrade(nextTrade);
  assert.equal(attempts, 2, "a failed field is retried once during the flush");
  assert.equal(view.trade, nextTrade, "the switch proceeds only after the retry succeeds");
  assert.equal(view._failedReviewWrites.size, 0);
});

test("trade switching is blocked when a review write remains failed after retry", async () => {
  const view = makeView();
  const oldTrade = { id: "old.md", date: "2026-11-01", symbol: "NQ", direction: "long", quantity: 1, entryPrice: 100, exitPrice: 110, pnl: 10 };
  const nextTrade = { ...oldTrade, id: "next.md" };
  let attempts = 0;
  view.trade = oldTrade;
  view.allTrades = [oldTrade, nextTrade];
  view.plugin = { knownSetups: async () => [], settings: { setups: [] } };
  view.render = () => {};
  globalThis.window = { clearTimeout: () => {} };
  view._saveTimers.review_what_happened = {
    timer: 53,
    run: async () => { attempts++; throw new Error("persistent vault failure"); },
  };

  await view.setTrade(nextTrade);
  assert.equal(attempts, 2, "the failing write gets one bounded retry");
  assert.equal(view.trade, oldTrade, "the old trade remains open rather than silently abandoning the edit");
  assert.equal(view._failedReviewWrites.size, 1);
});

test("closing the view waits for a review write whose debounce timer already fired", async () => {
  const gate = deferred();
  const view = makeView();
  let timerCallback;
  globalThis.window = {
    setTimeout: (callback) => { timerCallback = callback; return 22; },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  let started = false;
  view.debounceReview("review_what_happened", () => { started = true; return gate.promise; });
  timerCallback();
  await Promise.resolve();
  assert.equal(started, true);
  assert.equal(Object.keys(view._saveTimers).length, 0, "the timer has fired and left the debounce map");

  let closed = false;
  const closing = view.onClose().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false, "onClose must await the in-flight write");
  gate.resolve();
  await closing;
  assert.equal(closed, true);
});
