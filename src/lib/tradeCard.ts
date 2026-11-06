import type { Trade } from "../types";
import { netPnl } from "./fees";
import { recordedRisk } from "./risk";
import { sessionLabel } from "./sessions";
import { holdFmtOf } from "./tradeTable";
import { mistakeTagsOf, normalizeTags, psychologyTagsOf } from "./tags";
import { entryInstantDate } from "./instant";
import { drawReviewText, measureReviewText, reviewTextHeight, type ReviewLine } from "./reviewRichText";

export type ExportOrientation = "vertical" | "horizontal";
export type ExportTheme = "dark" | "light";
export type ExportOptions = {
  orientation: ExportOrientation;
  theme: ExportTheme;
  imageFit?: "contain" | "cover";
  screenshot: boolean;
  stats: boolean;
  rating: boolean;
  notes: boolean;
  repeatChange: boolean;
  exitReason: boolean;
  psychology: boolean;
  hidePnl: boolean;
  primaryPrint: number;
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const GAP = 16;
const BODY = 26;
const LABEL = 20;

type Tone = "positive" | "negative" | "neutral";
type Pair = { label: string; value: string; tone?: Tone };
export type CardBox = { kind: string; x: number; y: number; w: number; h: number; label?: string };
type Print = { index: number; image: HTMLImageElement };
type TextBlock = Pair & { lines: ReviewLine[] };
export type TradeCardResult = { canvas: HTMLCanvasElement; boxes: CardBox[]; warnings: string[] };

function font(ctx: CanvasRenderingContext2D, size = BODY, weight = 500): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Break long tokens as well as words; no text relies on canvas' squeeze-to-fit argument. */
export function wrapCardText(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.trim().split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width) { line = next; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Redact explicit currency expressions in user text too, not just the numeric facts. */
export function redactCardMoney(value: string): string {
  return value.replace(/(?:[-+]?\s*[$€£¥]\s*[-+]?\d[\d,.]*(?:\s*(?:USD|EUR|GBP|JPY|dollars?|euros?|pounds?))?|\b(?:USD|EUR|GBP|JPY)\s*[-+]?\d[\d,.]*|[-+]?\d[\d,.]*\s*(?:USD|EUR|GBP|JPY|dollars?|euros?|pounds?)\b)/gi, "[hidden]");
}

function factsFor(t: Trade, zone: string, hideMoney: boolean): Pair[] {
  const result: Pair[] = [];
  const add = (label: string, value: string | undefined, tone: Tone = "neutral"): void => { if (value?.trim()) result.push({ label, value, tone }); };
  const sign = (value: number): Tone => value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  if (!hideMoney) {
    const money = (v: number): string => `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
    if (Number.isFinite(t.pnl)) {
      add("Net P&L", money(netPnl(t)), sign(netPnl(t)));
      add("Gross P&L", money(t.pnl), sign(t.pnl));
    }
    if (Number.isFinite(t.commission) || Number.isFinite(t.fees)) add("Fees", money((t.commission || 0) + (t.fees || 0)));
  }
  if (Number.isFinite(t.pnlPoints)) add("Points", `${t.pnlPoints >= 0 ? "+" : ""}${t.pnlPoints.toFixed(2)}`);
  const risk = recordedRisk(t);
  if (Number.isFinite(t.pnl) && risk !== null && Number.isFinite(risk) && risk > 0) add("Gross R", `${(t.pnl / risk).toFixed(2)}R`);
  if (Number.isFinite(t.quantity)) add("Contracts", String(t.quantity));
  add("Hold", holdFmtOf(t));
  add("Session", sessionLabel(t, zone));
  return result;
}

async function loadPrint(index: number, url: string | null): Promise<Print> {
  if (!url) throw new Error(`Print ${index + 1} could not be resolved. Choose another print or turn Screenshot off.`);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Print ${index + 1} took too long to load. Try again.`)), 12000);
    image.onload = () => { window.clearTimeout(timeout); resolve(); };
    image.onerror = () => { window.clearTimeout(timeout); reject(new Error(`Print ${index + 1} could not be loaded. Choose another print or turn Screenshot off.`)); };
    image.src = url;
  });
  return { index, image };
}

/** The only Trade Card painter: measure first, allocate a bounded flow, then draw. */
export async function renderTradeCard(
  t: Trade,
  opts: ExportOptions,
  zone: string,
  resolvePrint: (index: number) => string | null,
): Promise<TradeCardResult> {
  const horizontal = opts.orientation === "horizontal";
  const canvas = document.createElement("canvas");
  canvas.width = horizontal ? 1920 : 1080;
  const baseHeight = horizontal ? 1080 : 1350;
  canvas.height = baseHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable. Export cannot be rendered.");
  await document.fonts.ready;
  const pad = 40;
  const width = canvas.width - pad * 2;
  let bottom = canvas.height - pad;
  const extendTo = (required: number): void => {
    const height = Math.max(baseHeight, Math.ceil(required));
    if (height > 16000) throw new Error("The complete selected text exceeds the supported single-image height. Nothing was cut. Reduce the selected sections or split the text before exporting.");
    if (canvas.height !== height) canvas.height = height;
    bottom = height - pad;
  };
  const boxes: CardBox[] = [];
  const warnings: string[] = [];
  const safe = (s: string): string => opts.hidePnl ? redactCardMoney(s) : s;
  const dark = opts.theme === "dark";
  const colors = dark
    ? { bg: "#191919", surface: "#262626", fg: "#f4f4f4", muted: "#b8b8b8", border: "#424242", positive: "#62d9a3", negative: "#ff8585", gold: "#f2c55c" }
    : { bg: "#ffffff", surface: "#f1f1ef", fg: "#202020", muted: "#595959", border: "#d6d6d2", positive: "#227a4a", negative: "#b32635", gold: "#946200" };
  const toneColor = (tone: Tone = "neutral"): string => tone === "neutral" ? colors.fg : colors[tone];
  if (opts.screenshot && (!Number.isInteger(opts.primaryPrint) || opts.primaryPrint < 0)) throw new Error("Choose the main screenshot to share, or turn Screenshot off.");
  const primary = opts.screenshot ? await loadPrint(opts.primaryPrint, resolvePrint(opts.primaryPrint)) : undefined;
  const facts = opts.stats ? factsFor(t, zone, opts.hidePnl).map((p) => ({ ...p, value: safe(p.value) })) : [];
  const reviews: Pair[] = [];
  if (opts.notes && t.review_what_happened?.trim()) reviews.push({ label: "What happened?", value: safe(t.review_what_happened) });
  if (opts.repeatChange && t.review_repeat_change?.trim()) reviews.push({ label: "Repeat or change", value: safe(t.review_repeat_change) });
  if (opts.exitReason && t.exit_reason?.trim()) reviews.push({ label: "Why did I close?", value: safe(t.exit_reason) });
  for (let i = reviews.length - 1; i >= 0; i--) if (!measureReviewText(ctx, reviews[i].value, width - 32).length) reviews.splice(i, 1);
  const tagSources = opts.psychology ? [
    { label: "Psychology", values: normalizeTags(psychologyTagsOf(t)).map(safe) },
    { label: "Mistakes", values: normalizeTags(mistakeTagsOf(t)).map(safe) },
  ].filter((group) => group.values.length) : [];
  const hasTags = tagSources.length > 0;
  const rating = opts.rating && Number.isFinite(t.rating) && Number(t.rating) > 0 ? Math.round(Math.min(5, Number(t.rating))) : 0;
  if (!primary && !facts.length && !reviews.length && !hasTags && !rating) throw new Error("Select at least one populated content section to export.");
  const setup = safe(t.setups?.filter(Boolean).join(" · ") || t.setup || "");
  let zoneLabel = t.timezone || zone;
  try {
    const instant = entryInstantDate(t) ?? new Date(`${t.date}T12:00:00Z`);
    zoneLabel = new Intl.DateTimeFormat("en-US", { timeZone: zoneLabel, timeZoneName: "short" }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value || zoneLabel;
  } catch { /* Keep the recorded zone when it cannot be abbreviated. */ }
  const headerParts = [
    { value: "TRADEBOOK / TRADE CARD", size: 18, weight: 650 },
    { value: safe(`${t.symbol} · ${t.direction === "long" ? "Long" : "Short"}`), size: 26, weight: 700 },
    ...[t.date, t.entryTime, zoneLabel, setup].filter(Boolean).map((value) => ({ value: safe(value), size: 20, weight: 500 })),
  ];
  const headerRows: Array<Array<{ value: string; size: number; weight: number; w: number }>> = [[]];
  let rowWidth = 0;
  for (const part of headerParts) {
    font(ctx, part.size, part.weight);
    for (const value of wrapCardText(ctx, part.value, width)) {
      const w = ctx.measureText(value).width;
      if (rowWidth && rowWidth + 20 + w > width) { headerRows.push([]); rowWidth = 0; }
      headerRows[headerRows.length - 1].push({ ...part, value, w });
      rowWidth += (rowWidth ? 20 : 0) + w;
    }
  }
  const headerHeights = headerRows.map((row) => Math.max(...row.map((part) => part.size)) + 8);
  const headerH = headerHeights.reduce((sum, h) => sum + h, 0) + (headerRows.length - 1) * 4;
  boxes.push({ kind: "header", x: pad, y: pad, w: width, h: headerH });
  let y = pad + headerH + GAP;

  // Facts are a full-width grid in both orientations, never a narrow information rail.
  const rowCount = facts.length ? Math.ceil(facts.length / (horizontal ? 8 : 4)) : 0;
  const factRows: number[] = [];
  const factLines: string[][] = [];
  const factCells: Array<{ index: number; row: number; x: number; w: number }> = [];
  font(ctx, 28, 650);
  let cellIndex = 0;
  for (let row = 0; row < rowCount; row++) {
    const count = Math.floor(facts.length / rowCount) + (row < facts.length % rowCount ? 1 : 0);
    const w = (width - (count - 1) * GAP) / count;
    let linesInRow = 1;
    for (let col = 0; col < count; col++) {
      const index = cellIndex++;
      const lines = wrapCardText(ctx, facts[index].value, w - 24);
      factLines[index] = lines;
      linesInRow = Math.max(linesInRow, lines.length);
      factCells.push({ index, row, x: pad + col * (w + GAP), w });
    }
    factRows.push(38 + linesInRow * 32);
  }
  const factsH = factRows.reduce((sum, h) => sum + h, 0) + Math.max(0, factRows.length - 1) * GAP;
  const sideW = horizontal && primary && reviews.length ? 650 : width;
  const reviewW = sideW;
  font(ctx);
  const blocks: TextBlock[] = reviews.map((p) => { const lines = measureReviewText(ctx, p.value, reviewW - 32); return { ...p, lines }; });
  const blockHeight = (b: TextBlock): number => 38 + reviewTextHeight(b.lines);
  const reviewHeight = (): number => blocks.reduce((sum, b) => sum + blockHeight(b), 0) + Math.max(0, blocks.length - 1) * GAP;
  font(ctx, 24);
  const groupWidth = tagSources.length ? (sideW - (tagSources.length - 1) * 24) / tagSources.length : 0;
  const groupTop = rating ? 40 : 30;
  const tagGroups = tagSources.map((group, index) => {
    const lines = wrapCardText(ctx, group.values.join(" · "), groupWidth - 12);
    return { label: group.label, lines, x: index * (groupWidth + 24), y: groupTop, h: 26 + lines.length * 30 };
  });
  const tagsH = tagGroups.length ? groupTop + Math.max(...tagGroups.map((group) => group.h)) : rating ? 34 : 0;

  const addFacts = (top: number): void => {
    for (const cell of factCells) {
      const y = top + factRows.slice(0, cell.row).reduce((sum, h) => sum + h + GAP, 0);
      boxes.push({ kind: "fact", label: facts[cell.index].label, x: cell.x, y, w: cell.w, h: factRows[cell.row] });
    }
  };
  const addReview = (x: number, top: number): void => {
    if (tagsH) { boxes.push({ kind: "tags", x, y: top, w: sideW, h: tagsH }); top += tagsH + (blocks.length ? GAP : 0); }
    blocks.forEach((b) => { boxes.push({ kind: "review", label: b.label, x, y: top, w: reviewW, h: blockHeight(b) }); top += blockHeight(b) + GAP; });
  };
  const naturalPrintHeight = (w: number): number => primary ? w * primary.image.naturalHeight / primary.image.naturalWidth + 28 : 0;
  const addPrint = (x: number, top: number, w: number, maxHeight: number): number => {
    if (!primary) return 0;
    const h = Math.min(naturalPrintHeight(w), maxHeight);
    if (h < Math.min(naturalPrintHeight(w), 220)) throw new Error("These selections leave too little room for a readable screenshot. Turn off a review section or choose Horizontal.");
    // Fit sizes the actual frame to the source aspect ratio, not to unused canvas height.
    const frameW = opts.imageFit === "cover" ? w : Math.min(w, (h - 28) * primary.image.naturalWidth / primary.image.naturalHeight);
    boxes.push({ kind: "primary", label: `Print ${primary.index + 1}`, x: x + (w - frameW) / 2, y: top, w: frameW, h });
    return h;
  };

  if (horizontal) {
    if (factsH) { addFacts(y); y += factsH + GAP; }
    if (!blocks.length && tagsH) {
      boxes.push({ kind: "tags", x: pad, y, w: width, h: tagsH });
      y += tagsH + (primary ? GAP : 0);
    }
    const imageW = sideW < width ? width - sideW - 28 : width;
    const fullTextH = blocks.length ? tagsH + (tagsH ? GAP : 0) + reviewHeight() : 0;
    const imageMin = primary ? Math.min(naturalPrintHeight(imageW), 320) : 0;
    extendTo(y + Math.max(fullTextH, imageMin) + pad);
    if (primary) addPrint(pad, y, imageW, bottom - y);
    if (blocks.length) addReview(primary && sideW < width ? pad + width - sideW : pad, y);
  } else {
    const sectionCount = Number(!!primary) + Number(!!factsH) + Number(!!tagsH) + blocks.length;
    const gaps = Math.max(0, sectionCount - 1) * GAP;
    const fullTextH = factsH + tagsH + blocks.reduce((sum, b) => sum + blockHeight(b), 0) + gaps;
    const imageMin = primary ? Math.min(naturalPrintHeight(width), 320) : 0;
    // All selected text has its full measured budget before the screenshot receives space.
    extendTo(y + fullTextH + imageMin + pad);
    const imageH = primary ? Math.min(naturalPrintHeight(width), bottom - y - fullTextH) : 0;
    if (primary) y += addPrint(pad, y, width, imageH) + GAP;
    if (factsH) { addFacts(y); y += factsH + GAP; }
    addReview(pad, y);
  }

  if (horizontal) {
    // Balance the complete measured block; never inflate cards or stretch the image.
    const usedBottom = Math.max(...boxes.map((box) => box.y + box.h));
    const offset = Math.max(0, Math.round((bottom - usedBottom) / 2));
    boxes.forEach((box) => { box.y += offset; });
  }

  if (canvas.height > baseHeight) warnings.push(`${canvas.width} × ${canvas.height} · Height expanded to include all selected text.`);
  const ink = (value: string, x: number, top: number, size = BODY, color = colors.fg, weight = 500): void => {
    font(ctx, size, weight); ctx.fillStyle = color; ctx.fillText(value, x, top);
  };
  const surface = (b: CardBox): void => { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 12); ctx.fillStyle = colors.surface; ctx.fill(); if (!dark) { ctx.strokeStyle = colors.border; ctx.lineWidth = 1; ctx.stroke(); } };
  ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.textBaseline = "top";
  let headerY = boxes[0].y;
  headerRows.forEach((row, index) => {
    let x = pad;
    const occupied = row.reduce((sum, part) => sum + part.w, 0) + Math.max(0, row.length - 1) * 20;
    const metadataGap = row.length > 1 ? Math.max(0, width - occupied) : 0;
    for (const [partIndex, part] of row.entries()) {
      if (partIndex === 1) x += metadataGap;
      ink(part.value, x, headerY + (headerHeights[index] - 8 - part.size) / 2, part.size, part.weight === 700 ? colors.fg : colors.muted, part.weight);
      x += part.w + 20;
    }
    headerY += headerHeights[index] + 4;
  });
  let factIndex = 0;
  for (const box of boxes.slice(1)) {
    if (box.y + box.h > bottom + 0.5) throw new Error("Card content exceeds the available canvas. Reduce the selection.");
    if (box.kind === "fact") {
      const f = facts[factIndex]; surface(box);
      ink(f.label, box.x + 12, box.y + 9, LABEL, colors.muted);
      factLines[factIndex++].forEach((line, i) => ink(line, box.x + 12, box.y + 36 + i * 32, 28, toneColor(f.tone), 650));
    } else if (box.kind === "review") {
      const b = blocks.find((v) => v.label === box.label)!;
      surface(box); ink(b.label, box.x + 16, box.y + 6, LABEL, colors.muted, 650);
      drawReviewText(ctx, b.lines, box.x + 16, box.y + 34, box.w - 32, colors.fg);
    } else if (box.kind === "tags") {
      if (hasTags) ink("Tags", box.x, box.y + 4, LABEL, colors.muted);
      if (rating) {
        const x = hasTags ? box.x + box.w - 270 : box.x;
        ink("Self-rating", x, box.y + 4, LABEL, colors.muted);
        ink(`${"★".repeat(rating)}${"☆".repeat(5 - rating)}`, x + 128, box.y, 28, colors.gold);
      }
      for (const group of tagGroups) {
        const x = box.x + group.x;
        const top = box.y + group.y;
        ink(group.label, x, top, LABEL, colors.muted, 650);
        group.lines.forEach((line, i) => ink(line, x, top + 26 + i * 30, 24, colors.fg));
      }
    } else if (box.kind === "primary") {
      const p = primary!;
      ink(box.label!, box.x, box.y, LABEL, colors.muted, 650);
      const area = { ...box, y: box.y + 28, h: box.h - 28 };
      surface(area);
      const fit = opts.imageFit === "cover" ? Math.max : Math.min;
      const scale = fit(area.w / p.image.naturalWidth, area.h / p.image.naturalHeight);
      const w = p.image.naturalWidth * scale; const h = p.image.naturalHeight * scale;
      ctx.save(); ctx.beginPath(); ctx.roundRect(area.x, area.y, area.w, area.h, 12); ctx.clip();
      ctx.drawImage(p.image, area.x + (area.w - w) / 2, area.y + (area.h - h) / 2, w, h);
      ctx.restore();
    }
  }
  return { canvas, boxes, warnings };
}
