import { Modal, Notice } from "obsidian";
import type TradebookPlugin from "../main";
import type { RenamePlan } from "../main";
import { attachTip } from "../lib/tip";

/** How many rows we are willing to render before folding the rest away. */
const PREVIEW_LIMIT = 80;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Open the "normalise file names" preview. The plan is computed first and
 * nothing is written until the user confirms, so a rename pass can never be a
 * surprise — the whole point is that the user sees the list before it happens.
 */
export async function openRenamePreview(plugin: TradebookPlugin): Promise<void> {
  const plan = await plugin.planFileRename();
  new RenamePreviewModal(plugin, plan).open();
}

class RenamePreviewModal extends Modal {
  private working = false;

  constructor(
    private plugin: TradebookPlugin,
    private plan: RenamePlan
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tj-rename-modal");
    contentEl.createEl("h2", { text: "Normalise file names" });

    const total = this.plan.items.length;
    const prints = this.plan.items.reduce((sum, item) => sum + item.printMoves.length, 0);

    if (!total) {
      contentEl.createEl("p", {
        text: this.plan.skipped
          ? `Nothing to rename — ${plural(this.plan.skipped, "note")} skipped (no date or symbol).`
          : "Every note already follows the current scheme. Nothing to do.",
      });
      const actions = contentEl.createDiv({ cls: "tj-rename-actions" });
      actions
        .createEl("button", { text: "Close", cls: "mod-cta", attr: { type: "button" } })
        .addEventListener("click", () => this.close());
      return;
    }

    contentEl.createEl("p", {
      text:
        `${plural(total, "note")} would be renamed` +
        (prints ? ` and ${plural(prints, "print")} would follow.` : ".") +
        " Links and embeds are updated, so nothing in your notes breaks.",
    });
    if (this.plan.skipped) {
      contentEl.createEl("p", {
        cls: "tj-rename-skipped",
        text: `${plural(this.plan.skipped, "note")} will be skipped (missing date or symbol in the frontmatter).`,
      });
    }

    const list = contentEl.createDiv({ cls: "tj-rename-list" });
    for (const item of this.plan.items.slice(0, PREVIEW_LIMIT)) {
      const row = list.createDiv({ cls: "tj-rename-row" });
      const from = row.createEl("code", {
        cls: "tj-rename-from",
        text: item.from.split("/").pop() ?? item.from,
      });
      attachTip(from, { title: "Now", sub: item.from }, "is-wide");
      row.createSpan({ cls: "tj-rename-arrow", text: "→" });
      const to = row.createEl("code", {
        cls: "tj-rename-to",
        text: `${item.newName}.md`,
      });
      attachTip(to, { title: "After the rename", sub: item.to }, "is-wide");
      if (item.printMoves.length) {
        row.createSpan({ cls: "tj-rename-prints", text: `+${item.printMoves.length} print` });
      }
    }
    if (total > PREVIEW_LIMIT) {
      list.createDiv({ cls: "tj-rename-more", text: `…and ${total - PREVIEW_LIMIT} more` });
    }

    const actions = contentEl.createDiv({ cls: "tj-rename-actions" });
    actions
      .createEl("button", { text: "Cancel", attr: { type: "button" } })
      .addEventListener("click", () => this.close());

    const go = actions.createEl("button", {
      text: `Rename ${plural(total, "file")}`,
      cls: "mod-cta",
      attr: { type: "button" },
    });
    go.addEventListener("click", async () => {
      if (this.working) return;
      this.working = true;
      go.setAttr("disabled", "true");
      go.setText("Renaming…");
      try {
        const res = await this.plugin.applyFileRename(this.plan);
        new Notice(`Renamed ${res.renamed} notes and ${res.prints} prints (skipped ${res.skipped}).`);
        this.close();
      } catch (err) {
        console.error("[tradebook] rename failed:", err);
        new Notice("Could not rename files — check the console.");
        go.removeAttribute("disabled");
        go.setText("Try again");
        this.working = false;
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
