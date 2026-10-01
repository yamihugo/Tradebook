import { Modal, Notice } from "obsidian";
import type TradebookPlugin from "../main";

/**
 * The undo for a restore. Every import writes a snapshot of the settings just
 * before it, so "restore everything" is itself reversible. This lists those
 * snapshots and puts one back. Trade notes are never touched — they live in the
 * vault and a snapshot only holds `data.json`.
 */
export async function openSettingsRestore(plugin: TradebookPlugin): Promise<void> {
  const snapshots = await plugin.listSettingsSnapshots();
  new SettingsRestoreModal(plugin, snapshots).open();
}

interface Snap {
  path: string;
  name: string;
  mtime: number;
}

class SettingsRestoreModal extends Modal {
  constructor(
    private readonly plugin: TradebookPlugin,
    private readonly snapshots: Snap[]
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Restore previous settings" });

    if (!this.snapshots.length) {
      contentEl.createEl("p", {
        text: "No snapshots yet. One is written every time you import a backup, so this fills up as you use the journal.",
        cls: "setting-item-description",
      });
      const actions = contentEl.createDiv({ cls: "tj-backup-actions" });
      actions.createEl("button", { text: "Close", attr: { type: "button" } }).addEventListener("click", () => this.close());
      return;
    }

    contentEl.createEl("p", {
      text: "A snapshot is your settings — accounts, payouts, layouts and preferences — as they were just before an import. Restoring one puts them back; your trade notes stay in the vault, untouched.",
      cls: "setting-item-description",
    });

    const list = contentEl.createDiv({ cls: "tj-backup-list" });
    for (const snap of this.snapshots) {
      const row = list.createDiv({ cls: "tj-backup-row" });
      row.createSpan({
        cls: "tj-backup-k",
        text: snap.mtime ? new Date(snap.mtime).toLocaleString() : snap.name,
      });
      const btn = row.createEl("button", { text: "Restore", attr: { type: "button" } });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Restoring…";
        try {
          await this.plugin.restoreSettingsSnapshot(snap.path);
          new Notice("Settings restored from the snapshot.");
          this.close();
        } catch (err) {
          console.error("[tradebook] settings restore failed", err);
          new Notice("Could not restore that snapshot — check the console.");
          btn.disabled = false;
          btn.textContent = "Restore";
        }
      });
    }

    const actions = contentEl.createDiv({ cls: "tj-backup-actions" });
    actions.createEl("button", { text: "Close", attr: { type: "button" } }).addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
