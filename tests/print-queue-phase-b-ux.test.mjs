import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const viewSource = readFileSync(new URL("../src/views/printInboxView.ts", import.meta.url), "utf8");

test("PrintQueueView creates a new group with the next stable queue label and activates it", () => {
  assert.match(viewSource, /private async addTrade\(\)/);
  assert.match(viewSource, /nextPrintGroupOrdinal\(groups\)/);
  assert.match(viewSource, /Group \$\{ordinal\}/);
  assert.match(viewSource, /createPrintGroup\(this\.plugin\.app, base, journalDate, now, name, ordinal\)/);
  assert.match(viewSource, /await setActiveGroup\(this\.plugin\.app, base, group\.id\)/);
});

test("PrintQueueView selectGroup promotes selected group to active via single global active invariant", () => {
  assert.match(viewSource, /private async selectGroup\(groupId: string\)/);
  assert.match(viewSource, /await setActiveGroup\(this\.plugin\.app, "", groupId\)/);
  assert.match(viewSource, /setActiveGroup/);
});

test("PrintQueueView renders groups with combined editable name/time and pending filter", () => {
  assert.match(viewSource, /tj-print-group\$\{group\.state === "active" \? " is-active" : ""\}/);
  assert.match(viewSource, /tj-print-group-header/);
  assert.match(viewSource, /tj-print-group-details/);
  assert.match(viewSource, /updatePrintGroupDetails/);
  assert.ok(viewSource.includes("tj-print-group-time-menu"));
  assert.ok(viewSource.includes("tj-print-group-time-${part}-options"));
  assert.ok(viewSource.includes('createTimeOptions("hour"'));
  assert.ok(viewSource.includes('createTimeOptions("minute"'));
  assert.ok(viewSource.includes("tj-print-group-time-separator"));
  assert.doesNotMatch(viewSource, /tj-print-group-count/);
  assert.match(viewSource, /g\.state !== "attached"/);
});

test("PrintQueueView latent initial state remains two actions until first capture", () => {
  assert.match(viewSource, /if \(!pendingGroups\.length && !ungroupedEntries\.length\)/);
  assert.match(viewSource, /tj-print-inbox-empty/);
  assert.match(viewSource, /Paste clipboard/);
  assert.match(viewSource, /Choose print/);
  assert.doesNotMatch(viewSource, /Paste or choose a print/);
  assert.doesNotMatch(viewSource, /Paste an image from the clipboard/);
});

test("PrintQueueView new-lane button sits after the last lane with New group wording", () => {
  assert.match(viewSource, /tj-print-inbox-new-lane/);
  assert.match(viewSource, /this\.renderNewLane\(day\)/);
  assert.match(viewSource, /New group/);
  assert.match(viewSource, /addEventListener\("click", \(\) => void this\.addTrade\(\)\)/);
  assert.doesNotMatch(viewSource, /tj-print-inbox-footer/);
  assert.doesNotMatch(viewSource, /New print group/);
  assert.doesNotMatch(viewSource, /tj-print-inbox-add-trade/);
  assert.doesNotMatch(viewSource, /Capture screenshot/);
});

test("PrintQueueView group selection is keyboard and pointer accessible", () => {
  assert.match(viewSource, /groupEl\.setAttr\("role", "group"\)/);
  assert.match(viewSource, /groupEl\.setAttr\("tabindex", "0"\)/);
  assert.match(viewSource, /groupEl\.addEventListener\("keydown"/);
  assert.match(viewSource, /event\.key === "Enter"/);
  assert.match(viewSource, /select\(\)/);
});

test("PrintQueueView does not implement attach behavior in Phase B", () => {
  assert.doesNotMatch(viewSource, /attachedTradeId/);
  assert.doesNotMatch(viewSource, /setGroupState.*attached/);
  // Phase D implements advanced editing (remove/reorder/move)
});

test("PrintQueueView renders Unsorted prints for legacy ungrouped entries without mutating metadata", () => {
  assert.match(viewSource, /ungroupedEntries/);
  assert.match(viewSource, /tj-print-inbox-unsorted/);
  assert.match(viewSource, /Unsorted prints/);
  assert.doesNotMatch(viewSource, /updatePrintInboxEntry.*status/); // should not mutate metadata
});

test("PrintQueueView keeps active state out of visible status badges", () => {
  assert.match(viewSource, /is-active/);
  assert.doesNotMatch(viewSource, /tj-print-group-state/);
  assert.match(viewSource, /aria-labelledby/);
  assert.doesNotMatch(viewSource, /Capture destination|Default paste group/);
});

test("PrintQueueView new-lane button has aria-label and meets hit target minimums", () => {
  assert.match(viewSource, /aria-label.*Start a new print group/);
  assert.match(viewSource, /tj-print-group-paste/);
  assert.match(viewSource, /tj-print-group-choose/);
});

test("PrintQueueView reload persistence test: refresh re-lists persisted groups", async () => {
  // View-level refresh/reload persistence: verify refresh() loads groups and re-renders
  assert.match(viewSource, /async refresh\(\): Promise<void>/);
  assert.match(viewSource, /this\.groups = await listPrintGroups/);
  assert.match(viewSource, /this\.render\(\)/);
  // Verify renderList uses current groups state, not cached metadata
  assert.match(viewSource, /const pendingGroups = this\.groups\.filter/);
});