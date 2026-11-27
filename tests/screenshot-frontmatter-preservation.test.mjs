/**
 * Screenshot frontmatter must survive being written in more than one shape.
 *
 * A `screenshots:` list is valid YAML with or without blank lines between its
 * items, and a user's own hand edit (or a frontmatter rewrite by the host) can
 * produce the blank-separated form. The parser has to walk past those blank
 * separators AND still stop at the next top-level key, because swallowing the
 * key would corrupt the note and stopping at the first blank line would drop
 * every screenshot after the first on the next save.
 *
 * The risk this guards is real link loss: `appendTradeScreenshots` and
 * `updateTradeScreenshots` both read the existing entries back through this
 * parser, so a mis-parse silently writes a shortened list over the note.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { parseTradeFromMarkdown, appendTradeScreenshots, updateTradeScreenshots, saveTrade, tradeMonthPath, tradeFilename } from './src/storage';
      export { TFile } from 'obsidian';`,
    resolveDir: new URL("..", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  plugins: [{
    name: "isolated-obsidian-host",
    setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
      b.onLoad({ filter: /.*/, namespace: "host" }, () => ({
        contents: `export class App {} export class Plugin {} export class PluginManifest {} export class ItemView {}
          export class Modal {} export class PluginSettingTab {} export class Setting {} export class Menu {}
          export class SuggestModal {} export class FuzzySuggestModal {} export class Component {} export class MarkdownRenderChild {}
          export class Vault {} export class TFile { constructor(p){this.path=p;} get name(){return this.path.split('/').pop();} get extension(){return this.name.split('.').pop();} }
          export class TFolder {} export class Notice {}
          export const normalizePath=p=>String(p).replace(/\\\\/g,'/').replace(/\\/+/g,'/');
          export const setIcon=()=>{}; export const addIcon=()=>{}; export const debounce=fn=>fn; export const apiVersion='synthetic';
          export const moment=()=>{}; export const MarkdownRenderer={}; export const Platform={isDesktop:true,isMobile:false};
          export const requestUrl=()=>{throw new Error('Network forbidden');};`,
      }));
    },
  }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function note(screenshotBlock, extra = "rating: 4") {
  return [
    "---",
    "type: trade",
    "date: 2026-11-06",
    "symbol: MES",
    "direction: long",
    'entry_time: "09:30:00"',
    'exit_time: "09:41:00"',
    "quantity: 2",
    "entry_price: 5000",
    "exit_price: 5002",
    "pnl: 20",
    "pnl_points: 2",
    'screenshot: "Attachments/a.png"',
    "screenshots:",
    screenshotBlock,
    extra,
    "---",
    "",
    "Synthetic body line.",
    "",
  ].join("\n");
}

const BLANK_SEPARATED = [
  '  - file: "Attachments/a.png"',
  '    note: "first"',
  "",
  '  - file: "Attachments/b.png"',
  '    note: "second"',
  "",
  '  - file: "Attachments/c.png"',
].join("\n");

const CONTIGUOUS = [
  '  - file: "Attachments/a.png"',
  '    note: "first"',
  '  - file: "Attachments/b.png"',
  '    note: "second"',
  '  - file: "Attachments/c.png"',
].join("\n");

const EXPECTED = [
  { file: "Attachments/a.png", note: "first" },
  { file: "Attachments/b.png", note: "second" },
  { file: "Attachments/c.png" },
];

test("a blank-separated screenshot block reads back every entry", () => {
  const text = note(BLANK_SEPARATED);
  const parsed = api.parseTradeFromMarkdown(text);
  assert.deepEqual(parsed.screenshots, EXPECTED, "every screenshot after the first must survive");
});

test("a contiguous screenshot block still reads back every entry", () => {
  const parsed = api.parseTradeFromMarkdown(note(CONTIGUOUS));
  assert.deepEqual(parsed.screenshots, EXPECTED, "the ordinary shape must keep working");
});

test("the parser stops at the next top-level key instead of swallowing it", () => {
  const parsed = api.parseTradeFromMarkdown(note(BLANK_SEPARATED, "rating: 4"));
  assert.deepEqual(parsed.screenshots, EXPECTED);
  assert.equal(parsed.rating, 4, "the key after the list is still parsed");
});

test("the parser also stops when a blank line separates the list from the next key", () => {
  const parsed = api.parseTradeFromMarkdown(note(BLANK_SEPARATED, "\nrating: 5"));
  assert.deepEqual(parsed.screenshots, EXPECTED);
  assert.equal(parsed.rating, 5, "a blank line before the next key is a separator, not part of the list");
});

test("appending a screenshot to a blank-separated note keeps the entries already there", async () => {
  const files = new Map();
  const path = "Trades/2026/11/2026-11-06 MES LONG 0930.md";
  const file = new api.TFile(path);
  file.text = note(BLANK_SEPARATED);
  files.set(path, file);
  const app = {
    vault: {
      getFiles: () => [...files.values()],
      getAbstractFileByPath: (p) => files.get(p) ?? null,
      createFolder: async () => {},
      create: async () => { throw new Error("unexpected create"); },
      read: async (f) => f.text,
      cachedRead: async (f) => f.text,
      process: async (f, fn) => { f.text = fn(f.text); return f.text; },
      rename: async () => {},
      adapter: { exists: async () => false },
    },
    fileManager: {},
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFirstLinkpathDest: () => null },
  };
  const result = await api.appendTradeScreenshots(app, file, [{ file: "Attachments/d.png", note: "fourth" }]);
  assert.equal(result.appended, 1);
  assert.deepEqual(
    result.screenshots,
    [...EXPECTED, { file: "Attachments/d.png", note: "fourth" }],
    "the three existing links must still be there after an append",
  );
  const reread = api.parseTradeFromMarkdown(files.get(path).text);
  assert.deepEqual(reread.screenshots, [...EXPECTED, { file: "Attachments/d.png", note: "fourth" }], "and on disk");
  assert.equal(reread.rating, 4, "the neighbour key survives the rewrite");
  assert.match(files.get(path).text, /Synthetic body line\./, "the body survives the rewrite");
});

test("a blank line that the note itself put before the next key is left alone", async () => {
  const files = new Map();
  const path = "Trades/2026/11/2026-11-06 MES LONG 0930.md";
  const file = new api.TFile(path);
  file.text = note(CONTIGUOUS, "\nrating: 4");
  files.set(path, file);
  const app = {
    vault: {
      getFiles: () => [...files.values()],
      getAbstractFileByPath: (p) => files.get(p) ?? null,
      createFolder: async () => {},
      create: async () => { throw new Error("unexpected create"); },
      read: async (f) => f.text,
      cachedRead: async (f) => f.text,
      process: async (f, fn) => { f.text = fn(f.text); return f.text; },
      rename: async () => {},
      adapter: { exists: async () => false },
    },
    fileManager: {},
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFirstLinkpathDest: () => null },
  };
  await api.appendTradeScreenshots(app, file, [{ file: "Attachments/d.png", note: "fourth" }]);
  const text = files.get(path).text;
  assert.match(text, /\n[ \t]*\nrating: 4/, "the note's own spacing before the next key is not reformatted");
  assert.equal(api.parseTradeFromMarkdown(text).rating, 4);
});
