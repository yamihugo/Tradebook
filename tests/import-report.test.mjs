import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: [new URL("../src/lib/importReport.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const report = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const base = {
  detected: 10,
  importable: 8,
  assigned: 8,
  written: 8,
  copyLegs: 0,
  duplicates: 2,
  unfilled: 0,
  unpaired: 0,
  unreadable: 0,
  unpinned: 0,
};

test("importSummary reports selected as the assigned subset, never unassigned", () => {
  const receipt = report.importSummary({ ...base, assigned: 5 });
  assert.equal(receipt.selected, 5);
  assert.equal(receipt.unassigned, 3);
  assert.ok(receipt.skipped.some((line) => line.includes("3 without an account")));
  // The unassigned are not accused of anything else and never counted as written.
  assert.equal(receipt.written, 8);
});

test("importSummary lists every reason a file was left out, and none when clean", () => {
  const clean = report.importSummary({ ...base, duplicates: 0 });
  assert.deepEqual(clean.skipped, []);
  const messy = report.importSummary({
    ...base,
    duplicates: 1,
    importable: 6,
    assigned: 4,
    unfilled: 2,
    unpaired: 1,
    unreadable: 3,
    unpinned: 4,
  });
  assert.deepEqual(messy.skipped, [
    "1 already in the journal",
    "2 without an account",
    "2 order(s) never filled",
    "1 fill(s) not paired",
    "3 row(s) unreadable",
    "4 timestamp(s) not pinned",
  ]);
});

test("writeOutcome never calls a partial write 'nothing'", () => {
  assert.equal(report.writeOutcome(0, 0), "complete");
  assert.equal(report.writeOutcome(5, 0), "complete");
  assert.equal(report.writeOutcome(0, 3), "none");
  assert.equal(report.writeOutcome(5, 3), "partial");
});
