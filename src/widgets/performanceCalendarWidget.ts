// Performance calendar widget: a self-contained month grid with P&L per day,
// week totals and month KPIs. Used on the dashboard (and potentially on Home).
// It mirrors the Calendar view but is reusable — the dashboard passes the
// already-filtered trades and gets an onDayClick callback.

import { Trade } from "../types";
import { kpiCard } from "../ui";
import { isFiniteNumber, toZoneDate } from "../tz";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface PerfCalOpts {
  timeZone: string;
  onDayClick: (dateKey: string) => void;
  showNav?: boolean;
  greyscaleNeutral?: boolean;
}

export class PerformanceCalendarWidget {
  el: HTMLElement;
  trades: Trade[];
  timeZone: string;
  opts: PerfCalOpts;
  year: number;
  month: number;
  private labelEl: HTMLElement | null = null;
  private kpiEl: HTMLElement | null = null;
  private gridEl: HTMLElement | null = null;

  constructor(container: HTMLElement, trades: Trade[], opts: PerfCalOpts) {
    this.trades = trades;
    this.opts = opts;
    this.timeZone = opts.timeZone || "Europe/Lisbon";
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.el = container.createDiv({ cls: "tj-perfcal" });
    this.render();
  }

  dayKey(t: Trade): string {
    return toZoneDate(t.date, t.entryTime, this.timeZone);
  }

  setTrades(trades: Trade[]): void {
    this.trades = trades;
    this.draw();
  }

  private render(): void {
    const box = this.el;
    box.empty();
    if (this.opts.showNav !== false) {
      const nav = box.createDiv({ cls: "tj-cal-nav" });
      nav.createEl("button", { text: "‹", cls: "tj-btn", attr: { title: "Previous month" } }).addEventListener("click", () => this.shiftMonth(-1));
      this.labelEl = nav.createEl("span", { cls: "tj-cal-label" });
      nav.createEl("button", { text: "›", cls: "tj-btn", attr: { title: "Next month" } }).addEventListener("click", () => this.shiftMonth(1));
      nav.createEl("button", { text: "Today", cls: "tj-chip" }).addEventListener("click", () => {
        const now = new Date();
        this.year = now.getFullYear();
        this.month = now.getMonth();
        this.draw();
      });
    }
    this.kpiEl = box.createDiv({ cls: "tj-kpis" });
    this.gridEl = box.createDiv({ cls: "tj-cal-grid" });
    this.draw();
  }

  shiftMonth(delta: number): void {
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.draw();
  }

  draw(): void {
    const byDay = new Map<string, { pnl: number; count: number; wins: number }>();
    for (const t of this.trades) {
      if (!isFiniteNumber(t.pnl) || !t.date) continue;
      const key = this.dayKey(t);
      let bucket = byDay.get(key);
      if (!bucket) {
        bucket = { pnl: 0, count: 0, wins: 0 };
        byDay.set(key, bucket);
      }
      bucket.pnl += t.pnl;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    const prefix = `${this.year}-${String(this.month + 1).padStart(2, "0")}`;
    let net = 0;
    let count = 0;
    let wins = 0;
    let days = 0;
    let winDays = 0;
    for (const [key, b] of byDay) {
      if (key.startsWith(prefix)) {
        net += b.pnl;
        count += b.count;
        wins += b.wins;
        days += 1;
        if (b.pnl > 0) winDays += 1;
      }
    }
    if (this.kpiEl) {
      const kpis = this.kpiEl;
      kpis.empty();
      kpiCard(kpis, "Net P&L", `${net >= 0 ? "+" : ""}$${net.toFixed(2)}`, net >= 0 ? "pos" : "neg");
      kpiCard(kpis, "Trades", `${count}`, "neutral");
      kpiCard(kpis, "Win Rate", count ? `${Math.round((wins / count) * 100)}%` : "—", "neutral");
      kpiCard(kpis, "Day Win Rate", days ? `${Math.round((winDays / days) * 100)}%` : "—", "neutral");
      kpiCard(kpis, "Days", `${days}`, "neutral");
      kpiCard(kpis, "Avg / Day", days ? `${net >= 0 ? "+" : ""}$${(net / days).toFixed(2)}` : "—", net >= 0 ? "pos" : "neg");
    }
    if (this.labelEl) this.labelEl.setText(new Date(this.year, this.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }));

    const grid = this.gridEl;
    if (!grid) return;
    grid.empty();
    for (const wd of WEEKDAYS) grid.createEl("div", { text: wd, cls: "tj-cal-wd" });
    grid.createEl("div", { cls: "tj-cal-wd tj-cal-wtotal-head", text: "Wk" });

    const lead = (new Date(this.year, this.month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth();
    const td = today.getDate();
    const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;
    const start = new Date(this.year, this.month, 1 - lead);
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const inMonth = d.getMonth() === this.month;
      const col = i % 7;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const bucket = byDay.get(key);
      const dayTone = inMonth && bucket ? (bucket.pnl > 0 ? " pos" : bucket.pnl < 0 ? " neg" : " be") : "";
      const cell = grid.createEl("div", {
        cls: "tj-cal-cell tj-clickable-cell" + (col < 5 ? " td" : " we") + (inMonth ? dayTone : " tj-cal-dim"),
      });
      cell.addEventListener("click", () => this.opts.onDayClick(key));
      if (inMonth && ty === d.getFullYear() && tm === d.getMonth() && td === d.getDate()) cell.addClass("today");
      cell.createDiv({ cls: "tj-cal-num" + (bucket || !inMonth ? "" : " tj-cal-muted"), text: String(d.getDate()) });
      if (bucket) {
        const pnl = cell.createDiv({ cls: "tj-cal-pnl" });
        pnl.addClass(bucket.pnl > 0 ? "tj-pos" : bucket.pnl < 0 ? "tj-neg" : "tj-be");
        pnl.textContent = `${bucket.pnl >= 0 ? "+" : ""}$${bucket.pnl.toFixed(0)}`;
        cell.createDiv({ cls: "tj-cal-trades", text: `${bucket.count} tr · ${Math.round((bucket.wins / bucket.count) * 100)}%` });
        cell.setAttr("title", `${key} — ${bucket.count} trades, ${bucket.wins} wins, ${bucket.pnl >= 0 ? "+" : ""}$${bucket.pnl.toFixed(2)}`);
      }
      if (i % 7 === 6) {
        const weekNum = Math.floor(i / 7) + 1;
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - 6);
        let wPnl = 0;
        let wCount = 0;
        let wWins = 0;
        for (let u = 0; u < 7; u++) {
          const dd = new Date(weekStart);
          dd.setDate(dd.getDate() + u);
          const wk = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
          const wb = byDay.get(wk);
          if (wb) {
            wPnl += wb.pnl;
            wCount += wb.count;
            wWins += wb.wins;
          }
        }
        const wcell = grid.createEl("div", { cls: "tj-cal-wtotal" + (wCount > 0 ? (wPnl >= 0 ? " pos" : " neg") : "") });
        wcell.createDiv({ cls: "tj-cal-wknum", text: `Week ${weekNum}` });
        if (wCount > 0) {
          wcell.createDiv({ cls: "tj-cal-wrate", text: `${Math.round((wWins / wCount) * 100)}%` });
          wcell.createDiv({ cls: "tj-cal-wpnl", text: `${wPnl >= 0 ? "+" : ""}$${wPnl.toFixed(0)}` });
          wcell.createDiv({ cls: "tj-cal-wtrades", text: `${wCount} tr` });
          wcell.setAttr("title", `Week ${weekNum} — ${wCount} trades, ${wWins} wins, ${wPnl >= 0 ? "+" : ""}$${wPnl.toFixed(2)}`);
        } else {
          wcell.createDiv({ cls: "tj-cal-wrate tj-cal-muted", text: "—" });
        }
      }
    }
  }
}