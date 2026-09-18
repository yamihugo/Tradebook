import { ItemView, setIcon } from "obsidian";
import type TradebookPlugin from "../main";
import { renderAppShell } from "../ui";
import { AddTradePanel } from "./addTradePanel";

export const ADD_TRADE_VIEW_TYPE = "tradebook-add-trade";

export class AddTradeView extends ItemView {
  plugin: TradebookPlugin;
  panel: AddTradePanel | null = null;
  tab: "manual" | "import" = "manual";

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return ADD_TRADE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Add Trade";
  }

  getIcon(): string {
    return "plus";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.disposePanel();
  }

  /** Open the page on a specific tab (used by the import command / ribbon). */
  setTab(tab: "manual" | "import"): void {
    this.tab = tab;
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-addpanel-view");
    const main = renderAppShell(root, this.plugin, "add");
    // One page, two tabs — Manual and Import share the same look & feel.
    const tabsWrap = main.createDiv({ cls: "tj-tabs-wrap" });
    const tabs = tabsWrap.createDiv({ cls: "tj-tabs" });
    const mkTab = (id: "manual" | "import", label: string, icon: string) => {
      const b = tabs.createEl("button", {
        cls: "tj-tab" + (this.tab === id ? " active" : ""),
        attr: { type: "button" },
      });
      const ic = b.createSpan({ cls: "tj-tab-icon" });
      setIcon(ic, icon);
      b.createSpan({ text: label });
      b.addEventListener("click", () => {
        if (this.tab !== id) {
          this.tab = id;
          this.render();
        }
      });
    };
    mkTab("manual", "Manual", "pencil");
    mkTab("import", "Import CSV", "upload");

    const body = main.createDiv({ cls: "tj-tabpanel" });

    try {
      this.disposePanel();
      this.panel = new AddTradePanel(this.plugin, {
        startTab: this.tab === "import" ? "import" : "manual",
        onSaveDone: () => {
          this.disposePanel();
          this.render();
        },
      });
      this.panel.mount(body);
    } catch (err) {
      console.error("[tradebook] AddTradePanel failed to render:", err);
      const box = body.createDiv({ cls: "tj-error" });
      box.createEl("h3", { text: "Add Trade failed to render" });
      box.createEl("p", { text: (err as Error).message || String(err) });
    }
  }

  disposePanel(): void {
    this.panel?.dispose();
    this.panel = null;
  }
}
