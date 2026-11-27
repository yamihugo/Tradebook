import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { test } from "node:test";

const settingsPath = new URL("../src/settings.ts", import.meta.url).pathname;
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const stubModules = {
  "./tz": "export const TIMEZONE_OPTIONS = []; export const detectSystemZone = () => 'UTC';",
  "./lib/brandIcons": "export const BRAND_MARKS = {}; export const appendBrandMark = () => {};",
  "./views/renamePreview": "export const openRenamePreview = async () => {};",
  "./lib/diagnostics": "export const buildDiagnostics = async () => '';",
  "./views/backupRestore": "export const openBackupSummary = () => {};",
  "./views/settingsRestore": "export const openSettingsRestore = () => {};",
  "./lib/backup": "export const summariseBackup = () => ({});",
  "./lib/numeric": "export const freeNumeric = () => {};",
  "./lib/dropdown": "export const mountDropdown = () => {};",
  "./lib/tags": "export const MISTAKE_GROUPS = []; export const PSYCHOLOGY_TAGS = []; export const libraryFor = () => []; export const reviewOptions = () => [];",
  "./futures": "export const CORE_INSTRUMENTS = []; export const CORE_SYMBOLS = []; export const contractLabel = () => ''; export const futuresSpec = () => ({}); export const DEFAULT_ACCOUNT_RULES = [];",
  "./lib/accountTypes": "export const typeColor = () => ''; export const typeLabel = () => '';",
};

const dom = new JSDOM("<!doctype html><html><body class='theme-light'></body></html>", { pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
const proto = dom.window.HTMLElement.prototype;
proto.createEl = function (tag, opts = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (opts.cls) el.className = opts.cls;
  if (opts.text !== undefined) el.textContent = opts.text;
  for (const [key, value] of Object.entries(opts.attr ?? {})) {
    if (value === true) el.setAttribute(key, "");
    else if (value !== false && value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  this.appendChild(el);
  return el;
};
proto.createDiv = function (opts = {}) { return this.createEl("div", opts); };
proto.createSpan = function (opts = {}) { return this.createEl("span", opts); };
proto.empty = function () { this.replaceChildren(); };
proto.addClass = function (name) { this.classList.add(name); };
proto.toggleClass = function (name, force) { this.classList.toggle(name, force); };

const bundle = await build({
  entryPoints: [settingsPath],
  bundle: true,
  format: "esm",
  platform: "browser",
  loader: { ".png": "dataurl" },
  write: false,
  plugins: [{
    name: "settings-test-host",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "settings-test" }));
      build.onLoad({ filter: /^obsidian$/, namespace: "settings-test" }, () => ({
        contents: `
          export class App {}
          export class Notice { constructor() {} }
          export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); } }
          export class Setting {}
          export const setIcon = () => {};
        `,
        loader: "js",
      }));
      build.onResolve({ filter: /^\.\/(?:tz|lib\/(?:brandIcons|diagnostics|backup|numeric|dropdown|tags|accountTypes)|views\/(?:renamePreview|backupRestore|settingsRestore)|futures)$/ }, (args) => ({ path: args.path, namespace: "settings-test" }));
      build.onLoad({ filter: /.*/, namespace: "settings-test" }, (args) => ({ contents: stubModules[args.path], loader: "js" }));
    },
  }],
});
const output = bundle.outputFiles.find((file) => file.path.endsWith("settings.js")) ?? bundle.outputFiles[0];
const { SettingsTab } = await import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);

test("Support card displays the loaded manifest version", () => {
  const tab = new SettingsTab({}, { manifest: { version: "1.1.2" } });
  dom.window.document.body.appendChild(tab.containerEl);
  tab.display();
  assert.equal(tab.containerEl.querySelector(".tj-set-about-ver")?.textContent, "v1.1.2");
  tab.containerEl.remove();
});

test("Settings home sections can be reached and activated with keyboard controls", () => {
  const tab = new SettingsTab({}, { manifest: { version: "test" } });
  dom.window.document.body.appendChild(tab.containerEl);
  let refreshes = 0;
  tab.refresh = () => {
    refreshes += 1;
    tab.containerEl.empty();
    tab.containerEl.createEl("button", { cls: "tj-set-back" });
  };
  tab.display();
  const rows = [...tab.containerEl.querySelectorAll(".tj-set-item")];
  assert.ok(rows.length >= 7, "all settings sections are rendered");
  const general = rows.find((row) => row.querySelector(".tj-set-title")?.textContent === "General");
  assert.ok(general);
  assert.equal(general.getAttribute("role"), "button");
  assert.equal(general.getAttribute("aria-label"), "General");
  assert.ok(general.getAttribute("aria-description"));
  assert.equal(general.tabIndex, 0);
  general.focus();
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  general.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true, "Enter is handled without triggering browser behavior");
  assert.equal(tab.active, "general");
  assert.equal(refreshes, 1, "keyboard activation follows the same navigation path as clicking");
  assert.equal(dom.window.document.activeElement.className, "tj-set-back", "focus moves into the opened settings section");

  tab.active = "root";
  tab.display();
  const journal = [...tab.containerEl.querySelectorAll(".tj-set-item")]
    .find((row) => row.querySelector(".tj-set-title")?.textContent === "Journal");
  journal.focus();
  journal.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  assert.equal(tab.active, "journal");
  assert.equal(refreshes, 2, "Space activates the section through the same click handler");
  dom.window.close();
});

test("Settings home keyboard focus uses host theme tokens in Light and Dark", () => {
  const focusRule = css.match(/\.tj-set-item:focus-visible\s*\{[^}]*\}/s);
  assert.ok(focusRule, "Settings navigation rows have a visible keyboard-focus rule");
  assert.match(focusRule[0], /outline:[^;]*var\(--interactive-accent\)/);
  assert.equal(/body\.theme-light[^{}]*\.tj-set-item:focus-visible/.test(css), false);
  assert.equal(/body\.theme-dark[^{}]*\.tj-set-item:focus-visible/.test(css), false);
});

test("Settings muted text follows the host Light token without overriding Dark", () => {
  const lightRule = css.match(/body\.theme-light\s+\.tj-settings\s*\{[^}]*\}/);
  assert.ok(lightRule, "the settings panel has a scoped Light-mode text ramp");
  assert.equal(/--tj-fg-3:\s*var\(--text-muted\)/.test(lightRule[0]), true);
  assert.equal(/body\.theme-dark\s+\.tj-settings\s*\{[^}]*--tj-fg-3\s*:/.test(css), false);
  assert.equal(css.includes("--tj-fg-3: #8a9099;"), true, "the existing Dark-mode ramp remains unchanged");

  const themeDom = new JSDOM("<!doctype html><html><body class='theme-light'><div class='tj-settings'></div></body></html>");
  const panel = themeDom.window.document.querySelector(".tj-settings");
  assert.equal(panel.matches("body.theme-light .tj-settings"), true, "the selector matches the actual settings-panel topology");
  themeDom.window.document.body.className = "theme-dark";
  assert.equal(panel.matches("body.theme-light .tj-settings"), false, "the Light override does not leak into Dark mode");
  themeDom.window.close();
});

test("timezone guidance names the default clearly without the old lowercase copy", () => {
  assert.equal(/Trade times use one journal timezone across devices\. New York \(Eastern Time\) is the default\./.test(settingsSource), true);
  assert.equal(/New york \(eastern\)|trade on et/.test(settingsSource), false);
});
