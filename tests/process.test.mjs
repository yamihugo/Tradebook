import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: {
    process: new URL("../src/lib/process.ts", import.meta.url).pathname,
    tags: new URL("../src/lib/tags.ts", import.meta.url).pathname,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outdir: "bundle",
  write: false,
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: [
          "export const App = class {};",
          "export const TFile = class {};",
          "export const TFolder = class {};",
          "export const normalizePath = (p) => p;",
          "export const setIcon = () => {};",
        ].join("\n"),
        loader: "js",
      }));
    },
  }],
});
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [processMod, tags] = await Promise.all([loadBundle("process"), loadBundle("tags")]);
const { reentrySignals, revengeStats, DEFAULT_REENTRY_WINDOW_MINUTES, computeProcessSignals } = processMod;
const { isDeclaredRevenge, mistakeTagsOf } = tags;

const dayKey = (t) => t.date;
const trade = (overrides = {}) => ({
  id: "trade",
  date: "2026-09-01",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "Live One",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20001,
  pnl: 100,
  commission: 0,
  fees: 0,
  ...overrides,
});

const loser = trade({ id: "loser", quantity: 2, pnl: -100 });
const quick = trade({ id: "quick", entryTime: "10:15", exitTime: "10:20", quantity: 3, pnl: 50 });

test("a declaration is a tag, not an inferred motive; the legacy field still counts", () => {
  assert.equal(isDeclaredRevenge(trade({ mistake_tags: ["Revenge entry"] })), true);
  assert.equal(isDeclaredRevenge(trade({ psychology_tags: ["Revenge"] })), true);
  assert.equal(isDeclaredRevenge(trade({ mistake: "Revenge entry" })), true, "legacy single field falls back");
  assert.equal(isDeclaredRevenge(trade({ mistake_tags: ["Chased entry"], psychology_tags: ["FOMO"] })), false);
  // The curated array supersedes the legacy field entirely.
  assert.deepEqual(mistakeTagsOf(trade({ mistake: "old", mistake_tags: ["New"] })), ["New"]);
  assert.deepEqual(mistakeTagsOf(trade({ mistake: "old" })), ["old"]);
});

test("the window is the parameter: 10 minutes counts at 15, not at 5", () => {
  const reentry = trade({ id: "re", entryTime: "10:15", exitTime: "10:20", pnl: 50 });
  const atFive = reentrySignals([loser, reentry], dayKey, undefined, 5);
  assert.equal(atFive.observed.size, 0, "10-minute gap is outside a 5-minute window");
  const atFifteen = reentrySignals([loser, reentry], dayKey, undefined, DEFAULT_REENTRY_WINDOW_MINUTES);
  assert.equal(atFifteen.observed.size, 1, "10-minute gap is inside the 15-minute default");
  assert.ok(atFifteen.observed.has(reentry));
});

test("observed and declared are one union for the rate, but the axes stay separate", () => {
  const tagged = trade({ id: "tagged", date: "2026-09-02", symbol: "ES", mistake_tags: ["Revenge entry"] });
  const signals = reentrySignals([loser, quick, tagged], dayKey, undefined, 15);
  assert.equal(signals.observed.size, 1);
  assert.equal(signals.declared.size, 1);
  assert.equal(signals.escalated.size, 1, "the quick re-entry came in larger than the loss it followed");

  const stats = revengeStats([loser, quick, tagged], dayKey, undefined, 15);
  assert.equal(stats.count, 2, "loser is regular; quick observed + tagged declared");
  assert.equal(stats.rate, (2 / 3) * 100);
});

test("the process signals read the curated mistake tags", () => {
  const tagged = trade({ id: "tagged", mistake_tags: ["Moved stop"] });
  const legacy = trade({ id: "legacy", mistake: "No stop" });
  const signals = computeProcessSignals([tagged, legacy, trade({ id: "clean" })], dayKey);
  assert.equal(signals.mistakeRate, (2 / 3) * 100, "both a curated tag and a legacy label are mistakes");
});
