// Performance calendar — Journalit-style month grid.
// Mon–Fri columns + a week-number column, day cells tinted by P&L intensity,
// a metric toggle (P&L / Trades) and a compact P&L scale. Click a day to open
// the Trade Log filtered to that day.

import { Trade } from "../types";
import { fmtMoney, isFiniteNumber, toZoneDate } from "../tz";
import { formatDate } from "../lib/dates";
import { attachTip } from "../lib/tip";

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Only one calendar tooltip may exist at a time, and it lives on <body>. */
let ACTIVE_TIP: HTMLElement | null = null;
let TIP_LISTENER = false;
function killTip(): void {
  if (ACTIVE_TIP) {
    ACTIVE_TIP.remove();
    ACTIVE_TIP = null;
  }
}
function ensureTipListener(): void {
  if (TIP_LISTENER) return;
  TIP_LISTENER = true;
  // Safety net: whenever the pointer leaves a calendar cell (anywhere in the
  // app, any page), drop the tooltip so nothing can get stuck.
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!ACTIVE_TIP) return;
      const el = e.target as HTMLElement | null;
      if (!el || !el.closest || !el.closest(".tj-pcal-cell")) killTip();
    },
    true
  );
}

export interface PerfCalOpts {
  timeZone: string;
  onDayClick: (dateKey: string) => void;
  showNav?: boolean;
  greyscaleNeutral?: boolean;
  /** Play a small entrance animation (first render only). */
  animate?: boolean;
  /** Date format from settings (so the hover card matches the rest). */
  dateFormat?: string;
}

interface DayBucket {
  pnl: number;
  count: number;
  wins: number;
}

export class PerformanceCalendarWidget {
  el: HTMLElement;
  trades: Trade[];
  timeZone: string;
  opts: PerfCalOpts;
  year: number;
  month: number;
  private titleEl: HTMLElement | null = null;
  private tipEl: HTMLElement | null = null;
  private gridEl: HTMLElement | null = null;
  private wdRowEl: HTMLElement | null = null;

  constructor(container: HTMLElement, trades: Trade[], opts: PerfCalOpts) {
    this.trades = trades;
    this.opts = opts;
    this.timeZone = opts.timeZone ?? "";
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.el = container.createDiv({ cls: "tj-pcal" });
    // Remove any orphaned tooltips left behind by previous instances / views.
    document.querySelectorAll(".tj-pcal-tip").forEach((n) => n.remove());
    ACTIVE_TIP = null;
    ensureTipListener();
    this.render();
  }

  dayKey(t: Trade): string {
    return toZoneDate(t.date, t.entryTime, this.timeZone);
  }

  setTrades(trades: Trade[]): void {
    this.trades = trades;
    this.draw();
  }

  shiftMonth(delta: number): void {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.draw();
  }

  private render(): void {
    const box = this.el;
    box.empty();

    const head = box.createDiv({ cls: "tj-pcal-top" });
    const prev = head.createEl("button", { cls: "tj-pcal-nav", text: "‹", attr: { type: "button", "aria-label": "Previous month" } });
    attachTip(prev, { title: "Previous month" });
    prev.addEventListener("click", () => this.shiftMonth(-1));
    head.createDiv({ cls: "tj-pcal-name", text: "Performance Calendar" });
    const next = head.createEl("button", { cls: "tj-pcal-nav", text: "›", attr: { type: "button", "aria-label": "Next month" } });
    attachTip(next, { title: "Next month" });
    next.addEventListener("click", () => this.shiftMonth(1));
    this.titleEl = box.createDiv({ cls: "tj-pcal-title" });

    const body = box.createDiv({ cls: "tj-pcal-body" });
    this.wdRowEl = body.createDiv({ cls: "tj-pcal-wdrow" });
    this.gridEl = body.createDiv({ cls: "tj-pcal-grid" });
    this.draw();
  }

  private buckets(): Map<string, DayBucket> {
    const byDay = new Map<string, DayBucket>();
    for (const t of this.trades) {
      if (!isFiniteNumber(t.pnl) || !t.date) continue;
      const key = this.dayKey(t);
      const b = byDay.get(key) ?? { pnl: 0, count: 0, wins: 0 };
      b.pnl += t.pnl;
      b.count += 1;
      if (t.pnl > 0) b.wins += 1;
      byDay.set(key, b);
    }
    return byDay;
  }

  draw(): void {
    const byDay = this.buckets();
    const monthName = new Date(this.year, this.month, 1).toLocaleDateString("en-US", { month: "short" }).toUpperCase();
    const quarter = Math.floor(this.month / 3) + 1;
    if (this.titleEl) this.titleEl.setText(`${monthName} · Q${quarter} ${this.year}`);

    const grid = this.gridEl;
    if (!grid) return;
    if (this.tipEl) { this.tipEl.remove(); this.tipEl = null; }
    grid.empty();

    // Weekday headers (Mon–Fri) + "WEEK" column, on their own compact row.
    if (this.wdRowEl) {
      this.wdRowEl.empty();
      for (const wd of WEEKDAYS) this.wdRowEl.createEl("div", { cls: "tj-pcal-wd", text: wd });
      this.wdRowEl.createEl("div", { cls: "tj-pcal-wd tj-pcal-wkhead", text: "WEEK" });
    }

    const first = new Date(this.year, this.month, 1);
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const weeks = Math.ceil((lead + daysInMonth) / 7);
    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth();
    const td = today.getDate();

    let rowsBefore = 0;
    for (let r = 0; r < weeks; r++) {
      let has = false;
      for (let c = 0; c < 5; c++) {
        const dn = r * 7 + c + 1 - lead;
        if (dn >= 1 && dn <= daysInMonth) { has = true; break; }
      }
      if (has) break;
      rowsBefore++;
    }

    for (let w = 0; w < weeks; w++) {
      let weekPnl = 0;
      let weekHasData = false;
      let weekHasMonth = false;

      for (let c = 0; c < 5; c++) {
        const dayNum = w * 7 + c + 1 - lead;
        const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
        const key = `${this.year}-${String(this.month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
        const b = inMonth ? byDay.get(key) : undefined;
        const cell = grid.createEl("div", { cls: "tj-pcal-cell" + (inMonth ? "" : " is-dim") });
        if (this.opts.animate && inMonth) {
          cell.addClass("tj-pcal-in");
          cell.style.animationDelay = `${(w * 30 + c * 12)}ms`;
        }

        if (inMonth) {
          weekHasMonth = true;
          cell.createDiv({ cls: "tj-pcal-num", text: String(dayNum) });
          if (b) {
            weekPnl += b.pnl;
            weekHasData = true;
            // Soft tints matching the equity chart palette (green #227a4a / red #8f2b1e).
            // Colour lives in the stylesheet (.is-pos / .is-neg) so the theme
            // can give it a soft-neon treatment.
            cell.addClass(b.pnl > 0 ? "is-pos" : b.pnl < 0 ? "is-neg" : "is-flat");
            cell.createDiv({ cls: "tj-pcal-val", text: fmtMoney(b.pnl, 0) });
            this.bindDayTip(cell, key, b);
          }
          if (ty === this.year && tm === this.month && td === dayNum) cell.addClass("today");
          cell.addEventListener("click", () => this.opts.onDayClick(key));
        } else {
          // Days from the previous/next month — shown, but faded into the background.
          const prevDays = new Date(this.year, this.month, 0).getDate();
          const outNum = dayNum < 1 ? prevDays + dayNum : dayNum - daysInMonth;
          cell.createDiv({ cls: "tj-pcal-num tj-pcal-num-out", text: String(outNum) });
        }
      }

      // Week number column — just the label, tinted by the week's net.
      const wk = grid.createEl("div", { cls: "tj-pcal-wk" });
      if (weekHasMonth) {
        wk.createDiv({ cls: "tj-pcal-wknum", text: String(w - rowsBefore + 1) });
        if (weekHasData) {
          const tone = weekPnl > 0 ? "tj-pos" : weekPnl < 0 ? "tj-neg" : "";
          wk.createDiv({ cls: "tj-pcal-wkpnl " + tone, text: fmtMoney(weekPnl, 0) });
          wk.addClass(weekPnl > 0 ? "is-pos" : weekPnl < 0 ? "is-neg" : "is-flat");
        }
      }
    }

  }

  /** Custom hover card for a day cell (the native title tooltip looks bad). */
  private bindDayTip(cell: HTMLElement, key: string, b: DayBucket | undefined): void {
    const [y, m, d] = key.split("-");
    const label = this.opts.dateFormat
      ? formatDate(key, this.opts.dateFormat)
      : `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1] ?? ""} ${y}`;
    cell.addEventListener("mouseenter", () => this.showDayTip(label, b));
    cell.addEventListener("mousemove", (e) => this.moveTip(e));
    cell.addEventListener("mouseleave", () => this.hideTip());
  }

  private showDayTip(label: string, b?: DayBucket): void {
    ensureTipListener();
    killTip();
    const tip = document.body.createDiv({ cls: "tj-pcal-tip" });
    ACTIVE_TIP = tip;
    this.tipEl = tip;
    tip.empty();
    tip.createDiv({ cls: "tj-pcal-tip-date", text: label });
    if (b) {
      tip.createDiv({ cls: "tj-pcal-tip-val " + (b.pnl >= 0 ? "tj-pos" : "tj-neg"), text: fmtMoney(b.pnl, 2) });
      tip.createDiv({ cls: "tj-pcal-tip-sub", text: `${b.count} trade${b.count === 1 ? "" : "s"} · ${Math.round((b.wins / b.count) * 100)}% win` });
    } else {
      tip.createDiv({ cls: "tj-pcal-tip-sub", text: "No trades" });
    }
    tip.addClass("is-visible");
  }

  private moveTip(e: MouseEvent): void {
    const tip = this.tipEl;
    if (!tip) return;
    const pad = 12;
    const w = tip.offsetWidth || 120;
    const h = tip.offsetHeight || 60;
    let left = e.clientX + pad;
    let top = e.clientY - h - pad;
    if (left + w > window.innerWidth - 8) left = e.clientX - w - pad;
    if (top < 8) top = e.clientY + pad;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  private hideTip(): void {
    if (this.tipEl) {
      this.tipEl.remove();
      if (ACTIVE_TIP === this.tipEl) ACTIVE_TIP = null;
      this.tipEl = null;
    }
  }
}
