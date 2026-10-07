import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const persistentQueueView = await readFile(new URL("../src/views/printInboxView.ts", import.meta.url), "utf8");
const queueModule = await readFile(new URL("../src/views/printQueueView.ts", import.meta.url), "utf8");

test("the Tradebook menu remains registered in the left sidebar", () => {
  assert.ok(main.includes('import { TradebookSidebarView, TRADEBOOK_SIDEBAR_VIEW_TYPE } from "./views/sidebarView"'));
  assert.match(main, /registerView\(TRADEBOOK_SIDEBAR_VIEW_TYPE,\s*\(leaf\) => new TradebookSidebarView/);
  assert.match(main, /const leftLeaf = this\.app\.workspace\.getLeftLeaf\?\.\(true\);/);
});

test("the persistent Print Queue owns the existing right-sidebar view id", () => {
  assert.ok(main.includes('import { PrintQueueView, PRINT_QUEUE_VIEW_TYPE } from "./views/printQueueView"'));
  assert.match(main, /registerView\(PRINT_QUEUE_VIEW_TYPE,\s*\(leaf\) => new PrintQueueView/);
  assert.match(persistentQueueView, /export const PRINT_QUEUE_VIEW_TYPE = "tradebook-print-queue"/);
  assert.match(persistentQueueView, /export class PrintQueueView extends ItemView/);
  assert.match(persistentQueueView, /getViewType\(\): string \{ return PRINT_QUEUE_VIEW_TYPE; \}/);
  assert.match(persistentQueueView, /getDisplayText\(\): string \{ return "Print queue"; \}/);
  assert.match(queueModule, /export \{ PrintQueueView, PRINT_QUEUE_VIEW_TYPE \} from "\.\/printInboxView"/);
});

test("Print Queue is opened only in Obsidian's right sidebar", () => {
  assert.doesNotMatch(main, /PRINT_INBOX_VIEW_TYPE|ensurePrintInboxLeaf|open-print-inbox/);
  assert.match(main, /await this\.ensureSidebarLeaf\(\);\s*await this\.ensurePrintQueueLeaf\(\);/);
  assert.match(main, /await this\.ensurePrintQueueLeaf\(\);/);
  assert.match(main, /const rightLeaf = this\.app\.workspace\.getRightLeaf\?\.\(true\);/);
  assert.doesNotMatch(main, /PRINT_QUEUE_VIEW_TYPE[\s\S]{0,500}getLeftLeaf/);
});
