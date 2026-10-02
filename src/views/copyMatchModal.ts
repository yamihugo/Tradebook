import { Modal, Notice, setIcon } from "obsidian";
import { attachTip } from "../lib/tip";
import type TradebookPlugin from "../main";
import type { CopierMatchProposal } from "../lib/copyReconcile";

/**
 * The minimal confirmation surface for explicit reconciliation.
 *
 * Real follower fills whose leader trade is known are listed here. Nothing is
 * written until "Link" is pressed: Skip only drops the proposal from this list,
 * and closing the modal changes nothing. No new page — one modal, opened by
 * command or from the copy area on the Accounts page.
 */
export function openCopyMatchModal(plugin: TradebookPlugin, onDone?: () => void): void {
  new CopyMatchModal(plugin, onDone).open();
}

class CopyMatchModal extends Modal {
  private plugin: TradebookPlugin;
  private onDone?: () => void;
  private proposals: CopierMatchProposal[] = [];
  private busy = false;

  constructor(plugin: TradebookPlugin, onDone?: () => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("tj-copymatch-modal");
    this.proposals = await this.plugin.proposeCopierMatches();
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();

    const head = c.createDiv({ cls: "tj-import-head" });
    setIcon(head.createSpan({ cls: "tj-import-headico" }), "link");
    const txt = head.createDiv({ cls: "tj-import-headtxt" });
    txt.createEl("h2", { text: "Match real fills to copies" });
    txt.createEl("p", {
      cls: "tj-import-sub",
      text: "These real fills have a matching leader trade. Nothing is written until you link one.",
    });
    // What linking actually does, said once at the top: the generated leg is kept
    // as history and marked superseded, never deleted. This modal had no
    // explanation anywhere, and "Link" is the one irreversible-looking word in it.
    c.createDiv({
      cls: "tj-copymatch-explainer",
      text: "Linking replaces the generated copy with the follower's own fill. The generated leg is kept in the ledger and marked superseded \u2014 nothing is deleted, and the platform's record stays the source of truth.",
    });

    if (!this.proposals.length) {
      c.createDiv({ cls: "tj-manage-empty" }).createDiv({
        cls: "tj-manage-emptytitle",
        text: "No unmatched fills",
      });
      const foot = c.createDiv({ cls: "tj-import-actions" });
      const close = foot.createEl("button", { cls: "tj-actionbtn", text: "Close" });
      close.addEventListener("click", () => this.close());
      return;
    }

    const list = c.createDiv({ cls: "tj-copymatch-list" });
    this.proposals.forEach((p, i) => this.renderRow(list, p, i));

    const foot = c.createDiv({ cls: "tj-import-actions" });
    const close = foot.createEl("button", { cls: "tj-actionbtn", text: "Close" });
    close.addEventListener("click", () => this.close());
    foot.createDiv({ cls: "tj-import-spacer" });
    const all = foot.createEl("button", { cls: "tj-actionbtn is-primary", text: `Link all (${this.proposals.length})` });
    attachTip(all, { title: "Link every match", sub: "The same as pressing Link on each row: generated legs are kept and marked superseded." });
    all.addEventListener("click", () => void this.linkAll());
  }

  private renderRow(host: HTMLElement, proposal: CopierMatchProposal, index: number): void {
    const row = host.createDiv({ cls: "tj-copymatch-row" });
    const info = row.createDiv({ cls: "tj-copymatch-info" });
    info.createDiv({
      cls: "tj-copymatch-line",
      text: `${proposal.copierName}: ${proposal.symbol} ${proposal.direction} · ${proposal.date} ${proposal.entryTime || ""}`.trim(),
    });
    info.createDiv({ cls: "tj-copymatch-reason", text: proposal.reason });
    const ratio = info.createSpan({ cls: "tj-copymatch-ratio", text: `×${proposal.ratio}` });
    attachTip(ratio, {
      title: `Ratio \u00d7${proposal.ratio}`,
      sub: "Contracts copied per leader contract. It sizes the generated leg this fill would replace.",
    });

    const acts = row.createDiv({ cls: "tj-copymatch-acts" });
    const link = acts.createEl("button", { cls: "tj-actionbtn is-primary", text: "Link", attr: { type: "button" } });
    attachTip(link, {
      title: "Link this fill",
      sub: "The follower's own fill replaces the generated leg, which is kept and marked superseded. Both stay in the ledger.",
    });
    link.addEventListener("click", () => void this.linkOne(proposal, index));
    const skip = acts.createEl("button", { cls: "tj-actionbtn", text: "Skip", attr: { type: "button" } });
    attachTip(skip, { title: "Skip", sub: "Leaves both trades as they are. Nothing is written." });
    skip.addEventListener("click", () => {
      if (this.busy) return;
      this.proposals.splice(index, 1);
      this.render();
    });
  }

  private async linkOne(proposal: CopierMatchProposal, index: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const result = await this.plugin.applyCopierMatch(proposal);
      if (result !== "applied") new Notice(this.resultNote(result));
      this.proposals.splice(index, 1);
      this.onDone?.();
    } finally {
      this.busy = false;
    }
    this.render();
  }

  private async linkAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const pending = [...this.proposals];
    let linked = 0;
    let skipped = 0;
    try {
      for (const proposal of pending) {
        const result = await this.plugin.applyCopierMatch(proposal);
        if (result === "applied") linked++;
        else skipped++;
      }
      this.proposals = [];
    } finally {
      this.busy = false;
    }
    new Notice(
      `${linked} fill${linked === 1 ? "" : "s"} linked${skipped ? `, ${skipped} skipped` : ""}.`
    );
    this.onDone?.();
    this.render();
  }

  /** Why a proposal could not be linked, in the trader's words. */
  private resultNote(result: "already" | "missing" | "changed"): string {
    if (result === "already") return "Already linked.";
    if (result === "missing") return "The trade is no longer in the journal — nothing was written.";
    return "The trade changed since it was proposed — nothing was written.";
  }
}
