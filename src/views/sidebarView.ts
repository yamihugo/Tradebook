import { ItemView, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { Trade } from "../types";
import { fmtMoney2, fmtPrice, isFiniteNumber } from "../tz";
import { dateSearchTokens, formatDate } from "../lib/dates";
import { tradeKey } from "../storage";
import { attachTip } from "../lib/tip";
import { BRAND_ICON_ID } from "../lib/brand";
import { legBaseKey } from "../lib/copy";

export const TRADEBOOK_SIDEBAR_VIEW_TYPE = "tradebook-sidebar-view";

type Category = "OVERVIEW" | "TOOLS";

interface NavItem {
  id: string;
  label: string;
  icon: string;
  fn: () => void;
  category: Category;
}

interface SearchRow {
  icon: string;
  label: string;
  sub?: string;
  value?: string;
  valueTone?: "pos" | "neg";
  action: () => void;
}

interface SearchGroup {
  title: string;
  rows: SearchRow[];
}

/**
 * Journalit-style sidebar with a live, grouped fuzzy search that mirrors the
 * menu (Navigation · Trades · Accounts · Strategies · Actions).
 */
export class TradebookSidebarView extends ItemView {
  plugin: TradebookPlugin;
  active = "home";

  private _trades: Trade[] | null = null;
  private _flat: { el: HTMLElement; action: () => void }[] = [];
  private _sel = 0;

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TRADEBOOK_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Tradebook";
  }

  getIcon(): string {
    return "candlestick-chart";
  }

  async onOpen(): Promise<void> {
    this.syncActive();
    this.render();
    // Keep the highlight in sync with whatever view is focused (also after a
    // reload, when the workspace restores the previously open view).
    const ws = this.plugin?.app?.workspace;
    if (ws?.on) {
      try {
        this.registerEvent(ws.on("active-leaf-change", () => this.syncActive()));
        this.registerEvent(ws.on("layout-change", () => this.syncActive()));
      } catch {
        /* older/mocked workspace */
      }
      window.setTimeout(() => this.syncActive(), 300);
    }
  }

  /** Map the focused workspace view to a sidebar item id. */
  private viewToNavId(type: string): string | null {
    switch (type) {
      case "tradebook-home-view":
        return "home";
      case "tradebook-dashboard-view":
        return "dashboard";
      case "tradebook-trade-log-view":
      case "tradebook-trade-detail-view":
        return "tradelog";
      case "tradebook-setups-view":
        return "setups";
      case "tradebook-accounts-list-view":
      case "tradebook-account-dash-view":
        return "accounts";
      default:
        return null;
    }
  }

  private syncActive(): void {
    try {
      const ws = this.plugin?.app?.workspace;
      if (!ws) return;
      const view = ws.getActiveViewOfType?.(ItemView) as any;
      const type = view?.getViewType?.() ?? "";
      if (type === TRADEBOOK_SIDEBAR_VIEW_TYPE) return; // sidebar itself focused
      const id = this.viewToNavId(type);
      if (id && id !== this.active) {
        this.active = id;
        this.render();
      }
    } catch {
      /* ignore */
    }
  }

  setActive(id: string): void {
    this.active = id;
    if (this.contentEl) this.render();
  }

  private navItems(): NavItem[] {
    return [
      { id: "home", label: "Home", icon: "home", fn: () => this.plugin.openHome(), category: "OVERVIEW" },
      { id: "dashboard", label: "Analytics", icon: "grip", fn: () => this.plugin.openDashboard(), category: "OVERVIEW" },
      { id: "tradelog", label: "Trade Log", icon: "folder-tree", fn: () => this.plugin.openTradeLog(), category: "OVERVIEW" },
      { id: "setups", label: "Strategies", icon: "target", fn: () => this.plugin.openSetups(), category: "OVERVIEW" },
      { id: "accounts", label: "Accounts", icon: "users", fn: () => this.plugin.openAccounts(), category: "OVERVIEW" },
      { id: "addtrade", label: "Manual Trade", icon: "plus-circle", fn: () => this.plugin.openAddPanel(), category: "TOOLS" },
      { id: "import", label: "Import CSV", icon: "upload", fn: () => this.plugin.openImport(), category: "TOOLS" },
    ];
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-nav-sidebar");

    // Header with brand
    const header = root.createDiv({ cls: "tj-nav-header" });
    const brand = header.createDiv({ cls: "tj-nav-brand" });
    const brandIcon = brand.createDiv({ cls: "tj-nav-brand-icon" });
    setIcon(brandIcon, BRAND_ICON_ID);
    brand.createEl("h3", { text: "Tradebook" });

    // Settings shortcut (top-right), like Journalit.
    const gear = header.createEl("button", {
      cls: "tj-nav-gear",
      attr: { type: "button", "aria-label": "Tradebook settings" },
    });
    setIcon(gear, "settings");
    if (!gear.querySelector("svg")) gear.setText("⚙");
    gear.addEventListener("click", () => {
      const setting: any = (this.plugin.app as any).setting;
      if (setting && typeof setting.open === "function") {
        setting.open();
        if (typeof setting.openTabById === "function") setting.openTabById(this.plugin.manifest.id);
      }
    });

    // Search
    const search = root.createDiv({ cls: "tj-nav-search" });
    const searchWrapper = search.createDiv({ cls: "tj-nav-search-input-wrapper" });
    const searchIcon = searchWrapper.createSpan({ cls: "tj-nav-search-icon" });
    setIcon(searchIcon, "search");
    const searchInput = searchWrapper.createEl("input", {
      cls: "tj-nav-search-input",
      attr: { type: "text", placeholder: "Search anything — date, symbol, P&L, strategy…" },
    });

    // Results panel (shown while searching) + the normal menu sections.
    const results = root.createDiv({ cls: "tj-nav-results" });
    results.style.display = "none";
    const sections = root.createDiv({ cls: "tj-nav-sections" });

    const items = this.navItems();
    const categories: Category[] = ["OVERVIEW", "TOOLS"];
    for (const cat of categories) {
      const catItems = items.filter((i) => i.category === cat);
      if (catItems.length === 0) continue;
      const section = sections.createDiv({ cls: "tj-nav-section" });
      section.createDiv({ cls: "tj-nav-section-header", text: cat.charAt(0).toUpperCase() + cat.slice(1) });
      for (const it of catItems) {
        const btn = section.createEl("button", {
          cls: "tj-nav-item" + (this.active === it.id ? " active" : ""),
          attr: { type: "button", "aria-label": it.label },
        });
        const iconSpan = btn.createSpan({ cls: "tj-nav-icon" });
        setIcon(iconSpan, it.icon);
        btn.createSpan({ cls: "tj-nav-label", text: it.label });
        btn.addEventListener("click", () => {
          it.fn();
          this.setActive(it.id);
        });
      }
    }

    // ---------------- Search wiring ----------------
    const run = async (raw: string) => {
      const query = raw.trim().toLowerCase();
      if (!query) {
        results.style.display = "none";
        sections.style.display = "";
        return;
      }
      if (!this._trades) {
        try {
          this._trades = await this.plugin.loadTradesExpanded();
        } catch {
          this._trades = [];
        }
      }
      const groups = this.buildGroups(query, items);
      this.renderResults(results, groups);
      results.style.display = "";
      sections.style.display = groups.length ? "none" : "";
      if (!groups.length) {
        results.createDiv({ cls: "tj-nav-results-empty", text: "No matches" });
      }
    };

    let deb = 0;
    searchInput.addEventListener("input", () => {
      if (deb) window.clearTimeout(deb);
      deb = window.setTimeout(() => void run(searchInput.value), 120);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveSel(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveSel(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.activateSel(searchInput);
      } else if (e.key === "Escape") {
        searchInput.value = "";
        void run("");
      }
    });
  }

  private buildGroups(query: string, items: NavItem[]): SearchGroup[] {
    const terms = query.split(/\s+/).filter(Boolean);
    const hit = (s: string | undefined | null): boolean => {
      if (!s) return false;
      const l = s.toLowerCase();
      return terms.every((t) => l.includes(t));
    };
    const groups: SearchGroup[] = [];

    // 1) Navigation (mirrors the menu exactly)
    const navRows: SearchRow[] = items
      .filter((it) => hit(it.label))
      .map((it) => ({ icon: it.icon, label: it.label, sub: "Page", action: () => it.fn() }));
    if (navRows.length) groups.push({ title: "Navigation", rows: navRows });

    // 2) Trades — search EVERY field, then group copy-traded legs.
    const trades = this._trades ?? [];
    const fmtDate = this.plugin.settings.dateFormat;
    const buckets = new Map<string, { legs: Trade[]; matched: string }>();
    for (const t of trades) {
      if (!isFiniteNumber(t.pnl)) continue;
      const money = fmtMoney2(t.pnl);
      const fields: Array<[string, string]> = [
        ["Date", dateSearchTokens(t.date, fmtDate)],
        ["Symbol", t.symbol || ""],
        ["Direction", t.direction || ""],
        ["Account", t.account || ""],
        ["Strategy", t.setup || ""],
        ["Mistake", t.mistake || ""],
        ["Review", t.review || ""],
        ["Thesis", t.thesis || ""],
        ["Tags", (t.tags ?? []).join(" ")],
        ["P&L", `${t.pnl} ${Math.abs(t.pnl)} ${money} ${money.replace(/[^0-9.]/g, "")}`],
        ["Points", `${t.pnlPoints}`],
        ["Qty", `${t.quantity}`],
        ["Entry", fmtPrice(t.entryPrice)],
        ["Exit", fmtPrice(t.exitPrice)],
        ["Stop", fmtPrice(t.stopLoss)],
        ["Rating", `${t.rating ?? ""}`],
      ];
      const hay = fields.map(([, v]) => v).join(" ").toLowerCase();
      if (!hit(hay)) continue;
      const matched = fields.find(([, v]) => terms.some((term) => (v || "").toLowerCase().includes(term)))?.[0] ?? "";
      const key = legBaseKey(t);
      const bucket = buckets.get(key);
      if (bucket) bucket.legs.push(t);
      else buckets.set(key, { legs: [t], matched });
      if (buckets.size >= 25) break;
    }
    const tradeRows: SearchRow[] = [];
    for (const { legs, matched } of buckets.values()) {
      const t = legs[0];
      const total = legs.reduce((sum, x) => sum + x.pnl, 0);
      const accounts = [...new Set(legs.map((x) => x.account).filter(Boolean))];
      const generic = matched === "Symbol" || matched === "Account" || matched === "Date" || matched === "Direction";
      const sub =
        accounts.length > 1
          ? `${accounts.length} accounts · ${accounts.slice(0, 3).join(", ")}${accounts.length > 3 ? "…" : ""}`
          : [t.account, t.setup, matched && !generic ? `match: ${matched}` : ""].filter(Boolean).join(" · ");
      tradeRows.push({
        icon: "file-text",
        label: `${formatDate(t.date, fmtDate)}  ${t.symbol}${t.direction ? " " + t.direction.toUpperCase() : ""}${accounts.length > 1 ? "  ⇄" : ""}`,
        sub,
        value: fmtMoney2(total),
        valueTone: total >= 0 ? "pos" : "neg",
        action: () => this.plugin.openTradeDetail({ id: t.id }),
      });
    }
    if (tradeRows.length) groups.push({ title: "Trades", rows: tradeRows });

    // 3) Accounts
    const accounts = this.plugin.settings.propAccounts ?? [];
    const accRows: SearchRow[] = accounts
      .filter((a) => hit(`${a.name} ${a.type} ${a.size}`))
      .map((a) => ({
        icon: "wallet",
        label: a.name || `${a.type} ${Math.round(a.size / 1000)}K`,
        sub: `${a.type} · ${Math.round(a.size / 1000)}K`,
        action: () => this.plugin.openAccountDashboard(undefined, a.id),
      }));
    if (accRows.length) groups.push({ title: "Accounts", rows: accRows });

    // 4) Setups (derived from trades)
    const setups = new Map<string, { count: number; net: number }>();
    for (const t of trades) {
      if (!isFiniteNumber(t.pnl) || !t.setup) continue;
      const g = setups.get(t.setup) ?? { count: 0, net: 0 };
      g.count++;
      g.net += t.pnl;
      setups.set(t.setup, g);
    }
    const setupRows: SearchRow[] = [...setups.entries()]
      .filter(([name]) => hit(name))
      .sort((a, b) => b[1].net - a[1].net)
      .map(([name, g]) => ({
        icon: "flask-conical",
        label: name,
        sub: `${g.count} trades`,
        value: fmtMoney2(g.net),
        valueTone: g.net >= 0 ? "pos" : "neg",
        action: () => this.plugin.openSetups(),
      }));
    if (setupRows.length) groups.push({ title: "Strategies", rows: setupRows });

    // 5) Actions
    const actionRows: SearchRow[] = [
      { icon: "plus-circle", label: "Manual Trade", sub: "Action", action: () => this.plugin.openAddPanel() },
      { icon: "upload", label: "Import CSV", sub: "Action", action: () => this.plugin.openImport() },
    ].filter((r) => hit(r.label));
    if (actionRows.length) groups.push({ title: "Actions", rows: actionRows });

    return groups;
  }

  private renderResults(container: HTMLElement, groups: SearchGroup[]): void {
    container.empty();
    this._flat = [];
    this._sel = 0;
    for (const g of groups) {
      container.createDiv({ cls: "tj-nav-section-header tj-nav-results-header", text: g.title });
      for (const row of g.rows) {
        const el = container.createDiv({ cls: "tj-nav-result" });
        const ic = el.createSpan({ cls: "tj-nav-icon" });
        setIcon(ic, row.icon);
        const main = el.createDiv({ cls: "tj-nav-result-main" });
        main.createSpan({ cls: "tj-nav-result-label", text: row.label });
        if (row.sub) main.createSpan({ cls: "tj-nav-result-sub", text: row.sub });
        if (row.value) {
          const v = el.createSpan({ cls: "tj-nav-result-value" });
          v.textContent = row.value;
          if (row.valueTone === "pos") v.addClass("tj-pos");
          else if (row.valueTone === "neg") v.addClass("tj-neg");
        }
        const entry = { el, action: row.action };
        el.addEventListener("click", () => void entry.action());
        this._flat.push(entry);
      }
    }
    if (this._flat.length) this._flat[0].el.addClass("is-selected");
  }

  private moveSel(delta: number): void {
    if (!this._flat.length) return;
    this._flat[this._sel]?.el.removeClass("is-selected");
    this._sel = (this._sel + delta + this._flat.length) % this._flat.length;
    const el = this._flat[this._sel].el;
    el.addClass("is-selected");
    el.scrollIntoView({ block: "nearest" });
  }

  private activateSel(input: HTMLInputElement): void {
    const entry = this._flat[this._sel];
    if (!entry) return;
    input.value = "";
    entry.action();
  }
}
