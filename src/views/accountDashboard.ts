import { ItemView } from "obsidian";
import type TradingJournalPlugin from "../main";
import { Trade } from "../types";
import { effectiveSize, getFirm, getProgram, getSize } from "../props";
import { attachTooltip, clamp, kpiCard, pathFromPoints, renderAppShell, renderAreaChart, svgLine } from "../ui";
import { fmtMoney, isFiniteNumber, todayKey, toZoneDate } from "../tz";

export const ACCOUNT_DASH_VIEW_TYPE = "trading-journal-account-dash-view";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export class AccountDashboardView extends ItemView {
  plugin: TradingJournalPlugin;
  accountId: string | null = null;
  trades: Trade[] = [];

  constructor(leaf: any, plugin: TradingJournalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ACCOUNT_DASH_VIEW_TYPE;
  }

  getDisplayText(): string {
    const acc = this.account();
    return acc ? `Accounts — ${acc.name}` : "Accounts";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  getState(): any {
    return { accountId: this.accountId };
  }

  async setState(state: any, result: any): Promise<void> {
    this.accountId = typeof state?.accountId === "string" ? state.accountId : null;
    await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.trades = await this.plugin.loadTrades();
    this.render();
  }

  async onClose(): Promise<void> {}

  account() {
    const accounts = this.plugin.settings.propAccounts || [];
    return (
      accounts.find((a) => a.id === this.accountId) ??
      accounts.find((a) => a.id === this.plugin.getPrimaryAccount()?.id) ??
      accounts[0]
    );
  }

  /** Dropdown to switch between configured accounts. */
  accountPicker(parent: HTMLElement, acc: { id: string; name: string; size: number; scope: string }): void {
    const accounts = this.plugin.settings.propAccounts || [];
    const sel = parent.createEl("select", { cls: "dropdown tj-account-picker" });
    sel.setAttr("aria-label", "Switch account");
    for (const a of accounts) {
      const opt = sel.createEl("option", { value: a.id, text: `${a.name} · $${(a.size / 1000).toFixed(0)}K` });
      if (a.id === acc.id) opt.setAttr("selected", "selected");
    }
    sel.value = acc.id;
    sel.addEventListener("change", () => {
      this.accountId = sel.value;
      this.plugin.settings.primaryAccountId = this.accountId ?? "";
      void this.plugin.saveSettings();
      this.render();
    });
  }

  scoped(): Trade[] {
    const acc = this.account();
    if (!acc) return [];
    return this.trades
      .filter((t) => {
        if (!isFiniteNumber(t.pnl) || !t.date) return false;
        if (acc.scope === "all") return true;
        const mapped = this.plugin.mappedAccount(t.account);
        return mapped ? mapped.id === acc.id : (t.account || "").trim().toLowerCase() === (acc.name || "").trim().toLowerCase();
      })
      .sort((a, b) => {
        const ka = this.dayKey(a);
        const kb = this.dayKey(b);
        return ka.localeCompare(kb) || (a.id || "").localeCompare(b.id || "");
      });
  }

  dayKey(t: Trade): string {
    return toZoneDate(t.date, t.entryTime, this.plugin.settings.timeZone);
  }

  todayKey(): string {
    return todayKey(this.plugin.settings.timeZone);
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTrades();
    this.render();
  }

  /** Open the plugin's own Settings tab (not the general Obsidian settings). */
  openPluginSettings(): void {
    const app = this.app as any;
    try {
      if (typeof app.setting?.openTabById === "function") {
        app.setting.openTabById(this.plugin.manifest.id);
        return;
      }
    } catch (err) {
      console.error("[trading-journal] openTabById failed:", err);
    }
    // Fallback: open Obsidian settings and switch to this plugin's tab.
    try {
      if (typeof app.setting?.open === "function") {
        app.setting.open();
        const tabs = app.setting?.settingTabs ?? [];
        const tab = tabs.find((t: any) => t.id === this.plugin.manifest.id);
        if (tab && typeof tab.display === "function") tab.display();
      }
    } catch (err) {
      console.error("[trading-journal] settings open failed:", err);
    }
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-account-dash");
    const main = renderAppShell(root, this.plugin, "accounts");

    const acc = this.account();
    if (!acc) {
      const empty = main.createDiv({ cls: "tj-empty" });
      empty.createDiv({ text: "No accounts configured yet — add your first account in Settings to see its dashboard here." });
      empty.createEl("button", { text: "Open Settings", cls: "mod-cta tj-btn", attr: { type: "button" } }).addEventListener("click", () => {
        this.openPluginSettings();
      });
      return;
    }
    const firm = getFirm(acc.firmId);
    const program = getProgram(firm, acc.programId);
    const size = effectiveSize(getSize(program, acc.size), acc.rules);
    if (!firm || !program || !size) {
      main.createDiv({ cls: "tj-empty", text: "Unknown firm/program — please re-create this account in the Accounts tab." });
      return;
    }
    const topbar = main.createDiv({ cls: "tj-account-topbar" });
    this.accountPicker(topbar, acc);
    topbar.createEl("button", { text: "Settings", cls: "tj-btn tj-mini", attr: { title: "Add, edit or remove accounts" } }).addEventListener("click", () => {
      this.openPluginSettings();
    });
    const title = main.createDiv({ cls: "tj-dash-title" });
    title.createEl("h1", { text: acc.name });
    title.createEl("p", {
      cls: "tj-account-meta tj-account-meta-big",
      text: `${firm.name} · ${program.label} · $${(acc.size / 1000).toFixed(0)}K  —  tracks: ${acc.scope === "all" ? "all journal trades" : acc.scope + " trades"}`,
    });

    const scoped = this.scoped();
    const byDay = new Map<string, { net: number; count: number; wins: number }>();
    for (const t of scoped) {
      const key = this.dayKey(t);
      let bucket = byDay.get(key);
      if (!bucket) {
        bucket = { net: 0, count: 0, wins: 0 };
        byDay.set(key, bucket);
      }
      bucket.net += t.pnl;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    const days = [...byDay.keys()].sort();
    const series: { date: string; net: number; cum: number }[] = [];
    let running = 0;
    for (const d of days) {
      running += byDay.get(d)!.net;
      series.push({ date: d, net: byDay.get(d)!.net, cum: running });
    }
    const net = running;
    const startBalance = firm.id === "tradovate" ? acc.size : 0;
    const peak = Math.max(0, ...series.map((s) => s.cum)) || 0;
    const floor = Math.min(peak - size.maxLoss, 0);
    const buffer = net - floor;
    const grossProfit = days.reduce((s, d) => s + Math.max(0, byDay.get(d)!.net), 0);
    const bestDay = days.reduce((s, d) => Math.max(s, byDay.get(d)!.net), 0);
    const consistency = grossProfit > 0 ? (bestDay / grossProfit) * 100 : 0;
    const consistencyNeed = size.consistency > 0 && bestDay > 0 ? bestDay / (size.consistency / 100) - grossProfit : 0;
    const todayNet = byDay.get(this.todayKey())?.net ?? 0;
    const tradeCount = scoped.length;
    const winCount = scoped.filter((t) => t.pnl > 0).length;
    const targetReached = size.target > 0 ? net >= size.target : false;
    const targetPct = size.target > 0 ? Math.min(100, (net / size.target) * 100) : 0;

if (acc.scope === "eval" && targetReached && !this.plugin.isCelebrationDismissed(acc.id)) {
      void this.showEvalPassedModal(acc, size, net);
    }

    const kpis = main.createDiv({ cls: "tj-kpis" });
    if (startBalance > 0) kpiCard(kpis, "Balance", `$${(startBalance + net).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, net >= 0 ? "pos" : "neg");
    kpiCard(kpis, "Net P&L", fmtMoney(net), net >= 0 ? "pos" : "neg");
    kpiCard(kpis, "Profit Target", size.target ? `${fmtMoney(net)} / $${size.target.toLocaleString()}` : "—", targetReached ? "pos" : "neutral");
    kpiCard(kpis, "Target progress", size.target ? `${targetPct.toFixed(0)}% ${targetReached ? "✓ reached" : `(need ${fmtMoney(size.target - net)})`}` : "—", targetReached ? "pos" : "neutral");
    kpiCard(kpis, "Drawdown floor", size.maxLoss ? `${fmtMoney(floor)} (buffer ${fmtMoney(buffer)})` : "None (practice)", size.maxLoss ? (buffer > 0 ? "pos" : "neg") : "neutral");
    kpiCard(kpis, "Daily Loss Limit", size.dailyLoss ? `${fmtMoney(todayNet)} / -$${size.dailyLoss.toLocaleString()}` : "None", size.dailyLoss && todayNet <= -size.dailyLoss ? "neg" : todayNet >= 0 ? "pos" : "neutral");
    kpiCard(kpis, "Consistency", size.consistency ? `${consistency.toFixed(0)}% / ${size.consistency}%` : "None", size.consistency && consistency <= size.consistency ? "pos" : "neutral");
    kpiCard(kpis, "Win Rate", tradeCount ? `${Math.round((winCount / tradeCount) * 100)}%` : "—", "neutral");
    kpiCard(kpis, "Max Position", size.posSize, "neutral");
    // Fase 2+3: Rule gauges (visual progress bars with hover tooltips)
    this.renderGauges(main, {
      size,
      net,
      floor,
      buffer,
      todayNet,
      consistency,
      targetPct,
      targetReached,
    });
    if (size.consistency > 0 && consistencyNeed > 0 && grossProfit > 0) {
      main.createDiv({
        cls: "tj-account-note tj-account-warn",
        text: `Best day is ${consistency.toFixed(0)}% of profit — to satisfy the ${size.consistency}% consistency rule you need ${fmtMoney(consistencyNeed)} total profit.`,
      });
    }
    if (size.note) main.createDiv({ cls: "tj-account-note", text: size.note });

    const chartBox = main.createDiv({ cls: "tj-chart-box" });
    if (series.length > 0) this.renderAccountChart(chartBox, series, size.target, floor, startBalance);
    else main.createDiv({ cls: "tj-empty", text: "No trades for this account yet." });

    const table = main.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Trades", "Net", "Net P&L", startBalance > 0 ? "Balance" : "Cumulative", size.maxLoss ? "To floor" : "--"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    for (const s of [...series].reverse()) {
      const b = byDay.get(s.date)!;
      const tr = tbody.createEl("tr");
      const parts = s.date.split("-");
      tr.createEl("td", { text: `${parts[2]}/${MONTHS[+parts[1] - 1]}/${parts[0]}` });
      tr.createEl("td", { text: String(b.count) });
      tr.createEl("td", { text: `${b.wins}W / ${b.count - b.wins}L` });
      const netTd = tr.createEl("td");
      netTd.addClass(s.net >= 0 ? "tj-pos" : "tj-neg");
      netTd.textContent = fmtMoney(s.net);
      const cumTd = tr.createEl("td");
      cumTd.addClass(s.cum >= 0 ? "tj-pos" : "tj-neg");
      cumTd.textContent = startBalance > 0 ? `$${(startBalance + s.cum).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : fmtMoney(s.cum);
      if (size.maxLoss) tr.createEl("td", { text: fmtMoney(s.cum - floor) });
      else tr.createEl("td", { text: "—" });
    }
    // Fase 4: trades desta conta (clickável -> abre a nota)
    this.renderAccountTrades(main, scoped, byDay);
    // Fase 5: breakdown por dia da semana
    this.renderWeekdayBreakdown(main, scoped);
    // Fase 7: payouts — only for funded / live accounts
    if (acc.scope === "funded" || acc.live) this.renderPayoutTracker(main, acc);
  }

  showEvalPassedModal(acc: any, size: any, net: number): void {
    // Guard: never stack two celebration modals (double render / double click bug).
    document.querySelectorAll(".tj-celebration-overlay").forEach((o) => o.remove());
    const overlay = document.body.createDiv({ cls: "tj-modal-overlay tj-celebration-overlay" });
    const modal = overlay.createDiv({ cls: "tj-modal tj-celebration" });
    modal.createDiv({ cls: "tj-confetti tj-c1" });
    modal.createDiv({ cls: "tj-confetti tj-c2" });
    modal.createDiv({ cls: "tj-confetti tj-c3" });
    modal.createDiv({ cls: "tj-trophy-big", text: "🏆" });
    modal.createEl("h2", { text: "CONGRATULATIONS!" });
    modal.createEl("h3", { text: "You Passed this Evaluation!" });
    modal.createEl("p", {
      cls: "tj-celebration-detail",
      text: `${acc.name} · Target of $${size.target.toLocaleString()} reached (${fmtMoney(net)} net P&L). You are ready for your funded account.`,
    });
    const actions = modal.createDiv({ cls: "tj-celebration-actions" });

    const dismiss = () => {
      overlay.remove();
      // Remember for this session so re-renders / other views don't re-show it.
      this.plugin.markCelebrationDismissed(acc.id);
    };

    async function doUpgrade(action: "keep" | "archive" | "delete") {
      const newId = await this.plugin.upgradeAccountToFunded(acc.id, action);
      overlay.remove();
      if (newId) await this.plugin.openAccountDashboard(this.leaf, newId);
    }

    const upBtn = actions.createEl("button", { text: "🚀 Upgrade to Funded", cls: "mod-cta tj-btn" });
    upBtn.addEventListener("click", () => doUpgrade("keep"));
    const archBtn = actions.createEl("button", { text: "📦 Archive & Upgrade", cls: "tj-btn" });
    archBtn.addEventListener("click", () => doUpgrade("archive"));
    const delBtn = actions.createEl("button", { text: "🗑️ Delete & Upgrade", cls: "tj-btn tj-del" });
    delBtn.addEventListener("click", async () => {
      if (confirm("Delete this passed eval account and switch to Funded?")) {
        await doUpgrade("delete");
      }
    });
    const laterBtn = actions.createEl("button", { text: "Later", cls: "tj-btn tj-mini" });
    laterBtn.addEventListener("click", dismiss);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
  }

  renderPayoutTracker(box: HTMLElement, acc: any): void {
    const payouts = this.plugin.payoutsFor(acc.id);
    const totalPaid = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
    const section = box.createDiv({ cls: "tj-payout-box" });
    const head = section.createDiv({ cls: "tj-payout-head" });
    head.createEl("h3", { text: `Payouts — total withdrawn $${totalPaid.toLocaleString()}` });
    const addBtn = head.createEl("button", { text: "+ Add payout", cls: "tj-btn tj-mini" });
    addBtn.addEventListener("click", () => this.showPayoutForm(section, acc));

    const table = section.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Amount", "Status", ""].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    if (payouts.length === 0) {
      const tr = tbody.createEl("tr");
      const td = tr.createEl("td", { attr: { colspan: "4" } });
      td.createDiv({ cls: "tj-empty", text: "No payouts recorded yet. Add the first one to start tracking your total withdrawals." });
    }
    for (const p of payouts) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: p.date });
      const amt = tr.createEl("td");
      amt.addClass("tj-pos");
      amt.textContent = `$${p.amount.toLocaleString()}`;
      tr.createEl("td", { text: p.status === "paid" ? "Paid" : "Requested", cls: "tj-badge " + (p.status === "paid" ? "ok" : "") });
      const del = tr.createEl("td").createEl("button", { text: "✕", cls: "tj-mini tj-del", attr: { title: "Remove payout" } });
      del.addEventListener("click", async () => {
        await this.plugin.removePayout(p.id);
        this.render();
      });
    }
  }

  showPayoutForm(section: HTMLElement, acc: any): void {
    const form = section.createDiv({ cls: "tj-payout-form" });
    const row = form.createDiv({ cls: "tj-form-row" });
    row.createEl("label", { text: "Date" });
    const dateInput = row.createEl("input", { type: "date", cls: "tj-input", value: this.todayKey() });
    row.createEl("label", { text: "Amount ($)" });
    const amountInput = row.createEl("input", { type: "number", cls: "tj-input", attr: { min: "1", step: "1", placeholder: "1000" } });
    row.createEl("label", { text: "Status" });
    const statusSel = row.createEl("select", { cls: "dropdown" });
    statusSel.createEl("option", { value: "paid", text: "Paid", attr: { selected: "selected" } });
    statusSel.createEl("option", { value: "requested", text: "Requested" });
    row.createEl("label", { text: "Note (optional)" });
    const noteInput = row.createEl("input", { type: "text", cls: "tj-input", attr: { placeholder: "e.g. 90/10 split" } });
    const save = row.createEl("button", { text: "Save payout", cls: "mod-cta tj-btn" });
    save.addEventListener("click", async () => {
      const amount = Math.max(1, Math.round(parseFloat(amountInput.value) || 0));
      if (amount <= 0) return;
      const date = dateInput.value || this.todayKey();
      const status = statusSel.value === "paid" ? "paid" : "requested";
      await this.plugin.registerPayout(acc.id, date, amount, status, noteInput.value.trim() || undefined);
      form.remove();
      this.render();
    });
    const cancel = row.createEl("button", { text: "Cancel", cls: "tj-btn tj-mini" });
    cancel.addEventListener("click", () => form.remove());
  }

  renderAccountChart(box: HTMLElement, series: { date: string; cum: number }[], target: number, floor: number, startBalance = 0): void {
    const svg = box.createSvg("svg", { cls: "tj-chart" });
    svg.setAttribute("viewBox", "0 0 600 200");
    svg.setAttribute("preserveAspectRatio", "none");
    const W = 600;
    const H = 200;
    const PAD = 22;
    const values = series.map((s) => s.cum + startBalance);
    const n = values.length;
    const finite = values.filter(Number.isFinite);
    const max = Math.max(target, floor, startBalance, ...(finite.length ? finite : [0]));
    const min = Math.min(floor, startBalance, ...(finite.length ? finite : [0]));
    const range = max - min || 1;
    const x = (i: number) => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2);
    const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
    svgLine(svg, PAD, y(startBalance), W - PAD, y(startBalance), "tj-chart-base");
    if (target > 0) svgLine(svg, PAD, y(target), W - PAD, y(target), "tj-chart-target");
    if (floor < 0) svgLine(svg, PAD, y(floor), W - PAD, y(floor), "tj-chart-floor");
    const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
    const lineD = pathFromPoints(pts);
    const zeroY = y(startBalance);
    renderAreaChart(svg, lineD, zeroY, H, W, x(0), x(n - 1));
    const { show, hide } = attachTooltip(box);
    const guide = svg.createSvg("line", { cls: "tj-chart-guide" });
    guide.setAttribute("y1", String(PAD));
    guide.setAttribute("y2", String(H - PAD));
    guide.style.display = "none";
    svg.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const idx = clamp(Math.round(((px - PAD) / (W - PAD * 2)) * (n - 1)), 0, n - 1);
      guide.setAttribute("x1", String(x(idx)));
      guide.setAttribute("x2", String(x(idx)));
      guide.style.display = "block";
      const label = startBalance > 0 ? `$${values[idx].toLocaleString(undefined, { maximumFractionDigits: 0 })}` : fmtMoney(values[idx]);
      show(e.clientX, e.clientY, `${series[idx].date}  •  ${label}`);
    });
    svg.addEventListener("mouseleave", () => {
      guide.style.display = "none";
      hide();
    });
  }

  /** Fase 2+3: visual rule gauges — progress bars toward target / drawdown / DLL / consistency, with hover tooltips. */
  renderGauges(
    root: HTMLElement,
    d: {
      size: any;
      net: number;
      floor: number;
      buffer: number;
      todayNet: number;
      consistency: number;
      targetPct: number;
      targetReached: boolean;
    }
  ): void {
    const { size } = d;
    const box = root.createDiv({ cls: "tj-gauges" });
    box.createEl("h3", { text: "Prop rules" });
    const gauge = (
      label: string,
      pct: number,
      valueText: string,
      tip: string,
      tone: "pos" | "neg" | "warn" | "neutral" = "neutral"
    ) => {
      const g = box.createDiv({ cls: "tj-gauge" });
      const head = g.createDiv({ cls: "tj-gauge-head" });
      head.createEl("span", { cls: "tj-gauge-label", text: label });
      head.createEl("span", { cls: "tj-gauge-value " + tone, text: valueText });
      const track = g.createDiv({ cls: "tj-gauge-track" });
      const fill = track.createDiv({ cls: "tj-gauge-fill " + tone });
      fill.style.width = `${clamp(pct, 0, 100)}%`;
      g.addEventListener("mousemove", (e) => {
        const tip = g.querySelector(".tj-tooltip");
        if (tip) {
          (tip as HTMLElement).style.left = `${e.clientX - g.getBoundingClientRect().left + 12}px`;
          (tip as HTMLElement).style.top = `${e.clientY - g.getBoundingClientRect().top + 12}px`;
          (tip as HTMLElement).style.display = "block";
        }
      });
      g.addEventListener("mouseleave", () => {
        const tip = g.querySelector(".tj-tooltip");
        if (tip) (tip as HTMLElement).style.display = "none";
      });
      g.createDiv({ cls: "tj-tooltip", text: tip });
      return g;
    };

    if (size.target > 0) {
      const pct = d.targetReached ? 100 : d.targetPct;
      const tip = d.targetReached
        ? `Target reached ✓ — ${fmtMoney(d.net)} / $${size.target.toLocaleString()}`
        : `Profit: ${fmtMoney(d.net)} / $${size.target.toLocaleString()} — need ${fmtMoney(size.target - d.net)}`;
      gauge("Profit Target", pct, d.targetReached ? "✓ reached" : `need ${fmtMoney(size.target - d.net)}`, tip, d.targetReached ? "pos" : "neutral");
    }

    if (size.maxLoss > 0) {
      const used = clamp((1 - d.buffer / size.maxLoss) * 100, 0, 100);
      const tip = `Drawdown used: ${fmtMoney(used < 100 ? size.maxLoss - d.buffer : size.maxLoss)} / -$${size.maxLoss.toLocaleString()} — floor ${fmtMoney(d.floor)}, buffer ${fmtMoney(d.buffer)}`;
      gauge("Drawdown", used, `buffer ${fmtMoney(d.buffer)}`, tip, used >= 100 ? "neg" : used >= 75 ? "warn" : "pos");
    }

    if (size.dailyLoss > 0) {
      const used = d.todayNet < 0 ? clamp((-d.todayNet / size.dailyLoss) * 100, 0, 100) : 0;
      const tip = `Today: ${fmtMoney(d.todayNet)} against -$${size.dailyLoss.toLocaleString()} daily loss limit`;
      gauge("Daily Loss", used, d.todayNet < 0 ? fmtMoney(d.todayNet) : "—", tip, used >= 100 ? "neg" : used >= 75 ? "warn" : "neutral");
    }

    if (size.consistency > 0) {
      const pct = d.consistency > 0 ? clamp((d.consistency / size.consistency) * 100, 0, 100) : 0;
      const ok = d.consistency <= size.consistency;
      const tip = `Best day holds ${d.consistency.toFixed(0)}% of profit — firm limit is ${size.consistency}% (${ok ? "within" : "exceeded"})`;
      gauge("Consistency", pct, `${d.consistency.toFixed(0)}% / ${size.consistency}%`, tip, ok ? "pos" : "neg");
    }
  }

  /** Fase 4: table of this account's trades — clicking a row opens the trade note. */
  renderAccountTrades(root: HTMLElement, scoped: Trade[], byDay: Map<string, { net: number; count: number; wins: number }>): void {
    const box = root.createDiv({ cls: "tj-account-trades" });
    box.createEl("h3", { text: `Trades in this account (${scoped.length})` });
    if (scoped.length === 0) {
      box.createDiv({ cls: "tj-empty", text: "No trades for this account yet." });
      return;
    }
    const rows = [...scoped].slice(-30).reverse();
    const table = box.createEl("table", { cls: "tj-table tj-trades-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Date", "Symbol", "Dir", "Qty", "Entry", "Exit", "P&L"].forEach((h) => thead.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    for (const t of rows) {
      const tr = tbody.createEl("tr", { cls: "tj-clickable-row" });
      if (t.id) tr.setAttr("data-tj-note", t.id);
      const d = this.dayKey(t);
      const parts = d.split("-");
      tr.createEl("td", { text: `${parts[2]}/${MONTHS[+parts[1] - 1]}/${parts[0]}` });
      tr.createEl("td", { text: t.symbol });
      tr.createEl("td", { text: t.direction === "long" ? "Long" : "Short" });
      tr.createEl("td", { text: String(t.quantity) });
      tr.createEl("td", { text: t.entryPrice ? String(t.entryPrice) : "—" });
      tr.createEl("td", { text: t.exitPrice ? String(t.exitPrice) : "—" });
      const pnlTd = tr.createEl("td");
      pnlTd.addClass(t.pnl >= 0 ? "tj-pos" : "tj-neg");
      pnlTd.textContent = fmtMoney(t.pnl);
      tr.addEventListener("click", async () => {
        const id = tr.getAttr("data-tj-note");
        if (!id) return;
        await this.plugin.openTradeDetail(t);
      });
    }
  }

  /** Fase 5: net P&L by weekday (Mon..Sun) for this account. */
  renderWeekdayBreakdown(root: HTMLElement, scoped: Trade[]): void {
    const box = root.createDiv({ cls: "tj-weekday-box" });
    box.createEl("h3", { text: "By weekday" });
    const per = new Map<number, { net: number; count: number; wins: number }>();
    for (const t of scoped) {
      const d = this.dayKey(t);
      const [y, m, day] = d.split("-").map(Number);
      const wd = new Date(y, m - 1, day).getDay();
      let bucket = per.get(wd);
      if (!bucket) {
        bucket = { net: 0, count: 0, wins: 0 };
        per.set(wd, bucket);
      }
      bucket.net += t.pnl;
      bucket.count += 1;
      if (t.pnl > 0) bucket.wins += 1;
    }
    if (per.size === 0) {
      box.createDiv({ cls: "tj-empty", text: "No trades for this account yet." });
      return;
    }
    const grid = box.createDiv({ cls: "tj-weekday-grid" });
    for (let wd = 1; wd <= 5; wd++) {
      const b = per.get(wd);
      const cell = grid.createDiv({ cls: "tj-weekday-cell" + (b ? "" : " tj-weekday-empty") });
      cell.createEl("div", { cls: "tj-weekday-name", text: WEEKDAYS[wd] });
      if (b) {
        cell.createEl("div", { cls: "tj-weekday-net " + (b.net >= 0 ? "tj-pos" : "tj-neg"), text: fmtMoney(b.net) });
        cell.createEl("div", { cls: "tj-weekday-sub", text: `${b.count} trades · ${Math.round((b.wins / b.count) * 100)}% win` });
      } else {
        cell.createEl("div", { cls: "tj-weekday-sub", text: "no trades" });
      }
    }
  }
}
