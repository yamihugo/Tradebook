import { Modal, setIcon } from "obsidian";
import type TradingJournalPlugin from "./main";
import { AddTradePanel } from "./views/addTradePanel";

/**
 * Add Trade as a centered pop-up (like the eval-passed celebration).
 * Opens over whatever you are doing — the panel mounts inside the modal,
 * closes cleanly when a save finishes (or on ESC / click-outside).
 */
export class AddTradesModal extends Modal {
  plugin: TradingJournalPlugin;
  panel: AddTradePanel | null = null;

  constructor(app: any, plugin: TradingJournalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("tj-addtrade-modal");
    contentEl.empty();

    // Journalit-style header: icon + title + subtitle, close on the right.
    const header = contentEl.createDiv({ cls: "tj-addtrade-header" });
    const titleWrap = header.createDiv({ cls: "tj-addtrade-title-wrap" });
    const iconEl = titleWrap.createDiv({ cls: "tj-addtrade-title-icon" });
    setIcon(iconEl, "plus");
    const textWrap = titleWrap.createDiv({ cls: "tj-addtrade-title-text" });
    textWrap.createDiv({ cls: "tj-addtrade-h1", text: "Add Trade" });
    textWrap.createDiv({
      cls: "tj-addtrade-sub",
      text: "Drop a Tradeovate CSV below to import your round-trips, or log a trade by hand.",
    });
    const closeBtn = header.createEl("button", {
      cls: "tj-addtrade-close",
      attr: { title: "Close (Esc)", "aria-label": "Close" },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());

    try {
      this.panel = new AddTradePanel(this.plugin, {
        onSaveDone: () => {
          this.close();
        },
        onClose: () => {
          this.close();
        },
      });
      this.panel.mount(contentEl);
    } catch (err) {
      console.error("[trading-journal] AddTradesModal failed to render:", err);
      const box = contentEl.createDiv({ cls: "tj-error" });
      box.createEl("h3", { text: "Add Trade failed to render" });
      box.createEl("p", { text: (err as Error).message || String(err) });
      box.createEl("p", { text: "Copy this text to the developer so it can be fixed.", cls: "tj-error-detail" });
    }
  }

  onClose(): void {
    this.panel?.dispose();
    this.panel = null;
    this.contentEl.empty();
    this.contentEl.removeClass("tj-addtrade-modal");
  }
}