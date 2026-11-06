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
        "export class MarkdownRenderer { static async render(){ } }",
        "export class Notice {}",
        "export const normalizePath = (p) => p;",
        "export const setIcon = () => {};",
      ].join("\n"),
      loader: "js",
    }));
  },
};

const bundle = await build({
  entryPoints: { detail: new URL("../src/views/tradeDetailView.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [obsidianStub],
});
const detail = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const annotated = new globalThis.__TradeBookTestTFile("Tradebook/print-inbox/2026-10-29/chart-annotated.png");

// This test is intentionally written against the public Trade Detail image
// resolution method. It models the real post-annotation state: the Trade keeps
// only the annotated basename, while Obsidian's metadata cache can resolve the
// unique vault file.
test("annotated basename resolves through the metadata cache", () => {
  const view = Object.create(detail.TradeDetailView.prototype);
  view.trade = { id: "Tradebook/2026/10/trades/trade.md", date: "2026-10-29" };
  view.plugin = { attachmentCandidates: () => [] };
  view.app = {
    vault: {
      getAbstractFileByPath: () => null,
      getResourcePath: (file) => `resource:${file.path}`,
    },
    metadataCache: {
      getFirstLinkpathDest: () => annotated,
    },
  };

  assert.equal(view.resolveImage("chart-annotated.png"), "resource:Tradebook/print-inbox/2026-10-29/chart-annotated.png");
});
