// Shared trade table — the ledger used by the Trade Log page and by the trades
// widget inside an account page. One recipe, so the two can never drift apart.
//
// The shape was chosen from a browser preview (docs/tradelog-previews-2.html):
// a timeline rail with one dot per trade, columns aligned so figures can be
// compared straight down the page.

import { TFile, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade, TradeFill } from "../types";
import { fmtMoney, fmtMoneyAbs, fmtPrice } from "../tz";
import { formatDate } from "./dates";
import { attachTip } from "./tip";
import { futuresSpec } from "../futures";
import { recordedRisk } from "./risk";
import { fillIndex, fillLabel, fillSet, FillSet, isBreakEven, toneClass } from "./fills";
import { legBaseKey } from "./copy";
import { netPnl } from "./fees";
import { holdMinutesOf, tradeDayInZone, tradeEntryTimeInZone } from "./instant";

/** The Journal Timezone a row is read in. Empty means "as recorded". */
const zoneOf = (plugin?: TradebookPlugin): string => plugin?.settings?.timeZone ?? "";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact date without year: "14 Sep". */
function compactDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "";
  const [, , mo, d] = m;
  return `${parseInt(d, 10)} ${MONTHS[parseInt(mo, 10) - 1]}`;
}

/**
 * Read an order type out of any of the dialects the plugin has written and
 * return the one canonical form: "Limit", "Market", "Stop", "Stop Limit".
 * Unknown non-empty values come back trimmed and untouched — the journal
 * reports what the broker said, it never invents a type or drops one it
 * cannot place.
 */
export function normalizeOrderType(raw?: string): string | undefined {
  const original = (raw ?? "").trim();
  if (!original) return undefined;
  const key = original.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  switch (key) {
    case "limit":
    case "lmt":
      return "Limit";
    case "market":
    case "mkt":
      return "Market";
    case "stop":
    case "stp":
      return "Stop";
    // "stoplimit" catches StopLimit/STOPLIMIT; the collapsed form catches
    // "stop-limit", "stop_limit" and "Stop Limit".
    case "stop limit":
    case "stoplimit":
      return "Stop Limit";
    default:
      return original;
  }
}

/**
 * How long a trade was held: `15s`, `1m 30s`, `1h 5m`, `2h 4m 9s`. Times are
 * read as wall clock; an exit earlier than the entry wrapped past midnight.
 * Empty times (older notes have none) read as an em dash, never as midnight.
 */
function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return s ? `${h}h ${m}m ${s}s` : m ? `${h}h ${m}m` : `${h}h`;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * How long a span of wall clock lasted — the FORMATTING only. The duration
 * itself comes from `holdMinutesOf` (`lib/instant.ts`), so a fill row's span and
 * a whole trade's hold are read by the same calculator: one midnight wrap, one
 * range rule, one answer for the same two stamps. No entry/exit to read, or an
 * out-of-range clock, reads as an em dash — never a guess at midnight.
 */
export function holdFmt(entryTime?: string, exitTime?: string): string {
  const minutes = holdMinutesOf({ entryTime, exitTime });
  return minutes === null ? "—" : fmtDuration(Math.round(minutes * 60));
}

/**
 * How long a trade was held: `15s`, `1m 30s`, `2h 4m 9s`.
 *
 * From the canonical instants when the note has them — a hold that crosses
 * midnight or a DST change is the time it really took — and from the recorded
 * clock (with its midnight wrap) otherwise. No entry/exit to read: a dash, never
 * a guess at midnight.
 */
export function holdFmtOf(t: Trade): string {
  const minutes = holdMinutesOf(t);
  return minutes === null ? "—" : fmtDuration(Math.round(minutes * 60));
}

/**
 * The R multiple of a trade: profit over the risk actually taken
 * (entry to stop, in money). Null when there is no stop to measure against —
 * a missing value must read as missing, never as zero.
 */
export function tradeR(t: Trade): number | null {
  const risk = recordedRisk(t);
  return risk ? t.pnl / risk : null;
}

/** The first print attached to a trade, as a resource URL (null when there is none). */
export function shotUrl(plugin: TradebookPlugin, t: Trade): string | null {
  const raw = (t.screenshot || "").trim();
  if (!raw || raw.toLowerCase() === "added") return null;
  const first = raw.split(/[,;\n]+/)[0].trim();
  const inner = first.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const target = inner.split("|")[0].split("#")[0].trim();
  const folder = plugin.getTradesFolder();
  const candidates = [first, target, ...plugin.attachmentCandidates(target, t.date), `${folder}/${target}`];
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
 *
 * The row is one line per decision, and its P&L is the trade's own gross — the
 * base note's figure, never the sum of the legs it was mirrored into. What each
 * copier's account made belongs to that account, not on the leader's row.
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
    // The original note wins the row: it is the one with the screenshot, the
    // review and the file on disk. Copies only stand in when it is not loaded.
    if (row.rep.isCopiedTrade && !t.isCopiedTrade) row.rep = t;
    // One row, one trade: the money is the winning record's own P&L, not the
    // sum of every leg. The day totals add up because each decision appears once.
    row.money = Number.isFinite(row.rep.pnl) ? row.rep.pnl : 0;
  }
  return [...map.values()];
}

/** What a cell renderer may need beyond the trade itself. */
export interface TradeColumnCtx {
  plugin: TradebookPlugin;
  /** Trade ids whose executions are on screen. */
  expanded: Set<string>;
  toggleFills: (t: Trade) => void;
  /** Every record behind this row, when the ledger is folding copies. */
  row?: TradeRow;
  /** Rows showing their copy provenance (base + copies + ratios). */
  copiesExpanded?: Set<string>;
  toggleCopies?: (t: Trade) => void;
  /** True when the table is grouping by day. Columns that show the date can
   *  use this to suppress the date portion and show only the time. */
  groupByDay?: boolean;
  /** When true, date column shows compact "DD Mon, HH:MM" format. */
  compactDate?: boolean;
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
      const url = shotUrl(plugin, t);
      const span = td.createSpan({ cls: "tj-tbl-print" + (url ? " is-on" : "") });
      if (url) {
        setIcon(span, "image");
        span.style.cursor = "pointer";
        span.addEventListener("click", (e) => {
          e.stopPropagation();
          void plugin.openTradeDetail({ id: t.id });
        });
        attachTip(span, { title: "Has a print", sub: "Click to open the trade and see it." });
      } else {
        span.setText("\u2014");
        attachTip(span, { title: "No print yet", sub: "Drop one on the trade page and this icon lights up." });
      }
    },
  },
  {
    id: "date",
    label: "Time",
    align: "left",
    sortValue: (t, plugin) => `${tradeDayInZone(t, zoneOf(plugin))}${tradeEntryTimeInZone(t, zoneOf(plugin))}`,
    firstDir: "asc",
    render: (td, t, plugin, ctx) => {
      // The row shows the day and the clock the instant is *in* — the same
      // values the day header above it and the period filter use.
      const day = tradeDayInZone(t, zoneOf(plugin));
      const time = tradeEntryTimeInZone(t, zoneOf(plugin)).trim();
      // No time recorded (imported fills have none): show a dash. An empty cell
      // reads as if the column were missing, and the eye then pairs the symbol
      // with the time header.
      if (!time) {
        td.setText("—");
        return;
      }
      td.setText(ctx.compactDate ? `${compactDateLabel(day)}, ${time}` : ctx.groupByDay ? time : `${formatDate(day, plugin.settings.dateFormat)} ${time}`.trim());
    },
  },
  {
    id: "symbol",
    label: "Symbol",
    align: "left",
    sortValue: (t) => t.symbol || "",
    firstDir: "asc",
    render: (td, t, _plugin, ctx) => {
      td.createSpan({ cls: "tj-tbl-sym", text: t.symbol });
      // Symbol is the one thing the log is read by, so it carries the row and
      // nothing else. Which accounts a decision reached is metadata: it lives in
      // the optional Accounts column, off by default, and the Accounts column is
      // where the drill-down to the copied legs lives too.
      const row = ctx?.row;
      if (!row || row.legs.length < 2 || !ctx?.copiesExpanded) return;
      const expanded = ctx.copiesExpanded.has(t.id);
      if (row.legs.every((leg) => leg.account === row.rep.account)) return;
      td.addClass("is-folded");
      td.setAttr("title", expanded ? "Copies expanded" : "Copied into several accounts — see the Accounts column");
    },
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
      const multi = set.isMulti;
      const open = multi && ctx.expanded.has(t.id);
      const partial = set.openQty > 0 && set.entryQty > 0;
      // A scaled trade makes its own quantity the door — the number, a chevron,
      // nothing more; the word would only crowd the ledger.
      const host: HTMLElement = multi
        ? td.createEl("button", { cls: "tj-tbl-fills", attr: { type: "button" } })
        : td;
      if (partial) {
        // Half the position is still on: say what is left, and let the P&L carry
        // its own asterisk further along the row.
        const span = host.createSpan({ cls: "tj-tbl-qty-partial" });
        span.createSpan({ text: String(set.exitQty) });
        span.createSpan({ cls: "tj-tbl-qty-total", text: `/${set.entryQty}` });
        if (!multi) {
          attachTip(span, {
            title: `${set.exitQty} of ${set.entryQty} closed`,
            sub: "The part still open counts nowhere until it is closed.",
          });
        }
      } else {
        host.setText(Number.isFinite(t.quantity) && t.quantity > 0 ? String(t.quantity) : "—");
      }
      if (!multi) return;
      if (open) host.addClass("is-open");
      host.createSpan({ cls: "tj-tbl-fills-chev", text: open ? "⌃" : "⌄" });
      host.createSpan({ cls: "tj-sr-only", text: "Show executions" });
      attachTip(host, {
        title: `${set.fills.length} executions`,
        sub: [
          `${set.entries.length} in · ${set.exits.length} out`,
          partial ? `${set.exitQty} of ${set.entryQty} closed` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      host.addEventListener("click", (e) => {
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
    // Same calculator the cell renders with: the real elapsed minutes from the
    // instants when there are any, so a sorted column cannot disagree with the
    // values it is sorting.
    sortValue: (t) => holdMinutesOf(t),
    firstDir: "desc",
    render: (td, t) => td.setText(holdFmtOf(t)),
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
    label: "P&L (Gross)",
    align: "right",
    sortValue: (t) => (Number.isFinite(t.pnl) ? t.pnl : null),
    firstDir: "desc",
    render: (td, t, _plugin, ctx) => {
      // Money is the trade's own gross, once. A trade mirrored into a copier is
      // still one decision on this ledger; the copier's account carries its own
      // leg. The day total adds up because every decision appears exactly once.
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
    id: "net",
    // Name the scope in the label itself: the one place a reader looks first.
    label: "Net (decision)",
    align: "right",
    sortValue: (t) => (Number.isFinite(t.pnl) ? netPnl(t) : null),
    firstDir: "desc",
    render: (td, t, _plugin, ctx) => {
      // Net of costs, for the row's one trade — the base note's own result.
      // A copy's net belongs to the copy's account, not on this row.
      const money = ctx.row ? netPnl(ctx.row.rep) : netPnl(t);
      td.addClass("tj-tbl-pnl");
      td.addClass(toneClass(money));
      td.setText(money === 0 ? fmtMoneyAbs(0) : fmtMoney(money));
    },
  },
  {
    id: "accounts",
    label: "Accounts",
    align: "left",
    // Opt-in: absent from DEFAULT_TRADE_LOG_ORDER, so the ledger shows Symbol
    // without an account column until the reader asks for one. Account identity
    // is metadata, not the first question the log answers.
    sortValue: (t, plugin) => plugin.displayAccount(t.account),
    firstDir: "asc",
    render: (td, t, plugin, ctx) => {
      const row = ctx?.row;
      const legs = row?.legs ?? [t];
      const names = [...new Set(legs.map((leg) => plugin.displayAccount(leg.account)))];
      if (names.length === 1) {
        // One account: the name, in the quiet metadata tone. No chip, no count.
        td.createSpan({ cls: "tj-tbl-acc", text: names[0] });
        return;
      }
      // A decision that reached several accounts: the count is the information,
      // and it stays a control because it opens the accounts behind it.
      const open = !!ctx?.copiesExpanded?.has(t.id);
      const chip = td.createEl("button", {
        cls: "tj-tbl-copies" + (open ? " is-open" : ""),
        attr: { type: "button", "aria-expanded": String(open) },
      });
      chip.createSpan({ text: names[0] });
      chip.createSpan({ cls: "tj-tbl-copies-more", text: `+${names.length - 1}` });
      attachTip(chip, {
        title: `This decision in ${names.length} accounts`,
        sub: `${names.join(" · ")}. Money is what it made in each account; the ledger counts the decision once.`,
      });
      if (ctx?.toggleCopies) {
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          ctx.toggleCopies?.(t);
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
    id: "stars",
    label: "Rating",
    align: "left",
    sortValue: (t) => ((t.rating ?? 0) > 0 ? (t.rating as number) : null),
    firstDir: "desc",
    render: (td, t) => {
      const r = t.rating ?? 0;
      const span = td.createSpan({ cls: "tj-tbl-stars", text: r > 0 ? "★".repeat(Math.min(5, Math.round(r))) : "—" });
      if (r > 0) attachTip(span, { title: `${r}/5`, sub: "Your execution rating for this trade." });
    },
  },
];

/** The default order for the Trade Log page. */
export const DEFAULT_TRADE_LOG_ORDER = [
  "date",
  "symbol",
  "side",
  "qty",
  "entryexit",
  "points",
  "pnl",
  "setup",
  "stars",
  "image",
];

/** The default order for the trades widget on an account page. */
export const DEFAULT_ACCOUNT_ORDER = ["date", "symbol", "side", "qty", "entryexit", "hold", "r", "pnl", "setup"];

/**
 * Each column's preferred width, in pixels, for the whole life of the ledger.
 *
 * With `table-layout: fixed` these are also the weights: the table fills its
 * container and shares any extra width in proportion, so a column's share
 * depends only on which column it is — never on how many others are on screen.
 * The sum is the Trade Log's minimum width: below it the table scrolls instead
 * of shrinking a column past its preferred size.
 */
const COLUMN_WIDTHS: Record<string, number> = {
  image: 56,
  date: 104,
  symbol: 92,
  side: 58,
  qty: 54,
  points: 74,
  entryexit: 168,
  hold: 74,
  r: 62,
  pnl: 104,
  net: 104,
  accounts: 150,
  setup: 150,
  stars: 92,
};

/** The rail and selection columns are chrome, not data — fixed like the rest. */
const RAIL_WIDTH = 26;
const SELECT_WIDTH = 40;

/**
 * The stable width of each visible column, keyed by id. A test pins that this
 * map does not change when an optional column is added or removed.
 */
export function tradeColumnWidths(order: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of order) if (COLUMN_WIDTHS[id] !== undefined) out[id] = COLUMN_WIDTHS[id];
  return out;
}

/** The sum of preferred widths for an order — the Trade Log's overflow floor. */
export function tradeTableMinWidth(order: string[], opts: { rail?: boolean; select?: boolean } = {}): number {
  let sum = opts.select ? SELECT_WIDTH : 0;
  if (opts.rail) sum += RAIL_WIDTH;
  for (const id of order) sum += COLUMN_WIDTHS[id] ?? 0;
  return sum;
}

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
  /** When false, suppresses the day header rows even when groupByDay is true. */
  showDayHeaders?: boolean;
  /** When true, date column shows compact "DD Mon, HH:MM" format. */
  compactDate?: boolean;
  /**
   * Fixed column geometry (Trade Log). Off by default: the account widget lives
   * in a small card where the browser's auto layout is the one that fits.
   */
  stableGeometry?: boolean;
  selectMode?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (t: Trade, shift?: boolean) => void;
  onRowClick: (t: Trade) => void;
  onReorder?: (order: string[]) => void;
  /** Header click sorting. Omit it and the headers stop being clickable. */
  sort?: TradeSort | null;
  onSort?: (next: TradeSort | null) => void;
  /**
   * Pin the header while the list scrolls (default on). Off inside a page that
   * is the scroll container itself, where a sticky header would float over the
   * widget title instead of the rows.
   */
  stickyHeader?: boolean;
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
    const zone = zoneOf(plugin);
    const clock = `${tradeDayInZone(a.rep, zone)}${tradeEntryTimeInZone(a.rep, zone)}`.localeCompare(
      `${tradeDayInZone(b.rep, zone)}${tradeEntryTimeInZone(b.rep, zone)}`
    );
    return (d !== 0 ? d : clock) * sign;
  });
  return [...known, ...unknown];
}

/** Newest day first; inside a day, the order the session actually happened. */
function groupDays(rows: TradeRow[], sort: TradeSort | null = null, plugin?: TradebookPlugin): DayGroup[] {
  // The header of each group is the journal's day — the same key the period
  // filter uses, so a day opens exactly the rows it shows.
  const zone = zoneOf(plugin);
  const map = new Map<string, TradeRow[]>();
  for (const t of rows) {
    const key = tradeDayInZone(t.rep, zone);
    const bucket = map.get(key);
    if (bucket) bucket.push(t);
    else map.set(key, [t]);
  }
  // Sorting inside a day keeps the day bars, which is where the day's own net
  // lives. Sorting by the clock is also the one sort that reorders the days
  // themselves — oldest day first when the arrow points up.
  const dayOrder = sort?.id === "date" ? (sort.dir === "asc" ? 1 : -1) : -1;
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]) * dayOrder)
    .map(([key, rows]) => ({
      key,
      money: rows.reduce((s, r) => s + r.money, 0),
      rows:
        sort && plugin
          ? sortTrades(rows, sort, plugin)
          : // Inside a day, the order the session actually happened — read from
            // the instant, so a row never sits above one that came before it.
            rows
              .slice()
              .sort((a, b) =>
                tradeEntryTimeInZone(a.rep, zone).localeCompare(tradeEntryTimeInZone(b.rep, zone))
              ),
    }));
}

/** The row order presented by the ledger, shared with filtered review navigation. */
export function orderedTradeRows(
  trades: Trade[],
  sort: TradeSort | null,
  plugin: TradebookPlugin,
  groupByDay = false
): TradeRow[] {
  const rows = tradeRows(trades);
  if (groupByDay) return groupDays(rows, sort, plugin).flatMap((group) => group.rows);
  if (sort) return sortTrades(rows, sort, plugin);
  // Newest first, read from the instant: the same day and clock every group
  // header and every cell shows.
  const zone = zoneOf(plugin);
  const stamp = (r: TradeRow): string => `${tradeDayInZone(r.rep, zone)}${tradeEntryTimeInZone(r.rep, zone)}`;
  return rows.slice().sort((a, b) => stamp(b).localeCompare(stamp(a)));
}

/** `Tue 8 Sep` — from the trade's own date, so it always matches the row below it. */
function dayLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return key || "No date";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function dayNet(rows: TradeRow[]): number {
  // The day answers "what did I make today?" the same way Home does: Net of
  // recorded costs, one entry per decision. The row's Gross column is untouched.
  return rows.reduce((s, r) => s + netPnl(r.rep), 0);
}

/**
 * Draw the ledger into `host`.
 */
export function renderTradeTable(host: HTMLElement, opts: TradeTableOpts): void {
  const plugin = opts.plugin;
  const cols = opts.order
    .map((id) => TRADE_COLUMNS.find((c) => c.id === id))
    .filter((c): c is TradeColumn => !!c);
  // Which trades are showing their executions. The ledger is redrawn on every
  // toggle — small tables, and it keeps one source of truth on screen.
  const expanded = new Set<string>();
  const copiesExpanded = new Set<string>();
  const ctx: TradeColumnCtx = {
    plugin,
    expanded,
    toggleFills: (t) => {
      if (expanded.has(t.id)) expanded.delete(t.id);
      else expanded.add(t.id);
      draw();
    },
    copiesExpanded,
    toggleCopies: (t) => {
      if (copiesExpanded.has(t.id)) copiesExpanded.delete(t.id);
      else copiesExpanded.add(t.id);
      draw();
    },
    groupByDay: !!opts.groupByDay,
    compactDate: !!opts.compactDate,
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
          // A break-even close reads as "BE"; the rest are TP1, TP2 … in order.
          const isExit = set.exits.includes(f);
          const be = isExit && set.explicit && isBreakEven(f, set.avgEntry, pointValue);
          const tag = cell.createSpan({ cls: "tj-tbl-fill-tag" + (be || (isExit && f.pnl === 0) ? " is-flat" : "") });
          tag.setText(fillLabel(f, fillIndex(f, set), set, pointValue));
          break;
        }
        default:
          break;
      }
    }
  };

  /** The accounts behind a folded decision, opened under its own row. */
  const drawCopyRow = (body: HTMLElement, tradeRow: TradeRow): void => {
    const tr = body.createEl("tr", { cls: "tj-tbl-copiesrow" });
    if (opts.selectMode) tr.createEl("td", { cls: "tj-tbl-selcol" });
    if (opts.rail) tr.createEl("td", { cls: "tj-tbl-rail is-sub" });
    const cell = tr.createEl("td", { attr: { colspan: String(Math.max(1, cols.length)) } });
    const list = cell.createDiv({ cls: "tj-tbl-copylist" });
    const line = (kind: string, name: string, ratio?: number) => {
      const l = list.createDiv({ cls: "tj-tbl-copyline" });
      l.createSpan({ cls: "tj-tbl-copykind", text: kind });
      l.createSpan({ cls: "tj-tbl-copyname", text: name });
      if (Number.isFinite(ratio)) {
        const chip = l.createSpan({ cls: "tj-tbl-copyratio", text: `×${ratio}` });
        attachTip(chip, { title: `Ratio \u00d7${ratio}`, sub: "Contracts copied per leader contract." });
      }
    };
    line("Original", plugin.displayAccount(tradeRow.rep.account) || tradeRow.rep.account || "—");
    for (const c of tradeRow.legs.filter((x) => x.isCopiedTrade)) {
      // A reconstructed leg is a model of the leader's trade; the ledger says so
      // rather than letting it pass as that account's own fill.
      line(
        c.dataSource === "reconstructed" ? "Copied (model)" : "Copied",
        plugin.displayAccount(c.account) || c.account || "—",
        c.copyMultiplier
      );
    }
  };

  const draw = (): void => {
    // Clear only the table we own: the Trade Log draws its section header inside
    // the same card, and it must survive a redraw (fills open, filter change).
    for (const child of Array.from(host.children)) {
      if (child.tagName === "TABLE") child.remove();
    }
    // Fixed geometry is opt-in: the Trade Log asks for it so optional columns
    // never re-measure the others. A narrow account widget keeps the browser's
    // auto layout instead, where a small card must still fit its columns.
    const stable = !!opts.stableGeometry;
    const table = host.createEl("table", {
      cls: "tj-tbl" + (stable ? " is-fixed" : "") + (opts.stickyHeader === false ? " is-static" : ""),
    });
    const colIds = cols.map((c) => c.id);
    if (stable) {
      // The <colgroup> carries each column's preferred width. With
      // `table-layout: fixed` and no auto column, those widths act as weights:
      // the table always fills its container, and any slack is shared in
      // proportion (Time and Entry→Exit grow more than Qty, never a blank
      // filler on the right). `min-width` is the sum of the preferred widths, so
      // a narrow pane keeps every column at its preferred size and scrolls
      // sideways instead of crushing them. Adding a column shifts the existing
      // ones by a small proportion — the same table, one more fact.
      const widths = tradeColumnWidths(colIds);
      table.style.minWidth = `${tradeTableMinWidth(colIds, { rail: opts.rail, select: opts.selectMode })}px`;
      const colgroup = table.createEl("colgroup");
      if (opts.selectMode) colgroup.createEl("col", { attr: { style: `width:${SELECT_WIDTH}px` } });
      if (opts.rail) colgroup.createEl("col", { attr: { style: `width:${RAIL_WIDTH}px` } });
      for (const id of colIds) colgroup.createEl("col", { attr: { style: `width:${widths[id] ?? 0}px` } });
    }
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
      th.createSpan({ text: col.label });
      if (opts.sort?.id === col.id) th.addClass(opts.sort.dir === "asc" ? "is-asc" : "is-desc");
      if (opts.onSort && col.sortValue) {
        th.setAttribute("aria-sort", !opts.sort || opts.sort.id !== col.id ? "none" : opts.sort.dir === "asc" ? "ascending" : "descending");
      }
      const arrow = arrowFor(col.id);
      if (arrow) th.createSpan({ cls: "tj-tbl-arrow", text: arrow });
      else if (opts.onSort && col.sortValue) th.createSpan({ cls: "tj-tbl-arrow is-idle", text: "\u2195" });
      if (opts.onSort && col.sortValue) {
        th.addClass("tj-col-clickable");
        th.setAttribute("tabindex", "0");
        attachTip(th, {
          title: `Sort by ${col.label || "print"}`,
          sub:
            col.id === "net"
              ? "The original trade's Net result. Copies belong to their own accounts. Click again to flip, once more to go back to the plain list."
              : "Click again to flip, once more to go back to the plain list.",
        });
        th.addEventListener("click", () => cycleSort(col));
        // Same door, without a mouse (SC 2.1.1).
        th.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          cycleSort(col);
        });
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
    const rows = tradeRows(opts.trades);
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
                  .sort((a, b) =>
                    `${tradeDayInZone(b.rep, zoneOf(plugin))}${tradeEntryTimeInZone(b.rep, zoneOf(plugin))}`.localeCompare(
                      `${tradeDayInZone(a.rep, zoneOf(plugin))}${tradeEntryTimeInZone(a.rep, zoneOf(plugin))}`
                    )
                  ),
          },
        ];

    for (const group of groups) {
      const alt = groups.indexOf(group) % 2 === 1;

      if (opts.groupByDay && opts.showDayHeaders !== false) {
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
        const netSpan = mid.createSpan({
          cls: "tj-tbl-daynet " + (net > 0 ? "tj-pos" : net < 0 ? "tj-neg" : ""),
          text: fmtMoney(net),
        });
        // Say which basis the day figure is, so it reads as the same number
        // Home's calendar shows and never as the row's Gross column.
        netSpan.setAttr("aria-label", "Day Net P&L");
        attachTip(netSpan, {
          title: "Day Net P&L",
          sub: "Net of recorded costs, one decision basis.",
        });
        bar.createSpan({ cls: "tj-tbl-dayrule" });
      }

      group.rows.forEach((tradeRow: TradeRow, i) => {
        const t = tradeRow.rep;
        const row = body.createEl("tr", { cls: "tj-tbl-row" + (alt ? " is-alt" : "") });
        // The row says which trade it is, so a view can put the reader back where
        // they were after opening one, and so the harnesses can find it.
        if (t.id) row.dataset.trade = t.id;
        // While selecting, the row is inert: opening a trade from a mis-aimed click
        // would throw away the selection the reader spent the last minute building.
        row.addEventListener("click", () => {
          if (opts.selectMode) return;
          opts.onRowClick(t);
        });

        if (opts.selectMode) {
          // The whole cell is the target, not just the 13px box. A selection that
          // a few pixels wide makes people open the wrong trade, which is the one
          // thing selection mode must never do.
          const cell = row.createEl("td", { cls: "tj-tbl-selcol" });
          const hit = cell.createSpan({ cls: "tj-tbl-selhit" });
          const check = hit.createEl("input", {
            cls: "tj-tbl-check",
            attr: { type: "checkbox", "aria-label": "Select this trade" },
          });
          check.checked = !!t.id && !!opts.selected?.has(t.id);
          const toggle = (e: Event): void => {
            // Selection mode is for choosing, not for opening. A click anywhere in
            // the cell — the box, the padding around it, the cell itself — selects
            // and never bubbles to the row.
            e.stopPropagation();
            // The box must keep its own default action. Cancel it and the UA restores
            // the pre-click checkedness *after* this handler runs, overwriting whatever
            // we set — the box then read one click behind the selection.
            if (e.target !== check) e.preventDefault();
            opts.onToggleSelect?.(t, (e as MouseEvent).shiftKey);
          };
          check.addEventListener("click", toggle);
          hit.addEventListener("click", toggle);
          cell.addEventListener("click", toggle);
          cell.addEventListener("mousedown", (e) => e.stopPropagation());
        }

        if (opts.rail) {
          // One dot per trade: solid, green or red, outside the figures but
          // inside the table, so the columns stay in step with the header.
          const cell = row.createEl("td", { cls: "tj-tbl-rail" });
          const dot = cell.createEl("i", { cls: (t.pnl ?? 0) < 0 ? "loss" : "" });
          const facts = [tradeEntryTimeInZone(t, zoneOf(plugin)).trim() || "no time", fmtMoney(t.pnl ?? 0)];
          if (i === 0) facts.push("First of the session");
          if (i === group.rows.length - 1) facts.push("Last of the session");
          attachTip(dot, { title: facts[0], sub: facts.slice(1).join(" · ") });
        }

        for (const col of cols) {
          const cell = row.createEl("td", { cls: col.align === "left" ? "l" : "" });
          col.render(cell, t, plugin, { ...ctx, row: tradeRow });
        }

        // The copies behind this decision, when the chip is open.
        if (copiesExpanded.has(t.id) && tradeRow.legs.length > 1) drawCopyRow(body, tradeRow);

        // The executions, when this trade has them open.
        const set = fillSet(t);
        if (set.isMulti && expanded.has(t.id)) for (const f of set.fills) drawFillRow(body, t, set, f);
      });
    }
  };

  draw();
}

// Test hook (see lib/fills.ts): the ledger is rendered by two views, so the
// harness drives it directly instead of going through a whole page.
if (typeof window !== "undefined") {
  (window as any).__tjTradeTable = { renderTradeTable, holdFmt, tradeR, orderedTradeRows, tradeRows };
}
