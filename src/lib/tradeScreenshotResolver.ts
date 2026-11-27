import { App, TFile } from "obsidian";
import type { PrintEntry, Trade } from "../types";

/** Minimal host contract shared by every TradeBook surface that renders prints. */
export interface TradeScreenshotHost {
  app: App;
  attachmentCandidates(target: string, date?: string): string[];
  getTradesFolder?(): string;
}

type ScreenshotTrade = Pick<Trade, "id" | "date" | "screenshot" | "screenshots">;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "tif", "tiff", "heic", "heif"]);
const EXACT_PRINT_SLOT = /^ print(?: [1-9]\d*)?(?:-annotated)?\.(?:png|jpe?g|webp|gif|bmp|svg|avif|tiff?)$/i;

function targetOf(link: string): string {
  const inner = link.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
  return inner.split("|")[0].split("#")[0].trim();
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}

/** Compare trade filename identity across supported date formats and collisions. */
function sameTradePrintBase(targetBase: string, noteBase: string, date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [, year, month, day] = match;
  const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
  const datePrefixes = [
    `${year}-${month}-${day}`,
    `${day}-${month}-${year}`,
    `${month}-${day}-${year}`,
    `${Number(day)} ${monthName} ${year}`,
  ];
  const suffixFor = (base: string): string | null => {
    const prefix = datePrefixes.find((candidate) => base.startsWith(`${candidate} `));
    if (!prefix) return null;
    return base.slice(prefix.length).trim();
  };
  const targetIdentity = suffixFor(targetBase);
  const noteIdentity = suffixFor(noteBase);
  return !!targetIdentity && !!noteIdentity && targetIdentity === noteIdentity;
}

function imageFile(host: TradeScreenshotHost, path: string): TFile | null {
  try {
    const file = host.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile && IMAGE_EXTENSIONS.has((file.extension || "").toLowerCase())) return file;
  } catch {
    // A stale or malformed link is expected; continue to the next resolver.
  }
  return null;
}

/**
 * Return structured print entries when present, otherwise split the legacy
 * scalar. Source indices remain stable so Detail can reorder/remove entries.
 */
export function tradeScreenshotEntries(trade: ScreenshotTrade): Array<{ entry: PrintEntry; sourceIndex: number }> {
  const shots = trade.screenshots ?? [];
  const structured = shots
    .map((entry, sourceIndex) => ({ entry, sourceIndex }))
    .filter(({ entry }) => !!entry && typeof entry.file === "string" && entry.file.trim() !== "");
  if (structured.length) return structured;

  const legacy = (trade.screenshot || "").trim();
  if (!legacy || legacy.toLowerCase() === "added") return [];
  return legacy.split(/[,;\n]+/).map((file) => file.trim()).filter(Boolean)
    .map((file, offset) => ({ entry: { file }, sourceIndex: shots.length + offset }));
}

/**
 * Resolve a screenshot consistently across Detail, Modal, and table surfaces.
 * Stale paths recover only when their exact print slot exists under the
 * current trade note's own basename; no prefix-only matching is used.
 */
export function resolveTradeScreenshotFile(
  host: TradeScreenshotHost,
  trade: ScreenshotTrade,
  link: string,
): TFile | null {
  const raw = (link || "").trim();
  if (!raw) return null;
  const target = targetOf(raw);
  if (!target) return null;
  // Resolve explicit paths as written, but do not let the host's basename
  // attachment search associate a bare legacy name with another trade's file.
  const candidates = [raw, target];
  const targetName = fileNameOf(target);
  const looksLikePrintSlot = / print(?: [1-9]\d*)?(?:-annotated)?\.[^.]+$/i.test(targetName);
  const explicitPath = target.includes("/") || target.includes("\\");
  if (explicitPath || !looksLikePrintSlot) {
    candidates.push(...host.attachmentCandidates(target, trade.date));
  }
  const tradesFolder = host.getTradesFolder?.();
  if (tradesFolder && explicitPath) candidates.push(`${tradesFolder}/${target}`);
  for (const candidate of candidates) {
    const found = imageFile(host, candidate);
    if (found) return found;
  }

  try {
    const found = host.app.metadataCache.getFirstLinkpathDest(target, trade.id || "");
    if (found instanceof TFile && IMAGE_EXTENSIONS.has((found.extension || "").toLowerCase())) return found;
  } catch {
    // Metadata cache can be empty during startup.
  }

  const noteBase = fileNameOf(trade.id).replace(/\.md$/i, "");
  const printAt = targetName.lastIndexOf(" print ");
  const printSuffix = printAt > 0 ? targetName.slice(printAt) : "";
  // The note's own stable basename plus an exact print slot is a stronger
  // ownership key than the legacy scalar path: that path may be stale from the
  // same date-format/collision rename this fallback is repairing. Never search
  // by prefix or slot alone; construct one exact expected filename instead.
  if (printSuffix && EXACT_PRINT_SLOT.test(printSuffix) &&
      sameTradePrintBase(targetName.slice(0, printAt), noteBase, trade.date)) {
    const exactTradeSlot = `${noteBase}${printSuffix}`;
    for (const candidate of host.attachmentCandidates(exactTradeSlot, trade.date)) {
      const found = imageFile(host, candidate);
      if (found) return found;
    }
  }

  return null;
}

export function resolveFirstTradeScreenshot(host: TradeScreenshotHost, trade: ScreenshotTrade): TFile | null {
  const first = tradeScreenshotEntries(trade)[0]?.entry.file;
  return first ? resolveTradeScreenshotFile(host, trade, first) : null;
}
