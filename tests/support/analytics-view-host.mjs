// Synthetic host boundary for the analytics view tests. No vault or plugin boot.
import { build } from "esbuild";
import Module from "node:module";
import { fileURLToPath } from "node:url";

export function installElementHelpers(window) {
  const proto = window.HTMLElement.prototype;
  proto.createEl = function (tag, options = {}) {
    const el = this.ownerDocument.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text !== undefined) el.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function (options) { return this.createEl("div", options); };
  proto.setText = function (text) { this.textContent = text; };
  proto.addClass = function (...names) { this.classList.add(...names); };
}

export async function loadAnalyticsView() {
  // Compile the real view and its real analytics/rendering dependencies in memory.
  // Only Obsidian's host classes are synthetic; no calculations are mocked.
  const entry = fileURLToPath(new URL("../../src/views/homeView.ts", import.meta.url));
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, platform: "node",
    format: "cjs", external: ["obsidian"], loader: { ".png": "dataurl" },
  });
  class ItemView { constructor(leaf) { this.leaf = leaf; this.app = leaf.app; } }
  class Modal {}
  class SuggestModal extends Modal {}
  const obsidian = { ItemView, Modal, SuggestModal, setIcon() {} };
  const compiled = new Module(entry);
  compiled.filename = entry;
  compiled.paths = Module._nodeModulePaths(fileURLToPath(new URL("../../src/views", import.meta.url)));
  const requireOriginal = compiled.require.bind(compiled);
  compiled.require = (id) => id === "obsidian" ? obsidian : requireOriginal(id);
  compiled._compile(result.outputFiles[0].text, entry);
  return compiled.exports.HomeView;
}

export function syntheticAnalyticsPlugin() {
  return {
    settings: {
      timeZone: "", weekStart: "monday", propAccounts: [],
      excludeDemosFromPortfolio: false, includeCopiesInPortfolioAnalytics: false,
      animations: false,
    },
    mappedAccount: () => undefined,
    isArchivedTrade: () => false,
    resolveAccountType: () => undefined,
  };
}
