import { Modal, Setting } from "obsidian";
import type TradebookPlugin from "../main";
import { BackupPayload, BackupSummary } from "../lib/backup";

/**
 * A restore is the one action in the plugin that can change everything at once, so
 * it is the one action that shows what it is about to do: what is in the file, and
 * what will happen to the notes already on disk. Nothing is written until the
 * button at the bottom is pressed.
 */
export function openBackupSummary(
  plugin: TradebookPlugin,
  summary: BackupSummary,
  onDone: (message: string) => void
): void {
  new BackupRestoreModal(plugin, summary, onDone).open();
}

class BackupRestoreModal extends Modal {
  private restoreNotes = true;

  constructor(
    private readonly plugin: TradebookPlugin,
    private readonly summary: BackupSummary,
    private readonly onDone: (message: string) => void
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    // No `tj-modal` here: that class is the old overlay box (its own background,
    // border, radius, padding and shadow). Inside a real Modal it painted a second
    // surface inside the first — one modal, two frames. Obsidian's own `.modal` is
    // the surface, exactly like the account-settings modal does it.
    contentEl.createEl("h2", { text: "Restore from a backup" });

    const payload = this.summary.payload as BackupPayload;
    const when = this.summary.exportedAt ? new Date(this.summary.exportedAt) : null;
    const whenText = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : "unknown date";

    contentEl.createEl("p", {
      text: `Taken ${whenText} by plugin v${this.summary.pluginVersion ?? "?"}.`,
      cls: "setting-item-description",
    });

    const table = contentEl.createDiv({ cls: "tj-backup-list" });
    const row = (label: string, value: string) => {
      const r = table.createDiv({ cls: "tj-backup-row" });
      r.createSpan({ cls: "tj-backup-k", text: label });
      r.createSpan({ cls: "tj-backup-v", text: value });
    };
    row("Accounts", `${this.summary.accounts ?? 0}${this.summary.archived ? ` (${this.summary.archived} archived)` : ""}`);
    row("Trade notes", String(this.summary.trades ?? 0));
    row("Payouts", String(this.summary.payouts ?? 0));
    row("Deposits", String(this.summary.deposits ?? 0));

    contentEl.createEl("p", {
      text: "Your settings and accounts will be replaced by the ones in the file. Your current settings are snapshotted first, so this can be undone.",
      cls: "tj-backup-note",
    });

    new Setting(contentEl)
      .setName("Also restore trade notes that are missing")
      .setDesc("Notes that already exist are never overwritten — only the gaps are filled.")
      .addToggle((t) =>
        t.setValue(this.restoreNotes).onChange((v) => {
          this.restoreNotes = v;
        })
      );

    const actions = contentEl.createDiv({ cls: "tj-backup-actions" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    const go = actions.createEl("button", { cls: "mod-cta", text: "Restore backup", attr: { type: "button" } });
    go.addEventListener("click", async () => {
      go.disabled = true;
      go.textContent = "Restoring…";
      try {
        const res = await this.plugin.applyBackup(payload, { restoreNotes: this.restoreNotes });
        const bits = [`${res.accounts} accounts`];
        if (this.restoreNotes) {
          bits.push(res.notesRestored ? `${res.notesRestored} notes restored` : "no notes missing");
          if (res.notesKept) bits.push(`${res.notesKept} notes already there`);
        }
        this.onDone(`Backup restored — ${bits.join(", ")}.`);
        this.close();
      } catch (err) {
        console.error("[tradebook] restore failed", err);
        go.disabled = false;
        go.textContent = "Try again";
        contentEl.createEl("p", { text: "The restore failed — see the console for the reason.", cls: "tj-backup-error" });
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
