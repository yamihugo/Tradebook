// Shared trade table — the ledger used by the Trade Log page and by the trades
// widget inside an account page. One recipe, so the two can never drift apart.
//
// The shape was chosen from a browser preview (docs/tradelog-previews-2.html):
// a timeline rail with one dot per trade, the day as a real separator carrying its
// own net, columns aligned so figures can be compared straight down the page, and a
// review column that only speaks when something is waiting.

import { TFile } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade, TradeFill } from "../types";
import { fmtMoney, fmtMoneyAbs, fmtPrice } from "../tz";
import { formatDate } from "./dates";
import { reviewStatus } from "./review";
import { attachTip } from "./tip";
import { futuresSpec } from "../futures";
import { fillIndex, fillLabel, fillSet, FillSet, toneClass } from "./fills";
import { legBaseKey } from "./copy";

/** Number → word for small counts (1–20). Falls back to digits for 21+. */
function accountWords(n: number): string {
  const w = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty",
  ];
  return n >= 0 && n <= 20 ? w[n] : String(n);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * How long a trade was held: `15s`, `1m 30s`, `1h 5m`, `2h 4m 9s`. Times are
 * read as wall clock; an exit earlier than the entry wrapped past midnight.
 * Empty times (older notes have none) read as an em dash, never as midnight.
 */
export function holdFmt(entryTime?: string, exitTime?: string): string {
  const seconds = heldSeconds(entryTime, exitTime);
  if (seconds === null) return "—";
  const diff = seconds;
  if (diff < 60) return `${diff}s`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return s ? `${h}h ${m}m ${s}s` : m ? `${h}h ${m}m` : `${h}h`;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Parse a wall-clock HH:MM(:SS) into seconds since midnight (null when absent). */
function secondsOf(v?: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec((v ?? "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0);
}

/** How long a trade was held, in seconds (null when a time is missing). */
function heldSeconds(entryTime?: string, exitTime?: string): number | null {
  const a = secondsOf(entryTime);
  const b = secondsOf(exitTime);
  if (a === null || b === null) return null;
  const diff = b >= a ? b - a : b + 86400 - a;
  return diff > 0 ? diff : null;
}

/**
 * How long a trade was held, in minutes — the number a filter buckets on.
 * Null (missing, never zero) when either time is absent, so a trade without
 * times is "no time", not a scalp.
 */
export function holdMinutes(entryTime?: string, exitTime?: string): number | null {
  const s = heldSeconds(entryTime, exitTime);
  return s === null ? null : s / 60;
}

/**
 * The R multiple of a trade: profit over the risk actually taken
 * (entry to stop, in money). Null when there is no stop to measure against —
 * a missing value must read as missing, never as zero.
 */
export function tradeR(t: Trade): number | null {
  if (!t.stopLoss || !t.entryPrice) return null;
  const risk = Math.abs(t.entryPrice - t.stopLoss) * futuresSpec(t.symbol).pointValue * (t.quantity || 1);
  return risk > 0 ? t.pnl / risk : null;
}

/** The first print attached to a trade, as a resource URL (null when there is none). */
export function shotUrl(plugin: TradebookPlugin, t: Trade): string | null {
  const raw = (t.screenshot || "").trim();
  if (!raw || raw.toLowerCase() === "added") return null;
  const first = raw.split(/[,;\n]+/)[0].trim();
  const inner = first.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const target = inner.split("|")[0].split("#")[0].trim();
  const folder = plugin.getTradesFolder();
  const candidates = [first, target, `${folder}/prints/${target}`, `${folder}/${target}`];
  for (const c of candidates) {
    try {
      const f = plugin.app.vault.getAbstractFileByPath(c);
      if (f instanceof TFile) return plugin.app.vault.getResourcePath(f);
    } catch {
      /* the path may simply not exist */
    }
  }
  try {
    const f = plugin.app.metadataCache.getFirstLinkpathDest(target, t.id || "");
    if (f instanceof TFile) return plugin.app.vault.getResourcePath(f);
  } catch {
    /* metadata cache can be empty during startup */
  }
  return null;
}

export interface TradeColumn {
  id: string;
  label: string;
  /** Header caption when the rows are grouped by day — the date is already above. */
  groupedLabel?: string;
  align: "left" | "right";
  render: (td: HTMLElement, t: Trade, plugin: TradebookPlugin, ctx: TradeColumnCtx) => void;
  /**
   * What a click on this header sorts by. Missing numbers (no stop, no times,
   * no rating) sort last in both directions: "we do not know" is not "zero".
   */
  sortValue?: (t: Trade, plugin: TradebookPlugin) => number | string | null;
  /**
   * The direction the first click gives. Text reads A→Z; money, size and time
   * read biggest/newest first; the date starts the other way because the list
   * already shows newest first and a click has to visibly change something.
   */
  firstDir?: "asc" | "desc";
}

/** The column a table is sorted by, if any. */
export interface TradeSort {
  id: string;
  dir: "asc" | "desc";
}

/**
 * One row of the ledger: a logical trade, with every account it reached. A
 * trade copied into five accounts is one decision and five records — the ledger
 * shows the decision, and says how many accounts it landed in.
 */
export interface TradeRow {
  key: string;
  /** The record the row reads from: the original note whenever it is here. */
  rep: Trade;
  /** Every record of this trade: the original plus its copies. */
  legs: Trade[];
  /** What the trade actually made across all of them. */
  money: number;
}

/**
 * Fold the flat list into logical trades. Records share a `copyBaseKey` when one
 * is a copy of the other; anything without one is a trade of its own.
 */
export function tradeRows(trades: Trade[]): TradeRow[] {
  const map = new Map<string, TradeRow>();
  for (const t of trades) {
    const key = legBaseKey(t);
    const row = map.get(key);
    if (!row) {
      map.set(key, { key, rep: t, legs: [t], money: Number.isFinite(t.pnl) ? t.pnl : 0 });
      continue;
    }
    row.legs.push(t);
    row.money += Number.isFinite(t.pnl) ? t.pnl : 0;
    // The original note wins the row: it is the one with the screenshot, the
    // review and the file on disk. Copies only stand in when it is not loaded.
    if (row.rep.isCopiedTrade && !t.isCopiedTrade) row.rep = t;
  }
  return [...map.values()];
}

/** What a cell renderer may need beyond the trade itself. */
export interface TradeColumnCtx {
  plugin: TradebookPlugin;
  /** Trade ids whose executions are on screen. */
  expanded: Set<string>;
  toggleFills: (t: Trade) => void;
  /** Absent in read-only tables, which then draw their own label instead. */
  onToggleReviewed?: (t: Trade, next: boolean) => void;
  /** Every record behind this row, when the ledger is folding copies. */
  row?: TradeRow;
  /** True when the table is grouping by day. Columns that show the date can
   *  use this to suppress the date portion and show only the time. */
  groupByDay?: boolean;
}

/** Every column the ledger can show, in the order the picker offers them. */
export const TRADE_COLUMNS: TradeColumn[] = [
  {
    id: "image",
    label: "Print",
    align: "left",
    // A thumbnail in a table shows nothing at 44px and steals the width of a
    // column. The ledger only needs to answer one question — is there a print? —
    // and the print itself belongs to the trade page.
    sortValue: (t, plugin) => (shotUrl(plugin, t) ? 1 : 0),
    firstDir: "desc",
    render: (td, t, plugin) => {
      const has = !!shotUrl(plugin, t);
      const span = td.createSpan({ cls: "tj-tbl-print" + (has ? " is-on" : "") });
      span.setText(has ? "✓" : "—");
      attachTip(span, has
        ? { title: "Has a print", sub: "Open the trade to see it." }
        : { title: "No print yet", sub: "Drop one on the trade page and this turns into a tick." });
    },
  },
  {
    id: "date",
    label: "Time",
    align: "left",
    sortValue: (t) => `${t.date}${t.entryTime ?? ""}`,
    firstDir: "asc",
    render: (td, t, plugin, ctx) => {
      const time = (t.entryTime || "").trim();
      // No time recorded (imported fills have none): show a dash. An empty cell
      // reads as if the column were missing, and the eye then pairs the symbol
      // with the time header.
      if (!time) {
        td.setText("—");
        return;
      }
      td.setText(ctx.groupByDay ? time : `${formatDate(t.date, plugin.settings.dateFormat)} ${time}`.trim());
    },
  },
  {
    id: "symbol",
    label: "Symbol",
    align: "left",
    sortValue: (t) => t.symbol || "",
    firstDir: "asc",
    render: (td, t) => td.createSpan({ cls: "tj-tbl-sym", text: t.symbol }),
  },
  {
    id: "side",
    label: "Side",
    align: "left",
    sortValue: (t) => t.direction || "",
    firstDir: "asc",
    render: (td, t, plugin) => {
      const long = t.direction === "long";
      const mode = (plugin.settings.tradeLog ?? {}).sideDisplay ?? "arrows";
      if (mode === "letters") {
        td.createSpan({ cls: "tj-tbl-side " + (long ? "long" : "short"), text: long ? "LONG" : "SHORT" });
      } else {
        const mark = td.createSpan({ cls: "tj-tbl-side " + (long ? "long" : "short"), text: long ? "▲" : "▼" });
        mark.setAttr("aria-label", long ? "Long" : "Short");
      }
    },
  },
  {
    id: "qty",
    label: "Qty",
    align: "right",
    sortValue: (t) => (Number.isFinite(t.quantity) ? t.quantity : null),
    firstDir: "desc",
    render: (td, t, plugin, ctx) => {
      const set = fillSet(t);
      if (set.openQty > 0 && set.entryQty > 0) {
        // Half the position is still on: say what is left, and let the P&L carry
        // its own asterisk further along the row.
        const span = td.createSpan({ cls: "tj-tbl-qty-partial" });
        span.createSpan({ text: String(set.exitQty) });
        span.createSpan({ cls: "tj-tbl-qty-total", text: `/${set.entryQty}` });
        attachTip(span, {
          title: `${set.exitQty} of ${set.entryQty} closed`,
          sub: "The part still open counts nowhere until it is closed.",
        });
      } else {
        td.setText(Number.isFinite(t.quantity) && t.quantity > 0 ? String(t.quantity) : "—");
      }
      if (!set.isMulti) return;
      // The only thing a scaled trade adds to the row: a badge that opens it.
      const open = ctx.expanded.has(t.id);
      const badge = td.createEl("button", { cls: "tj-tbl-fills", attr: { type: "button" } });
      badge.createSpan({ cls: "tj-tbl-fills-ico", text: "⋔" });
      badge.createSpan({ cls: "tj-tbl-fills-t", text: `${set.fills.length} fills` });
      badge.createSpan({ cls: "tj-tbl-fills-chev", text: open ? "⌃" : "⌄" });
      attachTip(badge, {
        title: `${set.entries.length} in · ${set.exits.length} out`,
        sub: set.exits.length > 1 ? "Every take profit, with its own P&L." : "Every fill, with its own price.",
      });
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.toggleFills(t);
      });
    },
  },
  {
    id: "points",
    label: "Points",
    align: "right",
    sortValue: (t) => (Number.isFinite(t.pnlPoints) ? t.pnlPoints : null),
    firstDir: "desc",
    render: (td, t) => {
      const pts = t.pnlPoints;
      if (!Number.isFinite(pts)) { td.setText("—"); return; }
      td.setText(`${pts >= 0 ? "+" : ""}${pts} pts`);
    },
  },
  {
    id: "entryexit",
    label: "Entry → Exit",
    align: "left",
    sortValue: (t) => (Number.isFinite(t.entryPrice) ? t.entryPrice : null),
    firstDir: "asc",
    render: (td, t) => {
      // Kept tight on purpose: two prices side by side read as one movement, and
      // spreading them across the column made them look like two numbers.
      const pair = td.createSpan({ cls: "tj-tbl-pair" });
      pair.createSpan({ text: fmtPrice(t.entryPrice) });
      pair.createSpan({ cls: "tj-tbl-arrow", text: "→" });
      pair.createSpan({ text: fmtPrice(t.exitPrice) });
    },
  },
  {
    id: "hold",
    label: "Hold",
    align: "right",
    sortValue: (t) => heldSeconds(t.entryTime, t.exitTime),
    firstDir: "desc",
    render: (td, t) => td.setText(holdFmt(t.entryTime, t.exitTime)),
  },
  {
    id: "r",
    label: "R",
    align: "right",
    sortValue: (t) => tradeR(t),
    firstDir: "desc",
    render: (td, t) => {
      const r = tradeR(t);
      if (r === null) {
        td.setText("—");
        return;
      }
      td.addClass(r >= 0 ? "tj-pos" : "tj-neg");
      td.setText(`${r >= 0 ? "+" : ""}${r.toFixed(2)}R`);
    },
  },
  {
    id: "pnl",
    label: "P&L",
    align: "right",
    sortValue: (t) => (Number.isFinite(t.pnl) ? t.pnl : null),
    firstDir: "desc",
    render: (td, t, _plugin, ctx) => {
      // Money is what the trade made in every account it reached: the row sums
      // its records so the day total above it adds up exactly.
      const money = ctx.row ? ctx.row.money : t.pnl;
      td.addClass("tj-tbl-pnl");
      // A trade that nets exactly zero is neither a win nor a loss: it gets no
      // colour at all. A trade that took TP1 and TP2 and left the rest flat nets
      // positive, so it stays a win — the ledger never calls that break-even.
      td.addClass(toneClass(money));
      // Flat money is written without a sign: "+$0" reads like a gain.
      td.setText(money === 0 ? fmtMoneyAbs(0) : fmtMoney(money));
      const set = fillSet(t);
      if (set.openQty > 0) {
        const star = td.createSpan({ cls: "tj-tbl-pnl-partial", text: "*" });
        attachTip(star, {
          title: "Realised so far",
          sub: `${set.openQty} of ${set.entryQty} contracts are still open — they count when they close.`,
        });
      }
    },
  },
  {
    id: "setup",
    label: "Strategy",
    align: "left",
    sortValue: (t) => t.setup || "",
    firstDir: "asc",
    render: (td, t) => td.setText(t.setup || "—"),
  },
  {
    id: "account",
    label: "Accounts",
    align: "left",
    sortValue: (t, plugin) => plugin.displayAccount(t.account) || "",
    firstDir: "asc",
    render: (td, t, plugin, ctx) => {
      const legs = ctx.row?.legs ?? [t];
      const n = legs.length;
      const label = n === 1 ? "one account" : accountWords(n) + " accounts";
      if (n < 2) {
        td.setText(label);
        return;
      }
      const chip = td.createSpan({ cls: "tj-tbl-accs", text: label });
      attachTip(chip, {
        title: `Copied to ${n} accounts`,
        sub: legs
          .map((l) => `${plugin.displayAccount(l.account) || "—"} · ${fmtMoney(l.pnl)}`)
          .join("\n"),
      });
    },
  },
  {
    id: "stars",
    label: "Rating",
    align: "left",
    sortValue: (t) => ((t.rating ?? 0) > 0 ? (t.rating as number) : null),
    firstDir: "desc",
    render: (td, t) => {
      const r = t.rating ?? 0;
      if (r <= 0) {
        td.setText("—");
        return;
      }
      const span = td.createSpan({ cls: "tj-tbl-stars", text: "★".repeat(Math.min(5, Math.round(r))) });
      attachTip(span, { title: `${r}/5`, sub: "Your execution rating for this trade." });
    },
  },
  {
    id: "review",
    label: "Review",
    align: "left",
    sortValue: (t) => {
      const rs = reviewStatus(t);
      return rs.total ? rs.done / rs.total : 0;
    },
    firstDir: "asc",
    render: (td, t, _plugin, ctx) => {
      const rs = reviewStatus(t);
      if (!ctx.onToggleReviewed) {
        // Read-only tables still get the sentence: it is the only thing they can say.
        if (rs.complete) return;
        const span = td.createSpan({ cls: "tj-tbl-review", text: "Needs review" });
        attachTip(span, { title: "Not reviewed yet", sub: `Still missing: ${rs.missing.join(", ")}.` });
        return;
      }
      // The review loop is: read the row, tick it, move on. Making that a trip to
      // the bulk bar (or the trade page) is what kept the queue from ever clearing.
      const done = rs.complete;
      const btn = td.createEl("button", {
        cls: "tj-tbl-tick" + (done ? " is-on" : ""),
        attr: { type: "button", "aria-label": done ? "Mark as not reviewed" : "Mark as reviewed" },
      });
      btn.setText(done ? "✓" : "○");
      attachTip(btn, done
        ? { title: "Reviewed", sub: "Click to put it back in the queue." }
        : { title: "Mark as reviewed", sub: rs.missing.length ? `Still missing: ${rs.missing.join(", ")}.` : "Nothing is missing — this just says you have read it." });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.onToggleReviewed?.(t, !done);
      });
    },
  },
];

/** The default order for the Trade Log page (as agreed: money at the end). */
export const DEFAULT_TRADE_LOG_ORDER = [
  // The preferred layout: time first, what it was, how many, the number,
  // where, plan, gaps. All columns center-aligned so reordering never breaks
  // the visual rhythm.
  "date",
  "symbol",
  "side",
  "qty",
  "points",
  "pnl",
  "account",
  "setup",
  "stars",
  "image",
  "review",
];

/** The default order for the trades widget on an account page. */
export const DEFAULT_ACCOUNT_ORDER = ["date", "symbol", "side", "qty", "entryexit", "hold", "r", "pnl", "setup"];

/**
 * Keep a saved order usable: unknown ids dropped, missing ones appended in the
 * catalogue order. A journal that gained a column overnight must not lose the
 * arrangement the user set (no dead ends).
 */
export function resolveOrder(saved: string[] | undefined, allowed: string[]): string[] {
  const known = allowed.filter((id) => TRADE_COLUMNS.some((c) => c.id === id));
  const out: string[] = [];
  for (const id of saved ?? []) if (known.includes(id) && !out.includes(id)) out.push(id);
  for (const id of known) if (!out.includes(id)) out.push(id);
  return out;
}

export interface TradeTableOpts {
  plugin: TradebookPlugin;
  trades: Trade[];
  order: string[];
  /** Timeline rail with one dot per trade (Trade Log) — off inside an account. */
  rail?: boolean;
  /** A day row per session, with its own net (Trade Log). */
  groupByDay?: boolean;
  /**
   * Fold the records of one trade into a single row (default on). Off means one
   * row per record, which is what the account page wants if it ever asks for it.
   */
  collapse?: boolean;
  selectMode?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (t: Trade) => void;
  onRowClick: (t: Trade) => void;
  onReorder?: (order: string[]) => void;
  /** Header click sorting. Omit it and the headers stop being clickable. */
  sort?: TradeSort | null;
  onSort?: (next: TradeSort | null) => void;
  onToggleReviewed?: (t: Trade, next: boolean) => void;
}

interface DayGroup {
  key: string;
  rows: TradeRow[];
  /** Everything the day made, across every account. */
  money: number;
}

/**
 * Sort a list by one column. Values we do not have (no stop, no times, no
 * rating) sink to the bottom in both directions — a missing number is not a
 * small one.
 */
function sortTrades(rows: TradeRow[], sort: TradeSort | null, plugin: TradebookPlugin): TradeRow[] {
  const col = sort ? TRADE_COLUMNS.find((c) => c.id === sort.id) : undefined;
  if (!sort || !col?.sortValue) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  // P&L sorts on the row's money, which is what the cell shows.
  const valueOf = (r: TradeRow): number | string | null => (col.id === "pnl" ? r.money : col.sortValue!(r.rep, plugin));
  const known: TradeRow[] = [];
  const unknown: TradeRow[] = [];
  for (const t of rows) {
    const v = valueOf(t);
    if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) unknown.push(t);
    else known.push(t);
  }
  known.sort((a, b) => {
    const va = valueOf(a) as number | string;
    const vb = valueOf(b) as number | string;
    const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    // A stable tie-break on the clock: two trades with the same P&L stay in the
    // order they happened instead of shuffling on every redraw.
    const clock = `${a.rep.date}${a.rep.entryTime ?? ""}`.localeCompare(`${b.rep.date}${b.rep.entryTime ?? ""}`);
    return (d !== 0 ? d : clock) * sign;
  });
  return [...known, ...unknown];
}

/** Newest day first; inside a day, the order the session actually happened. */
function groupDays(rows: TradeRow[], sort: TradeSort | null = null, plugin?: TradebookPlugin): DayGroup[] {
  const map = new Map<string, TradeRow[]>();
  for (const t of rows) {
    const key = t.rep.date ?? "";
    const bucket = map.get(key);
    if (bucket) bucket.push(t);
    else map.set(key, [t]);
  }
  // Sorting inside a day keeps the day bars, which is where the day's own net
  // lives. Sorting by the clock is also the one sort that reorders the days
  // themselves — oldest day first when the arrow points up.
  const dayOrder = sort?.id === "date" ? (sort.dir === "asc" ? 1 : -1) : -1;
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]) * dayOrder)
    .map(([key, rows]) => ({
      key,
      money: rows.reduce((s, r) => s + r.money, 0),
      rows:
        sort && plugin
          ? sortTrades(rows, sort, plugin)
          : rows.slice().sort((a, b) => (a.rep.entryTime ?? "").localeCompare(b.rep.entryTime ?? "")),
    }));
}

/** `Tue 8 Sep` — from the trade's own date, so it always matches the row below it. */
function dayLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return key || "No date";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function dayNet(rows: TradeRow[]): number {
  return rows.reduce((s, r) => s + r.money, 0);
}

/**
 * Draw the ledger into `host`. Returns a function that redraws it in place
 * (used when a filter chip changes without a full view re-render).
 */
export function renderTradeTable(host: HTMLElement, opts: TradeTableOpts): () => void {
  const plugin = opts.plugin;
  const cols = opts.order
    .map((id) => TRADE_COLUMNS.find((c) => c.id === id))
    .filter((c): c is TradeColumn => !!c);
  // Which trades are showing their executions. The ledger is redrawn on every
  // toggle — small tables, and it keeps one source of truth on screen.
  const expanded = new Set<string>();
  const ctx: TradeColumnCtx = {
    plugin,
    expanded,
    onToggleReviewed: opts.onToggleReviewed
      ? (t, next) => {
          opts.onToggleReviewed?.(t, next);
        }
      : undefined,
    toggleFills: (t) => {
      if (expanded.has(t.id)) expanded.delete(t.id);
      else expanded.add(t.id);
      draw();
    },
    groupByDay: !!opts.groupByDay,
  };

  /** The arrow a header shows: none, ↓ or ↑. */
  const arrowFor = (id: string): string => {
    if (!opts.sort || opts.sort.id !== id) return "";
    return opts.sort.dir === "asc" ? "\u2191" : "\u2193";
  };

  /**
   * Clicking a header walks three states: the column's first direction, the
   * other one, then back to the plain list. Three because the third click is how
   * you undo a sort without hunting for a reset.
   */
  const cycleSort = (col: TradeColumn): void => {
    if (!col.sortValue || !opts.onSort) return;
    const cur = opts.sort;
    const first = col.firstDir ?? "desc";
    if (!cur || cur.id !== col.id) opts.onSort({ id: col.id, dir: first });
    else if (cur.dir === first) opts.onSort({ id: col.id, dir: first === "asc" ? "desc" : "asc" });
    else opts.onSort(null);
  };

  /** One execution under its trade: its own time, size, price and P&L. */
  const drawFillRow = (body: HTMLElement, t: Trade, set: FillSet, f: TradeFill): void => {
    const row = body.createEl("tr", { cls: "tj-tbl-fill" });
    if (opts.selectMode) row.createEl("td", { cls: "tj-tbl-selcol" });
    // Sub-rows keep the column, without a dot of their own.
    if (opts.rail) row.createEl("td", { cls: "tj-tbl-rail is-sub" });
    const pointValue = futuresSpec(t.symbol).pointValue;
    const riskPerContract =
      t.stopLoss && set.avgEntry ? Math.abs(set.avgEntry - t.stopLoss) * pointValue : 0;
    for (const col of cols) {
      const cell = row.createEl("td", { cls: col.align === "left" ? "l" : "" });
      switch (col.id) {
        case "date":
          cell.setText(f.time || "—");
          break;
        case "side":
          cell.createSpan({ cls: "tj-tbl-fill-side", text: f.side });
          break;
        case "qty":
          cell.setText(String(f.qty));
          break;
        case "entryexit":
          cell.setText(fmtPrice(f.price));
          break;
        case "hold":
          cell.setText(set.entries.includes(f) ? "—" : holdFmt(set.firstEntryTime, f.time));
          break;
        case "r": {
          if (!set.exits.includes(f) || !Number.isFinite(f.pnl) || riskPerContract <= 0) {
            cell.setText("—");
            break;
          }
          const r = (f.pnl as number) / (riskPerContract * f.qty);
          cell.addClass(toneClass(f.pnl as number));
          cell.setText(`${r >= 0 ? "+" : ""}${r.toFixed(2)}R`);
          break;
        }
        case "pnl":
          if (!Number.isFinite(f.pnl)) {
            cell.setText("—");
            break;
          }
          cell.addClass("tj-tbl-pnl");
          cell.addClass(toneClass(f.pnl as number));
          cell.setText(f.pnl === 0 ? fmtMoneyAbs(0) : fmtMoney(f.pnl as number));
          break;
        case "setup": {
          // A target that closed flat reads as "T2 · BE": the position it belongs
          // to, and the decision that ended it.
          const flat = set.exits.includes(f) && f.pnl === 0;
          const tag = cell.createSpan({ cls: "tj-tbl-fill-tag" + (flat ? " is-flat" : "") });
          tag.setText(fillLabel(f, fillIndex(f, set), set) + (flat ? " · BE" : ""));
          break;
        }
        default:
          break;
      }
    }
  };

  const draw = (): void => {
    host.empty();
    const table = host.createEl("table", { cls: "tj-tbl" });
    const head = table.createEl("thead").createEl("tr");
    if (opts.selectMode) head.createEl("th", { cls: "tj-tbl-selcol" });
    // The rail is a real column: a ::before on a <tr> becomes an extra anonymous
    // cell in a table, which pushes every body cell one column to the right of
    // its header. A narrow td keeps the two in step.
    if (opts.rail) head.createEl("th", { cls: "tj-tbl-rail" });

    // Drag-to-reorder headers, the same gesture as the account page. The whole
    // drag lives and dies with the document mouseup: releasing outside a header
    // can never leave a stale reorder behind.
    let dragFrom = -1;
    let dragTo = -1;
    const ths: HTMLElement[] = [];
    const paint = () =>
      ths.forEach((h, i) => {
        h.toggleClass("tj-dragging", dragFrom >= 0 && i === dragFrom);
        h.toggleClass("tj-drag-over", dragFrom >= 0 && i === dragTo && i !== dragFrom);
      });
    const finish = () => {
      const from = dragFrom;
      const to = dragTo;
      dragFrom = -1;
      dragTo = -1;
      paint();
      document.removeEventListener("mouseup", finish);
      if (from < 0 || to < 0 || from === to) return;
      const next = opts.order.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      opts.onReorder?.(next);
    };
    cols.forEach((col, idx) => {
      const th = head.createEl("th", {
        cls: (col.align === "left" ? "l" : "") + (col.sortValue ? " tj-col-sort" : ""),
      });
      th.createSpan({ text: opts.groupByDay && col.id === "date" ? col.groupedLabel ?? col.label : col.label });
      if (opts.sort?.id === col.id) th.addClass(opts.sort.dir === "asc" ? "is-asc" : "is-desc");
      if (opts.onSort && col.sortValue) {
        th.setAttribute("aria-sort", !opts.sort || opts.sort.id !== col.id ? "none" : opts.sort.dir === "asc" ? "ascending" : "descending");
      }
      const arrow = arrowFor(col.id);
      if (arrow) th.createSpan({ cls: "tj-tbl-arrow", text: arrow });
      else if (opts.onSort && col.sortValue) th.createSpan({ cls: "tj-tbl-arrow is-idle", text: "\u2195" });
      if (opts.onSort && col.sortValue) {
        th.addClass("tj-col-clickable");
        attachTip(th, { title: `Sort by ${col.label || "print"}`, sub: "Click again to flip, once more to go back to the plain list." });
        th.addEventListener("click", () => cycleSort(col));
      }
      ths.push(th);
      if (!opts.onReorder) return;
      th.addClass("tj-col-drag");
      th.addEventListener("mousedown", (e) => {
        e.preventDefault();
        dragFrom = idx;
        dragTo = -1;
        paint();
        // The drag belongs to the document: releasing anywhere commits it, and a
        // release outside the header can never leave a stale reorder behind.
        document.addEventListener("mouseup", finish);
      });
      th.addEventListener("mouseover", () => {
        if (dragFrom < 0) return;
        dragTo = idx;
        paint();
      });
    });

    const body = table.createEl("tbody");
    // One entry per logical trade: a trade copied into five accounts is one line
    // with a "5 accounts" chip, not five lines the reader has to add up.
    const rows = opts.collapse === false
      ? opts.trades.map((t) => ({ key: t.id ?? "", rep: t, legs: [t], money: Number.isFinite(t.pnl) ? t.pnl : 0 }))
      : tradeRows(opts.trades);
    const groups: DayGroup[] = opts.groupByDay
      ? groupDays(rows, opts.sort ?? null, plugin)
      : [
          {
            key: "",
            money: rows.reduce((s, r) => s + r.money, 0),
            rows: opts.sort
              ? sortTrades(rows.slice(), opts.sort, plugin)
              : rows
                  .slice()
                  .sort((a, b) => `${b.rep.date}${b.rep.entryTime ?? ""}`.localeCompare(`${a.rep.date}${a.rep.entryTime ?? ""}`)),
          },
        ];

    for (const group of groups) {
      const alt = groups.indexOf(group) % 2 === 1;

      if (opts.groupByDay) {
        const row = body.createEl("tr", { cls: "tj-tbl-day" });
        if (opts.selectMode) row.createEl("td", { cls: "tj-tbl-selcol" });
        if (opts.rail) row.createEl("td", { cls: "tj-tbl-rail" });
        const cell = row.createEl("td", { attr: { colspan: String(Math.max(1, cols.length)) } });
        // The day is a divider, not a row: hairlines either side and one pill in
        // the middle of the line. Reading the far-right profits used to lose the
        // date completely — a centred label is caught by the eye without looking.
        const bar = cell.createDiv({ cls: "tj-tbl-daybar" });
        bar.createSpan({ cls: "tj-tbl-dayrule" });
        const mid = bar.createSpan({ cls: "tj-tbl-daymid" });
        mid.createSpan({ cls: "tj-tbl-dayname", text: dayLabel(group.key) });
        // The count is trades, never records: five records of one decision are
        // still one trade today, and the row itself says where it went.
        mid.createSpan({
          cls: "tj-tbl-daymeta",
          text: `${group.rows.length} trade${group.rows.length === 1 ? "" : "s"}`,
        });
        const net = dayNet(group.rows);
        mid.createSpan({
          cls: "tj-tbl-daynet " + (net > 0 ? "tj-pos" : net < 0 ? "tj-neg" : ""),
          text: fmtMoney(net),
        });
        bar.createSpan({ cls: "tj-tbl-dayrule" });
      }

      group.rows.forEach((tradeRow: TradeRow, i) => {
        const t = tradeRow.rep;
        const row = body.createEl("tr", { cls: "tj-tbl-row" + (alt ? " is-alt" : "") });
        // The row says which trade it is, so a view can put the reader back where
        // they were after opening one, and so the harnesses can find it.
        if (t.id) row.dataset.trade = t.id;
        row.addEventListener("click", () => opts.onRowClick(t));

        if (opts.selectMode) {
          const cell = row.createEl("td", { cls: "tj-tbl-selcol" });
          const check = cell.createEl("input", { cls: "tj-tbl-check", attr: { type: "checkbox" } });
          check.checked = !!t.id && !!opts.selected?.has(t.id);
          check.addEventListener("click", (e) => {
            e.stopPropagation();
            opts.onToggleSelect?.(t);
          });
        }

        if (opts.rail) {
          // One dot per trade: solid, green or red, outside the figures but
          // inside the table, so the columns stay in step with the header.
          const cell = row.createEl("td", { cls: "tj-tbl-rail" });
          const dot = cell.createEl("i", { cls: (t.pnl ?? 0) < 0 ? "loss" : "" });
          const facts = [t.entryTime || "no time", fmtMoney(t.pnl ?? 0)];
          if (i === 0) facts.push("First of the session");
          if (i === group.rows.length - 1) facts.push("Last of the session");
          attachTip(dot, { title: facts[0], sub: facts.slice(1).join(" · ") });
        }

        for (const col of cols) {
          const cell = row.createEl("td", { cls: col.align === "left" ? "l" : "" });
          col.render(cell, t, plugin, { ...ctx, row: tradeRow });
        }

        // The executions, when this trade has them open.
        const set = fillSet(t);
        if (set.isMulti && expanded.has(t.id)) for (const f of set.fills) drawFillRow(body, t, set, f);
      });
    }
  };

  draw();
  return draw;
}

// Test hook (see lib/fills.ts): the ledger is rendered by two views, so the
// harness drives it directly instead of going through a whole page.
if (typeof window !== "undefined") {
  (window as any).__tjTradeTable = { renderTradeTable, holdFmt, tradeR };
}
