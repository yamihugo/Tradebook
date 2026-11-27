import type { Trade, TradeExecutionSnapshot, TradeFill } from "../types";
import { knownFuturesSpec } from "../futures";
import { isCivilDate, isCivilTime, instantFromWall } from "./instant";
import { applyFillsToTrade, compareFills, entrySide, fillSet } from "./fills";

/** One draft row, tied to its original saved row until it is persisted. */
export interface ExecutionEditCandidate {
  originalIndex?: number;
  fill: TradeFill;
}

function normalizedClock(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!isCivilTime(text)) throw new Error("Enter a valid execution time.");
  const [hour, minute, second = "0"] = text.split(":");
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function correctionInstantSource(trade: Trade, explicitJournalZone: string): "source-zone" | "journal-zone" {
  if (explicitJournalZone) return "journal-zone";
  if (trade.timezone && trade.timezone !== trade.sourceZone) return "journal-zone";
  return trade.sourceZone ? "source-zone" : "journal-zone";
}

function correctedInstant(
  trade: Trade,
  fill: TradeFill,
  previous: TradeFill | undefined,
  zone: string,
  explicitJournalZone: string,
): TradeFill {
  const date = fill.date ?? "";
  const time = fill.time ?? "";
  if (previous && previous.date === date && previous.time === time && previous.instant) {
    return { ...fill, instant: previous.instant };
  }
  if (!zone) {
    const { instant: _discardedInstant, ...wallClockOnly } = fill;
    return wallClockOnly;
  }
  const resolution = instantFromWall(date, time, zone, correctionInstantSource(trade, explicitJournalZone));
  if (resolution.status !== "ok") {
    throw new Error("This execution time is invalid or ambiguous in the recorded timezone; no instant was guessed.");
  }
  return { ...fill, instant: resolution.iso };
}

/** Capture the pre-correction execution facts for an auditable manual correction. */
export function executionSnapshot(trade: Trade): TradeExecutionSnapshot {
  const side = entrySide(trade);
  const fills = fillSet(trade).fills.map((fill) => ({
    ...fill,
    date: fill.date ?? (fill.side === side ? trade.date : trade.exitDate ?? trade.date),
  }));
  return {
    date: trade.date,
    direction: trade.direction,
    ...(trade.exitDate ? { exitDate: trade.exitDate } : {}),
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    quantity: Number.isFinite(trade.quantity) ? trade.quantity : undefined,
    entryPrice: Number.isFinite(trade.entryPrice) ? trade.entryPrice : undefined,
    exitPrice: Number.isFinite(trade.exitPrice) ? trade.exitPrice : undefined,
    pnl: Number.isFinite(trade.pnl) ? trade.pnl : undefined,
    pnlPoints: Number.isFinite(trade.pnlPoints) ? trade.pnlPoints : undefined,
    ...(trade.entryInstant ? { entryInstant: trade.entryInstant } : {}),
    ...(trade.exitInstant ? { exitInstant: trade.exitInstant } : {}),
    fills,
  };
}

/**
 * Validate and apply corrected civil dates, clocks, sides, quantities and prices.
 * Existing fill provenance is retained; draft rows use their original index
 * when no broker fill ID exists, and new rows are treated as manual fills.
 */
export function applyExecutionEdits(
  trade: Trade,
  proposed: Array<TradeFill | ExecutionEditCandidate>,
  journalZone = "",
): Trade {
  if (trade.isCopiedTrade || trade.dataSource === "reconstructed" || trade.supersededBy) {
    throw new Error("Reconstructed or superseded model executions cannot be edited; correct the original actual trade instead.");
  }
  if (!Array.isArray(proposed) || proposed.length === 0) throw new Error("At least one execution is required.");
  const candidates: ExecutionEditCandidate[] = proposed.map((item) =>
    "fill" in item ? item : { fill: item },
  );

  const current = fillSet(trade);
  const originalById = new Map<string, { fill: TradeFill; index: number }>();
  current.fills.forEach((fill, index) => {
    if (!fill.fillId) return;
    if (originalById.has(fill.fillId)) throw new Error("Duplicate fill IDs prevent a safe execution edit.");
    originalById.set(fill.fillId, { fill, index });
  });

  const used = new Set<number>();
  const originalIndexByFill = new Map<TradeFill, number>();
  const explicitJournalZone = journalZone.trim();
  const zone = explicitJournalZone || trade.timezone || trade.sourceZone || "";
  const spec = knownFuturesSpec(trade.symbol || "");
  let requiresPnlRecalculation = false;

  const fills = candidates.map(({ fill: candidate, originalIndex: requestedIndex }, index): TradeFill => {
    let original: TradeFill | undefined;
    let originalIndex = -1;
    if (requestedIndex !== undefined) {
      if (!Number.isInteger(requestedIndex) || requestedIndex < 0 || requestedIndex >= current.fills.length) {
        throw new Error("Execution row identity is invalid; reopen the trade before editing.");
      }
      original = current.fills[requestedIndex];
      if (candidate.fillId !== undefined && candidate.fillId !== original.fillId) {
        throw new Error("Imported fill identity cannot be changed or invented.");
      }
      originalIndex = requestedIndex;
    } else if (candidate.fillId) {
      const match = originalById.get(candidate.fillId);
      if (!match) throw new Error("Imported fill identity cannot be changed or invented.");
      original = match.fill;
      originalIndex = match.index;
    } else if (index < current.fills.length && !current.fills[index].fillId && current.fills[index].side === candidate.side) {
      original = current.fills[index];
      originalIndex = index;
    }

    if (originalIndex >= 0) {
      if (used.has(originalIndex)) throw new Error("An execution row was submitted more than once.");
      used.add(originalIndex);
    } else if (candidate.fillId || candidate.orderType || Number.isFinite(candidate.fees) || candidate.exitType || candidate.exitTypeSource) {
      throw new Error("New executions cannot claim imported fill metadata.");
    }

    const side = candidate.side;
    if (side !== "buy" && side !== "sell") throw new Error("Choose buy or sell for each execution.");
    const date = typeof candidate.date === "string" ? candidate.date.trim() : "";
    if (!isCivilDate(date)) throw new Error("Enter a valid date for every execution.");
    const time = normalizedClock(candidate.time);
    const qty = Number(candidate.qty);
    const price = Number(candidate.price);
    if (!(Number.isFinite(qty) && qty > 0)) throw new Error("Enter a quantity greater than zero for every execution.");
    if (spec && !Number.isSafeInteger(qty)) throw new Error("Futures execution quantities must be whole contracts.");
    if (!Number.isFinite(price)) throw new Error("Enter a finite price for every execution.");

    if (!original || candidate.side !== original.side || qty !== original.qty || price !== original.price) {
      requiresPnlRecalculation = true;
    }
    const base: TradeFill = original ? { ...original } : { side, date, time, qty, price };
    const corrected = correctedInstant(trade, { ...base, side, date, time, qty, price }, original, zone, explicitJournalZone);
    if (originalIndex >= 0) originalIndexByFill.set(corrected, originalIndex);
    return corrected;
  });

  if (used.size !== current.fills.length) {
    throw new Error("Existing executions cannot be removed from this correction; set their actual quantity instead.");
  }

  const anchorIndex = current.fills.findIndex((fill) => fill.side === entrySide(trade));
  const anchor = fills.find((fill) => originalIndexByFill.get(fill) === anchorIndex);
  const direction: Trade["direction"] = anchor ? (anchor.side === "buy" ? "long" : "short") : trade.direction;
  if (direction !== trade.direction) requiresPnlRecalculation = true;
  const entry = direction === "long" ? "buy" : "sell";
  const ordered = fills.slice().sort(compareFills);
  if (ordered.some((fill, index) => originalIndexByFill.get(fill) !== index)) {
    requiresPnlRecalculation = true;
  }
  let open = 0;
  const lots: Array<{ qty: number; price: number }> = [];
  for (const fill of ordered) {
    if (fill.side === entry) {
      if (requiresPnlRecalculation) delete fill.pnl;
      open += fill.qty;
      lots.push({ qty: fill.qty, price: fill.price });
      continue;
    }
    if (fill.qty > open + 1e-9) throw new Error("An exit cannot close more contracts than have entered.");
    if (requiresPnlRecalculation) {
      if (!spec) throw new Error("Execution order, price, or quantity edits need a known contract point value to recalculate P&L.");
      let remaining = fill.qty;
      let realized = 0;
      while (remaining > 1e-9) {
        const lot = lots[0];
        if (!lot) throw new Error("An exit cannot close more contracts than have entered.");
        const matched = Math.min(remaining, lot.qty);
        const movement = direction === "long" ? fill.price - lot.price : lot.price - fill.price;
        realized += movement * spec.pointValue * matched;
        remaining -= matched;
        lot.qty -= matched;
        if (lot.qty <= 1e-9) lots.shift();
      }
      fill.pnl = money(realized);
    }
    open -= fill.qty;
  }

  const updated: Trade = { ...trade, direction, fills };
  applyFillsToTrade(updated);
  const result = fillSet(updated);
  if (result.exits.length === 0) {
    updated.exitPrice = 0;
    updated.exitTime = "";
    delete updated.exitDate;
    delete updated.exitInstant;
    updated.pnl = Number.NaN;
    updated.pnlPoints = Number.NaN;
  }
  if (zone && fills.every((fill) => !!fill.instant)) {
    updated.timezone = zone;
    updated.instantSource = correctionInstantSource(trade, explicitJournalZone);
    delete updated.timeUnresolved;
  }
  if (!requiresPnlRecalculation && result.exits.length > 0) {
    updated.pnl = trade.pnl;
    updated.pnlPoints = trade.pnlPoints;
  }
  return updated;
}
