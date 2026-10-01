import { Modal } from "obsidian";
import type TradebookPlugin from "../main";
import { AddTradePanel } from "./addTradePanel";

/**
 * "Add Trade" as a pop-up.
 *
 * The manual form is the same panel used everywhere; the modal only gives it a
 * frame, so a trade can be logged from whatever page you are on without losing
 * it. Saving closes the modal — the journal behind it has already been told to
 * refresh through `onChange`.
 */
export function openAddTradeModal(plugin: TradebookPlugin, onChange?: () => void): void {
  new AddTradeModal(plugin, onChange).open();
}

class AddTradeModal extends Modal {
  private plugin: TradebookPlugin;
  private onChange?: () => void;
  private panel: AddTradePanel | null = null;

  constructor(plugin: TradebookPlugin, onChange?: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.onChange = onChange;
  }

  onOpen(): void {
    this.modalEl.addClass("tj-addtrade-modal");
    this.titleEl.setText("Manual trade");
    this.titleEl.createDiv({
      cls: "tj-addtrade-sub",
      text: "One trade at a time — save it, then log the next.",
    });
    const host = this.contentEl.createDiv({ cls: "tj-addtrade-body" });
    try {
      this.panel = new AddTradePanel(this.plugin, {
        onSaveDone: () => {
          this.onChange?.();
          this.close();
        },
        onCancel: () => this.close(),
      });
      this.panel.mount(host);
    } catch (err) {
      console.error("[tradebook] Add Trade failed to render:", err);
      const box = host.createDiv({ cls: "tj-error" });
      box.createEl("h3", { text: "Add manual trade failed to render" });
      box.createEl("p", { text: (err as Error).message || String(err) });
    }
  }

  onClose(): void {
    this.panel?.dispose();
    this.panel = null;
    this.contentEl.empty();
  }
}
