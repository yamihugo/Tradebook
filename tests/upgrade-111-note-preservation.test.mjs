/**
 * Note, image-byte and link preservation across the published 1.1.1 → candidate
 * upgrade, and across save → edit → restart.
 *
 * The vault is written by the *published 1.1.1 product code* (its own
 * `saveTrade`), not by hand, so the fixture is a real 1.1.1 artefact rather than
 * a guess at the format. The 1.1.1 source is read out of this checkout's own git
 * object store at the pinned release commit into a temp directory; the
 * repository is never modified. If that commit is unavailable the test fails
 * loudly rather than skipping, because an upgrade cannot be validated without
 * the version it upgrades from.
 *
 * Everything asserted here is real vault state: the note text as persisted, the
 * exact bytes of a real PNG, the paths, and the screenshot links. Nothing is
 * compared against an in-memory object the product handed back, so a serializer
 * that dropped a field or clobbered an unknown key would fail.
 */
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import path from "node:path";
import os from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLISHED = { version: "1.1.1", commit: "858e60e03672deedce90affb0a91d144041114a6" };
const CANDIDATE_VERSION = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;
const EXTRACT = ["manifest.json", "versions.json", "package.json"];

/** The host's `obsidian` module: every name the bundled modules import must exist. */
const HOST = `
  export class App {} export class Plugin {} export class PluginManifest {} export class ItemView {}
  export class Modal {} export class PluginSettingTab {} export class Setting {} export class Menu {}
  export class SuggestModal {} export class FuzzySuggestModal {} export class Component {} export class MarkdownRenderChild {}
  export class Vault {} export class WorkspaceLeaf {} export class MarkdownView {} export class TAbstractFile {}
  export class TFile { constructor(p){this.path=p;} get name(){return this.path.split('/').pop();} get extension(){return this.name.split('.').pop();} get parent(){return {path:this.path.slice(0,this.path.lastIndexOf('/'))};} }
  export class TFolder {} export class Notice {}
  export const normalizePath=p=>String(p).replace(/\\\\/g,'/').replace(/\\/+/g,'/');
  export const setIcon=()=>{}; export const addIcon=()=>{}; export const debounce=fn=>fn; export const apiVersion='synthetic';
  export const moment=()=>{}; export const MarkdownRenderer={}; export const Platform={isDesktop:true,isMobile:false};
  export const requestUrl=()=>{throw new Error('Network forbidden');};
`;
const hostPlugin = () => ({
  name: "isolated-obsidian-host",
  setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    b.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: HOST }));
  },
});

const STORAGE_ENTRY = `export {
  tradeToMarkdown, parseTradeFromMarkdown, saveTrade, updateTradeFields, appendTradeScreenshots,
  updateTradeScreenshots, tradeMonthPath, tradeFilename, updateTradeExecutions, updateManualTradeExecutions
} from './src/storage';
export { TFile } from 'obsidian';`;
/** The candidate bundled together with the plugin class, for the rename path. */
const UI_ENTRY = `${STORAGE_ENTRY}\nexport { default as Product } from './src/main';`;

const textCache = new Map();
async function bundleText(resolveDir, entry = STORAGE_ENTRY) {
  const key = `${resolveDir}\u0000${entry}`;
  if (textCache.has(key)) return textCache.get(key);
  const built = await build({
    stdin: { contents: entry, resolveDir, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser",
    loader: { ".png": "dataurl", ".svg": "dataurl" },
    plugins: [hostPlugin()],
  });
  const text = built.outputFiles[0].text;
  textCache.set(key, text);
  return text;
}
/** Each call re-imports, so a "restart" is a genuinely fresh module instance. */
const loadProduct = (text) => import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);

let cachedPublishedDir = null;
function publishedSourceDir() {
  if (cachedPublishedDir) return cachedPublishedDir;
  let listing;
  try {
    listing = execFileSync("git", ["-C", ROOT, "ls-tree", "-r", "--name-only", PUBLISHED.commit], { encoding: "utf8" });
  } catch (err) {
    throw new Error(
      `the published ${PUBLISHED.version} source (${PUBLISHED.commit}) is not available in this checkout, so the ` +
        `upgrade path cannot be validated: ${err.message}`,
    );
  }
  const dir = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "tb111-src-"));
  for (const rel of listing.split("\n")) {
    if (!rel) continue;
    if (!rel.startsWith("src/") && !EXTRACT.includes(rel)) continue;
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, execFileSync("git", ["-C", ROOT, "show", `${PUBLISHED.commit}:${rel}`]));
  }
  cachedPublishedDir = dir;
  return dir;
}
after(() => {
  if (cachedPublishedDir) rmSync(cachedPublishedDir, { recursive: true, force: true });
  cachedPublishedDir = null;
});

/* ---------- a real PNG, so "image bytes preserved" means something ---------- */
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function png(seed) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const w = 2;
  const h = 2;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = seed & 0xff;
      raw[o + 1] = (seed * 7) & 0xff;
      raw[o + 2] = (seed * 13) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

/* ---------- the synthetic vault, modelled on persisted text ---------- */
function makeVault(api) {
  const files = new Map();
  const addText = (p, text) => { const f = new api.TFile(p); f.text = text; files.set(p, f); return f; };
  const addImage = (p, bytes) => { const f = new api.TFile(p); f.bytes = bytes; files.set(p, f); return f; };
  const app = {
    vault: {
      getFiles: () => [...files.values()],
      getAbstractFileByPath: (p) => files.get(p) ?? null,
      createFolder: async (p) => { files.set(p, { path: p, folder: true }); },
      create: async (p, content) => addText(p, content),
      read: async (f) => f.text,
      cachedRead: async (f) => f.text,
      process: async (f, fn) => { f.text = fn(f.text); return f.text; },
      modify: async (f, text) => { f.text = text; },
      rename: async (f, to) => { files.delete(f.path); f.path = to; files.set(to, f); },
      adapter: { exists: async (p) => files.has(p) },
    },
    fileManager: { renameFile: async (f, to) => { files.delete(f.path); f.path = to; files.set(to, f); } },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFirstLinkpathDest: () => null },
  };
  return {
    app, files, addText, addImage,
    text: (p) => files.get(p)?.text,
    digest: (p) => sha(files.get(p).bytes),
  };
}

const FIRST = "Attachments/synthetic print.png";
const SECOND = "Attachments/synthetic print 2.png";
const TRADE = {
  id: "Trades/2026/11/synthetic.md",
  type: "trade", origin: "manual", dataSource: "manual",
  date: "2026-11-06", exitDate: "2026-11-06",
  entryTime: "09:30:00", exitTime: "09:41:00",
  symbol: "MES", account: "Synthetic Demo", accountType: "demo", direction: "long",
  quantity: 2, entryPrice: 5000, exitPrice: 5002, pnl: 20, pnlPoints: 2,
  commission: 0, fees: 0, setup: "Breakout",
  mistake: "", thesis: "Synthetic thesis survives the upgrade.",
  review: "", rating: 0,
  screenshot: FIRST,
  screenshots: [
    { file: FIRST, note: "Synthetic first caption" },
    { file: SECOND, note: "Synthetic second caption" },
  ],
};
/** Extra frontmatter the trader added by hand. It must survive every write. */
const USER_KEY = 'user_notes: "Do not lose this line"';

function seedVault(api, vault) {
  vault.addImage(FIRST, png(0x22));
  vault.addImage(SECOND, png(0x77));
  return `${api.tradeMonthPath("Trades", TRADE.date)}/${api.tradeFilename(TRADE)}.md`;
}
const withUserKey = (text) => text.replace(/\n---\n/, `\n${USER_KEY}\n---\n`);
const bodyOf = (text) => text.slice(text.indexOf("\n---\n", 4) + "\n---\n".length);

/* =========================== the gate itself =========================== */

test("published 1.1.1 notes, links and image bytes survive the candidate's read, edit and restart", async () => {
  assert.notEqual(
    CANDIDATE_VERSION,
    PUBLISHED.version,
    `the candidate must be newer than ${PUBLISHED.version} for this to be an upgrade test`,
  );
  const newText = await bundleText(ROOT);
  const oldApi = await loadProduct(await bundleText(publishedSourceDir()));
  const newApi = await loadProduct(newText);

  // 1. A real 1.1.1 vault: the published product writes the trade, then the trader
  //    hand-adds a key of their own.
  const vault = makeVault(oldApi);
  const notePath = seedVault(oldApi, vault);
  assert.equal(await oldApi.saveTrade(vault.app, "Trades", TRADE, "YYYY-MM-DD"), true);
  const digests = { [FIRST]: vault.digest(FIRST), [SECOND]: vault.digest(SECOND) };
  vault.addText(notePath, withUserKey(vault.text(notePath)));
  const body = bodyOf(vault.text(notePath));
  assert.match(vault.text(notePath), /user_notes: "Do not lose this line"/);

  // 2. The candidate reads it.
  const parsed = newApi.parseTradeFromMarkdown(vault.text(notePath));
  assert.equal(parsed.symbol, TRADE.symbol);
  assert.equal(parsed.date, TRADE.date);
  assert.equal(parsed.direction, TRADE.direction);
  assert.equal(parsed.quantity, TRADE.quantity);
  assert.equal(parsed.entryPrice, TRADE.entryPrice);
  assert.equal(parsed.exitPrice, TRADE.exitPrice);
  assert.equal(parsed.pnl, TRADE.pnl);
  assert.equal(parsed.thesis, TRADE.thesis);
  assert.deepEqual(parsed.screenshots, TRADE.screenshots, "structured screenshot links survive the upgrade");

  // 3. The candidate edits a review field, the way the Trade Detail view does.
  await newApi.updateTradeFields(vault.app, vault.files.get(notePath), {
    rating: 4,
    review_what_happened: "Synthetic reflection",
  });
  const afterEdit = vault.text(notePath);
  assert.match(afterEdit, /user_notes: "Do not lose this line"/, "a trader's own key is never dropped");
  assert.ok(afterEdit.includes(body), "the note body is unchanged by a frontmatter edit");
  assert.equal(vault.digest(FIRST), digests[FIRST], "first image bytes unchanged");
  assert.equal(vault.digest(SECOND), digests[SECOND], "second image bytes unchanged");
  assert.ok(vault.files.has(notePath), "the note keeps its path");
  const edited = newApi.parseTradeFromMarkdown(afterEdit);
  assert.deepEqual(edited.screenshots, TRADE.screenshots, "screenshot links survive the edit");
  assert.equal(edited.rating, 4);
  assert.equal(edited.review_what_happened, "Synthetic reflection");
  assert.equal(edited.symbol, TRADE.symbol, "no unrelated field was lost to the edit");
  assert.equal(edited.thesis, TRADE.thesis);

  // 4. A third print through the product's own append path.
  const third = "Attachments/synthetic print 3.png";
  vault.addImage(third, png(0x9a));
  await newApi.appendTradeScreenshots(vault.app, vault.files.get(notePath), [{ file: third, note: "Third caption" }]);
  const appended = newApi.parseTradeFromMarkdown(vault.text(notePath));
  assert.deepEqual(appended.screenshots, [...TRADE.screenshots, { file: third, note: "Third caption" }]);
  assert.equal(vault.digest(FIRST), digests[FIRST]);
  assert.equal(vault.digest(SECOND), digests[SECOND]);
  assert.match(vault.text(notePath), /user_notes: "Do not lose this line"/);
  assert.ok(vault.text(notePath).includes(body), "the body is still untouched after appending a print");

  // 5. Restart: a fresh module instance re-reads the vault from text alone.
  const restarted = await loadProduct(newText);
  const reread = restarted.parseTradeFromMarkdown(vault.text(notePath));
  assert.equal(reread.rating, 4);
  assert.equal(reread.review_what_happened, "Synthetic reflection");
  assert.deepEqual(reread.screenshots, appended.screenshots);
  assert.equal(reread.symbol, TRADE.symbol);
  assert.equal(reread.quantity, TRADE.quantity);
});

test("correcting execution details leaves the notes, other fields, image bytes and links intact", async () => {
  const newText = await bundleText(ROOT);
  const api = await loadProduct(newText);
  const vault = makeVault(api);
  const notePath = seedVault(api, vault);
  assert.equal(await api.saveTrade(vault.app, "Trades", TRADE, "YYYY-MM-DD"), true);
  vault.addText(notePath, withUserKey(vault.text(notePath)));
  const digests = { [FIRST]: vault.digest(FIRST), [SECOND]: vault.digest(SECOND) };
  const before = api.parseTradeFromMarkdown(vault.text(notePath));

  const corrected = await api.updateTradeExecutions(
    vault.app,
    vault.files.get(notePath),
    before,
    [
      { side: "buy", date: TRADE.date, time: "09:30:00", qty: 2, price: 4999.75 },
      { side: "sell", date: TRADE.date, time: "09:41:00", qty: 2, price: 5002.5 },
    ],
    "",
  );
  assert.ok(corrected);

  const text = vault.text(notePath);
  const after = api.parseTradeFromMarkdown(text);
  // The correction must actually have landed, or every other assertion below
  // would also hold for a writer that silently did nothing.
  assert.equal(after.entryPrice, 4999.75, "the corrected entry price is persisted, not merely returned");
  assert.equal(after.exitPrice, 5002.5, "the corrected exit price is persisted");
  const correctionBlock = /execution_correction:[ \t]*(.*)$/m.exec(text)?.[1] ?? "";
  assert.ok(correctionBlock.length > 0, "the correction is recorded in the note");
  assert.ok(correctionBlock.includes("5000"), "the replaced entry price is kept as the original record");
  assert.ok(correctionBlock.includes("5002"), "the replaced exit price is kept as the original record");
  assert.match(text, /user_notes: "Do not lose this line"/, "an execution correction keeps unknown frontmatter");
  assert.deepEqual(after.screenshots, TRADE.screenshots, "screenshot links survive an execution correction");
  assert.equal(after.thesis, TRADE.thesis, "the written-up thesis survives");
  assert.equal(after.setup, TRADE.setup);
  assert.equal(after.account, TRADE.account);
  assert.equal(after.symbol, TRADE.symbol);
  assert.equal(after.date, TRADE.date);
  assert.equal(after.quantity, 2);
  for (const [p, d] of Object.entries(digests)) assert.equal(vault.digest(p), d, `${p} bytes unchanged`);
  assert.ok(vault.files.has(notePath));

  const restarted = await loadProduct(newText);
  const reread = restarted.parseTradeFromMarkdown(vault.text(notePath));
  assert.equal(reread.symbol, after.symbol);
  assert.equal(reread.quantity, after.quantity);
  assert.equal(reread.thesis, TRADE.thesis);
  assert.deepEqual(reread.screenshots, TRADE.screenshots);
});

test("the upgrade crosses a real 1.1.1 -> candidate version boundary", async () => {
  const oldDir = publishedSourceDir();
  const oldManifest = JSON.parse(readFileSync(path.join(oldDir, "manifest.json"), "utf8"));
  const oldVersions = JSON.parse(readFileSync(path.join(oldDir, "versions.json"), "utf8"));
  const newManifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const newVersions = JSON.parse(readFileSync(path.join(ROOT, "versions.json"), "utf8"));

  assert.equal(oldManifest.version, PUBLISHED.version, "the pinned source really is the published 1.1.1");
  assert.equal(newManifest.version, CANDIDATE_VERSION);
  assert.notEqual(newManifest.version, oldManifest.version, "this is an upgrade, not a same-version reload");
  assert.equal(newVersions[PUBLISHED.version], oldVersions[PUBLISHED.version], "1.1.1's minimum app version is unchanged");
  assert.ok(newVersions[CANDIDATE_VERSION], "the candidate's own version is registered for updaters");

  // And the note a 1.1.1 vault actually contains still parses under the candidate.
  const oldApi = await loadProduct(await bundleText(oldDir));
  const newApi = await loadProduct(await bundleText(ROOT));
  const vault = makeVault(oldApi);
  const notePath = seedVault(oldApi, vault);
  await oldApi.saveTrade(vault.app, "Trades", TRADE, "YYYY-MM-DD");
  const written = vault.text(notePath);
  const a = oldApi.parseTradeFromMarkdown(written);
  const b = newApi.parseTradeFromMarkdown(written);
  for (const key of ["date", "symbol", "direction", "quantity", "entryPrice", "exitPrice", "pnl", "pnlPoints", "account", "setup", "thesis", "screenshot"]) {
    assert.deepEqual(b[key], a[key], `the candidate reads ${key} exactly as 1.1.1 wrote it`);
  }
  assert.deepEqual(b.screenshots, a.screenshots);
});

/* ---------------- rename, on the upgraded note ---------------- */

/** The note-with-`data`-and-`body` model the repo's published rename test uses. */
function objectVault(api) {
  const files = new Map();
  const read = (file) => {
    const data = file.data ?? {};
    const rows = [
      `date: ${TRADE.date}`,
      `symbol: ${file.data?.symbol ?? TRADE.symbol}`,
      `direction: ${file.data?.direction ?? TRADE.direction}`,
      `entry_time: ${JSON.stringify(TRADE.entryTime)}`,
    ];
    if (data.screenshot !== undefined) rows.push(`screenshot: ${JSON.stringify(data.screenshot)}`);
    if (data.screenshots?.length) {
      rows.push("screenshots:");
      for (const s of data.screenshots) {
        rows.push(`  - file: ${JSON.stringify(s.file)}`, `    note: ${JSON.stringify(s.note ?? "")}`);
      }
    }
    for (const [k, v] of Object.entries(data)) {
      if (k !== "screenshot" && k !== "screenshots" && k !== "symbol" && k !== "direction") rows.push(`${k}: ${JSON.stringify(v)}`);
    }
    return `---\n${rows.join("\n")}\n---\n${file.body}`;
  };
  const move = async (file, to) => {
    assert.ok(!files.has(to), `a rename must never overwrite ${to}`);
    files.delete(file.path);
    file.path = to;
    files.set(to, file);
  };
  const app = {
    vault: {
      getFiles: () => [...files.values()],
      getAbstractFileByPath: (p) => files.get(p) ?? null,
      createFolder: async () => {},
      cachedRead: async (f) => read(f),
      read: async (f) => read(f),
      rename: move,
      modify: async (f, text) => { f.body = text.slice(text.indexOf("\n---\n", 4) + "\n---\n".length); },
      adapter: { exists: async (p) => files.has(p) },
    },
    fileManager: { renameFile: move, processFrontMatter: async (f, change) => { change(f.data); } },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFirstLinkpathDest: () => null },
  };
  return { app, files, read };
}

test("an upgraded note renames with its whole print family, and a collision or a shared link leaves it whole", async () => {
  const oldApi = await loadProduct(await bundleText(publishedSourceDir()));
  const api = await loadProduct(await bundleText(ROOT, UI_ENTRY));
  const printsDir = "Attachments";
  const base = api.tradeFilename(TRADE, "YYYY-MM-DD");
  const newBase = api.tradeFilename(TRADE, "DD/MM/YYYY");
  assert.notEqual(newBase, base, "the fixture must actually need renaming");
  const firstPrint = `${printsDir}/${base} print.png`;
  const secondPrint = `${printsDir}/${base} print 2.png`;
  const trade = {
    ...TRADE,
    screenshot: `${base} print.png`,
    screenshots: [
      { file: `${base} print.png`, note: "Synthetic first caption" },
      { file: secondPrint, note: "Synthetic second caption" },
    ],
  };
  const notePath = `${api.tradeMonthPath("Trades", TRADE.date)}/${base}.md`;

  // The links seeded below are the ones the published 1.1.1 product really wrote.
  const probe = makeVault(oldApi);
  probe.addImage(firstPrint, png(0x31));
  probe.addImage(secondPrint, png(0x84));
  assert.equal(await oldApi.saveTrade(probe.app, "Trades", trade, "YYYY-MM-DD"), true);
  assert.deepEqual(oldApi.parseTradeFromMarkdown(probe.text(notePath)).screenshots, trade.screenshots);

  const build = () => {
    const vault = objectVault(api);
    const note = new api.TFile(notePath);
    note.data = {
      symbol: TRADE.symbol,
      direction: TRADE.direction,
      screenshot: trade.screenshot,
      screenshots: trade.screenshots.map((s) => ({ ...s })),
      user_notes: "Do not lose this line",
    };
    note.body = "\nSynthetic body remains unchanged.\n";
    vault.files.set(notePath, note);
    const digests = {};
    for (const [p, seed] of [[firstPrint, 0x31], [secondPrint, 0x84]]) {
      const f = new api.TFile(p);
      f.bytes = png(seed);
      digests[p] = sha(f.bytes);
      vault.files.set(p, f);
    }
    const product = Object.create(api.Product.prototype);
    product.app = vault.app;
    product.settings = { tradesFolder: "Trades", dateFormat: "DD/MM/YYYY" };
    product.getTradesFolder = () => "Trades";
    product.getAttachmentsFolder = () => printsDir;
    product.clearTradeCache = () => {};
    product.reloadAllViews = async () => {};
    return { vault, product, note, digests };
  };

  // (a) a clean rename moves the note and every print, and touches nothing else.
  {
    const { vault, product, note, digests } = build();
    const plan = await product.planFileRename();
    const item = plan.items.find((i) => i.from === notePath);
    assert.ok(item, "the upgraded note is planned for rename");
    const result = await product.applyFileRename(plan);
    assert.equal(result.renamed, 1);
    assert.equal(result.prints, 2);
    assert.ok(vault.files.has(item.to), "the note is at its new path");
    assert.equal(note.body, "\nSynthetic body remains unchanged.\n", "a rename leaves the note body untouched");
    assert.equal(note.data.user_notes, "Do not lose this line", "a rename leaves the trader's own key untouched");
    assert.equal(note.data.screenshot, `${newBase} print.png`, "the legacy scalar link follows the print");
    assert.deepEqual(
      note.data.screenshots.map((s) => s.file),
      [`${newBase} print.png`, `${printsDir}/${newBase} print 2.png`],
      "every structured link follows its print",
    );
    for (const p of [firstPrint, secondPrint]) assert.equal(vault.files.has(p), false, `${p} is no longer at the old name`);
    for (const [p, d] of Object.entries(digests)) {
      const moved = p.replace(base, newBase);
      assert.ok(vault.files.has(moved), `${moved} exists after the rename`);
      assert.equal(sha(vault.files.get(moved).bytes), d, "the moved print's bytes are unchanged");
    }
    assert.equal(note.data.screenshots[0].note, "Synthetic first caption", "a print caption survives the rename");
  }

  // (b) any colliding print destination skips the whole note and print family.
  {
    const { vault, product, note } = build();
    const occupiedPrint = `${printsDir}/${newBase} print 2.png`;
    vault.files.set(occupiedPrint, new api.TFile(occupiedPrint));
    const plan = await product.planFileRename();
    assert.equal(plan.items.some((i) => i.from === notePath), false, "a colliding print destination produces no partial plan");
    assert.ok(plan.skipped >= 1);
    const result = await product.applyFileRename(plan);
    assert.equal(result.renamed, 0);
    assert.ok(vault.files.has(notePath), "the note stays where it was");
    for (const p of [firstPrint, secondPrint]) assert.ok(vault.files.has(p), `${p} stays with its note`);
    assert.equal(note.body, "\nSynthetic body remains unchanged.\n");
    assert.deepEqual(note.data.screenshots.map((s) => s.file), trade.screenshots.map((s) => s.file));
  }

  // (b2) a note name already in use is bumped, never overwritten, and the family follows it.
  {
    const { vault, product, note, digests } = build();
    const occupied = `${api.tradeMonthPath("Trades", TRADE.date)}/${newBase}.md`;
    const squatter = new api.TFile(occupied);
    squatter.body = "\nSomebody else's note.\n";
    vault.files.set(occupied, squatter);
    const plan = await product.planFileRename();
    const item = plan.items.find((i) => i.from === notePath);
    assert.ok(item, "the note is still renamed");
    assert.equal(item.to, `${api.tradeMonthPath("Trades", TRADE.date)}/${newBase}_2.md`, "the taken name is bumped, not reused");
    const result = await product.applyFileRename(plan);
    assert.equal(result.renamed, 1);
    assert.ok(vault.files.has(occupied), "the other note is untouched");
    assert.equal(squatter.body, "\nSomebody else's note.\n", "the other note's body is untouched");
    assert.equal(note.body, "\nSynthetic body remains unchanged.\n");
    assert.equal(note.data.screenshot, `${newBase}_2 print.png`, "the scalar link follows the bumped family");
    assert.deepEqual(
      note.data.screenshots.map((s) => s.file),
      [`${newBase}_2 print.png`, `${printsDir}/${newBase}_2 print 2.png`],
    );
    for (const [p, d] of Object.entries(digests)) {
      const moved = p.replace(base, `${newBase}_2`);
      assert.ok(vault.files.has(moved), `${moved} exists after the bumped rename`);
      assert.equal(sha(vault.files.get(moved).bytes), d, "the bumped print's bytes are unchanged");
    }
  }

  // (c) a print referenced by another note keeps the source trade and family whole.
  {
    const { vault, product, note } = build();
    const otherPath = `${api.tradeMonthPath("Trades", TRADE.date)}/2026-11-06 NQ SHORT 1015.md`;
    const other = new api.TFile(otherPath);
    other.data = {
      symbol: "NQ",
      direction: "short",
      screenshot: trade.screenshot,
      screenshots: [{ file: trade.screenshot, note: "Shared print" }],
    };
    other.body = "\nAnother trade's note.\n";
    vault.files.set(otherPath, other);
    const plan = await product.planFileRename();
    assert.equal(
      plan.items.some((i) => i.from === notePath),
      false,
      "a print shared with another note must not be stolen from it",
    );
    assert.ok(plan.skipped >= 1);
    assert.ok(vault.files.has(firstPrint));
    assert.ok(vault.files.has(secondPrint));
    assert.equal(note.body, "\nSynthetic body remains unchanged.\n");
  }
});
