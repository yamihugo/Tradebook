import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: { printInbox: new URL("../src/lib/printInbox.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
      build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
        contents: "export const normalizePath = (p) => p; export const TFile = class {};",
        loader: "js",
      }));
    },
  }],
});
const output = result.outputFiles[0];
const inbox = await import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);

test("print inbox paths stay inside the configured journal and are grouped by capture day", () => {
  assert.equal(inbox.printInboxDayFolder("Tradebook", "2026-10-05"), "Tradebook/print-inbox/2026-10-05");
  assert.equal(inbox.printInboxImagePath("Tradebook", "2026-10-05", "2026-10-05T09:42:18.000Z", "Chart shot.PNG"), "Tradebook/print-inbox/2026-10-05/09-42-18 Chart shot.png");
  assert.deepEqual(inbox.groupPrintInboxEntries([
    { id: "b", capturedAt: "2026-10-04T10:00:00.000Z", journalDate: "2026-10-04" },
    { id: "a", capturedAt: "2026-10-05T10:00:00.000Z", journalDate: "2026-10-05" },
    { id: "c", capturedAt: "2026-10-05T09:00:00.000Z", journalDate: "2026-10-05" },
  ]).map((g) => [g.date, g.entries.map((e) => e.id)]), [
    ["2026-10-05", ["a", "c"]],
    ["2026-10-04", ["b"]],
  ]);
});

test("print inbox metadata round-trips escaped notes without trade fields", () => {
  const markdown = inbox.printInboxMarkdown({
    id: "print-1",
    capturedAt: "2026-10-05T09:42:18.000Z",
    journalDate: "2026-10-05",
    imagePath: "Tradebook/print-inbox/2026-10-05/09-42-18 Chart shot.png",
    title: "Chart shot",
    note: "Wait for \"confirmation\"",
    source: "paste",
    status: "unassigned",
  });
  assert.match(markdown, /type: print/);
  assert.match(markdown, /status: unassigned/);
  assert.match(markdown, /note: 'Wait for "confirmation"'/);
  assert.doesNotMatch(markdown, /tradelog|review|pnl|trade_id/);
});

test("multiline notes round-trip without truncation", () => {
  const entry = {
    id: "print-multiline",
    capturedAt: "2026-10-05T09:42:18.000Z",
    journalDate: "2026-10-05",
    imagePath: "Tradebook/print-inbox/2026-10-05/chart.png",
    metadataPath: "Tradebook/print-inbox/2026-10-05/chart.md",
    title: "Chart",
    note: "line one\nline two: still here",
    source: "paste",
    status: "unassigned",
  };
  const parsed = inbox.parsePrintInboxMarkdown(inbox.printInboxMarkdown(entry), entry.id, entry.metadataPath);
  assert.equal(parsed?.note, entry.note);
});

test("queue entries cannot point outside their own metadata pair under the configured root", () => {
  const root = "Tradebook";
  const valid = {
    id: "valid",
    capturedAt: "2026-10-05T09:42:18.000Z",
    journalDate: "2026-10-05",
    imagePath: "Tradebook/print-inbox/2026-10-05/chart.png",
    metadataPath: "Tradebook/print-inbox/2026-10-05/chart.md",
    title: "Chart",
    source: "paste",
    status: "unassigned",
  };
  assert.equal(inbox.isSafePrintInboxEntry(root, valid), true);
  assert.equal(inbox.isSafePrintInboxEntry(root, { ...valid, imagePath: "Private/secrets.png" }), false);
  assert.equal(inbox.isSafePrintInboxEntry(root, { ...valid, imagePath: "Tradebook/print-inbox/2026-10-05" }), false);
  assert.equal(inbox.isSafePrintInboxEntry(root, { ...valid, metadataPath: "Tradebook/print-inbox/2026-10-05/other.md" }), false);
});

test("a failed metadata write rolls back the captured image", async () => {
  const deleted = [];
  const app = {
    vault: {
      getAbstractFileByPath: (path) => ({ path }),
      createBinary: async () => {},
      create: async () => { throw new Error("metadata failed"); },
      delete: async (file) => { deleted.push(file.path); },
    },
  };
  const file = { name: "chart.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(1) };
  await assert.rejects(() => inbox.savePrintInboxEntry(app, "Tradebook", file, "2026-10-05", "paste"), /metadata failed/);
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /^Tradebook\/print-inbox\/2026-10-05\/.+\.png$/);
});

test("listing works in hosts that expose getFiles without getMarkdownFiles", async () => {
  const markdown = inbox.printInboxMarkdown({
    id: "print-1",
    capturedAt: "2026-10-05T09:42:18.000Z",
    journalDate: "2026-10-05",
    imagePath: "Tradebook/print-inbox/2026-10-05/chart.png",
    title: "Chart",
    source: "paste",
    status: "unassigned",
  });
  const app = {
    vault: {
      getFiles: () => [
        { path: "Tradebook/print-inbox/2026-10-05/chart.md", extension: "md" },
        { path: "Tradebook/print-inbox/2026-10-05/chart.png", extension: "png" },
      ],
      cachedRead: async () => markdown,
    },
  };
  const entries = await inbox.listPrintInboxEntries(app, "Tradebook");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "print-1");
});

test("image extensions are limited to safe common formats", () => {
  assert.equal(inbox.imageExtension("image/jpeg", "screen.jpeg"), "jpg");
  assert.equal(inbox.imageExtension("image/webp", "screen.webp"), "webp");
  assert.equal(inbox.imageExtension("text/plain", "screen.txt"), "png");
});
