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
    const hasMergeRetry = this.proposals.some((proposal) => proposal.mergePending === true);
    txt.createEl("h2", { text: "Match real fills to copies" });
    txt.createEl("p", {
      cls: "tj-import-sub",
      text: hasMergeRetry
        ? "Some linked trades have unfinished generated-review merges. You can retry them without duplicating saved screenshots."
        : "These real fills have a matching leader trade. Nothing is written until you confirm the link.",
    });
    c.createDiv({
      cls: "tj-copymatch-explainer",
      text: "Linking keeps the generated leg as history and marks it superseded; it is never deleted. The platform's record remains the source of truth.",
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
    const all = foot.createEl("button", {
      cls: "tj-actionbtn is-primary",
      text: hasMergeRetry ? `Complete all (${this.proposals.length})` : `Link all (${this.proposals.length})`,
    });
    attachTip(all, {
      title: hasMergeRetry ? "Complete every link and pending merge" : "Link every match",
      sub: hasMergeRetry
        ? "Confirmed links and unfinished generated-review merges are handled in this queue."
        : "The same as pressing Link on each row: generated legs are kept and marked superseded.",
    });
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
      sub: proposal.mergePending
        ? "Original copy ratio recorded on this actual trade."
        : "Contracts copied per leader contract. It sizes the generated leg this fill would replace.",
    });

    const acts = row.createDiv({ cls: "tj-copymatch-acts" });
    const isMergeRetry = proposal.mergePending === true;
    const link = acts.createEl("button", {
      cls: "tj-actionbtn is-primary",
      text: isMergeRetry ? "Retry merge" : "Link",
      attr: { type: "button" },
    });
    attachTip(link, {
      title: isMergeRetry ? "Finish the generated-review merge" : "Link this fill",
      sub: isMergeRetry
        ? "Continue the confirmed link. Saved fields are kept, and unfinished generated review content is retried."
        : "The follower's own fill replaces the generated leg, which is kept and marked superseded. Both stay in the ledger.",
    });
    link.addEventListener("click", () => void this.linkOne(proposal, index));
    const skip = acts.createEl("button", { cls: "tj-actionbtn", text: "Skip", attr: { type: "button" } });
    attachTip(skip, {
      title: "Skip",
      sub: isMergeRetry
        ? "Dismisses this prompt; the unfinished merge stays preserved and can be retried later."
        : "Leaves both trades as they are. Nothing is written.",
    });
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
    } catch (error) {
      const detail = error instanceof Error ? error.message : "A vault write did not complete";
      new Notice(`The link did not finish. Saved review data is preserved; this row remains available to retry. ${detail}`);
      this.onDone?.();
      const refreshed = await this.plugin.proposeCopierMatches().catch((): CopierMatchProposal[] => []);
      const retry = refreshed.find((candidate) => candidate.followerId === proposal.followerId);
      if (retry) this.proposals[index] = retry;
    } finally {
      this.busy = false;
    }
    this.render();
  }

  private async linkAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const pending = [...this.proposals];
    const failed: CopierMatchProposal[] = [];
    let linked = 0;
    let skipped = 0;
    let firstError = "";
    try {
      for (const proposal of pending) {
        try {
          const result = await this.plugin.applyCopierMatch(proposal);
          if (result === "applied") linked++;
          else skipped++;
        } catch (error) {
          failed.push(proposal);
          if (!firstError) firstError = error instanceof Error ? error.message : "A vault write did not complete";
        }
      }
      const refreshed = await this.plugin.proposeCopierMatches().catch((): CopierMatchProposal[] => []);
      this.proposals = failed.map((proposal) =>
        refreshed.find((candidate) => candidate.followerId === proposal.followerId) ?? proposal
      );
    } finally {
      this.busy = false;
    }
    this.onDone?.();
    if (failed.length) {
      new Notice(`${linked} linked, ${skipped} skipped; ${failed.length} could not finish and remain here to retry. ${firstError}`);
    } else {
      new Notice(`${linked} fill${linked === 1 ? "" : "s"} linked${skipped ? `, ${skipped} skipped` : ""}.`);
    }
    this.render();
  }

  /** Why a proposal could not be linked, in the trader's words. */
  private resultNote(result: "already" | "missing" | "changed"): string {
    if (result === "already") return "Already linked.";
    if (result === "missing") return "The trade is no longer in the journal — nothing was written.";
    return "The trade changed since it was proposed — nothing was written.";
  }
}
