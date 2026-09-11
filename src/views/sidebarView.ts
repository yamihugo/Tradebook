import { ItemView, WorkspaceLeaf } from "obsidian";
import type TradingJournalPlugin from "../main";

export const TRADING_JOURNAL_SIDEBAR_VIEW_TYPE = "trading-journal-sidebar-view";

export class TradingJournalSidebarView extends ItemView {
  plugin: TradingJournalPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: TradingJournalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TRADING_JOURNAL_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Trading Journal";
  }

  getIcon(): string {
    // Logo shown as the tab icon in Obsidian's left sidebar top bar.
    return "candlestick-chart";
  }

  active = "dashboard";

  async onOpen(): Promise<void> {
    this.render();
  }

  setActive(id: string): void {
    this.active = id;
    if (this.contentEl) this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-sidebar-pane");

    const brand = root.createDiv({ cls: "tj-sb-brand" });
    const brandLabel = this.plugin.settings?.journalName || "Trading Journal";
    brand.createDiv({ cls: "tj-sb-brand-icon" }).createEl("span", { text: "TJ" });
    brand.createEl("h3", { text: brandLabel });

    const NAV_ITEMS: { id: string; label: string; fn: () => void; category: "OVERVIEW" | "REVIEWS" | "TOOLS" }[] = [
      { id: "dashboard", label: "Home", fn: () => this.plugin.openDashboard(), category: "OVERVIEW" },
      { id: "calendar", label: "Calendar", fn: () => this.plugin.openCalendar(), category: "OVERVIEW" },
      { id: "tradelog", label: "Trade Log", fn: () => this.plugin.openTradeLog(), category: "OVERVIEW" },
      { id: "accounts", label: "Accounts", fn: () => this.plugin.openAccounts(), category: "OVERVIEW" },
      { id: "drc", label: "Today's DRC", fn: () => this.plugin.openDashboard(), category: "REVIEWS" },
      { id: "weekly", label: "This Week's Review", fn: () => this.plugin.openDashboard(), category: "REVIEWS" },
      { id: "monthly", label: "This Month's Review", fn: () => this.plugin.openDashboard(), category: "REVIEWS" },
      { id: "import", label: "Trade Import", fn: () => this.plugin.openImport(), category: "TOOLS" },
    ];

    const categories: ("OVERVIEW" | "REVIEWS" | "TOOLS")[] = ["OVERVIEW", "REVIEWS", "TOOLS"];
    for (const cat of categories) {
      const items = NAV_ITEMS.filter((i) => i.category === cat);
      if (items.length === 0) continue;
      root.createDiv({ cls: "tj-sidebar-category", text: cat });
      for (const it of items) {
        const b = root.createEl("button", {
          cls: "tj-app-nav-item" + (this.active === it.id ? " active" : ""),
          attr: { type: "button", title: it.label },
        });
        b.createSpan({ cls: "tj-app-nav-label", text: it.label });
        b.addEventListener("click", () => {
          it.fn();
          this.setActive(it.id);
        });
      }
    }

    const addBtn = root.createEl("button", { cls: "tj-app-nav-item tj-app-add", attr: { type: "button", title: "Add a new trade" } });
    addBtn.createSpan({ cls: "tj-app-nav-label", text: "+ Add Trade" });
    addBtn.addEventListener("click", () => this.plugin.openAddPanel());
  }
}
