import type { Trade, TradeFill } from "../types";
import { knownFuturesSpec } from "../futures";
import { applyFillsToTrade, compareFills, entrySide, fillSet } from "./fills";

export interface ManualExitFillInput {
  quantity: number;
  price: number;
  /** Wall-clock time recorded by the trader, normalized to HH:MM:SS. */
  time: string;
  /** Present when the exit was pinned in the journal's time zone. */
  instant?: string;
  exitType?: TradeFill["exitType"];
}

export type ManualExitFillResult = { ok: true; trade: Trade } | { ok: false; error: string };

export function isManualClock(value: string): boolean {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3]) < 60;
}

/**
 * Turn multiple manual, completed exits into the same execution ledger used by
 * imports and trade detail. The row quantities must close the full position;
 * each row must carry a time so TP ordering is based on what happened.
 */
export function buildManualExitFills(trade: Trade, exits: readonly ManualExitFillInput[], allowSingle = false): ManualExitFillResult {
  if (!Number.isSafeInteger(trade.quantity) || trade.quantity < (allowSingle ? 1 : 2)) {
    return { ok: false, error: "A multiple-exit trade needs at least two whole contracts." };
  }
  if (!(Number.isFinite(trade.entryPrice) && trade.entryPrice > 0)) {
    return { ok: false, error: "Enter a valid entry price before adding actual exits." };
  }
  if (!isManualClock(String(trade.entryTime ?? ""))) {
    return { ok: false, error: "Enter a valid entry time so the exit sequence can be recorded accurately." };
  }
  if (exits.length < (allowSingle ? 1 : 2)) {
    return { ok: false, error: "Add at least two actual exits to use multiple-exit tracking." };
  }
  if (exits.length > trade.quantity) {
    return { ok: false, error: "Each exit needs at least one contract; there are more exit rows than contracts." };
  }
  if (exits.some((exit) => !Number.isSafeInteger(exit.quantity) || exit.quantity <= 0)) {
    return { ok: false, error: "Enter a whole-contract quantity for every actual exit." };
  }
  if (exits.some((exit) => !Number.isFinite(exit.price) || exit.price <= 0)) {
    return { ok: false, error: "Enter a valid price for every actual exit." };
  }
  if (exits.some((exit) => !isManualClock(String(exit.time ?? "")))) {
    return { ok: false, error: "Enter a valid time for every actual exit." };
  }

  const exitQuantity = exits.reduce((sum, exit) => sum + exit.quantity, 0);
  if (exitQuantity !== trade.quantity) {
    return {
      ok: false,
      error: `Exit quantities total ${exitQuantity}; they must equal the trade quantity of ${trade.quantity}.`,
    };
  }

  const hasPinnedEntry = Boolean(trade.entryInstant);
  const hasPinnedExits = exits.every((exit) => Boolean(exit.instant));
  if ((hasPinnedEntry || exits.some((exit) => exit.instant)) && !(hasPinnedEntry && hasPinnedExits)) {
    return { ok: false, error: "The entry and every exit must use the same complete time-zone pin." };
  }
  if (!hasPinnedEntry && exits.some((exit) => exit.time < trade.entryTime)) {
    return { ok: false, error: "These exits cross midnight; set the journal time zone before saving their sequence." };
  }

  if (exits.some((exit) => exit.exitType === "be" && exit.price !== trade.entryPrice)) {
    return { ok: false, error: "A BE exit must close at the actual entry price." };
  }
  const previous = fillSet(trade);
  const entry: TradeFill = {
    ...(previous.explicit && previous.entries.length === 1 ? previous.entries[0] : {}),
    side: entrySide(trade),
    time: trade.entryTime,
    qty: trade.quantity,
    price: trade.entryPrice,
  };
  if (trade.entryInstant) entry.instant = trade.entryInstant;
  else delete entry.instant;

  const spec = knownFuturesSpec(trade.symbol || "");
  const exitSide = entry.side === "buy" ? "sell" : "buy";
  const exitFills: TradeFill[] = exits.map((exit, index) => {
    const fill: TradeFill = {
      ...(previous.explicit ? previous.exits[index] : {}),
      side: exitSide,
      time: exit.time,
      qty: exit.quantity,
      price: exit.price,
    };
    if (exit.instant) fill.instant = exit.instant; else delete fill.instant;
    delete fill.exitType; delete fill.exitTypeSource;
    if (exit.exitType) { fill.exitType = exit.exitType; fill.exitTypeSource = "manual"; }
    if (!spec) delete fill.pnl;
    if (spec) {
      const points = trade.direction === "long" ? exit.price - trade.entryPrice : trade.entryPrice - exit.price;
      fill.pnl = Math.round(points * spec.pointValue * exit.quantity * 100) / 100;
    }
    return fill;
  });

  const updated: Trade = { ...trade, fills: [entry, ...exitFills].sort(compareFills) };
  const set = fillSet(updated);
  updated.fills = set.fills;
  applyFillsToTrade(updated);
  // `applyFillsToTrade` intentionally avoids replacing empty scalar times on
  // older notes. This is a new manual record, so its fill ledger is authoritative.
  updated.entryTime = set.entries[0]?.time ?? "";
  const lastExit = set.exits[set.exits.length - 1];
  updated.exitTime = lastExit?.time ?? "";
  if (lastExit?.instant) updated.exitInstant = lastExit.instant;
  else delete updated.exitInstant;
  if (!spec) {
    updated.pnl = Number.NaN;
    updated.pnlPoints = Number.NaN;
  }
  return { ok: true, trade: updated };
}
