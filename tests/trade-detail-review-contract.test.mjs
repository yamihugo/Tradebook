import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { test } from "node:test";

const load = async (name, rel) => {
  const result = await build({
    entryPoints: { [name]: new URL(rel, import.meta.url).pathname },
    bundle: true,
    format: "esm",
    platform: "browser",
    outdir: "bundle",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
};

const tags = await load("tags", "../src/lib/tags.ts");
const detailSource = readFileSync(new URL("../src/views/tradeDetailView.ts", import.meta.url), "utf8");
const dropdownSource = readFileSync(new URL("../src/lib/dropdown.ts", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("mistake picker exposes the approved execution vocabulary", () => {
  const groups = tags.reviewTagGroups(undefined, "mistakes");
  assert.deepEqual(groups.map((group) => group.label), [
    "Entry timing",
    "Entry validity",
    "Management & exit",
    "Risk & size",
    "Discipline & process",
  ]);
  assert.deepEqual(groups.flatMap((group) => group.tags), [
    "Entered early",
    "Entered late",
    "Chased entry",
    "No valid setup",
    "Outside session",
    "Took profit early / Cut winner early",
    "Let loss run / Late exit",
    "Moved stop",
    "No stop",
    "No target",
    "Too large size",
    "Too small size",
    "Overtraded",
    "Revenge entry",
    "Broke plan / rules",
  ]);
  assert.ok(!groups.flatMap((group) => group.tags).includes("Added to loser"));
});

test("legacy review-option settings migrate into the approved mistake vocabulary", () => {
  const migrated = tags.reviewOptions({ reviewOptions: { mistakes: ["Early entry", "No setup", "Oversized", "Rule break", "Distracted"] } }, "mistakes");
  assert.deepEqual(migrated, ["Entered early", "No valid setup", "Too large size", "Broke plan / rules"]);
});
test("Trade Detail pairs Psychology with execution/mistake controls", () => {
  assert.match(detailSource, /tagSection\(\s*psychologyExecution,\s*"psychology_tags"/);
  assert.match(detailSource, /tagSection\(\s*psychologyExecution,\s*"mistake_tags"/);
  assert.match(detailSource, /reviewTagGroups\([^)]*"mistakes"/);
  assert.match(detailSource, /group\.label/);
  assert.match(detailSource, /setTradeMistakeTags/);
  assert.match(detailSource, /ackBtn\.disabled = false/);
  assert.match(detailSource, /ackBtn\.toggleClass\("is-selected", active\)/);
  assert.match(detailSource, /ackBtn\.setText\(ack\.text\)/);
  assert.match(detailSource, /const next = hasTags \? true : this\.trade\?\.\[ack\.field\] !== true/);
  assert.match(detailSource, /tj-td-ack" \+ \(mistake \? " is-mistake" : " is-psychology"\)/);
  assert.match(detailSource, /Clear the selected tags and record that there was nothing to record/);
  assert.match(detailSource, /summary: false/);
  assert.match(detailSource, /text: "No psychology state"/);
  assert.match(detailSource, /text: "No execution issue"/);
  assert.match(detailSource, /picker\?\.setValues\(\[\]\)/);
  assert.match(detailSource, /picker\?\.setValues\(clean\)/);
  assert.match(dropdownSource, /setValues: \(values: string\[\]\) => void/);
  assert.match(dropdownSource, /chosen = \[\.\.\.nextValues\]/);
  assert.match(styleSource, /--tj-ack-selected: var\(--color-green-bright/);
  assert.match(styleSource, /\.tj-td-ack\[aria-pressed="true"\]/);
  assert.doesNotMatch(styleSource, /\.tj-td-ack\.on\.is-mistake/);
  assert.doesNotMatch(styleSource, /\.tj-td-ack\.on\.is-psychology/);
  assert.match(styleSource, /\.tj-td-ack::before[\s\S]*content: none/);
});

test("Export selector exposes only the approved Trade Card content and orientations", () => {
  assert.match(detailSource, /const opts: ExportOptions = \{ orientation: "vertical", theme: "dark", screenshot: true, stats: true, rating: true, notes: false, repeatChange: false, exitReason: false, psychology: true, hidePnl: false, primaryPrint: 0 \}/);
  assert.match(detailSource, /cls: "tj-export-header"/);
  assert.doesNotMatch(detailSource, /One clear card · choose/);
  assert.match(detailSource, /label: "What happened\?"/);
  assert.match(detailSource, /label: "Repeat or change"/);
  assert.match(detailSource, /label: "Why did I close\?"/);
  assert.doesNotMatch(detailSource, /key: "plan", label: "Plan"/);
  assert.match(detailSource, /Hide money/);
  assert.match(detailSource, /label: "Tags"/);
  assert.match(detailSource, /text: "Vertical"/);
  assert.match(detailSource, /Height adjusts to include all text/);
  assert.match(detailSource, /text: "Horizontal"/);
  assert.doesNotMatch(detailSource, /shortened with an ellipsis/);
  assert.match(detailSource, /Choose one print\./);
  assert.doesNotMatch(detailSource, /MAX_EXPORT_PRINTS|printIndices|Make primary/);
  assert.match(detailSource, /opts\.primaryPrint = index/);
});
test("Strategy offers one choice while preserving unresolved legacy assignments", () => {
  assert.match(detailSource, /const currentSetups = strategiesOf\(t\)/);
  assert.match(detailSource, /const strategyDropdown = mountDropdown\(/);
  assert.match(detailSource, /setTradeStrategy\(this\.app, file, choice\)/);
  assert.match(detailSource, /nothing is removed until you choose/);
  assert.match(detailSource, /label: "＋ New strategy…"/);
  assert.match(detailSource, /openSetupsForCreation\(\)/);
  assert.match(styleSource, /\.tj-mg-dd-check/);
  assert.match(detailSource, /const stratField = execExtra\.createDiv/);
  assert.match(detailSource, /tj-td-process-rating/);
  assert.match(styleSource, /\.tj-td-review-workspace \.tj-td-review-more \{ display: none; \}/);
  assert.match(styleSource, /\.tj-td-review-workspace \.tj-td-process-rating\s*\{[\s\S]*?order: 3;/);
  assert.match(detailSource, /const execGrid = execCard\.createDiv/);
  assert.match(detailSource, /tj-td-exec-wide/);
  assert.match(styleSource, /\.tj-td-exec-grid \.tj-td-exec-wide \{/);
  assert.match(styleSource, /grid-column: 1 \/ -1/);
});

test("Market context stays independent from Psychology and execution mistakes", () => {
  assert.match(detailSource, /text: "Market context \/ news"/);
  assert.match(detailSource, /market_context_timing/);
  assert.match(detailSource, /market_context_effect/);
  assert.match(detailSource, /event-approaching-in-trade/);
  assert.match(detailSource, /management-changed/);
  assert.match(detailSource, /updateTradeArrayFields\(this\.app, file, \{ \[key\]: clean \}\)/);
  assert.match(styleSource, /\.tj-td-panel:has\(\.tj-td-review-prompts\) \.tj-td-market-context/);
  assert.match(styleSource, /\.tj-td-panel:has\(\.tj-td-review-prompts\) \.tj-td-review-patterns/);
  assert.match(styleSource, /\.tj-td-panel:has\(\.tj-td-review-prompts\) \.tj-td-review-exit/);
  assert.match(styleSource, /\.tj-td-review-workspace \.tj-td-market-context[\s\S]*display: none/);
});

test("Process self-rating is labelled and placed after the review work", () => {
  assert.match(detailSource, /text: "Self-rating"/);
  assert.doesNotMatch(detailSource, /Optional · independent of P&L/);
  assert.match(styleSource, /\.tj-td-review-workspace \.tj-td-process-rating/);
});

test("Trade Detail shows six matching bubbles with concise, single hover labels", () => {
  assert.match(detailSource, /const bubbleKeys: ReviewCheckKey\[\] = \["setup", "rating", "psychology", "mistakes", "whatHappened", "repeatChange"\]/);
  assert.match(detailSource, /attachTip\(dot, \{ title: check\.label \}\)/);
  assert.match(detailSource, /dot\.createSpan\(\{ cls: "tj-sr-only", text: check\.label \}\)/);
  assert.doesNotMatch(detailSource, /dot\.setAttr\("aria-label"|dot\.setAttr\("title"/);
  assert.doesNotMatch(detailSource, /tj-td-review-progress-text|tj-td-risk-flag|Risk recorded|Stop not recorded/);
  assert.match(detailSource, /reviewState\.label/);
  assert.doesNotMatch(detailSource, /tj-td-markreviewed|Mark as reviewed/);
  assert.match(styleSource, /\.tj-td-review-dot\s*\{[\s\S]*?flex: 0 0 10px;[\s\S]*?width: 10px;[\s\S]*?height: 10px;[\s\S]*?cursor: help;/);
  assert.doesNotMatch(styleSource, /\.tj-td-review-dot:not\(\.is-core\)/);
  assert.match(styleSource, /\.tj-td-hero-badge\.is-status\s*\{[\s\S]*?cursor: default;/);
  assert.doesNotMatch(styleSource, /\.tj-td-markreviewed\s*\{/);
});

test("Execution and risk stay visible together without retired subheadings or disclosure", () => {
  assert.match(detailSource, /const reviewWorkspace = leftCol\.createDiv\(\{ cls: "tj-td-review-workspace" \}\)/);
  assert.match(detailSource, /const top = main\.createDiv\(\{ cls: "tj-td-top" \}\)/);
  assert.match(detailSource, /const hero = top\.createDiv\(\{ cls: "tj-td-hero" \}\)/);
  assert.match(detailSource, /const pageScroll = leftCol\.closest<HTMLElement>\("\.tj-app-main"\)/);
  assert.match(detailSource, /pageScroll\.scrollTop \+= event\.deltaY/);
  assert.match(detailSource, /leftCol\.scrollTop \+= event\.deltaY/);
  assert.match(detailSource, /text: "Entry → Exit"/);
  assert.match(detailSource, /row\(execRisk, "Gross P&L"/);
  assert.match(detailSource, /editableRow\(execRisk, "Stop"/);
  assert.match(detailSource, /editableRow\(execRisk, "Risk"/);
  assert.match(detailSource, /contenteditable: "true"/);
  assert.match(detailSource, /reviewHtmlToMarkdown\(area\)/);
  assert.match(detailSource, /document\.execCommand\(command, false, value\)/);
  assert.doesNotMatch(detailSource, /MarkdownRenderer\.render/);
  assert.doesNotMatch(detailSource, /text: "Preview"/);
  assert.match(detailSource, /panelCard\(reviewWorkspace, "Execution & Risk"\)/);
  assert.doesNotMatch(detailSource, /text: "Show source details"/);
  assert.doesNotMatch(detailSource, /text: "Trade facts"/);
  assert.doesNotMatch(detailSource, /text: "Risk plan"/);
  assert.doesNotMatch(detailSource, /Show execution details/);
});

test("Exit reason remains one manual selector", () => {
  assert.match(detailSource, /text: "Why did I close\?"/);
  assert.doesNotMatch(detailSource, /exitReasonField\.createDiv\(\{ cls: "tj-td-char-count", text: "Optional" \}\)/);
  assert.doesNotMatch(detailSource, /Manual exit declaration/);
});

test("Exit reason uses the approved primary-decision vocabulary and preserves legacy values", () => {
  for (const id of [
    "stop/invalidation reached",
    "target/planned objective reached",
    "breakeven/scratch exit",
    "trailing/managed stop",
    "thesis/setup no longer valid",
    "time/session ended",
    "market/news context changed",
    "risk/comfort changed",
    "forced/external close",
    "mixed/multiple reasons",
  ]) {
    assert.ok(detailSource.includes(`id: "${id}"`), `missing exit reason: ${id}`);
  }
  assert.match(detailSource, /label: `\$\{legacyExitLabels\[currentExitReason\]\} \(legacy\)`/);
  assert.doesNotMatch(detailSource, /id: "early exit", label: "Early exit"/);
});


test("manual plan fields keep visible labels and post-exit data stays optional", () => {
  assert.match(detailSource, /text: "Plan timing"/);
  assert.match(detailSource, /\["review_planned_entry", "Planned entry"\]/);
  assert.match(detailSource, /"Post-exit observation"/);
  assert.match(detailSource, /Optional: what happened after you were out/);
  assert.doesNotMatch(detailSource, /text: "Trade story"/);
  assert.doesNotMatch(detailSource, /text: "Post-exit points"/);
});

test("debounced review writes retain the trade identity across navigation", () => {
  assert.match(detailSource, /saveField\(key, val, tradeId\)/);
  assert.match(detailSource, /saveField\("rating", String\(next\), ratingTradeId\)/);
  assert.match(detailSource, /targetId = this\.trade\?\.id/);
});

test("review labels and controls retain readable focus and placeholder contrast", () => {
  assert.match(styleSource, /\.tj-td-star\s*\{[\s\S]*?color: var\(--tj-fg-2\)/);
  assert.match(styleSource, /\.tj-td-star:focus-visible/);
  assert.match(styleSource, /\.tj-td-textarea::placeholder\s*\{[\s\S]*?opacity: 1/);
  assert.match(styleSource, /\.tj-td-field-label \.tj-td-char-count\s*\{[\s\S]*?opacity: 1/);
});