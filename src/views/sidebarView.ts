import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type TradebookPlugin from "../main";
import { PropAccount, Trade } from "../types";
import { fmtMoney2, fmtMoneyCompact, fmtPrice, isFiniteNumber } from "../tz";
import { dateSearchTokens, formatDate } from "../lib/dates";
import { dateInZone } from "../lib/periods";
import { legBaseKey } from "../lib/copy";
import { reviewStatus } from "../lib/review";
import wordmarkUrl from "../../assets/brand/TradebookWordmark.png";

export const TRADEBOOK_SIDEBAR_VIEW_TYPE = "tradebook-sidebar-view";

type NavGroup = "OVERVIEW" | "PINNED" | "TOOLS" | "RECENT";

/** One row in the menu. A fixed page (Home, Trade Log…) or an optional page the
 *  user pinned from "Customize". `run` is the whole action — we never impose.
 *
 *  No tooltip: the label says where the row goes, and a hover card that repeats
 *  it in numbers is noise on the way to the page. */
interface NavEntry {
  id: string;
  label: string;
  icon: string;
  group: NavGroup;
  run: () => void;
  count?: string | null;
  countTone?: "money" | "warn";
  optional?: boolean;
}

interface SearchRow {
  icon: string;
  label: string;
  sub?: string;
  value?: string;
  valueTone?: "pos" | "neg";
  action: () => void;
  /** The decision was written up or marked reviewed — shown as a check. */
  reviewed?: boolean;
}

interface SearchGroup {
  title: string;
  rows: SearchRow[];
}

interface CatalogRow {
  id: string;
  label: string;
  icon: string;
  optional: boolean;
}

const GROUP_ORDER: NavGroup[] = ["OVERVIEW", "PINNED", "TOOLS"];
const GROUP_TITLES: Record<NavGroup, string> = {
  OVERVIEW: "Overview",
  PINNED: "Pinned",
  TOOLS: "Tools",
  RECENT: "Recent",
};

/** Fixed destinations the catalogue can hide/reveal (Tools keep their own
 *  section and is only toggled with the eye, not the catalogue). */
/**
 * The Tradebook menu — a navigable index, not a second app.
 *
 * It reads: brand, a search that replaces the list, a one-line summary of the
 * week, then the pages. Counts and the summary are reporting only: the menu
 * says where you are and what is waiting, and never blocks or refuses anything.
 * "Customize" lets the reader hide pages, pin the accounts and strategies they
 * follow, reorder, and put it back to the default.
 */
export class TradebookSidebarView extends ItemView {
  plugin: TradebookPlugin;
  active = "home";

  private _trades: Trade[] | null = null;
  private _flat: { el: HTMLElement; action: () => void }[] = [];
  private _sel = 0;
  /** Type filter for the search results — "all" or a group title. */
  private _searchFilter = "all";
  /** Last unfiltered result set, used to count the scope menu. */
  private _allGroups: SearchGroup[] = [];
  private _rerunQuery: (() => void) | null = null;
  private _scopeRef: { set: (id: string) => void } | null = null;
  private customizing = false;
  private _dragId: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TradebookPlugin) {
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
    void this.refresh();
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

  /** Re-read the trade index, then repaint. Called on plugin-wide reloads. */
  async refresh(): Promise<void> {
    try {
      this._trades = await this.plugin.loadTradesExpanded();
    } catch {
      this._trades = this._trades ?? [];
    }
    this.render();
  }

  /** Map the focused workspace view to a sidebar item id. */
  private viewToNavId(type: string): string | null {
    switch (type) {
      case "tradebook-home-view":
        return "home";
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
      const view = ws.getActiveViewOfType?.(ItemView) ?? null;
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

  // ---------------------------------------------------------------- prefs

  private prefs(): { hidden?: string[]; pinned?: string[]; order?: string[] } {
    const s = this.plugin.settings;
    if (!s.sidebar || typeof s.sidebar !== "object") s.sidebar = {};
    return s.sidebar;
  }

  private hiddenSet(): Set<string> {
    return new Set(this.prefs().hidden ?? []);
  }

  private pinnedList(): string[] {
    return this.prefs().pinned ?? [];
  }

  private async persist(): Promise<void> {
    try {
      await this.plugin.saveSettings();
    } catch {
      /* keep the menu usable even if the write fails */
    }
  }

  private async toggleHidden(id: string): Promise<void> {
    const p = this.prefs();
    const hidden = new Set(p.hidden ?? []);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    p.hidden = [...hidden];
    this.render();
    await this.persist();
  }

  private async togglePinned(id: string): Promise<void> {
    const p = this.prefs();
    const pinned = p.pinned ?? [];
    p.pinned = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
    this.render();
    await this.persist();
  }

  private async resetLayout(): Promise<void> {
    const p = this.prefs();
    p.hidden = [];
    p.pinned = [];
    p.order = [];
    this.render();
    await this.persist();
  }

  // ---------------------------------------------------------------- entries

  private today(): string {
    return dateInZone(this.plugin.settings.timeZone || "UTC");
  }

  /** The fixed pages: destinations, tools and the two review shortcuts. */
  private fixedEntries(): NavEntry[] {
    return [
      {
        id: "home",
        label: "Home",
        icon: "home",
        group: "OVERVIEW",
        run: () => void this.plugin.openHome(),
      },
      {
        id: "tradelog",
        label: "Trade Log",
        icon: "notebook-text",
        group: "OVERVIEW",
        run: () => void this.plugin.openTradeLog(),
      },
      {
        id: "setups",
        label: "Strategies",
        icon: "target",
        group: "OVERVIEW",
        run: () => void this.plugin.openSetups(),
      },
      {
        id: "accounts",
        label: "Accounts",
        icon: "wallet",
        group: "OVERVIEW",
        run: () => void this.plugin.openAccounts(),
      },
      {
        id: "addtrade",
        label: "Manual Trade",
        icon: "plus-circle",
        group: "TOOLS",
        run: () => this.plugin.openAddPanel(),
      },
      {
        id: "import",
        label: "Import CSV",
        icon: "upload",
        group: "TOOLS",
        run: () => this.plugin.openImport(),
      },
    ];
  }

  /** The pages the reader pinned: an account, a strategy, today's log, the
   *  print queue or the tour. A pin that no longer resolves is skipped. */
  private optionalEntries(): NavEntry[] {
    const out: NavEntry[] = [];
    const settings = this.plugin.settings;
    for (const id of this.pinnedList()) {
      if (id.startsWith("account:")) {
        const acc = (settings.propAccounts ?? []).find((a: PropAccount) => a.id === id.slice(8));
        if (!acc) continue;
        out.push({
          id,
          label: acc.name || acc.type || "Account",
          icon: "wallet",
          group: "PINNED",
          optional: true,
          count: fmtMoneyCompact(acc.size),
          run: () => void this.plugin.openAccountDashboard(undefined, acc.id),
        });
      } else if (id === "lens:today") {
        out.push({
          id,
          label: "Today's Log",
          icon: "clock",
          group: "PINNED",
          optional: true,
          run: () => void this.plugin.openTradeLogForDay(this.today()),
        });
      }
    }
    return out;
  }

  private allEntries(): NavEntry[] {
    return [...this.fixedEntries(), ...this.optionalEntries()];
  }

  /** Everything that can be shown/hidden, for the Customize catalogue. */
  private catalogGroups(): { title: string; rows: CatalogRow[] }[] {
    const settings = this.plugin.settings;
    const pages: CatalogRow[] = [
      { id: "home", label: "Home", icon: "home", optional: false },
      { id: "tradelog", label: "Trade Log", icon: "folder-tree", optional: false },
      { id: "setups", label: "Strategies", icon: "target", optional: false },
      { id: "accounts", label: "Accounts", icon: "users", optional: false },
    ];
    const accounts: CatalogRow[] = (settings.propAccounts ?? []).map((a: PropAccount) => ({
      id: `account:${a.id}`,
      label: a.name || a.type || "Account",
      icon: "wallet",
      optional: true,
    }));
    const views: CatalogRow[] = [{ id: "lens:today", label: "Today's Log", icon: "clock", optional: true }];
    const groups: { title: string; rows: CatalogRow[] }[] = [
      { title: "Pages", rows: pages },
      { title: "Accounts", rows: accounts },
      { title: "Views", rows: views },
    ];
    return groups.filter((g) => g.rows.length);
  }

  private isCatalogRowOn(row: CatalogRow, hidden: Set<string>, pinned: Set<string>): boolean {
    return row.optional ? pinned.has(row.id) : !hidden.has(row.id);
  }

  // ---------------------------------------------------------------- render

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-nav-sidebar");
    const prefs = this.prefs();
    const hidden = this.hiddenSet();
    const entries = this.allEntries().filter((e) => !hidden.has(e.id));

    this.renderHeader(root);
    const editing = this.customizing;
    const searchInput = editing ? null : this.renderSearch(root);
    if (editing) this.renderEditToolbar(root);

    const body = root.createDiv({ cls: "tj-nav-body" });
    const sections = body.createDiv({ cls: "tj-nav-sections" });
    const shown = entries.filter((e) => !hidden.has(e.id));
    this.renderSections(sections, shown, prefs.order ?? []);
    if (editing) {
      // Removed pages live as a normal section at the end of the list.
      this.renderRestore(sections, hidden, new Set(this.pinnedList()));
    } else {
      const results = body.createDiv({ cls: "tj-nav-results" });
      results.setCssStyles({ display: "none" });
      if (searchInput) this.wireSearch(searchInput, results, sections, entries);
    }
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "tj-nav-header" });
    const brand = header.createDiv({ cls: "tj-nav-brand" });
    const logo = brand.createEl("img", { cls: "tj-nav-wordmark", attr: { src: wordmarkUrl, alt: "Tradebook" } });
    logo.draggable = false;

    const edit = header.createEl("button", {
      cls: "tj-nav-customize" + (this.customizing ? " is-on" : ""),
      attr: { type: "button", "aria-label": this.customizing ? "Finish customizing" : "Customize sidebar" },
    });
    setIcon(edit, "settings-2");
    edit.addEventListener("click", () => {
      this.customizing = !this.customizing;
      this.render();
    });
  }

  /**
   * Edit mode's controls, as a plain toolbar where the search sits (nothing
   * floats, so it never covers the vault's footer). The removed pages move to a
   * normal section at the end of the list.
   */
  private renderEditToolbar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "tj-nav-edittoolbar" });
    bar.createSpan({ cls: "tj-nav-edittoolbar-title", text: "Customize" });
    const actions = bar.createDiv({ cls: "tj-nav-edittoolbar-actions" });
    const reset = actions.createEl("button", {
      cls: "tj-nav-edittoolbar-btn",
      attr: { type: "button", "aria-label": "Reset the sidebar layout" },
    });
    setIcon(reset, "rotate-ccw");
    reset.addEventListener("click", () => void this.resetLayout());
    const gear = actions.createEl("button", {
      cls: "tj-nav-edittoolbar-btn",
      attr: { type: "button", "aria-label": "Open Tradebook settings" },
    });
    setIcon(gear, "settings");
    gear.addEventListener("click", () => this.openPluginSettings());
    const done = actions.createEl("button", {
      cls: "tj-nav-edittoolbar-btn is-primary",
      attr: { type: "button" },
      text: "Done",
    });
    done.addEventListener("click", () => {
      this.customizing = false;
      this.render();
    });
  }

  private renderSearch(root: HTMLElement): HTMLInputElement {
    const search = root.createDiv({ cls: "tj-nav-search" });
    const wrapper = search.createDiv({ cls: "tj-nav-search-input-wrapper" });
    // The magnifier doubles as the scope control: one bar, no chip row.
    const scope = wrapper.createEl("button", {
      cls: "tj-nav-search-scope",
      attr: { type: "button", "aria-label": "Filter results by type", "aria-haspopup": "menu" },
    });
    const scopeIcon = scope.createSpan({ cls: "tj-nav-search-icon" });
    setIcon(scopeIcon, "search");
    const scopeLabel = scope.createSpan({ cls: "tj-nav-search-scope-label" });
    const caret = scope.createSpan({ cls: "tj-nav-search-caret" });
    setIcon(caret, "chevron-down");
    const setScope = (id: string): void => {
      scopeLabel.textContent = id === "all" ? "" : id;
      scope.toggleClass("has-filter", id !== "all");
    };
    this._scopeRef = { set: setScope };
    setScope(this._searchFilter === "all" ? "all" : this._searchFilter);
    scope.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openScopeMenu(search);
    });

    const input = wrapper.createEl("input", {
      cls: "tj-nav-search-input",
      attr: { type: "text", placeholder: "Search…" },
    });
    const clear = wrapper.createEl("button", {
      cls: "tj-nav-search-clear is-hidden",
      attr: { type: "button", "aria-label": "Clear search" },
    });
    setIcon(clear, "x");
    const paint = (): void => clear.toggleClass("is-hidden", input.value.trim() === "");
    input.addEventListener("input", paint);
    clear.addEventListener("click", () => {
      input.value = "";
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
    paint();
    return input;
  }

  /** The scope menu: each result type with its count for the current query. */
  private openScopeMenu(search: HTMLElement): void {
    const existing = search.querySelector(".tj-nav-scope-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const counts = new Map<string, number>();
    let total = 0;
    for (const g of this._allGroups) {
      counts.set(g.title, g.rows.length);
      total += g.rows.length;
    }
    const FILTERS: Array<[string, string]> = [
      ["all", "All"],
      ["Trades", "Trades"],
      ["Accounts", "Accounts"],
      ["Strategies", "Strategies"],
      ["Tags", "Tags"],
    ];
    const menu = search.createDiv({ cls: "tj-nav-scope-menu", attr: { role: "menu" } });
    for (const [id, name] of FILTERS) {
      const n = id === "all" ? total : counts.get(id) ?? 0;
      const item = menu.createEl("button", {
        cls: "tj-nav-scope-item" + (this._searchFilter === id ? " is-on" : ""),
        attr: { type: "button", role: "menuitem" },
      });
      item.createSpan({ cls: "tj-nav-scope-name", text: name });
      item.createSpan({ cls: "tj-nav-scope-count", text: String(n) });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.remove();
        this._searchFilter = id;
        this._scopeRef?.set(id);
        this._rerunQuery?.();
      });
    }
    const close = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", close);
      }
    };
    window.setTimeout(() => document.addEventListener("click", close), 0);
  }

  private renderSections(container: HTMLElement, entries: NavEntry[], order: string[]): void {
    const idx = (id: string): number => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    for (const group of GROUP_ORDER) {
      const items = entries.filter((e) => e.group === group).sort((a, b) => idx(a.id) - idx(b.id));
      if (!items.length) continue;
      const section = container.createDiv({ cls: "tj-nav-section" });
      const head = section.createDiv({ cls: "tj-nav-section-header" });
      head.createSpan({ text: GROUP_TITLES[group] });
      for (const entry of items) this.renderItem(section, entry, group);
    }
  }

  private renderItem(section: HTMLElement, entry: NavEntry, group: NavGroup): void {
    const btn = section.createEl("button", {
      cls: "tj-nav-item" + (this.active === entry.id ? " active" : ""),
      attr: { type: "button", "aria-label": entry.label },
    });
    btn.dataset.id = entry.id;
    btn.dataset.group = group;

    if (this.customizing) {
      btn.draggable = true;
      const handle = btn.createSpan({ cls: "tj-nav-handle", attr: { "aria-hidden": "true" } });
      setIcon(handle, "grip-vertical");
    }

    const iconSpan = btn.createSpan({ cls: "tj-nav-icon" });
    setIcon(iconSpan, entry.icon);
    btn.createSpan({ cls: "tj-nav-label", text: entry.label });

    if (entry.count) {
      const count = btn.createSpan({ cls: "tj-nav-count" });
      count.textContent = entry.count;
      if (entry.countTone === "money") count.addClass("is-money");
      if (entry.countTone === "warn") count.addClass("is-warn");
    }

    if (this.customizing) {
      // One X per row, floating over the right edge. It never takes
      // width from the label, so labels keep their full text while editing.
      const remove = btn.createSpan({
        cls: "tj-nav-item-remove",
        attr: { role: "button", tabindex: "0", "aria-label": `Remove ${entry.label}` },
      });
      setIcon(remove, "x");
      const drop = (): void => {
        if (entry.optional) void this.togglePinned(entry.id);
        else void this.toggleHidden(entry.id);
      };
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        drop();
      });
      remove.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          drop();
        }
      });
    } else {
      btn.addEventListener("click", () => {
        entry.run();
        this.setActive(entry.id);
      });
    }

    this.wireDrag(btn, section);
  }

  private wireDrag(item: HTMLElement, section: HTMLElement): void {
    if (!this.customizing) return;
    item.addEventListener("dragstart", (e: DragEvent) => {
      this._dragId = item.dataset.id ?? null;
      item.addClass("is-dragging");
      try {
        e.dataTransfer?.setData("text/plain", this._dragId ?? "");
      } catch {
        /* ignore */
      }
    });
    item.addEventListener("dragend", () => {
      this._dragId = null;
      section.querySelectorAll<HTMLElement>(".is-dragging, .is-drop").forEach((el) => {
        el.removeClass("is-dragging");
        el.removeClass("is-drop");
      });
    });
    item.addEventListener("dragover", (e: DragEvent) => {
      if (!this._dragId || this._dragId === item.dataset.id) return;
      e.preventDefault();
      item.addClass("is-drop");
    });
    item.addEventListener("dragleave", () => item.removeClass("is-drop"));
    item.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      item.removeClass("is-drop");
      const dragged = this._dragId ? section.querySelector<HTMLElement>(`.tj-nav-item[data-id="${this._dragId}"]`) : null;
      if (dragged && dragged.dataset.group === item.dataset.group && dragged !== item) {
        item.parentElement?.insertBefore(dragged, item);
        this.persistOrder();
      }
    });
  }

  private persistOrder(): void {
    const ids: string[] = [];
    this.contentEl.querySelectorAll<HTMLElement>(".tj-nav-sections .tj-nav-item").forEach((el) => {
      if (el.dataset.id) ids.push(el.dataset.id);
    });
    this.prefs().order = ids;
    void this.persist();
  }

  private renderRestore(container: HTMLElement, hidden: Set<string>, pinned: Set<string>): void {
    const removed = this.catalogGroups()
      .map((g) => ({ title: g.title, rows: g.rows.filter((r) => !this.isCatalogRowOn(r, hidden, pinned)) }))
      .filter((g) => g.rows.length);
    const section = container.createDiv({ cls: "tj-nav-section tj-nav-restore" });
    const head = section.createDiv({ cls: "tj-nav-section-header" });
    head.createSpan({ text: removed.length ? "Removed" : "All pages are in the menu" });
    if (removed.length) {
      const reset = head.createEl("button", { cls: "tj-nav-restore-reset", attr: { type: "button" }, text: "Reset" });
      reset.addEventListener("click", () => void this.resetLayout());
    }
    for (const group of removed) {
      section.createDiv({ cls: "tj-nav-restore-group", text: group.title });
      for (const row of group.rows) {
        const line = section.createDiv({ cls: "tj-nav-restore-row" });
        const ic = line.createSpan({ cls: "tj-nav-icon" });
        setIcon(ic, row.icon);
        line.createSpan({ cls: "tj-nav-label", text: row.label });
        const add = line.createEl("button", {
          cls: "tj-nav-restore-btn",
          attr: { type: "button", "aria-label": `Add ${row.label}` },
        });
        setIcon(add, "plus");
        add.createSpan({ text: "Add" });
        add.addEventListener("click", () => {
          if (row.optional) void this.togglePinned(row.id);
          else void this.toggleHidden(row.id);
        });
      }
    }
  }

  private openPluginSettings(): void {
    const setting = (this.plugin.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting;
    if (setting && typeof setting.open === "function") {
      setting.open();
      if (typeof setting.openTabById === "function") setting.openTabById(this.plugin.manifest.id);
    }
  }

  // ---------------------------------------------------------------- search

  private wireSearch(input: HTMLInputElement, results: HTMLElement, sections: HTMLElement, entries: NavEntry[]): void {
    const run = async (raw: string): Promise<void> => {
      const query = raw.trim().toLowerCase();
      if (!query) {
        this._searchFilter = "all";
        results.setCssStyles({ display: "none" });
        results.removeClass("is-entering");
        sections.setCssStyles({ display: "" });
        return;
      }
      sections.setCssStyles({ display: "none" });
      if (!this._trades) {
        try {
          this._trades = await this.plugin.loadTradesExpanded();
        } catch {
          this._trades = [];
        }
      }
      const all = this.buildGroups(query, entries);
      if (!all.length) {
        results.empty();
        results.createDiv({ cls: "tj-nav-results-empty", text: "No matches" });
        results.setCssStyles({ display: "" });
        return;
      }
      this._allGroups = all;
      this._scopeRef?.set(this._searchFilter);
      const groups =
        this._searchFilter === "all" ? all : all.filter((g) => g.title === this._searchFilter);
      this.renderResults(results, groups);
      results.setCssStyles({ display: "" });
      // A gentle fade+slide on every fresh result set (CSS honours reduced motion
      // and the Animations setting through the class).
      results.removeClass("is-entering");
      void results.offsetWidth;
      if (this.plugin.settings.animations !== false) results.addClass("is-entering");
    };

    this._rerunQuery = () => void run(input.value);

    let deb = 0;
    input.addEventListener("input", () => {
      if (deb) window.clearTimeout(deb);
      deb = window.setTimeout(() => void run(input.value), 120);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveSel(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveSel(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.activateSel(input);
      } else if (e.key === "Escape") {
        input.value = "";
        void run("");
      }
    });
  }

  private buildGroups(query: string, entries: NavEntry[]): SearchGroup[] {
    const terms = query.split(/\s+/).filter(Boolean);
    const hit = (s: string | undefined | null): boolean => {
      if (!s) return false;
      const l = s.toLowerCase();
      return terms.every((t) => l.includes(t));
    };
    const groups: SearchGroup[] = [];

    // 1) Navigation (mirrors the menu exactly)
    const navRows: SearchRow[] = entries
      .filter((it) => hit(it.label))
      .map((it) => ({ icon: it.icon, label: it.label, sub: "Page", action: () => it.run() }));
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
        action: () => void this.plugin.openTradeDetail({ id: t.id }),
        reviewed: !reviewStatus(t).unreviewed,
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

    // 4b) Tags — the mistake/psychology tags that match, each opening the Log
    // filtered to it. A tag is a way in, never a judgement (§0).
    const tagRows: SearchRow[] = [];
    const seenTags = new Set<string>();
    const addTag = (tag: string, kind: "mistake" | "psychology"): void => {
      const clean = (tag || "").trim();
      if (!clean) return;
      const key = `${kind}:${clean.toLowerCase()}`;
      if (seenTags.has(key) || !hit(clean)) return;
      seenTags.add(key);
      tagRows.push({
        icon: kind === "mistake" ? "alert-triangle" : "brain",
        label: clean,
        sub: kind === "mistake" ? "Mistake tag" : "Psychology tag",
        action: () =>
          void this.plugin.openTradeLogView(
            kind === "mistake" ? { mistakeTags: [clean] } : { psychologyTags: [clean] }
          ),
      });
    };
    for (const t of trades) {
      for (const tag of t.mistake_tags ?? []) addTag(tag, "mistake");
      for (const tag of t.psychology_tags ?? []) addTag(tag, "psychology");
    }
    if (tagRows.length) groups.push({ title: "Tags", rows: tagRows.slice(0, 12) });

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
    if (!groups.length) {
      container.createDiv({ cls: "tj-nav-results-empty", text: "No matches here" });
      return;
    }
    for (const g of groups) {
      const head = container.createDiv({ cls: "tj-nav-section-header tj-nav-results-header" });
      head.createSpan({ text: g.title });
      head.createSpan({ cls: "tj-nav-results-count", text: String(g.rows.length) });
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
        if (row.reviewed) {
          const rv = el.createSpan({ cls: "tj-nav-result-reviewed", attr: { "aria-label": "Reviewed" } });
          setIcon(rv, "check");
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
