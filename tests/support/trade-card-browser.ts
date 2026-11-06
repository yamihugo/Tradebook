import { renderTradeCard, type ExportOptions } from "../../src/lib/tradeCard";
import { TradeDetailView } from "../../src/views/tradeDetailView";
import type { Trade } from "../../src/types";
import { reviewHtmlToMarkdown, reviewMarkdownToHtml } from "../../src/lib/reviewRichText";

// Only the host's element helpers are adapted; the modal, renderer and canvas are production code.
function element(tag: string, options: { cls?: string; text?: string; attr?: Record<string, string | number> } = {}): HTMLElement {
  const el = document.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  Object.entries(options.attr || {}).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}
Object.assign(HTMLElement.prototype, {
  createEl(this: HTMLElement, tag: string, options: Parameters<typeof element>[1]) { const el = element(tag, options); this.append(el); return el; },
  createDiv(this: HTMLElement, options: Parameters<typeof element>[1]) { const el = element("div", options); this.append(el); return el; },
  createSpan(this: HTMLElement, options: Parameters<typeof element>[1]) { const el = element("span", options); this.append(el); return el; },
  setText(this: HTMLElement, text: string) { this.textContent = text; },
  toggleClass(this: HTMLElement, name: string, on: boolean) { this.classList.toggle(name, on); },
  setCssStyles(this: HTMLElement, values: object) { Object.assign(this.style, values); },
});
Object.assign(window, { createEl: element });

function chart(index: number): string {
  const w = index === 3 ? 640 : index === 4 ? 2160 : 1440;
  const h = index === 3 ? 1000 : 810;
  const candles = Array.from({ length: 44 }, (_, i) => {
    const x = 66 + i * (w - 170) / 44;
    const y = 220 + Math.sin(i / 3 + index) * 80 + i * 4;
    const green = i % 3 !== 0;
    return `<line x1="${x}" y1="${y - 24}" x2="${x}" y2="${y + 50}" stroke="${green ? "#58cfa5" : "#ef8e7f"}" stroke-width="3"/><rect x="${x - 7}" y="${y}" width="14" height="26" fill="${green ? "#58cfa5" : "#ef8e7f"}"/>`;
  }).join("");
  const grid = Array.from({ length: 8 }, (_, i) => `<path d="M40 ${120 + i * 80}H${w - 90}" stroke="#373737"/><text x="${w - 80}" y="${126 + i * 80}" fill="#bbbbbb" font-size="20">${1080 - i * 5}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#202020"/><text x="40" y="50" fill="#eeeeee" font-family="sans-serif" font-size="30">SYNTHETIC EXAMPLE / PRINT ${index + 1}</text><text x="40" y="88" fill="#aaaaaa" font-size="22">Illustrative chart · no journal data</text>${grid}${candles}<path d="M40 540H${w - 90}" stroke="#c5a6ff" stroke-width="3" stroke-dasharray="10 8"/><text x="44" y="${h - 30}" fill="#bbbbbb" font-size="24">09:30                         09:45                         10:00</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const urls = Array.from({ length: 5 }, (_, i) => chart(i));
const trade: Trade = {
  id: "synthetic-export-example", date: "2026-11-03", entryTime: "09:35:00", exitTime: "09:47:00",
  timezone: "America/New_York", symbol: "MES", direction: "long", account: "Synthetic", accountType: "personal",
  quantity: 3, entryPrice: 6000, exitPrice: 6020, stopLoss: 5990, pnl: 300, pnlPoints: 20,
  commission: 3, fees: 2, setup: "Pullback continuation", rating: 4, mistake: "", thesis: "", review: "", screenshot: "",
  psychology_tags: ["Focused", "Patient", "Confident", "Bored"], mistake_tags: ["Entered early"],
  review_what_happened: "Price held the opening range and reclaimed the prior high. I waited for the pullback, then entered after confirmation. The first push stalled before buyers returned.",
  review_repeat_change: "Repeat the patient entry and keep the initial risk defined. Next time, wait for a complete close before adjusting the stop instead of reacting to a single wick.",
  exit_reason: "target/planned objective reached", screenshots: urls.map((_, i) => ({ file: `synthetic-${i}.svg` })),
};
const defaults: ExportOptions = { orientation: "vertical", theme: "dark", screenshot: true, stats: false, rating: false, notes: false, repeatChange: false, exitReason: false, psychology: false, hidePnl: false, primaryPrint: 0 };
const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const captures: Array<{ text: string; x: number; y: number; font: string; width: number; color: string }> = [];
const drawnPrints: Array<{ sourceRatio: number; drawnRatio: number; area: number }> = [];
const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...args: unknown[]) {
  const source = args[0];
  if (source instanceof HTMLImageElement && args.length === 5) {
    const values = args as unknown as [HTMLImageElement, number, number, number, number];
    drawnPrints.push({ sourceRatio: source.naturalWidth / source.naturalHeight, drawnRatio: values[3] / values[4], area: values[3] * values[4] });
  }
  return (originalDraw as (...values: unknown[]) => void).apply(this, args);
};
const originalText = CanvasRenderingContext2D.prototype.fillText;
CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
  captures.push({ text, x, y, font: this.font, width: this.measureText(text).width, color: String(this.fillStyle) });
  return maxWidth === undefined ? originalText.call(this, text, x, y) : originalText.call(this, text, x, y, maxWidth);
};
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const richTrade: Trade = {
  ...trade, reviewed: true,
  review_what_happened: "## **Example Text**\n- **Point 1**\n- **Point 2**\n- **Point 3**\n\nMaybe conclusion\n\n*or some details*",
  review_repeat_change: "## Example text\nI want to change **X** and *Y* next time.",
};
const richStates: Array<[string, Partial<ExportOptions>]> = [
  ["rich-review-all", { primaryPrint: 0, stats: true, rating: true, psychology: true, notes: true, repeatChange: true, exitReason: true }],
  ["rich-review-only", { primaryPrint: 4, notes: true }],
];
async function captureRichCases(rows: object[]): Promise<void> {
  for (const orientation of ["vertical", "horizontal"] as const) for (const theme of ["dark", "light"] as const) for (const [name, selection] of richStates) {
    captures.length = 0;
    const result = await renderTradeCard(richTrade, { ...defaults, orientation, theme, ...selection }, "America/New_York", (i) => urls[i]);
    const text = captures.map((c) => c.text);
    assert(!text.some((value) => value.endsWith("…")), "Selected review text was shortened");
    assert(!text.some((value) => /##|\*\*/.test(value)), "Export printed raw formatting delimiters instead of formatted review text");
    assert(captures.some((c) => c.text.includes("Example Text") && /(?:700|bold)/.test(c.font) && /30px/.test(c.font)), `Heading formatting missing: ${JSON.stringify(captures.filter((c) => c.text.includes("Example")))}`);
    assert(captures.filter((c) => c.text === "•").length === 3, "Bullet list formatting missing");
    assert(captures.some((c) => c.text.includes("Point 1") && /(?:700|bold)/.test(c.font)), "Bold list text missing");
    assert(captures.some((c) => c.text.includes("or some details") && /italic/.test(c.font)), "Italic paragraph formatting missing");
    if (selection.repeatChange) {
      assert(captures.some((c) => c.text.trim() === "X" && /(?:700|bold)/.test(c.font)), "Inline bold formatting missing");
      assert(captures.some((c) => c.text.trim() === "Y" && /italic/.test(c.font)), "Inline italic formatting missing");
    }
    assert(!text.includes("Needs attention"), "Signal heading incorrectly implies an unfinished review");
    assert(richTrade.reviewed === true, "Export changed the reviewed flag");
    captures.forEach((c) => assert(c.x + c.width <= result.canvas.width - 25 && c.y >= 0 && c.y + parseFloat(c.font.match(/([\d.]+)px/)![1]) <= result.canvas.height - 20, `Rich text clipped: ${c.text}`));
    rows.push({ key: `${orientation}-${theme}-${name}`, boxes: result.boxes, warnings: result.warnings, text, runs: [...captures], png: result.canvas.toDataURL() });
  }
  for (const orientation of ["vertical", "horizontal"] as const) {
    captures.length = 0;
    const result = await renderTradeCard({ ...richTrade, review_what_happened: (richTrade.review_what_happened! + "\n\n").repeat(30) + "*FINAL_RICH_LINE*" }, { ...defaults, orientation, primaryPrint: 4, notes: true }, "America/New_York", (i) => urls[i]);
    assert(result.canvas.height > (orientation === "vertical" ? 1350 : 1080), "Long rich text did not expand the image");
    assert(captures.some((c) => c.text.includes("FINAL_RICH_LINE")), "The last rich-text line is missing");
    assert(captures.filter((c) => c.text === "•").length === 30 * 3, "Selected bullet items were lost");
    assert(!captures.some((c) => c.text.endsWith("…")), "Long rich text was shortened");
    assert(!captures.some((c) => /##|\*\*/.test(c.text)), "Rich truncation exposed formatting delimiters");
    captures.forEach((c) => assert(c.x + c.width <= result.canvas.width - 25 && c.y + parseFloat(c.font.match(/([\d.]+)px/)![1]) <= result.canvas.height - 20, `Truncated rich text clipped: ${c.text}`));
    rows.push({ key: `${orientation}-dark-rich-review-long`, boxes: result.boxes, warnings: result.warnings, runs: [...captures], png: result.canvas.toDataURL() });
  }

}

async function cases(): Promise<object> {
  const rows: object[] = [];
  const editor = document.createElement("div");
  editor.innerHTML = '<h2><b>Example Text</b></h2><ul><li><b>Point 1</b></li><li><b>Point 2</b></li><li><b>Point 3</b></li></ul><p>Maybe conclusion</p><p><i>or some details</i></p>';
  const saved = reviewHtmlToMarkdown(editor);
  const reloaded = new DOMParser().parseFromString(reviewMarkdownToHtml(saved), "text/html");
  assert(reloaded.querySelector("h2")?.textContent === "Example Text" && reloaded.querySelectorAll("li strong").length === 3 && reloaded.querySelector("em")?.textContent === "or some details", "Review formatting did not survive save/reload");
  editor.innerHTML = '<p>I want to change<b><b> X </b></b>and <span style="font-weight:700;font-style:italic">Y</span> next time.</p>';
  const mixed = reviewHtmlToMarkdown(editor);
  const mixedHtml = new DOMParser().parseFromString(reviewMarkdownToHtml(mixed), "text/html");
  assert(!mixed.includes("****") && mixed.includes("**X**") && mixedHtml.querySelector("strong em")?.textContent === "Y", "Nested/whitespace emphasis serialization is malformed");
  const legacyHtml = new DOMParser().parseFromString(reviewMarkdownToHtml('I want to change** **** X **and **Y** next time.'), "text/html");
  assert(!legacyHtml.body.textContent?.includes("**") && [...legacyHtml.querySelectorAll("strong")].some((node) => node.textContent?.includes("X")), "Legacy editor emphasis was exposed as raw markers");
  editor.innerHTML = 'First paragraph<div>Second paragraph</div>';
  assert(reviewHtmlToMarkdown(editor).includes('First paragraph\n\nSecond paragraph'), "Editor paragraph boundary was lost");
  assert(!new DOMParser().parseFromString(reviewMarkdownToHtml('<img src=x onerror=alert(1)>'), 'text/html').querySelector('img'), "Raw HTML was interpreted");
  await captureRichCases(rows);
  const states: Array<[string, Partial<ExportOptions>]> = [
    ["screenshot-only", {}], ["screenshot-fill", { imageFit: "cover" }],
    ["wide-main-screenshot", { primaryPrint: 4, stats: true, rating: true, psychology: true, notes: true, repeatChange: true, exitReason: true }],
    ["screenshot-stats", { stats: true }], ["screenshot-signals", { psychology: true }],
    ["screenshot-repeat-change", { repeatChange: true }], ["screenshot-exit-reason", { exitReason: true }],
    ["screenshot-what-happened", { notes: true }], ["screenshot-all-review", { notes: true, repeatChange: true, exitReason: true }],
    ["all-hidden", { stats: true, rating: true, psychology: true, notes: true, repeatChange: true, exitReason: true, hidePnl: true }],
    ["all-money", { stats: true, rating: true, psychology: true, notes: true, repeatChange: true, exitReason: true }],
    ["different-main-screenshot", { primaryPrint: 1, stats: true, rating: true, psychology: true, notes: true, repeatChange: true, exitReason: true }],
    ["no-screenshot", { screenshot: false, stats: true, notes: true, repeatChange: true, exitReason: true, psychology: true, rating: true }],
    ["tall-main-screenshot", { primaryPrint: 3, stats: true }],
  ];
  for (const orientation of ["vertical", "horizontal"] as const) for (const theme of ["dark", "light"] as const) {
    for (const [name, changes] of states) {
      captures.length = 0; drawnPrints.length = 0;
      const opts = { ...defaults, orientation, theme, ...changes };
      const result = await renderTradeCard(trade, opts, "America/New_York", (i) => urls[i] || null);
      const { canvas, boxes } = result;
      drawnPrints.forEach((image) => assert(Math.abs(image.sourceRatio - image.drawnRatio) < 0.0001, "Screenshot was stretched"));
      assert(drawnPrints.length === (opts.screenshot ? 1 : 0), "A card must contain exactly the selected main screenshot");
      const primaryBox = boxes.find((b) => b.kind === "primary");
      if (opts.screenshot && opts.imageFit !== "cover") {
        assert(primaryBox && Math.abs(primaryBox.w / (primaryBox.h - 28) - drawnPrints[0].sourceRatio) < 0.0001, "Fit frame has artificial letterboxing");
      }
      if (orientation === "vertical" && ["screenshot-only", "screenshot-stats", "screenshot-signals"].includes(name)) {
        assert(primaryBox && primaryBox.h <= 600, `Sparse portrait screenshot expanded into unused canvas space: ${primaryBox?.h}`);
      }
      assert(boxes[0].h <= 38, "Ordinary metadata did not fit the compact single-row header");
      assert(canvas.width === (orientation === "vertical" ? 1080 : 1920) && canvas.height >= (orientation === "vertical" ? 1350 : 1080), "Wrong output size");
      for (const b of boxes) {
        assert(b.x >= 0 && b.y >= 0 && b.x + b.w <= canvas.width && b.y + b.h <= canvas.height, `Out of bounds: ${b.kind}`);
        for (const other of boxes) if (b !== other) assert(!(b.x < other.x + other.w - 0.5 && b.x + b.w > other.x + 0.5 && b.y < other.y + other.h - 0.5 && b.y + b.h > other.y + 0.5), `Overlap: ${b.kind}/${other.kind}`);
      }
      captures.forEach((c) => assert(c.x + c.width <= canvas.width - 25 && c.y >= 0 && c.y + parseFloat(c.font.match(/([\d.]+)px/)![1]) <= canvas.height - 20, `Text clipped: ${c.text}`));
      captures.forEach((c) => assert(parseFloat(c.font.match(/([\d.]+)px/)![1]) >= 18, `Unreadably small card text: ${c.text}`));
      const texts = captures.map((c) => c.text);
      const facts = boxes.filter((b) => b.kind === "fact").map((b) => b.label);
      assert(new Set(facts).size === facts.length, "Duplicated metric");
      for (const label of ["Net P&L", "Gross P&L", "Fees"]) assert(facts.includes(label) === (opts.stats && !opts.hidePnl), `Money toggle failed for ${label}`);
      if (opts.stats && !opts.hidePnl) assert(texts.includes("$295.00") && texts.includes("$300.00") && texts.includes("$5.00"), "Actual monetary values missing");
      if (opts.hidePnl) assert(!texts.some((s) => /[$€£]/.test(s)), "Money leaked");
      for (const [key, label] of [["notes", "What happened?"], ["repeatChange", "Repeat or change"], ["exitReason", "Why did I close?"]] as const) assert(texts.includes(label) === opts[key], `Review selection lost: ${label}`);
      assert(boxes.filter((b) => /primary|secondary/.test(b.kind)).length === (opts.screenshot ? 1 : 0), "Selected main screenshot missing");
      assert(!texts.includes("Plan"), "Plan leaked into export");
      const positive = theme === "dark" ? "#62d9a3" : "#227a4a";
      const negative = theme === "dark" ? "#ff8585" : "#b32635";
      const neutral = theme === "dark" ? "#f4f4f4" : "#202020";
      const valueColor = (label: string): string | undefined => captures[captures.findIndex((c) => c.text === label) + 1]?.color;
      if (opts.stats) {
        assert(valueColor("Points") === neutral && valueColor("Gross R") === neutral, "Non-money metrics should remain neutral");
        if (!opts.hidePnl) assert(valueColor("Net P&L") === positive && valueColor("Gross P&L") === positive && valueColor("Fees") === neutral, "Result or fee color semantics are incorrect");
      }
      if (opts.rating) assert(captures.some((c) => c.text.includes("★") && c.color === (theme === "dark" ? "#f2c55c" : "#946200")), "Self-rating stars are not gold");
      if (opts.psychology) {
        assert(texts.includes("Tags"), "Export heading is not Tags");
        const psychology = captures.find((c) => c.text === "Psychology");
        const mistakes = captures.find((c) => c.text === "Mistakes");
        assert(psychology && mistakes && psychology.x < mistakes.x, "Stored tag categories are not separated");
        assert(!texts.some((value) => ["Review signals", "Supportive", "Challenges", "Other states"].includes(value)), "Invented tag categorization remains");
        const tagBox = boxes.find((b) => b.kind === "tags")!;
        const psychologyText = captures.filter((c) => c.x >= psychology!.x && c.x < mistakes!.x - 12 && c.y > psychology!.y && c.y < tagBox.y + tagBox.h);
        const mistakeText = captures.filter((c) => c.x >= mistakes!.x && c.y > mistakes!.y && c.y < tagBox.y + tagBox.h);
        const psychologyWords = psychologyText.map((c) => c.text).join(" ");
        const mistakeWords = mistakeText.map((c) => c.text).join(" ");
        assert(["Focused", "Patient", "Confident", "Bored"].every((label) => psychologyWords.includes(label)), "Psychology tags were classified into other groups");
        assert(mistakeWords.includes("Entered early") && !mistakeWords.includes("Bored") && !psychologyWords.includes("Entered early"), "Tag sources were mixed");
        const tagBodies = [...psychologyText, ...mistakeText].filter((c) => parseFloat(c.font.match(/([\d.]+)px/)![1]) === 24);
        assert(tagBodies.length >= 2 && tagBodies.every((c) => c.color === neutral), "Tag body text should stay neutral");
      }
      for (const box of boxes.filter((b) => b.kind === "review")) {
        const body = captures.filter((c) => c.x >= box.x && c.x < box.x + box.w && c.y >= box.y && c.y < box.y + box.h && parseFloat(c.font.match(/([\d.]+)px/)![1]) === 26);
        assert(body.length > 0, "Review card contains no body text");
        const lastBottom = Math.max(...body.map((c) => c.y + 26));
        assert(box.y + box.h - lastBottom <= 14, `Review card stretched beyond its text: ${box.label}`);
      }
      const key = `${orientation}-${theme}-${name}`;
      rows.push({ key, boxes, warnings: result.warnings, text: texts, png: canvas.toDataURL("image/png") });
    }
  }
  for (const orientation of ["vertical", "horizontal"] as const) {
    const long = { ...trade, review_what_happened: "UnbrokenToken".repeat(160) + " FINAL_WHAT", review_repeat_change: trade.review_repeat_change!.repeat(20) + " FINAL_REPEAT" };
    captures.length = 0;
    const result = await renderTradeCard(long, { ...defaults, orientation, notes: true, repeatChange: true, exitReason: true }, "America/New_York", (i) => urls[i]);
    assert(result.canvas.height > (orientation === "vertical" ? 1350 : 1080), "Long text did not expand the output");
    assert(captures.some((c) => c.text.includes("FINAL_WHAT")) && captures.some((c) => c.text.includes("FINAL_REPEAT")), "A selected text field lost its ending");
    assert(!captures.some((c) => c.text.endsWith("…")), "Full-text mode still adds ellipses");
    rows.push({ key: `${orientation}-long-review`, boxes: result.boxes, warnings: result.warnings, png: result.canvas.toDataURL() });
  }
  let blocked = false;
  try { await renderTradeCard(trade, { ...defaults, screenshot: false }, "America/New_York", () => null); } catch (e) { blocked = /populated content/.test(String(e)); }
  assert(blocked, "A blank card should be blocked visibly, not exported");
  captures.length = 0;
  await renderTradeCard({ ...trade, setup: "Budget $300", review_what_happened: "Risk $30.00, costs EUR 5.00, result 300 USD." }, { ...defaults, notes: true, screenshot: false, hidePnl: true }, "America/New_York", () => null);
  assert(!captures.some((c) => /\b300\b|\b30\.00\b|\b5\.00\b|[$€£]/.test(c.text)), `Currency in review text leaked: ${captures.map((c) => c.text).join(" | ")}`);
  captures.length = 0;
  const longTags = await renderTradeCard({ ...trade, psychology_tags: ["Very long state ".repeat(400) + "FINAL_PSYCHOLOGY"] }, { ...defaults, psychology: true }, "America/New_York", (i) => urls[i]);
  assert(longTags.canvas.height > 1350 && captures.some((c) => c.text.includes("FINAL_PSYCHOLOGY")), "Long selected tags were clipped instead of included");
  captures.length = 0;
  await renderTradeCard({ ...trade, pnl: -300, pnlPoints: -20 }, { ...defaults, stats: true }, "America/New_York", (i) => urls[i]);
  const negativeValue = captures[captures.findIndex((c) => c.text === "Net P&L") + 1];
  assert(negativeValue.color === "#ff8585", "Negative result did not render red");
  captures.length = 0;
  await renderTradeCard({ ...trade, pnl: 0, pnlPoints: 0, commission: 0, fees: 0 }, { ...defaults, stats: true }, "America/New_York", (i) => urls[i]);
  assert(captures[captures.findIndex((c) => c.text === "Net P&L") + 1].color === "#f4f4f4", "Zero result is not neutral");
  blocked = false;
  try { await renderTradeCard(trade, defaults, "America/New_York", () => null); } catch (e) { blocked = /Print 1 could not be resolved/.test(String(e)); }
  assert(blocked, "Missing selected image silently discarded");
  const empty = await renderTradeCard({ ...trade, review_what_happened: " ", review_repeat_change: "", exit_reason: undefined, rating: undefined, psychology_tags: [], mistake_tags: [] }, { ...defaults, screenshot: false, stats: true, notes: true, repeatChange: true, exitReason: true, psychology: true, rating: true }, "America/New_York", () => null);
  assert(empty.boxes.every((b) => b.kind !== "review" && b.kind !== "tags"), "Empty selected fields reserve space");
  const plainModal = await modal(states);
  const richModal = await modal(richStates, richTrade);
  const extendedFixture = { ...richTrade,
    review_what_happened: (richTrade.review_what_happened! + "\n\n").repeat(12) + "*FINAL_MODAL_WHAT*",
    review_repeat_change: (richTrade.review_repeat_change! + "\n\n").repeat(6) + "**FINAL_MODAL_REPEAT**",
  };
  const extendedModal = await modal(richStates, extendedFixture);
  blocked = false;
  try { await renderTradeCard({ ...trade, review_what_happened: "Complete paragraph\n\n".repeat(2000) }, { ...defaults, notes: true }, "America/New_York", (i) => urls[i]); } catch (error) { blocked = /supported single-image height/.test(String(error)); }
  assert(blocked, "Excessive image allocation should fail explicitly, never truncate content");
  captures.length = 0;
  await renderTradeCard({ ...trade, setup: "Long setup ".repeat(100) + "FINAL_SETUP" }, defaults, "America/New_York", (i) => urls[i]);
  assert(captures.some((c) => c.text.includes("FINAL_SETUP")) && !captures.some((c) => c.text.endsWith("…")), "Header metadata was shortened");
  return { rows, modal: { ...plainModal, states: [...plainModal.states, ...richModal.states, ...extendedModal.states] } };
}

async function modal(states: Array<[string, Partial<ExportOptions>]>, fixture: Trade = trade): Promise<{ states: object[]; singleMainScreenshot: boolean; noPlan: boolean }> {
  document.querySelectorAll(".tj-overlay").forEach((node) => node.remove());
  const view = Object.create(TradeDetailView.prototype) as TradeDetailView;
  view.trade = structuredClone(fixture);
  const untouchedTrade = JSON.stringify(view.trade);
  view.plugin = { settings: { timeZone: "America/New_York" } } as TradeDetailView["plugin"];
  view.resolveImage = (file: string) => urls[Number(file.match(/\d+/)?.[0])] || null;
  view.showExportPanel();
  const ready = async (): Promise<HTMLCanvasElement> => {
    for (let i = 0; i < 120; i++) {
      await wait(50);
      const button = document.querySelector<HTMLButtonElement>(".tj-export-btn");
      if (button && !button.disabled) return document.querySelector<HTMLCanvasElement>(".tj-export-preview-wrap canvas")!;
    }
    throw new Error(`Preview did not become ready: ${document.querySelector(".tj-export-status")?.textContent}`);
  };
  let canvas = await ready();
  for (const button of document.querySelectorAll<HTMLButtonElement>(".tj-export-panel button")) {
    const style = getComputedStyle(button);
    assert(style.backgroundColor === "rgba(0, 0, 0, 0)" && style.boxShadow === "none", `Host button fill leaked into Export: ${button.textContent?.trim()} / ${style.backgroundColor}`);
  }
  const header = document.querySelector<HTMLElement>(".tj-export-header")!;
  const body = document.querySelector<HTMLElement>(".tj-export-body")!;
  assert(header && header.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 0.5, "Export header overlaps the body");
  assert([...document.querySelectorAll('.tj-export-header [role="group"]')].length === 2, "Orientation and Theme are not grouped in the header");
  assert(!document.querySelector(".tj-export-subtitle"), "Generic subtitle was not removed");
  const tagsOption = document.querySelector<HTMLElement>('.tj-export-option[aria-label="Tags"]')!;
  tagsOption.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); await ready();
  assert(tagsOption.getAttribute("aria-checked") === "false" && !tagsOption.classList.contains("on"), "Space did not toggle the content option");
  tagsOption.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await ready();
  assert(tagsOption.getAttribute("aria-checked") === "true" && tagsOption.classList.contains("on"), "Enter did not restore the content option");
  const privacyDefault = [...document.querySelectorAll<HTMLElement>(".tj-export-option")].find((el) => el.textContent?.includes("Hide money"))!;
  assert(!privacyDefault.classList.contains("on"), "Money is not visible by default");
  assert(document.querySelectorAll('.tj-export-print-row[aria-checked="true"]').length === 1, "Main screenshot is not single-choice");
  const originalPreview = canvas.toDataURL();
  document.querySelectorAll<HTMLElement>(".tj-export-print-row")[3].click();
  canvas = await ready();
  assert(canvas.toDataURL() !== originalPreview, "Changing the main screenshot did not visibly update the preview");
  assert(document.querySelectorAll('.tj-export-print-row[aria-checked="true"]').length === 1, "Choosing a different main screenshot did not replace the old choice");
  const modalStates: object[] = [];
  const clickLabel = (selector: string, label: string): void => {
    const e = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim() === label);
    assert(e, `Missing control ${label}`); e!.click();
  };
  const checkParity = async (key: string): Promise<void> => {
    canvas = await ready();
    if (canvas.height > (canvas.width === 1080 ? 1350 : 1080)) {
      const wrap = document.querySelector<HTMLElement>(".tj-export-preview-wrap")!;
      assert(wrap.dataset.expanded === "true" && getComputedStyle(canvas).maxHeight === "none", "Expanded text is squeezed into the preview frame");
      assert(getComputedStyle(wrap).alignItems === "flex-start", "Tall preview starts clipped above its scroll area");
    }
    const expected = canvas.toDataURL("image/png");
    let downloaded: Blob | null = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { downloaded = blob as Blob; return "blob:isolated-export-test"; };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};
    clickLabel(".tj-export-btn", "PNG");
    for (let i = 0; i < 100 && !downloaded; i++) await wait(20);
    URL.createObjectURL = original; HTMLAnchorElement.prototype.click = originalClick;
    assert(downloaded, "Download did not produce a blob");
    const actual = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(downloaded!); });
    assert(actual === expected, `Preview/download PNG mismatch: ${key}`);
    modalStates.push({ key: fixture === trade ? key : fixture === richTrade ? `formatted-${key}` : `extended-${key}`, identicalPngBytes: true, png: expected });
  };
  clickLabel(".tj-export-toggle-btn", "Select all");
  await ready();
  assert(![...document.querySelectorAll(".tj-export-option-label")].some((el) => el.textContent === "Plan"), "Plan in selector");
  clickLabel(".tj-export-preset", "Light");
  await ready();
  assert(getComputedStyle(document.querySelector(".tj-export-preview-wrap")!).backgroundColor === "rgb(255, 255, 255)", "Preview frame theme mismatch");
  await checkParity("vertical-light-all");
  view.showExportPanel(); await ready();
  clickLabel(".tj-export-preset", "Horizontal"); await ready();
  clickLabel(".tj-export-toggle-btn", "Select all"); await ready();
  const privacy = [...document.querySelectorAll<HTMLElement>(".tj-export-option")].find((el) => el.textContent?.includes("Hide money"))!;
  assert(!privacy.classList.contains("on"), "Select all changed privacy");
  await checkParity("horizontal-dark-all-money");
  for (const orientation of ["vertical", "horizontal"] as const) for (const theme of ["dark", "light"] as const) for (const [name, changes] of states) {
    const target = { ...defaults, orientation, theme, ...changes };
    view.showExportPanel(); await ready();
    if (orientation === "horizontal") clickLabel(".tj-export-preset", "Horizontal");
    if (theme === "light") clickLabel(".tj-export-preset", "Light");
    if (target.imageFit === "cover") clickLabel(".tj-export-preset", "Fill");
    for (const [key, label] of [["screenshot", "Screenshot"], ["stats", "Stats"], ["rating", "Self-rating"], ["psychology", "Tags"], ["notes", "What happened?"], ["repeatChange", "Repeat or change"], ["exitReason", "Why did I close?"], ["hidePnl", "Hide money"]] as const) {
      const row = [...document.querySelectorAll<HTMLElement>(".tj-export-option")].find((el) => el.querySelector(".tj-export-option-label")?.textContent === label)!;
      assert(row, `Missing option ${label}`);
      if (row.classList.contains("on") !== target[key]) row.click();
    }
    if (target.primaryPrint !== 0) document.querySelectorAll<HTMLElement>(".tj-export-print-row")[target.primaryPrint].click();
    await checkParity(`${orientation}-${theme}-${name}-modal`);
  }
  view.showExportPanel(); await ready();
  clickLabel(".tj-export-toggle-btn", "Select all");
  clickLabel(".tj-export-preset", "Light");
  await ready();
  const wrap = document.querySelector<HTMLElement>(".tj-export-preview-wrap")!;
  const controls = document.querySelector<HTMLElement>(".tj-export-left")!;
  assert(controls.getBoundingClientRect().right <= wrap.getBoundingClientRect().left, "Controls are not confined to the left column");
  assert(JSON.stringify(view.trade) === untouchedTrade, "Export controls changed the trade record");
  return { states: modalStates, singleMainScreenshot: true, noPlan: true };
}
function inspectExportDialog(): object {
  const panel = document.querySelector<HTMLElement>(".tj-export-panel")!;
  const header = panel.querySelector<HTMLElement>(".tj-export-header")!;
  const body = panel.querySelector<HTMLElement>(".tj-export-body")!;
  const left = panel.querySelector<HTMLElement>(".tj-export-left")!;
  const preview = panel.querySelector<HTMLElement>(".tj-export-preview-wrap")!;
  const panelBox = panel.getBoundingClientRect();
  assert(panelBox.left >= 0 && panelBox.right <= innerWidth + 1, "Dialog exceeds the viewport width");
  assert(header.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 1, "Header overlaps the body");
  assert(left.getBoundingClientRect().right <= preview.getBoundingClientRect().left, "Options overlap the preview");
  const controls = [...panel.querySelectorAll<HTMLButtonElement>("button")].map((button) => {
    const css = getComputedStyle(button);
    assert(css.backgroundColor === "rgba(0, 0, 0, 0)" && css.boxShadow === "none", `Native button fill returned: ${button.textContent}`);
    return { label: button.textContent?.trim(), background: css.backgroundColor, shadow: css.boxShadow, pressed: button.getAttribute("aria-pressed") };
  });
  for (const group of header.querySelectorAll('[role="group"]')) {
    assert(group.querySelectorAll('[aria-pressed="true"]').length === 1, "Appearance group has an ambiguous selection");
    const box = group.getBoundingClientRect();
    assert(box.left >= panelBox.left && box.right <= panelBox.right && box.bottom <= header.getBoundingClientRect().bottom, "Header controls are clipped");
  }
  const before = left.scrollTop;
  left.scrollTop = left.scrollHeight;
  const action = panel.querySelector<HTMLButtonElement>(".tj-export-btn")!.getBoundingClientRect();
  const leftBox = left.getBoundingClientRect();
  assert(action.top >= leftBox.top - 1 && action.bottom <= leftBox.bottom + 1, "Export actions are unreachable in the scroll column");
  left.scrollTop = before;
  return { width: innerWidth, height: innerHeight, headerHeight: header.getBoundingClientRect().height, controls, previewWidth: preview.clientWidth };
}
async function inspectLightPalette(): Promise<object> {
  const colors = new Set<string>();
  let page = ""; let surface = "";
  const sample = (ctx: CanvasRenderingContext2D, x: number, y: number): string => {
    const value = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    return "#" + [...value].slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("");
  };
  for (const pnl of [300, -300]) {
    captures.length = 0;
    const result = await renderTradeCard({ ...trade, pnl }, { ...defaults, theme: "light", stats: true, rating: true, psychology: true, notes: true }, "America/New_York", (i) => urls[i]);
    captures.forEach((run) => colors.add(run.color));
    const ctx = result.canvas.getContext("2d")!;
    const fact = result.boxes.find((box) => box.kind === "fact")!;
    page = sample(ctx, 2, 2); surface = sample(ctx, fact.x + fact.w - 8, fact.y + 8);
  }
  const luminance = (hex: string): number => {
    const values = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const ratios = [...colors].map((color) => {
    const on = (background: string): number => { const [a, b] = [luminance(color), luminance(background)].sort((a, b) => a - b); return (b + 0.05) / (a + 0.05); };
    const onPage = on(page); const onCard = on(surface);
    assert(onPage >= 4.5 && onCard >= 4.5, `Light text contrast fell below the repository target: ${color}`);
    return { color, onPage, onCard };
  });
  assert(page === "#ffffff" && surface === "#f1f1ef", "Light surfaces do not match their own palette");
  return { page, surface, ratios };
}
Object.assign(window, { runCardCases: cases, inspectExportDialog, inspectLightPalette });
