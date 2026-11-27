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
        "globalThis.__TradeScreenshotTestTFile = TFile;",
      ].join("\n"),
      loader: "js",
    }));
  },
};

const bundle = await build({
  entryPoints: { resolver: new URL("../src/lib/tradeScreenshotResolver.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [obsidianStub],
});
const resolver = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const TFile = globalThis.__TradeScreenshotTestTFile;

function host(files = new Map()) {
  return {
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path) ?? null,
        getResourcePath: (file) => `resource:${file.path}`,
      },
      metadataCache: { getFirstLinkpathDest: () => null },
    },
    attachmentCandidates: (target) => [`Tradebook/2026/10/attachments/${target}`],
    getTradesFolder: () => "Tradebook/2026/10/trades",
  };
}

function file(path) { return new TFile(path); }
function trade(overrides = {}) {
  return {
    id: "Tradebook/2026/10/trades/19-10-2026 NQ LONG 1005.md",
    date: "2026-10-19",
    screenshot: "19-10-2026 NQ LONG 1005 print 2-annotated.png",
    screenshots: [],
    ...overrides,
  };
}

test("an unresolved foreign identity never recovers another trade's same-slot image", () => {
  const wrong = file("Tradebook/2026/10/attachments/A print 2.png");
  const app = host(new Map([[wrong.path, wrong]]));
  assert.equal(resolver.resolveTradeScreenshotFile(app, trade({ id: "Trades/A.md" }), "B print 2.png"), null);
});

test("existing HEIC and HEIF image links resolve", () => {
  for (const ext of ["heic", "heif"]) {
    const image = file(`Tradebook/2026/10/attachments/chart.${ext}`);
    assert.equal(resolver.resolveTradeScreenshotFile(host(new Map([[image.path, image]])), trade(), image.name), image);
  }
});

test("metadata resolves an existing original before same-slot recovery", () => {
  const original = file("Elsewhere/B print 2.png");
  const wrong = file("Tradebook/2026/10/attachments/A print 2.png");
  const app = host(new Map([[original.path, original], [wrong.path, wrong]]));
  app.app.metadataCache.getFirstLinkpathDest = (target, source) => {
    assert.equal(target, "B print 2.png");
    assert.equal(source, "Trades/A.md");
    return original;
  };
  assert.equal(resolver.resolveTradeScreenshotFile(app, trade({ id: "Trades/A.md" }), "B print 2.png"), original);
});

test("structured entries stay authoritative; legacy scalar is only the fallback", () => {
  const current = trade({ screenshots: [{ file: "one.png" }, { file: "two.png" }] });
  assert.deepEqual(resolver.tradeScreenshotEntries(current), [
    { entry: { file: "one.png" }, sourceIndex: 0 },
    { entry: { file: "two.png" }, sourceIndex: 1 },
  ]);
  assert.deepEqual(resolver.tradeScreenshotEntries(trade({ screenshots: [], screenshot: "one.png; two.png" })), [
    { entry: { file: "one.png" }, sourceIndex: 0 },
    { entry: { file: "two.png" }, sourceIndex: 1 },
  ]);
  assert.deepEqual(resolver.tradeScreenshotEntries(trade({ screenshot: "added" })), []);
});

test("stale paths recover only the same trade's exact print slot across all indexed prints", () => {
  const note = "Tradebook/2026/10/trades/19-10-2026 NQ LONG 1005_2.md";
  const printFiles = Array.from({ length: 9 }, (_, offset) =>
    file(`Tradebook/2026/10/attachments/19-10-2026 NQ LONG 1005_2 print ${offset + 1}-annotated.png`));
  const files = new Map([[note, file(note)], ...printFiles.map((item) => [item.path, item])]);
  const app = host(files);
  const currentTrade = trade({
    id: "Tradebook/2026/10/trades/19-10-2026 NQ LONG 1005_2.md",
    screenshots: Array.from({ length: 9 }, (_, offset) => ({ file: `2026-10-19 NQ LONG 1005_2 print ${offset + 1}-annotated.png` })),
  });

  currentTrade.screenshots.forEach((entry, index) => {
    assert.equal(
      resolver.resolveTradeScreenshotFile(app, currentTrade, entry.file)?.path,
      printFiles[index].path,
      `slot ${index + 1} must resolve to its exact same-trade file`,
    );
  });
  assert.equal(resolver.resolveFirstTradeScreenshot(app, currentTrade)?.path, printFiles[0].path);
});

test("stale references do not borrow a similar print from another trade", () => {
  const target = "2026-10-19 NQ LONG 1005_2 print 2-annotated.png";
  const foreign = file("Tradebook/2026/10/attachments/19-10-2026 NQ SHORT 0900 print 2-annotated.png");
  const files = new Map([[foreign.path, foreign]]);
  const currentTrade = trade({ screenshot: "19-10-2026 NQ SHORT 0900 print 2-annotated.png" });
  assert.equal(resolver.resolveTradeScreenshotFile(host(files), currentTrade, target), null);
});

test("old ISO and matching collision-suffixed links recover the exact current-format print slot", () => {
  const currentBase = "19-10-2026 NQ LONG 1005_2";
  const stale = "2026-10-19 NQ LONG 1005_2 print 2-annotated.png";
  const print = file(`Tradebook/2026/10/attachments/${currentBase} print 2-annotated.png`);
  const currentTrade = trade({
    id: `Tradebook/2026/10/trades/${currentBase}.md`,
    screenshot: stale,
    screenshots: [{ file: stale }],
  });
  const resolved = resolver.resolveTradeScreenshotFile(host(new Map([[print.path, print]])), currentTrade, stale);
  assert.equal(resolved?.path, print.path);
});

test("a mismatched collision suffix is ambiguous and never recovers another trade's slot", () => {
  const currentBase = "19-10-2026 NQ LONG 1005";
  const stale = "2026-10-19 NQ LONG 1005_2 print 2-annotated.png";
  const otherTradePrint = file(`Tradebook/2026/10/attachments/${currentBase} print 2-annotated.png`);
  const currentTrade = trade({
    id: `Tradebook/2026/10/trades/${currentBase}.md`,
    screenshot: stale,
    screenshots: [{ file: stale }],
  });
  assert.equal(resolver.resolveTradeScreenshotFile(host(new Map([[otherTradePrint.path, otherTradePrint]])), currentTrade, stale), null);
});

test("a missing slot and a JSON annotation sidecar never resolve as an image", () => {
  const note = "Tradebook/2026/10/trades/19-10-2026 NQ LONG 1005.md";
  const anchor = file("Tradebook/2026/10/attachments/19-10-2026 NQ LONG 1005 print 2-annotated.png");
  const sidecar = file("Tradebook/2026/10/attachments/19-10-2026 NQ LONG 1005 print 2.json");
  const files = new Map([[note, file(note)], [anchor.path, anchor], [sidecar.path, sidecar]]);
  const app = host(files);
  const currentTrade = trade();
  assert.equal(resolver.resolveTradeScreenshotFile(app, currentTrade, "2026-10-19 NQ LONG 1005_2 print 10.png"), null);
  assert.equal(resolver.resolveTradeScreenshotFile(app, currentTrade, sidecar.name), null);
});

test("direct wiki links resolve and ignore display labels", () => {
  const print = file("Tradebook/2026/10/attachments/chart.webp");
  const app = host(new Map([[print.path, print]]));
  assert.equal(
    resolver.resolveTradeScreenshotFile(app, trade(), "[[chart.webp|entry screenshot]]")?.path,
    print.path,
  );
});
