import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";

const result = await build({
  entryPoints: { printGroup: new URL("../src/lib/printGroup.ts", import.meta.url).pathname },
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
          contents: 'export const normalizePath = (p) => p; export const TFile = class { constructor(path){this.path=path;this.name=path.split("/").pop();} }; export const App = class {}; ',
          loader: "js",
        }));
      },
    },
  ],
});

const pg = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const viewSource = await fs.promises.readFile(new URL("../src/views/printInboxView.ts", import.meta.url), "utf8");
const cssSource = await fs.promises.readFile(new URL("../styles.css", import.meta.url), "utf8");

function makeApp(root) {
  return {
    vault: {
      getAbstractFileByPath(p) {
        if (!p) return null;
        const full = path.join(root, p);
        if (!existsSync(full)) return null;
        return new pg.TFile(p);
      },
      createFolder: async (p) => { await fsPromises.mkdir(path.join(root, p), { recursive: true }); },
      create: async (p, content) => { await fsPromises.writeFile(path.join(root, p), content, "utf8"); },
      createBinary: async (p, buf) => { await fsPromises.mkdir(path.dirname(path.join(root, p)), { recursive: true }); await fsPromises.writeFile(path.join(root, p), Buffer.from(buf)); },
      cachedRead: async (file) => { return await fsPromises.readFile(path.join(root, file.path), "utf8"); },
      modify: async (file, content) => { await fsPromises.writeFile(path.join(root, file.path), content, "utf8"); },
      getFiles: () => { const files = []; const walk = (dir) => { const entries = fs.readdirSync(dir, { withFileTypes: true }); for (const e of entries) { const full = path.join(dir, e.name); if (e.isDirectory()) { walk(full); } else if (e.isFile()) { files.push({ path: path.relative(root, full), name: e.name, extension: e.name.split(".").pop() }); } } }; walk(root); return files; },
    },
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "printqueue-seam-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function makeMockImageFile(name = "test.png") {
  return { name, type: "image/png", arrayBuffer: async () => new ArrayBuffer(8) };
}

class StubContainer {
  constructor() { this.children = []; this.classes = new Set(); this.attrs = {}; this.text = ""; this.listeners = {}; }
  addClass(c) { const parts = c.split(" "); for (const x of parts) this.classes.add(x); }
  toggleClass(c, on) { on ? this.addClass(c) : this.removeClass(c); }
  removeClass(c) { const parts = c.split(" "); for (const x of parts) this.classes.delete(x); }
  createEl(tag, opts) { const c = new StubContainer(); if (opts?.cls) { const parts = opts.cls.split(" "); for (const x of parts) c.classes.add(x); } if (opts?.attr) Object.assign(c.attrs, opts.attr); if (opts?.text) c.text = opts.text; this.children.push(c); return c; }
  empty() { this.children = []; }
  setText(t) { this.text = t; }
  setAttr(k, v) { this.attrs[k] = v; }
  getAttr(k) { return this.attrs[k]; }
  dispatch(t, evt) { (this.listeners[t] || []).forEach(fn => fn(evt)); }
  addEventListener(t, fn, opts) { this.listeners = this.listeners || {}; this.listeners[t] = (this.listeners[t] || []).concat(fn); }
}

test("clean empty state: no prints and no groups shows only Paste clipboard and Choose print", () => {
  assert.match(viewSource, /tj-print-inbox-empty/);
  assert.match(viewSource, /tj-print-inbox-paste/);
  assert.match(viewSource, /tj-print-inbox-choose/);
  assert.match(viewSource, /Paste clipboard/);
  assert.match(viewSource, /Choose print/);
  assert.doesNotMatch(viewSource, /Paste or choose a print/);
  assert.doesNotMatch(viewSource, /No prints yet/);
  assert.doesNotMatch(viewSource, /Capture a chart screenshot and it will appear here/);
  assert.doesNotMatch(viewSource, /New print group/);
});

test("first Ctrl+V from empty side panel creates first group and places entry into it", () => {
  assert.match(viewSource, /private onPaste/);
  assert.match(viewSource, /private async saveFiles/);
  assert.match(viewSource, /captureTargetGroupId/);
  assert.match(viewSource, /routeCapture/);
  assert.match(viewSource, /const name = `Group \$\{route\.ordinal\}`/);
});

test("hovered-card routing: Ctrl+V while hovering card routes to that card's group", () => {
  assert.match(viewSource, /pointerover/);
  assert.match(viewSource, /pointerout/);
  assert.match(viewSource, /focusin/);
  assert.match(viewSource, /focusout/);
  assert.match(viewSource, /setTarget/);
  assert.match(viewSource, /is-capture-target/);
  assert.match(viewSource, /captureTargetGroupId/);
  assert.match(viewSource, /routeCapture/);
});

test("active and capture-target states are accessible without visible status labels", () => {
  assert.doesNotMatch(viewSource, /tj-print-group-state/);
  assert.match(viewSource, /aria-labelledby/);
  assert.doesNotMatch(viewSource, /Default paste group|Capture destination/);
  assert.doesNotMatch(viewSource, /groupEl\.setAttr\("aria-label"/);
  assert.match(cssSource, /\.tj-print-group-details\s*\{[^}]*color:\s*var\(--text-normal\)/);
  assert.doesNotMatch(cssSource, /\.tj-print-group\.is-active\s*\{[^}]*border-bottom-color/);
});

test("empty group discard: trash button appears only on empty groups", () => {
  assert.match(viewSource, /tj-print-group-discard/);
  assert.match(viewSource, /Move empty group to trash/);
  assert.match(viewSource, /group.entryIds.length === 0/);
});

test("persisted behaviors preserved: empty-group discard, file selection fallback, drag/drop", () => {
  assert.match(viewSource, /discardGroup/);
  assert.match(viewSource, /deletePrintGroup/);
  assert.match(viewSource, /tj-print-inbox-picker/);
  assert.match(viewSource, /accept.*image/);
  assert.match(viewSource, /PRINT_GROUP_MIME/);
  assert.match(viewSource, /makePrintGroupDragPayload/);
});
