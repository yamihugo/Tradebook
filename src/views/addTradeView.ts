import { ItemView } from "obsidian";
import type TradingJournalPlugin from "../main";
import { renderAppShell } from "../ui";
import { AddTradePanel } from "./addTradePanel";

export const ADD_TRADE_VIEW_TYPE = "trading-journal-add-trade";

export class AddTradeView extends ItemView {
  plugin: TradingJournalPlugin;
  panel: AddTradePanel | null = null;

  constructor(leaf: any, plugin: TradingJournalPlugin) {
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

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-addpanel-view");
    const main = renderAppShell(root, this.plugin, "add");
    main.createEl("h1", { text: "Add Trade", cls: "tj-view-h1" });
    try {
      this.disposePanel();
      this.panel = new AddTradePanel(this.plugin, {
        onSaveDone: () => {
          this.disposePanel();
          this.render();
        },
      });
      this.panel.mount(main);
    } catch (err) {
      console.error("[trading-journal] AddTradePanel failed to render:", err);
      const box = main.createDiv({ cls: "tj-error" });
      box.createEl("h3", { text: "Add Trade failed to render" });
      box.createEl("p", { text: (err as Error).message || String(err) });
      box.createEl("p", { text: "Copy this text to the developer so it can be fixed.", cls: "tj-error-detail" });
    }
  }

  disposePanel(): void {
    this.panel?.dispose();
    this.panel = null;
  }
}
