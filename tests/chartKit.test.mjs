import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// One bundle with the shape (chartKit) and the adapter that feeds it
// (breakdown), so the contract under test is the same number in both.
const result = await build({
  stdin: {
    contents: [
      'export { renderTreemap } from "./src/lib/chartKit";',
      'export { dimensionTiles } from "./src/lib/breakdown";',
    ].join("\n"),
    resolveDir: new URL("..", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: "export const App = class {}; export const TFile = class {}; export const normalizePath = (p) => p; export const setIcon = () => {};",
        loader: "js",
      }));
    },
  }],
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const row = (id, pnl, opts = {}) => ({
  id,
  date: "2026-01-05",
  entryTime: "09:00:00",
  exitTime: "10:00:00",
  symbol: "NQ",
  account: "A",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20001,
  commission: 0,
  fees: 0,
  costCoverage: { commission: true, fees: true },
  pnl,
  ...opts,
});

// Minimal DOM stand-in: renderTreemap only needs createDiv, addClass,
// classList.add (attachTip) and the two style writes it does.
const makeEl = () => {
  const el = {
    classes: new Set(),
    children: [],
    text: "",
    style: {
      flex: "",
      setProperty(name, value) {
        this[name] = value;
      },
    },
    createDiv({ cls = "", text = "" } = {}) {
      const child = makeEl();
      child.addClass(cls);
      child.text = text;
      this.children.push(child);
      return child;
    },
    addClass(cls) {
      for (const token of String(cls).split(/\s+/)) if (token) el.classes.add(token);
    },
    addEventListener() {},
  };
  el.classList = { add: (cls) => el.addClass(cls) };
  return el;
};

const findByClass = (root, cls) => {
  if (root.classes.has(cls)) return root;
  for (const child of root.children) {
    const hit = findByClass(child, cls);
    if (hit) return hit;
  }
  return null;
};

const render = (tiles, spec = {}) => {
  const host = makeEl();
  kit.renderTreemap(host, { tiles, ...spec });
  return host;
};

const winLabelOf = (host) => findByClass(host, "tj-treemap-w")?.text;

const otherTile = (host) =>
  host.children[0].children.find((c) => findByClass(c, "tj-treemap-t")?.text === "Other");

test("a tile's win% is Net-positive ÷ decided — the number the list shows, not wins ÷ count", () => {
  const rows = [row("w", 10), row("l", -8), row("b", 0)];
  const tiles = kit.dimensionTiles(rows, (t) => t.symbol, {});
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].count, 3, "three decisions in the bucket");
  assert.equal(tiles[0].wins, 1);
  assert.equal(tiles[0].decided, 2, "the break-even stays out of the denominator");

  const host = render(tiles);
  // wins ÷ count would read 33%; wins ÷ decided reads 50%.
  assert.equal(winLabelOf(host), "50% win");
});

test("a tile with nothing decided reads an em dash, never an invented 0%", () => {
  const breakeven = row("b", 0);
  const tiles = kit.dimensionTiles([breakeven], (t) => t.symbol, {});
  assert.equal(tiles[0].decided, 0);

  const host = render(tiles);
  assert.equal(winLabelOf(host), "—");
});

test("the merged Other tile sums decided, so its rate stays the same formula", () => {
  const head = ["NQ", "MNQ", "ES", "MES", "RTY"].flatMap((symbol) => [
    row(`${symbol}-w1`, 10, { symbol }),
    row(`${symbol}-w2`, 12, { symbol }),
    row(`${symbol}-l1`, -8, { symbol }),
    row(`${symbol}-l2`, -6, { symbol }),
  ]);
  const tail = [
    row("cl-w", 10, { symbol: "CL" }),
    row("cl-l", -8, { symbol: "CL" }),
    row("cl-b", 0, { symbol: "CL" }),
    row("gc-l1", -5, { symbol: "GC" }),
    row("gc-l2", -7, { symbol: "GC" }),
    row("gc-b", 0, { symbol: "GC" }),
  ];
  const rows = [...head, ...tail];
  const tiles = kit.dimensionTiles(rows, (t) => t.symbol, {});
  assert.equal(tiles.length, 7);

  const expected = (rest) => {
    const decided = rest.reduce((a, t) => a + t.decided, 0);
    const wins = rest.reduce((a, t) => a + t.wins, 0);
    return { decided, wins, label: `${Math.round((wins / decided) * 100)}% win` };
  };

  // Default merge (six head tiles): the tail is CL — decided 2, wins 1.
  {
    const want = expected(tiles.slice(6));
    assert.equal(want.decided, 2);
    const el = otherTile(render(tiles));
    assert.ok(el, "the tail is merged into an Other tile");
    assert.equal(findByClass(el, "tj-treemap-w")?.text, want.label);
  }

  // Two tiles in the tail: the sums are real sums, not one tile's numbers.
  {
    const rest = tiles.slice(5);
    const want = expected(rest);
    assert.equal(rest.length, 2);
    assert.equal(want.decided, 4, "CL decided 2 + GC decided 2");
    assert.equal(want.label, "25% win", "wins ÷ decided across the merged tiles");
    const el = otherTile(render(tiles, { maxTiles: 5 }));
    assert.equal(findByClass(el, "tj-treemap-w")?.text, want.label);
  }
});
