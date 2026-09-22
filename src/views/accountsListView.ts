import { ItemView, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { PropAccount, Trade } from "../types";
import { resolveAccountView } from "../lib/accountRules";
import { firmLabel } from "../lib/firmLogos";
import { clamp, openPluginSettings as openSettings, renderAppShell } from "../ui";
import { attachTip } from "../lib/tip";
import { fmtMoney, isFiniteNumber, todayKey, toZoneDate } from "../tz";
import { renderLineChart } from "../lib/lineChart";
import { computeAccountMetrics, AccountMetrics } from "../lib/accountMetrics";
import { netPnl } from "../lib/fees";
import { analyticsTrades } from "../lib/scope";
import { mountDropdown } from "../lib/dropdown";
import { BAR_SLOTS, MINI_SLOTS, layoutFor } from "../lib/cardSlots";
import { openAccountWizard } from "./accountWizard";
import { openAccountsDisplay, openCopyGroups } from "./accountsManage";
import { renderEmptyState as renderEmptyBox } from "../lib/emptyState";

export const ACCOUNTS_LIST_VIEW_TYPE = "tradebook-accounts-list-view";

type ChartPeriod = "all" | "1y" | "6m" | "3m" | "1m";

/**
 * Windows offered by the portfolio chart. "all" is the whole history; the rest
 * are trailing windows, so the page never needs a date picker.
 */
const CHART_PERIODS: Array<{ id: ChartPeriod; label: string; months: number }> = [
  { id: "all", label: "All time", months: 0 },
  { id: "1y", label: "Last 12 months", months: 12 },
  { id: "6m", label: "Last 6 months", months: 6 },
  { id: "3m", label: "Last 3 months", months: 3 },
  { id: "1m", label: "Last 1 month", months: 1 },
];

// Labels, colours and section order come from lib/accountTypes, which reads the
// Manage → Types preferences. Nothing here is hardcoded any more.
import { typeColor, typeKey, typeLabel, typeOrder, typeRank } from "../lib/accountTypes";

type GroupMode = "type" | "firm" | "firm-type" | "copy";

/** One rendered block: a firm, a type, a firm with type sub-sections, or a copy group. */
interface AccSection {
  key: string;
  label: string;
  demo?: boolean;
  accounts: PropAccount[];
  children?: AccSection[];
  /** Id of the account that leads a copy group (it owns the group's name). */
  heroId?: string;
  /**
   * Accent for the section title. Account-type sections take their type colour;
   * a copy group takes the leader's type colour; firms and standalone mix types
   * and therefore stay neutral.
   */
  tone?: string;
}

/** One drawn bar: what it says, how full it is, and how it should look. */
interface CardBar {
  label: string;
  value: string;
  pct: number;
  fill?: string;
  tone?: string;
  title?: string;
}

interface AccStats {
  net: number;
  count: number;
  wins: number;
  winRate: number;
  first: string;
  last: string;
  withdrawn: number;
  /** Money put in (deposits), which also sits in the balance. */
  deposited: number;
  /** What is actually in the account: size + net − payouts paid + deposits. */
  value: number;
  target: number;
  maxLoss: number;
  dailyLoss: number;
  /** Distinct symbols traded, for the demo card's mini row. */
  symbols: number;
  /** The full account metric set — one engine, so the card can never drift. */
  m: AccountMetrics;
}

export class AccountsListView extends ItemView {
  plugin: TradebookPlugin;
  trades: Trade[] = [];

  /** How the list is grouped — remembered in settings. */
  private get groupBy(): GroupMode {
    const v = this.plugin.settings.accountsGroupBy;
    return v === "firm" || v === "firm-type" || v === "copy" ? v : "type";
  }

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ACCOUNTS_LIST_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Accounts";
  }

  getIcon(): string {
    return "user";
  }

  async onOpen(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this.render();
  }

  async refresh(): Promise<void> {
    this.trades = await this.plugin.loadTradesExpanded();
    this.render();
  }

  // ---------------------------------------------------------------- helpers
  private tradesFor(acc: PropAccount): Trade[] {
    const name = (acc.name || "").trim().toLowerCase();
    return this.trades.filter((t) => {
      if (!isFiniteNumber(t.pnl) || !t.date) return false;
      const mapped = this.plugin.mappedAccount(t.account);
      const matches = mapped ? mapped.id === acc.id : (t.account || "").trim().toLowerCase() === name;
      if (!matches) return false;
      if (acc.createdAt && t.date < acc.createdAt) return false;
      return true;
    });
  }

  private statsFor(acc: PropAccount): AccStats {
    const list = this.tradesFor(acc);
    let net = 0;
    let wins = 0;
    let losses = 0;
    let first = "";
    let last = "";
    for (const t of list) {
      // Money the card reports is net of costs; win/loss counts stay gross.
      net += netPnl(t);
      if (t.pnl > 0) wins += 1;
      else if (t.pnl < 0) losses += 1;
      if (!first || t.date < first) first = t.date;
      if (!last || t.date > last) last = t.date;
    }
    const size = resolveAccountView(acc).rules;
    const withdrawn = this.plugin.accountPayoutsTotal(acc.id);
    const deposited = this.plugin.accountDepositsTotal(acc.id);
    const symbols = new Set(list.map((t) => (t.symbol || "").toUpperCase()).filter(Boolean)).size;
    // One metrics engine for the whole app: the card reads from it instead of
    // re-deriving wins, drawdown or anything else on its own.
    const m = computeAccountMetrics({
      trades: list,
      size: acc.size,
      target: size.target,
      maxLoss: size.maxLoss,
      ddLockOffset: size.ddLockOffset,
      ddNoLock: size.maxLossType === "eod-trailing-open",
      dailyLoss: size.dailyLoss,
      consistency: size.consistency,
      consistencyBasis: size.consistencyBasis,
      dayKey: (t) => this.dayKeyOf(t),
      todayKey: this.todayKey(),
      withdrawn,
      cashflows: [
        ...this.plugin.payoutsFor(acc.id).map((p) => ({ date: p.date, amount: -Math.abs(p.amount) })),
        ...this.plugin.depositsFor(acc.id).map((d) => ({ date: d.date, amount: Math.abs(d.amount) })),
        ...this.plugin.feeAdjustmentsFor(acc.id).map((a) => ({ date: a.date, amount: a.amount })),
      ],
    });
    return {
      net,
      count: list.length,
      wins,
      winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
      first,
      last,
      withdrawn,
      deposited,
      // What is actually in the account: the size you were given, plus what you
      // made, minus what you took out, plus what you put in. A payout is money
      // that left — the card must not keep showing it as if it were still there.
      value: m.balance,
      target: size?.target ?? 0,
      maxLoss: size?.maxLoss ?? 0,
      dailyLoss: size?.dailyLoss ?? 0,
      symbols,
      m,
    };
  }

  private dayKeyOf(t: Trade): string {
    return toZoneDate(t.date, t.entryTime, this.plugin.settings.timeZone);
  }

  private todayKey(): string {
    return todayKey(this.plugin.settings.timeZone);
  }

  private daysSince(iso: string): number {
    if (!iso) return 0;
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return 0;
    const ms = Date.now() - new Date(y, m - 1, d).getTime();
    return Math.max(0, Math.round(ms / 86400000));
  }

  private accounts(): PropAccount[] {
    return this.plugin.settings.propAccounts || [];
  }

  // ------------------------------------------------------------------ render
  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-accounts-list");
    const main = renderAppShell(root, this.plugin, "accounts");
    const all = this.accounts();
    const stats = new Map<string, AccStats>(all.map((a) => [a.id, this.statsFor(a)]));

    // ---------------- header ----------------
    const head = main.createDiv({ cls: "tj-acct-header" });
    const titles = head.createDiv();
    titles.createEl("h1", { text: "Accounts", cls: "tj-view-h1" });
    titles.createEl("p", {
      cls: "tj-import-info",
      text: "Portfolio overview — totals first, then each firm, then the account itself.",
    });
    // The same outline square the rest of the app uses for header actions — one
    // recipe, no words. The explanation lives in our own tip (never the engine's
    // black box), and the accessible name travels in a `tj-sr-only` span.
    const actions = head.createDiv({ cls: "tj-acct-header-actions" });

    // Two accounts are the minimum for anything to copy anything, so the copy
    // groups square says why it is off instead of opening an empty room.
    const groupsBtn = actions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button" },
    });
    setIcon(groupsBtn, "users");
    groupsBtn.createSpan({ cls: "tj-sr-only", text: "Copy groups" });
    if (all.length < 2) {
      groupsBtn.disabled = true;
      attachTip(groupsBtn, { title: "Copy groups", sub: "Add a second account to copy between." });
    } else {
      attachTip(groupsBtn, { title: "Copy groups", sub: "Which account leads, who copies it, and how." });
      groupsBtn.addEventListener("click", () => openCopyGroups(this.plugin));
    }

    const addBtn = actions.createEl("button", {
      cls: "tj-iconbtn is-primary",
      attr: { type: "button", "data-tour": "add-account" },
    });
    setIcon(addBtn, "plus");
    addBtn.createSpan({ cls: "tj-sr-only", text: "Add account" });
    attachTip(addBtn, { title: "Add account", sub: "One, or a whole batch at once." });
    addBtn.addEventListener("click", () => {
      openAccountWizard(this.plugin, {
        onDone: () => void this.refresh(),
      });
    });

    const settingsBtn = actions.createEl("button", {
      cls: "tj-iconbtn",
      attr: { type: "button" },
    });
    setIcon(settingsBtn, "sliders-horizontal");
    settingsBtn.createSpan({ cls: "tj-sr-only", text: "Settings" });
    attachTip(settingsBtn, { title: "Settings", sub: "How this page is grouped and how it reads." });
    settingsBtn.addEventListener("click", () => openAccountsDisplay(this.plugin));

    // ---------------- adaptive strip ----------------
    this.renderStrip(main, all, stats);

    // ---------------- P&L across accounts ----------------
    this.renderPortfolioChart(main, all);

    // ---------------- account mix by type (compact, under chart) ----------------
    this.renderComposition(main, all);

    // ---------------- how the cards are grouped (right above them) ----------------
    this.renderGroupBar(main, all);

    // ---------------- groups of cards ----------------
    this.renderGroups(main, all, stats);

    // ---------------- archived ----------------
    // Optional: some journals keep past evals out of the way entirely.
    if (this.plugin.settings.accountsShowArchived !== false) this.renderArchived(main);
  }

  private isDemo(acc: PropAccount): boolean {
    return acc.type === "demo";
  }

  /** The colour of the copy group an account belongs to, or "" when it is free. */
  private groupTint(acc: PropAccount): string {
    if (acc.copyRole === "base") return acc.copyGroupColor?.trim() || "";
    if (!acc.copyBaseId) return "";
    return this.accounts().find((a) => a.id === acc.copyBaseId)?.copyGroupColor?.trim() || "";
  }

  /** Accounts that feed the portfolio totals (demo accounts excluded by default). */
  private portfolioAccounts(all: PropAccount[]): PropAccount[] {
    if (this.plugin.settings.excludeDemosFromPortfolio === false) return all;
    return all.filter((a) => !this.isDemo(a));
  }

  /**
   * The window the chart and the strip totals are showing. Trailing windows are
   * measured from today, so the only thing stored is which one you picked.
   */
  private chartWindow(): { id: ChartPeriod; label: string; from: string } {
    const id = (this.plugin.settings.accountsChartPeriod ?? "all") as ChartPeriod;
    const def = CHART_PERIODS.find((p) => p.id === id) ?? CHART_PERIODS[0];
    if (!def.months) return { id: def.id, label: def.label, from: "" };
    const d = new Date();
    d.setMonth(d.getMonth() - def.months);
    return { id: def.id, label: def.label, from: d.toISOString().slice(0, 10) };
  }

  private renderStrip(main: HTMLElement, all: PropAccount[], stats: Map<string, AccStats>): void {
    const strip = main.createDiv({ cls: "tj-acct-strip" });
    const portfolio = this.portfolioAccounts(all);
    const demoCount = all.length - portfolio.length;
    const firms = new Set(portfolio.map((a) => firmLabel(a.firmId) || a.firmId));

    // Capital = nominal buying power of the real accounts (not inflated by P&L).
    const capital = portfolio.reduce((s, a) => s + (a.size || 0), 0);
    const w = this.chartWindow();
    // Totals follow the chart window. The account cards do not: an account's
    // state (drawdown, target, eligibility) is always its whole life.
    const flat = portfolio.flatMap((a) => this.tradesFor(a));
    const windowTrades = w.from ? flat.filter((t) => t.date >= w.from) : flat;
    const net = windowTrades.reduce((s, t) => s + netPnl(t), 0);
    const growth = capital > 0 ? (net / capital) * 100 : 0;
    // A copied trade lives in every account it reached. Count it once: gather
    // the real accounts' trades and dedupe by copyBaseKey. Money stays summed.
    const trades = analyticsTrades(windowTrades).unique.length;
    // Payouts follow the window too, so the strip and the chart tell one story.
    // "All time" is just the window that starts at the beginning.
    const withdrawn = portfolio.reduce(
      (s, a) =>
        s +
        this.plugin
          .payoutsFor(a.id)
          .filter((p) => !w.from || p.date >= w.from)
          .reduce((t, p) => t + Math.abs(p.amount), 0),
      0,
    );
    const funded = portfolio.filter((a) => a.type === "funded" || a.type === "live" || a.type === "personal");

    /** Sub-line bits, so "which window" is never a guess. */
    const sub = (...bits: string[]) => bits.filter(Boolean).join(" · ");
    const windowNote = w.from ? w.label.toLowerCase() : "";

    const cell = (label: string, value: string, sub?: string, tone = "", info?: string) => {
      const m = strip.createDiv({ cls: "tj-acct-strip-cell" });
      const k = m.createDiv({ cls: "tj-acct-strip-k" });
      k.createSpan({ text: label });
      if (info) {
        const i = k.createSpan({ cls: "tj-info-dot" });
        setIcon(i, "info");
        attachTip(i, { title: label, sub: info });
      }
      m.createDiv({ cls: `tj-acct-strip-v ${tone}`.trim(), text: value });
      if (sub) m.createDiv({ cls: "tj-acct-strip-sub", text: sub });
    };

    const accountSub = demoCount
      ? `${portfolio.length} real · ${demoCount} demo`
      : `${all.length} account${all.length === 1 ? "" : "s"} · ${firms.size} firm${firms.size === 1 ? "" : "s"}`;
    cell("Accounts", String(all.length), accountSub);
    // The money that is actually still in the accounts: size + P&L − payouts
    // paid + deposits. "Capital" stops being the headline because a payout is
    // money that left; the nominal size stays visible underneath.
    const inAccounts = portfolio.reduce((s, a) => s + (stats.get(a.id)?.value ?? a.size), 0);
    cell("In accounts", fmtMoney(inAccounts), sub(`on ${fmtMoney(capital)} capital`, w.from ? "all time" : ""), "", "What is really in your real accounts: size + realised P&L − payouts + deposits. Always all-time, whatever the chart shows.");
    cell("Net P&L", fmtMoney(net), sub(demoCount ? "excl. demo" : "all accounts", windowNote), net >= 0 ? "tj-pos" : "tj-neg", "Real money only. Follows the chart window.");
    cell("Growth", `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`, sub("on capital", windowNote), growth >= 0 ? "tj-pos" : "tj-neg", "Net P&L over your capital.");
    cell("Payouts", withdrawn ? fmtMoney(withdrawn) : "$0", sub(funded.length ? `${funded.length} funded` : "none yet", windowNote), withdrawn > 0 ? "tj-pos" : "", "Money you took out. Follows the chart window.");
    cell("Trades", String(trades), sub(`across ${portfolio.length} account${portfolio.length === 1 ? "" : "s"}`, windowNote), "", "Every decision counts once, however many accounts copied it. Real accounts only.");

    if (demoCount) {
      main.createDiv({ cls: "tj-acct-strip-note", text: "Demo accounts are excluded from these totals — open the Demo card below to see its numbers." });
    }
  }

  /**
   * Composition by account type — a thin, quiet strip under the chart. It counts
   * accounts, not capital: the money already lives in the strip above and in the
   * curve. Demos count here (they are real rows in the list), so the bar simply
   * mirrors the types you actually keep.
   */
  private renderComposition(main: HTMLElement, all: PropAccount[]): void {
    if (all.length < 2) return;

    const buckets = new Map<string, { label: string; color: string; count: number }>();
    for (const a of all) {
      const key = typeKey(a.type);
      let b = buckets.get(key);
      if (!b) {
        b = { label: typeLabel(key), color: typeColor(key), count: 0 };
        buckets.set(key, b);
      }
      b.count += 1;
    }
    const rows = [...buckets.values()].sort((a, b) => b.count - a.count);
    if (rows.length < 2) return;
    const total = rows.reduce((s, b) => s + b.count, 0);
    if (total <= 0) return;

    const row = main.createDiv({ cls: "tj-acct-comp" });
    row.createSpan({ cls: "tj-acct-comp-lbl", text: "Accounts" });

    const bar = row.createDiv({ cls: "tj-acct-comp-bar" });
    const legend = row.createDiv({ cls: "tj-acct-comp-legend" });
    rows.forEach((b, idx) => {
      const pct = (b.count / total) * 100;
      const plural = b.count === 1 ? "" : "s";
      const seg = bar.createDiv({ cls: "tj-acct-comp-seg" });
      seg.style.width = `${pct}%`;
      seg.style.background = b.color;
      attachTip(seg, { title: b.label, sub: `${b.count} account${plural} · ${pct.toFixed(0)}% of the list` });

      if (idx) legend.createSpan({ cls: "tj-acct-comp-sep", text: "·" });
      const sp = legend.createSpan({ cls: "tj-acct-comp-key" });
      const dot = sp.createEl("i");
      dot.style.background = b.color;
      sp.createSpan({ text: `${b.label} ${pct.toFixed(0)}%` });
      attachTip(sp, { title: `${b.label} ${pct.toFixed(0)}%`, sub: `${b.count} account${plural} of ${total}` });
    });
  }

  /**
   * Portfolio curve — realised P&L net of cash flows: minus payouts, plus
   * deposits. Starts at zero, green above / red below, with payouts and
   * deposits marked on the line and an underwater (drawdown) shade.
   */
  private renderPortfolioChart(main: HTMLElement, all: PropAccount[]): void {
    const portfolio = this.portfolioAccounts(all);
    const w = this.chartWindow();
    const card = main.createDiv({ cls: "tj-acct-chartcard" });

    // Title on the left; the value and the window grouped on the right of the
    // same line. The number closes the sentence the title opens, and the plot
    // stays completely free for the curve.
    const head = card.createDiv({ cls: "tj-acct-chart-head" });
    const k = head.createDiv({ cls: "tj-acct-chart-k" });
    k.createSpan({ text: "Net P&L across accounts" });
    const i = k.createSpan({ cls: "tj-info-dot" });
    setIcon(i, "info");
    attachTip(i, {
      title: "Net P&L across accounts",
      sub: "Real money only — payouts leave the account, deposits arrive. Dashed grey: the same window just before this one.",
    });

    const headR = head.createDiv({ cls: "tj-acct-chart-headr" });
    // Filled once the series is built; hidden until then so an empty account
    // never shows a dangling sign.
    const val = headR.createDiv({ cls: "tj-acct-chart-val" });
    val.style.display = "none";

    const periodHost = headR.createDiv({ cls: "tj-acct-chart-period" });
    mountDropdown(
      periodHost,
      CHART_PERIODS.map((p) => ({ id: p.id, label: p.label })),
      w.id,
      (id) => {
        this.plugin.settings.accountsChartPeriod = id as ChartPeriod;
        void this.plugin.saveSettings().then(() => this.render());
      },
      { align: "right", title: "The window this chart and the totals above are showing" }
    );

    const perAccount = portfolio.map((a) => ({ acc: a, list: this.tradesFor(a) }));
    // Every day is needed, even outside the window: the ghost line is the stretch
    // of trading days immediately before it.
    const allDays = new Map<string, number>();
    for (const { list } of perAccount) {
      for (const t of list) allDays.set(t.date, (allDays.get(t.date) ?? 0) + netPnl(t));
    }
    if (!allDays.size) {
      card.createDiv({ cls: "tj-empty", text: "No trades yet — add trades to see the portfolio curve." });
      return;
    }

    const inWindow = (d: string) => !w.from || d >= w.from;

    // Cash flows that belong to the accounts shown in this chart.
    const ids = new Set(portfolio.map((a) => a.id));
    const flows: { date: string; amount: number }[] = [];
    for (const p of this.plugin.settings.payouts ?? []) {
      if (ids.has(p.accountId) && inWindow(p.date)) flows.push({ date: p.date, amount: -Math.abs(p.amount) });
    }
    for (const d of this.plugin.settings.deposits ?? []) {
      if (ids.has(d.accountId) && inWindow(d.date)) flows.push({ date: d.date, amount: Math.abs(d.amount) });
    }
    const flowByDay = new Map<string, number>();
    for (const f of flows) flowByDay.set(f.date, (flowByDay.get(f.date) ?? 0) + f.amount);

    // The window starts at zero: the value you read is the P&L made inside it,
    // not the level the account happened to be at when it opened.
    const allTradeDays = [...allDays.keys()].sort();
    const tradeDays = allTradeDays.filter(inWindow);
    const dates = [...new Set([...tradeDays, ...flowByDay.keys()])].sort();
    if (!dates.length) {
      card.createDiv({ cls: "tj-empty", text: `No trading days in the ${w.label.toLowerCase()}.` });
      return;
    }
    let run = 0;
    const values = dates.map((d) => (run += (allDays.get(d) ?? 0) + (flowByDay.get(d) ?? 0)));

    const last = values[values.length - 1] ?? 0;

    // Ghost line: the same number of trading days immediately before this window.
    const prior = allTradeDays.filter((d) => d < dates[0]);
    const tail = tradeDays.length ? prior.slice(-tradeDays.length) : [];
    let g = 0;
    const ghost = tail.map((d) => (g += allDays.get(d) ?? 0));

    // Payout / deposit dots pinned on the curve.
    const idxOf = new Map(dates.map((d, di) => [d, di]));
    const markers = flows
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((f) => ({
        index: idxOf.get(f.date) ?? 0,
        kind: (f.amount >= 0 ? "in" : "out") as "in" | "out",
        title: `${f.amount >= 0 ? "Deposit" : "Payout"} ${fmtMoney(Math.abs(f.amount))} · ${f.date}`,
      }));

    // The value lives up in the header (next to the window chip), so the plot is
    // left entirely to the curve.
    val.createSpan({ cls: last >= 0 ? "tj-pos" : "tj-neg", text: fmtMoney(last) });
    val.style.display = "";

    const chart = card.createDiv({ cls: "tj-acct-chart" });
    renderLineChart(chart, {
      values,
      dates,
      key: "accounts-portfolio",
      format: this.plugin.settings.dateFormat,
      showDates: this.plugin.settings.chartDates !== false,
      animations: this.plugin.settings.animations !== false,
      baseline: 0,
      baseLine: 0,
      fadeFloor: 0,
      markers,
      // The chart sums every account, so the payout line sums them too: two
      // accounts paying out on the same day read as one number for that day.
      hoverLines: (i) => {
        const flow = flowByDay.get(dates[i] ?? "") ?? 0;
        const rows: Array<[string, string, string]> = [];
        if (flow < 0) rows.push(["Payout", fmtMoney(Math.abs(flow)), "tj-cash"]);
        if (flow > 0) rows.push(["Deposit", fmtMoney(flow), "tj-pos"]);
        return rows;
      },
      secondary: ghost.length > 1 ? [{ values: ghost, color: "#8a8a8a", width: 1.2, dash: true, label: "previous" }] : [],
    });

    if (ghost.length > 1 || flows.length) {
      const footer = card.createDiv({ cls: "tj-acct-chart-legend" });
      const item = (color: string, text: string, shape: "dot" | "dash" = "dot") => {
        const sp = footer.createSpan();
        const el = sp.createEl("i");
        el.style.background = color;
        if (shape === "dash") {
          el.style.width = "14px";
          el.style.height = "2px";
          el.style.borderRadius = "1px";
          el.style.opacity = ".75";
        } else {
          el.style.width = "8px";
          el.style.height = "8px";
          el.style.borderRadius = "50%";
        }
        sp.createSpan({ text });
      };
      if (ghost.length > 1) item("#8a8a8a", "previous period", "dash");
      if (flows.some((f) => f.amount > 0)) item("#34d17a", "deposit");
      if (flows.some((f) => f.amount < 0)) item("#d9a441", "payout");
    }
  }

  /** True when at least one account takes part in copy trading (leader or copier). */
  private hasCopyGroups(all: PropAccount[]): boolean {
    return all.some((a) => !!a.copyRole || !!a.copyBaseId);
  }

  /** The stored mode, downgraded to "type" when it can't be honoured right now. */
  private effectiveGroupBy(all: PropAccount[]): GroupMode {
    const mode = this.groupBy;
    return mode === "copy" && !this.hasCopyGroups(all) ? "type" : mode;
  }

  /**
   * The grouping control, on a line of its own between the capital bar and the
   * cards. It is a view choice, so it belongs next to the content it changes —
   * and the old left rail (search + role) is gone, giving the cards the width.
   */
  private renderGroupBar(host: HTMLElement, all: PropAccount[]): void {
    const row = host.createDiv({ cls: "tj-acct-gbrow" });
    row.createSpan({ cls: "tj-acct-gbrow-lbl", text: "Group by" });
    const gbWrap = row.createDiv({ cls: "tj-acct-gbwrap" });
    const modes: Array<[GroupMode, string, string, string]> = [
      ["type", "Account type", "layout-grid", "One section per account type — Funded, Evaluation, Demo. Archived stays last."],
      ["firm", "Firm", "building-2", "One section per prop firm."],
      ["firm-type", "Firm → type", "corner-down-right", "Firm as the parent, account type nested inside."],
    ];
    if (this.hasCopyGroups(all)) {
      modes.push(["copy", "Trading group", "users", "The leader and the accounts that copy it, grouped together."]);
    }
    const active = this.effectiveGroupBy(all);
    const current = modes.find((m) => m[0] === active) ?? modes[0];
    const ghost = gbWrap.createDiv({ cls: "tj-acct-gb" });
    attachTip(ghost, { title: current[1], sub: current[3] });
    const ghostIcon = ghost.createSpan({ cls: "tj-acct-gb-ic" });
    setIcon(ghostIcon, current[2]);
    ghost.createSpan({ cls: "tj-acct-gb-t", text: current[1] });
    const ghostChev = ghost.createSpan({ cls: "tj-acct-gb-chev" });
    setIcon(ghostChev, "chevron-down");

    const pop = gbWrap.createDiv({ cls: "tj-acct-gbpop" });
    for (const [id, label, icon, hint] of modes) {
      const row = pop.createDiv({ cls: "tj-acct-gbopt" + (active === id ? " on" : "") });
      const rowIcon = row.createSpan({ cls: "tj-acct-gb-ic" });
      setIcon(rowIcon, icon);
      row.createSpan({ cls: "tj-acct-gb-t", text: label });
      // How many sections this choice produces, so the label is never a guess.
      row.createSpan({ cls: "tj-acct-gb-n", text: String(this.buildSections(all, id).length) });
      attachTip(row, { title: label, sub: hint });
      row.addEventListener("click", () => {
        gbWrap.removeClass("is-open");
        if (this.groupBy === id) return;
        this.plugin.settings.accountsGroupBy = id;
        void this.plugin.saveSettings();
        this.render();
      });
    }
    ghost.addEventListener("click", () => {
      const open = !gbWrap.hasClass("is-open");
      gbWrap.toggleClass("is-open", open);
      if (!open) return;
      // Close on the next click anywhere else; removed as soon as it fires.
      const onDoc = (e: Event) => {
        if (gbWrap.contains(e.target as Node)) return;
        gbWrap.removeClass("is-open");
        document.removeEventListener("pointerdown", onDoc, true);
      };
      document.addEventListener("pointerdown", onDoc, true);
    });
  }

  /** Re-render just the groups + tiles (used after a group rename). */
  private rerenderBody(): void {
    const host = this.contentEl.querySelector(".tj-acct-groups");
    if (!host) return;
    host.empty();
    const all = this.accounts();
    const stats = new Map<string, AccStats>(all.map((a) => [a.id, this.statsFor(a)]));
    this.fillGroups(host as HTMLElement, all, stats);
  }

  private renderGroups(content: HTMLElement, all: PropAccount[], stats: Map<string, AccStats>): void {
    this.fillGroups(content.createDiv({ cls: "tj-acct-groups" }), all, stats);
  }

  private fillGroups(host: HTMLElement, all: PropAccount[], stats: Map<string, AccStats>): void {
    if (!all.length) {
      renderEmptyBox(host, {
        title: "No accounts yet",
        sub: "Create your first account — it is where every trade is recorded. Old trades can be imported afterwards.",
        primaryText: "Create an account",
        primaryIcon: "plus",
        onPrimary: () => openAccountWizard(this.plugin, { onDone: () => void this.refresh() }),
        secondaryText: "Import trades",
        secondaryIcon: "upload",
        onSecondary: () => this.plugin.openImport(),
      });
      return;
    }

    // The user can park the account types they never look at (Settings →
    // Accounts page). The accounts stay in the data — they just leave this list.
    const visible = new Set<string>(this.plugin.settings.accountsVisibleTypes ?? typeOrder());
    const shown = all.filter((a) => visible.has(typeKey(a.type)));
    if (!shown.length) {
      host.createDiv({
        cls: "tj-empty",
        text: "No account types are shown — pick some under “Account types shown” in the plugin settings.",
      });
      return;
    }

    for (const sec of this.buildSections(shown, undefined, stats)) this.renderSection(host, sec, stats);
  }

  /**
   * A leader always reads first: when a section holds a copy group, the account
   * the others mirror sits at the top, then everything else by name. Without a
   * copy link the list is plain alphabetical, exactly as before.
   */
  /** How the user asked the cards to be ordered inside a section. */
  private accountsSort(): "name" | "balance" | "net" | "dd" {
    const v = this.plugin.settings.accountsSort;
    return v === "balance" || v === "net" || v === "dd" ? v : "name";
  }

  private byRoleThenName(a: PropAccount, b: PropAccount, stats?: Map<string, AccStats>): number {
    const rank = (x: PropAccount) => (x.copyRole === "base" ? 0 : 1);
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const mode = this.accountsSort();
    if (mode !== "name" && stats) {
      // Biggest first: balance, net P&L or share of the drawdown already used.
      const key = (x: PropAccount) => {
        const st = stats.get(x.id);
        if (!st) return 0;
        if (mode === "balance") return st.value;
        if (mode === "net") return st.net;
        return st.maxLoss > 0 ? st.m.ddToLimit / st.maxLoss : -1;
      };
      const dv = key(b) - key(a);
      if (Math.abs(dv) > 1e-9) return dv;
    }
    return a.name.localeCompare(b.name);
  }

  /** Accounts sorted by type (Funded → … → Demo), then leader-first, then name. */
  private sortInType(accs: PropAccount[], stats?: Map<string, AccStats>): PropAccount[] {
    return accs.slice().sort((a, b) => {
      const d = typeRank(a.type) - typeRank(b.type);
      return d !== 0 ? d : this.byRoleThenName(a, b, stats);
    });
  }

  /** Turn the filtered accounts into sections for the current "Group by" mode. */
  private buildSections(
    filtered: PropAccount[],
    mode: GroupMode = this.effectiveGroupBy(filtered),
    stats?: Map<string, AccStats>
  ): AccSection[] {
    const byFirm = new Map<string, PropAccount[]>();
    for (const a of filtered) {
      const key = a.firmId || "unknown";
      if (!byFirm.has(key)) byFirm.set(key, []);
      byFirm.get(key)!.push(a);
    }
    const firmName = (id: string) => firmLabel(id) || id;
    const firms = [...byFirm.entries()].sort((x, y) => firmName(x[0]).localeCompare(firmName(y[0])));

    if (mode === "copy") {
      const byId = new Map(filtered.map((a) => [a.id, a]));
      const groups = new Map<string, PropAccount[]>();
      const claimed = new Set<string>();
      for (const a of filtered) {
        if (!a.copyBaseId) continue;
        const lead = byId.get(a.copyBaseId);
        const gk = lead ? lead.id : `missing:${a.copyBaseId}`;
        if (!groups.has(gk)) groups.set(gk, []);
        groups.get(gk)!.push(a);
        claimed.add(a.id);
        if (lead) claimed.add(lead.id);
      }
      const out: AccSection[] = [];
      for (const [gk, copiers] of groups) {
        const lead = byId.get(gk);
        const hero = lead ?? copiers[0];
        const members = copiers.filter((c) => c.id !== hero.id);
        out.push({
          key: `copy:${gk}`,
          label: lead?.copyGroupName?.trim() || `Trading group — ${lead ? lead.name : hero.name}`,
          accounts: [hero, ...members],
          heroId: hero.id,
          // The group's own colour, chosen in Manage, dresses the section and
          // the Leader/Copier tags — so the dot there has a consequence here.
          tone: lead?.copyGroupColor?.trim() || typeColor(hero.type),
        });
      }
      out.sort((x, y) => x.label.localeCompare(y.label));
      const standalone = filtered.filter((a) => !claimed.has(a.id));
      if (standalone.length) {
        out.push({
          key: "copy:standalone",
          label: "Standalone",
          accounts: this.sortInType(standalone, stats),
          demo: standalone.every((a) => this.isDemo(a)),
        });
      }
      return out;
    }

    if (mode === "type") {
      const out: AccSection[] = [];
      for (const t of typeOrder()) {
        const accs = filtered.filter((a) => typeKey(a.type) === t).sort((a, b) => this.byRoleThenName(a, b, stats));
        if (!accs.length) continue;
        out.push({ key: `type:${t}`, label: typeLabel(t), accounts: accs, demo: t === "demo", tone: typeColor(t) });
      }
      return out;
    }

    if (mode === "firm") {
      return firms.map(([fid, accs]) => ({
        key: `firm:${fid}`,
        label: firmName(fid),
        accounts: this.sortInType(accs, stats),
        demo: accs.every((a) => this.isDemo(a)),
      }));
    }

    // firm → type: the firm is the parent, the account type the child.
    return firms.map(([fid, accs]) => {
      const children: AccSection[] = [];
      for (const t of typeOrder()) {
        const sub = accs.filter((a) => typeKey(a.type) === t).sort((a, b) => this.byRoleThenName(a, b, stats));
        if (!sub.length) continue;
        children.push({
          key: `firm:${fid}/type:${t}`,
          label: typeLabel(t),
          accounts: sub,
          demo: t === "demo",
          tone: typeColor(t),
        });
      }
      return {
        key: `firm:${fid}`,
        label: firmName(fid),
        accounts: this.sortInType(accs, stats),
        demo: accs.every((a) => this.isDemo(a)),
        children,
      };
    });
  }

  /**
   * Right-hand side of a section title. The account count lives in its own pill
   * next to the label, so this only carries the money — and, for a copy group,
   * the shape of the group.
   */
  private sectionMeta(sec: AccSection, stats: Map<string, AccStats>): string {
    const accs = sec.accounts;
    if (sec.demo || accs.every((a) => this.isDemo(a))) return "not counted in totals";
    const counted = this.portfolioAccounts(accs);
    const total = counted.reduce((s, a) => s + (stats.get(a.id)?.value ?? a.size), 0);
    const net = counted.reduce((s, a) => s + (stats.get(a.id)?.net ?? 0), 0);
    if (sec.heroId) {
      const copiers = Math.max(0, accs.length - 1);
      return `Leader + ${copiers} copier${copiers === 1 ? "" : "s"} · ${fmtMoney(total)} · ${fmtMoney(net)}`;
    }
    return `${fmtMoney(total)} · ${fmtMoney(net)}`;
  }

  /**
   * Inline rename for a trading group. The leader account owns the name, so it
   * travels with the group — no extra registry to keep in sync.
   */
  private editGroupName(sh: HTMLElement, sec: AccSection): void {
    const acc = this.accounts().find((a) => a.id === sec.heroId);
    const nameEl = sh.querySelector<HTMLElement>(".tj-acct-h1-t");
    if (!acc || !nameEl) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tj-acct-sname-input";
    input.value = acc.copyGroupName ?? "";
    input.placeholder = `Trading group — ${acc.name}`;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = async (save: boolean) => {
      if (done) return;
      done = true;
      if (save) {
        const v = input.value.trim();
        acc.copyGroupName = v || undefined;
        await this.plugin.saveSettings();
      }
      this.rerenderBody();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void commit(true);
      else if (e.key === "Escape") void commit(false);
    });
    input.addEventListener("blur", () => void commit(true));
  }

  private renderSection(host: HTMLElement, sec: AccSection, stats: Map<string, AccStats>, sub = false): void {
    const onlyDemos = sec.demo || sec.accounts.every((a) => this.isDemo(a));
    const sect = host.createDiv({ cls: "tj-acct-sect" + (onlyDemos ? " is-demo" : "") + (sub ? " is-sub" : "") });
    const sh = sect.createDiv({ cls: "tj-acct-h1" });
    if (sec.tone) {
      const dot = sh.createSpan({ cls: "tj-acct-h1-dot" });
      dot.style.background = sec.tone;
    }
    const title = sh.createSpan({ cls: "tj-acct-h1-t", text: sec.label });
    if (sec.tone) title.style.color = sec.tone;
    sh.createSpan({ cls: "tj-acct-h1-c", text: String(sec.accounts.length) });
    if (sec.heroId) {
      const edit = sh.createEl("button", {
        cls: "tj-acct-sedit",
        attr: { type: "button", "aria-label": "Rename this trading group" },
      });
      setIcon(edit, "pencil");
      edit.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.editGroupName(sh, sec);
      });
    }
    sh.createSpan({ cls: "tj-acct-h1-line" });
    sh.createSpan({ cls: "tj-acct-h1-m", text: this.sectionMeta(sec, stats) });
    if (sec.children) {
      for (const child of sec.children) this.renderSection(sect, child, stats, true);
      return;
    }
    this.renderTiles(sect, sec, stats);
  }

  /**
   * Every account in the section, laid out as a plain responsive grid. Kept
   * deliberately simple: no measuring, no absolute positioning, no observers —
   * one less thing that can survive a re-render and misbehave.
   *
   * Each card is isolated: a single account that fails to draw must never take
   * the whole list down. It shows its own error instead, in place.
   */
  private renderTiles(sect: HTMLElement, sec: AccSection, stats: Map<string, AccStats>): void {
    const grid = sect.createDiv({ cls: "tj-acct-tiles" });
    for (const a of sec.accounts) {
      try {
        grid.appendChild(this.renderTile(a, stats.get(a.id)!));
      } catch (err) {
        console.error("[tradebook] account card failed to render:", a.name, err);
        grid.appendChild(this.errorTile(a, err));
      }
    }
  }

  /** A card that shows its own failure — far better than an empty list. */
  private errorTile(acc: PropAccount, err: unknown): HTMLElement {
    const tile = document.createElement("div");
    tile.className = "tj-acct-tile is-error";
    tile.createDiv({ cls: "tj-acct-tile-edge" }).style.background = "var(--color-red, #ff5d48)";
    tile.createDiv({ cls: "tj-acct-hd-1", text: acc.name });
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    tile.createDiv({ cls: "tj-acct-error-msg", text: msg });
    const where = err instanceof Error ? (err.stack ?? "").split("\n").slice(1, 3).join(" · ") : "";
    if (where) tile.createDiv({ cls: "tj-acct-error-where", text: where });
    return tile;
  }

  /**
   * One account, in the shape that best fits its type: an evaluation shows the
   * challenge, a funded account shows the way to a payout, a personal account
   * shows how it is actually going, and a demo shows what practice looks like.
   * The corner logo says which firm it is at a glance.
   */
  private renderTile(acc: PropAccount, st: AccStats): HTMLElement {
    const tile = document.createElement("div");
    const demo = this.isDemo(acc);
    tile.className = "tj-acct-tile" + (demo ? " is-demo" : "");
    // The account id travels with the card: handy for support ("which card is
    // this?") and it keeps the test harnesses honest without matching names.
    tile.dataset.account = acc.id;
    const m = st.m;

    const edge = tile.createDiv({ cls: "tj-acct-tile-edge" });
    const ddUsed = st.maxLoss > 0 ? st.m.ddToLimit / st.maxLoss : 0;
    edge.style.background = ddUsed > 0.75 ? "var(--color-red, #ff5d48)" : ddUsed > 0.4 ? "#d9a441" : "var(--color-green-bright, #34d17a)";

    // ---- firm logo, tucked in the corner so it identifies without shouting ----
    const firmName = firmLabel(acc.firmId) || "";
    const logoUrl = this.plugin.settings.accountsShowLogo !== false && acc.firmId ? this.plugin.firmLogoUrl(acc.firmId) : "";
    if (logoUrl) {
      const img = tile.createEl("img", { cls: "tj-acct-logo" });
      img.src = logoUrl;
      img.alt = firmName || acc.name;
      img.addEventListener("error", () => {
        img.replaceWith(tile.createDiv({ cls: "tj-acct-logo tj-acct-logo-fb", text: this.initialsOf(firmName || acc.name) }));
      });
    } else {
      tile.createDiv({ cls: "tj-acct-logo tj-acct-logo-fb", text: this.initialsOf(firmName || acc.name) });
    }

    // ---- header: who it is on top, what it is worth on the right ----
    const head = tile.createDiv({ cls: "tj-acct-hd" });
    const txt = head.createDiv({ cls: "tj-acct-hd-txt" });
    const [t1, t2] = this.splitAccountName(acc);
    txt.createDiv({ cls: "tj-acct-hd-1", text: t1 });
    if (t2) txt.createDiv({ cls: "tj-acct-hd-2", text: t2 });
    const bal = head.createDiv({ cls: "tj-acct-bal" });
    bal.createDiv({ cls: "tj-acct-bal-v", text: fmtMoney(st.value) });
    const pctOfSize = ((st.net / (acc.size || 1)) * 100).toFixed(1);
    bal.createDiv({
      cls: "tj-acct-bal-g " + (st.net < 0 ? "tj-neg" : "tj-pos"),
      text: `${st.net ? fmtMoney(st.net) : "$0"} · ${st.net < 0 ? "" : "+"}${pctOfSize}%`,
    });

    const tags = tile.createDiv({ cls: "tj-acct-tile-tags" });
    tags.createSpan({ cls: `tj-tag tj-tag-${acc.type}`, text: typeLabel(acc.type) });
    if (acc.copyRole) {
      const isLeader = acc.copyRole === "base";
      const tag = tags.createSpan({ cls: `tj-tag ${isLeader ? "tj-tag-base" : "tj-tag-copy"}` });
      // The leader wears the crown — a plain Lucide mark, never an emoji.
      if (isLeader) {
        const ico = tag.createSpan({ cls: "tj-tag-ico" });
        setIcon(ico, "crown");
      }
      tag.createSpan({ text: isLeader ? "Leader" : `Copier ${acc.copyMultiplier ?? 1}x` });
      const tint = this.groupTint(acc);
      if (tint) {
        tag.style.borderColor = tint;
        tag.style.color = tint;
      }
    }
    // A spent eval is not a running one: the tag says why it is still here.
    if (acc.type === "eval" && (acc.passedAt || acc.passKept || acc.linkedFundedId)) {
      const tag = tags.createSpan({ cls: "tj-tag tj-tag-passed", text: "Passed" });
      attachTip(tag, {
        title: acc.passedAt ? `Passed on ${acc.passedAt}` : "Passed",
        sub: "This eval did its job — archive it when you are done with the history.",
      });
    }
    if (demo) {
      tile.createDiv({ cls: "tj-acct-tile-note", text: "Practice account — not counted in portfolio totals" });
    }

    // Alerts: a state, never a control. One chip at most, and it only ever says
    // what the numbers already say — the platform is the one that enforces.
    const alert = this.alertFor(acc, st);
    if (alert) {
      const chip = tags.createSpan({ cls: `tj-tag tj-alert tj-alert-${alert.kind}`, text: alert.label });
      attachTip(chip, { title: alert.label, sub: alert.why });
    }

    this.slotsFor(acc, st).forEach((slot, i) => {
      const prog = tile.createDiv({ cls: "tj-acct-prog" + (i === 0 ? " is-first" : "") });
      const lbl = prog.createDiv({ cls: "tj-acct-prog-lbl" });
      lbl.createSpan({ text: slot.label });
      const val = lbl.createEl("b", { text: slot.value });
      if (slot.tone) val.addClass(slot.tone);
      const bar = prog.createDiv({ cls: "tj-acct-prog-bar" });
      // The bar explains itself on hover: the metric name, then the numbers.
      if (slot.title) attachTip(prog, { title: slot.label, sub: slot.title });
      // `slot.fill` may carry a band ("dd safe"): set it as a class string, never
      // through addClass — Obsidian rejects tokens that contain spaces.
      const fill = bar.createDiv({ cls: "tj-acct-prog-fill" + (slot.fill ? " " + slot.fill : "") });
      fill.style.width = `${Math.max(slot.pct > 0 ? 1 : 0, clamp(slot.pct, 0, 100))}%`;
    });

    const mini = tile.createDiv({ cls: "tj-acct-mini" });
    for (const [label, value] of this.miniFor(acc, st)) {
      const c = mini.createDiv();
      c.createDiv({ cls: "tj-acct-mini-k", text: label });
      c.createDiv({ cls: "tj-acct-mini-v", text: value });
    }

    tile.addEventListener("click", () => {
      void this.plugin.openAccountDashboard(undefined, acc.id);
    });
    return tile;
  }

  /** "TopStep · Trading Combine · $50K" → ["TopStep", "Trading Combine · $50K"]. */
  private splitAccountName(acc: PropAccount): [string, string] {
    const parts = acc.name.split("·").map((s) => s.trim()).filter(Boolean);
    const first = parts[0] ?? acc.name;
    if (parts.length > 1) return [first, parts.slice(1).join(" · ")];
    // A plain name (custom or single word): describe the account underneath from the
    // firm and the type — never the legacy program label — and drop anything the title
    // already says, so the card never repeats its own name on a second line.
    const segs = [firmLabel(acc.firmId), typeLabel(acc.type), `$${Math.round(acc.size / 1000)}K`].filter(Boolean) as string[];
    const words = new Set(first.toLowerCase().split(/[\s·]+/).filter(Boolean));
    // A segment only repeats the title when *every* word of it is already there —
    // so a two-word brand ("AMP Futures") drops out just like a single word does.
    const rest = segs
      .filter((s) => !s.toLowerCase().split(/[\s·]+/).filter(Boolean).every((w) => words.has(w)))
      .join(" · ");
    return [first, rest];
  }

  private initialsOf(name: string): string {
    const words = name.split(/[\s·-]+/).filter(Boolean);
    return (words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "");
  }

  /**
   * The two bars, exactly as configured — never swapped for something else.
   *
   * A bar with no rule to read yet says so instead of handing its slot to a
   * different bar: on a brand-new account the card is complete and reading zero,
   * which is what starting from zero should look like — the tools are in place
   * before the first trade arrives.
   */
  /**
   * One alert per card — a limit that is getting close. It is a state, not a
   * control: the journal reports what the numbers say, and the platform is the
   * one that enforces.
   *
   * There is deliberately no "payout ready" verdict any more: payouts exist to
   * keep the account value right, not to be judged here. A payout widget belongs
   * on the Home page, later.
   */
  private alertFor(acc: PropAccount, st: AccStats): { kind: string; label: string; why: string } | null {
    // Near limit: drawdown at 80% of the account's limit.
    if (st.maxLoss > 0) {
      const pct = (st.m.ddToLimit / st.maxLoss) * 100;
      if (pct >= 80) {
        const room = Math.max(0, st.maxLoss - st.m.ddToLimit);
        return {
          kind: "limit",
          label: `${pct.toFixed(0)}% of limit used`,
          why: `${fmtMoney(st.m.ddToLimit)} of ${fmtMoney(st.maxLoss)} used · ${fmtMoney(room)} room left. Nothing is blocked here — the platform is the one that enforces the limit.`,
        };
      }
    }

    return null;
  }

  private slotsFor(acc: PropAccount, st: AccStats): CardBar[] {
    const m = st.m;
    type Slot = CardBar;

    // A demo card is a statement, not a dashboard: it says what it is and what
    // it did, because none of its numbers take part in the portfolio totals.
    if (this.isDemo(acc)) {
      return [
        { label: "Practice account", value: "not counted in totals", pct: 0, title: "Demo accounts stay out of the portfolio totals." },
        { label: "Net since start", value: fmtMoney(st.net), pct: 100, fill: st.net < 0 ? "neg" : undefined, title: `${st.count} trades` },
      ];
    }
    const catalog: Record<string, Slot> = {
      target:
        st.target > 0
          ? {
              label: "Profit target",
              value: `${clamp(m.targetPct, 0, 100).toFixed(0)}% · ${fmtMoney(Math.max(0, m.toTarget))} to go`,
              pct: m.targetPct,
              fill: st.net < 0 ? "neg" : undefined,
              title: `${fmtMoney(Math.max(0, st.net))} of ${fmtMoney(st.target)} · ${fmtMoney(Math.max(0, m.toTarget))} to go`,
            }
          : {
              label: "Profit target",
              value: "No target set",
              pct: 0,
              title: "This account has no profit target yet — set one in its rules and this bar tracks it from the first trade.",
            },
      drawdown:
        st.maxLoss > 0
          ? (() => {
              const pct = clamp((st.m.ddToLimit / st.maxLoss) * 100, 0, 100);
              const band = pct > 75 ? "crit" : pct > 40 ? "warn" : "safe";
              return {
                label: "Drawdown level",
                value: `${pct.toFixed(0)}% · ${fmtMoney(Math.max(0, st.m.ddRemaining))} room`,
                pct,
                fill: `dd ${band}`,
                tone: band === "safe" ? undefined : band,
                title: `${fmtMoney(st.m.ddToLimit)} used of -$${st.maxLoss.toLocaleString()} · ${fmtMoney(Math.max(0, st.m.ddRemaining))} room left`,
              };
            })()
          : {
              label: "Drawdown level",
              value: "No loss limit set",
              pct: 0,
              fill: "dd safe",
              title: "This account has no drawdown rule yet — set one in its rules and this bar tracks how much room is left.",
            },
      dailyRoom:
        st.dailyLoss > 0
          ? {
              label: "Daily room",
              value: fmtMoney(Math.max(0, m.dailyLossRemaining)),
              pct: (Math.max(0, m.dailyLossRemaining) / st.dailyLoss) * 100,
              fill: "blue",
              title: `$${st.dailyLoss.toLocaleString()} daily loss limit · ${fmtMoney(m.todayNet)} today`,
            }
          : {
              label: "Daily room",
              value: "No daily limit",
              pct: 0,
              fill: "blue",
              title: "This account has no daily loss limit — set one in its rules and this bar tracks what is left of today's budget.",
            },
      greenDays: {
        label: "Green days",
        value: `${m.dayWinRate.toFixed(0)}% of days`,
        pct: m.dayWinRate,
        fill: "teal",
        title: `${m.dayCount} trading day${m.dayCount === 1 ? "" : "s"} · ${fmtMoney(m.bestDay)} best · ${fmtMoney(m.worstDay)} worst`,
      },
      ddFromPeak: {
        label: "Trade drawdown from peak",
        value: `${((m.ddCurrent / (m.peak || 1)) * 100).toFixed(1)}%`,
        pct: (m.ddCurrent / (m.peak || 1)) * 100,
        fill: "dd warn",
        tone: m.ddCurrent > 0 ? "warn" : undefined,
        title: `${fmtMoney(m.ddCurrent)} below the ${fmtMoney(m.peak)} trading peak · deepest was ${fmtMoney(m.maxDrawdown)}`,
      },
    };

    // The signed-off two bars for this type, in order. No substitutes.
    const wanted = layoutFor(acc.type).bars;
    return wanted
      .slice(0, BAR_SLOTS)
      .map((id) => catalog[id])
      .filter((slot): slot is Slot => !!slot);
  }

  /** The four quiet numbers under the bars, one set per account type. */
  private miniFor(acc: PropAccount, st: AccStats): Array<[string, string]> {
    const m = st.m;
    const catalog: Record<string, [string, string]> = {
      trades: ["Trades", String(st.count)],
      win: ["Win", st.count ? `${st.winRate.toFixed(0)}%` : "—"],
      dayWin: ["Day win", m.dayCount ? `${m.dayWinRate.toFixed(0)}%` : "—"],
      withdrawn: ["Paid out", m.withdrawn ? fmtMoney(m.withdrawn) : "—"],
      avgR: ["Avg R", Number.isFinite(m.avgRiskR) && m.avgRiskR !== 0 ? `${m.avgRiskR > 0 ? "+" : ""}${m.avgRiskR.toFixed(1)}R` : "—"],
      profitFactor: ["Profit factor", Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"],
      toTarget: ["To target", m.daysToTarget !== null ? `${m.daysToTarget}d` : "—"],
      last: ["Last", this.lastSeen(st.last)],
      symbols: ["Symbols", st.symbols ? String(st.symbols) : "—"],
      hold: ["Hold", m.avgHoldWinMin > 0 ? `${Math.round(m.avgHoldWinMin)}m` : "—"],
      expectancy: ["Expectancy", Number.isFinite(m.expectancy) ? fmtMoney(m.expectancy) : "—"],
    };

    const wanted = layoutFor(acc.type).mini;
    const out: Array<[string, string]> = [];
    for (const id of wanted) {
      const item = catalog[id];
      if (item && out.length < MINI_SLOTS) out.push(item);
    }
    // A card with three numbers looks broken; trades and win rate always exist.
    for (const filler of [catalog.trades, catalog.win, catalog.last]) {
      if (out.length >= MINI_SLOTS) break;
      if (!out.some(([label]) => label === filler[0])) out.push(filler);
    }
    return out;
  }

  private lastSeen(iso: string): string {
    if (!iso) return "—";
    const n = this.daysSince(iso);
    if (n <= 0) return "today";
    return n === 1 ? "1d ago" : `${n}d ago`;
  }

  private renderArchived(main: HTMLElement): void {
    const archived = this.plugin.settings.archivedAccounts || [];
    if (!archived.length) return;
    const box = main.createDiv({ cls: "tj-archived-box" });
    box.createEl("h3", { text: "Archived (past evals)" });
    for (const acc of archived) {
      const row = box.createDiv({ cls: "tj-archived-row" });
      row.createEl("span", { text: `${acc.name}  ·  $${(acc.size / 1000).toFixed(0)}K` });
      row
        .createEl("button", { text: "Restore", cls: "tj-btn tj-mini", attr: { type: "button" } })
        .addEventListener("click", async () => {
          await this.plugin.unarchiveAccount(acc.id);
          this.render();
        });
    }
  }

  openPluginSettings(): void {
    openSettings(this.app, this.plugin, "accounts");
  }
}
