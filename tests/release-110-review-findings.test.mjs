import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: ['export * from "./src/storage";', 'export * from "./src/lib/review";', 'export * from "./src/lib/printGroup";', 'export * from "./src/lib/printInbox";', 'export * from "./src/lib/printGroupAttach";'].join("\n"),
    resolveDir: new URL("../", import.meta.url).pathname,
    sourcefile: "release-review-findings.ts",
  },
  bundle: true, format: "esm", platform: "node", write: false,
  plugins: [{ name: "synthetic-host", setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
    b.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: 'export class App {} export class TFolder {} export class TFile { constructor(path){this.path=path;this.name=path.split("/").pop();this.extension=this.name.split(".").pop();} } export const normalizePath=p=>p.replace(/\\\\/g,"/").replace(/\\/+/g,"/").replace(/^\\//,""); export const setIcon=()=>{}; export const moment=()=>{};' }));
  } }],
});
const api = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const complete = {
  id: "synthetic.md", account: "Synthetic", accountType: "funded", direction: "long",
  quantity: 1, entryPrice: 20000, exitPrice: 20010, pnl: 200, pnlPoints: 10,
  entryTime: "10:00:00", exitTime: "10:01:00", commission: 0, fees: 0,
  mistake: "", review: "", thesis: "", screenshot: "",
  date: "2026-11-05", symbol: "NQ", setup: "A", setups: ["A", "B"], rating: 3,
  psychologyAcknowledged: true, mistakesAcknowledged: true,
  review_what_happened: "Observed execution", review_repeat_change: "Repeat preparation",
};
function memoryApp() {
  const files = new Map();
  const app = { vault: {
    getAbstractFileByPath: path => files.has(path) ? new api.TFile(path) : null,
    getFiles: () => [...files.keys()].map(path => new api.TFile(path)),
    createFolder: async () => {},
    create: async (path, content) => { files.set(path, content); return new api.TFile(path); },
    createBinary: async (path, content) => { files.set(path, content); return new api.TFile(path); },
    cachedRead: async file => files.get(file.path),
    read: async file => files.get(file.path),
    modify: async (file, content) => { await Promise.resolve(); files.set(file.path, content); },
    process: async (file, change) => { files.set(file.path, change(files.get(file.path))); },
  } };
  return { app, files };
}
test("strategy-library rename preserves legacy assignments including array-only names", async () => {
  const { app, files } = memoryApp();
  files.set("trade.md", api.tradeToMarkdown(complete));
  assert.equal(await api.renameTradeStrategy(app, new api.TFile("trade.md"), "A", "C"), true);
  let saved = api.parseTradeFromMarkdown(files.get("trade.md"));
  assert.equal(saved.setup, "C"); assert.deepEqual(saved.setups, ["C", "B"]);
  assert.equal(await api.renameTradeStrategy(app, new api.TFile("trade.md"), "B", "D"), true);
  saved = api.parseTradeFromMarkdown(files.get("trade.md"));
  assert.equal(saved.setup, "C"); assert.deepEqual(saved.setups, ["C", "D"]);
  assert.equal(api.reviewStatus(saved).checks.find(c => c.key === "setup").done, false);
});
test("persisted fractional and malformed ratings cannot complete automatic review", () => {
  const note = api.tradeToMarkdown({ ...complete, setups: ["A"] });
  for (const raw of ["3.5", "4oops", '"4oops"', "Infinity"]) {
    const saved = api.parseTradeFromMarkdown(note.replace(/^rating:.*$/m, `rating: ${raw}`));
    assert.equal(api.reviewStatus(saved).complete, false, raw);
  }
  assert.equal(api.reviewStatus(api.parseTradeFromMarkdown(note)).complete, true);
});
async function queuedFixture() {
  const fixture = memoryApp(); const { app, files } = fixture;
  for (const id of ["a.md", "b.md"]) files.set(id, api.tradeToMarkdown({ ...complete, setups: ["A"] }));
  const capture = await api.savePrintInboxEntry(app, "Tradebook", { name: "synthetic.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(8) }, "2026-11-05", "file");
  const group = await api.createPrintGroup(app, "", "2026-11-05", "2026-11-05T10:00:00Z", "Synthetic group", 1);
  await api.addEntryToGroup(app, "", group.id, capture.id); await api.setGroupState(app, "", group.id, "pending");
  return { ...fixture, group };
}
test("simultaneous views cannot attach one print group to two different trades", async () => {
  const { app, files, group } = await queuedFixture();
  const outcomes = await Promise.all(["a.md", "b.md"].map(id => api.attachGroupToTrade(app, { id }, id, group.id, "", "Tradebook")));
  assert.equal(outcomes.filter(result => result.ok).length, 1);
  const owners = ["a.md", "b.md"].filter(id => api.parseTradeFromMarkdown(files.get(id)).screenshots.length > 0);
  assert.equal(owners.length, 1);
  assert.equal((await api.loadPrintGroup(app, "", group.id)).attachedTradeId, owners[0]);
});
test("simultaneous same-trade retries remain idempotent", async () => {
  const { app, files, group } = await queuedFixture();
  const outcomes = await Promise.all([1, 2].map(() => api.attachGroupToTrade(app, { id: "a.md" }, "a.md", group.id, "", "Tradebook")));
  assert.equal(outcomes.every(result => result.ok), true);
  assert.equal(api.parseTradeFromMarkdown(files.get("a.md")).screenshots.length, 1);
  assert.equal(outcomes.filter(result => result.ok && result.idempotent).length, 1);
});
