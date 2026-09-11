import { ItemView, Notice, TFile } from "obsidian";
import type TradingJournalPlugin from "../main";
import { Trade } from "../types";
import { renderAppShell } from "../ui";
import { fmtMoney2 } from "../tz";
import { updateTradeFields } from "../storage";

export const TRADE_DETAIL_VIEW_TYPE = "trading-journal-trade-detail-view";

export class TradeDetailView extends ItemView {
  plugin: TradingJournalPlugin;
  trade: Trade | null = null;
  allTrades: Trade[] = [];
  index = -1;

  constructor(leaf: any, plugin: TradingJournalPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TRADE_DETAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.trade ? `Trade · ${this.trade.symbol} · ${this.trade.date}` : "Trade";
  }

  getIcon(): string {
    return "lines";
  }

  async setTrade(trade: Trade): Promise<void> {
    this.trade = trade;
    if (this.allTrades.length === 0) this.allTrades = await this.plugin.loadTrades();
    this.index = this.allTrades.findIndex((t) => t.id === trade.id);
    this.render();
  }

  private keydownHandler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      void this.prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      void this.next();
    }
  };

  async onOpen(): Promise<void> {
    if (!this.trade) {
      const first = await this.plugin.loadTrades();
      if (first.length) await this.setTrade(first[0]);
      else this.render();
    }
    window.addEventListener("keydown", this.keydownHandler);
  }

  async onClose(): Promise<void> {
    window.removeEventListener("keydown", this.keydownHandler);
  }

  async prev(): Promise<void> {
    if (this.index <= 0) return;
    this.index -= 1;
    const t = this.allTrades[this.index];
    if (t) await this.setTrade(t);
  }

  async next(): Promise<void> {
    if (this.index < 0 || this.index >= this.allTrades.length - 1) return;
    this.index += 1;
    const t = this.allTrades[this.index];
    if (t) await this.setTrade(t);
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-trade-detail");
    const main = renderAppShell(root, this.plugin, "");

    const t = this.trade;
    if (!t) {
      main.createDiv({ cls: "tj-empty", text: "No trade selected — open one from the Trade Log, Calendar or Dashboard." });
      return;
    }

    // ---- Header with nav controls + Back button ----
    const head = main.createDiv({ cls: "tj-td-head" });
    const navBtns = head.createDiv({ cls: "tj-td-nav" });
    const backBtn = navBtns.createEl("button", { text: "← Back", cls: "tj-btn tj-mini", attr: { title: "Back to Trade Log" } });
    backBtn.addEventListener("click", () => void this.plugin.openTradeLog());
    const prevBtn = navBtns.createEl("button", { text: "← Prev", cls: "tj-btn tj-mini", attr: { title: "Previous trade" } });
    prevBtn.disabled = this.index <= 0;
    prevBtn.addEventListener("click", () => void this.prev());
    const nextBtn = navBtns.createEl("button", { text: "Next →", cls: "tj-btn tj-mini", attr: { title: "Next trade" } });
    nextBtn.disabled = this.index < 0 || this.index >= this.allTrades.length - 1;
    nextBtn.addEventListener("click", () => void this.next());
    navBtns.createEl("span", { cls: "tj-td-counter", text: `${this.index + 1} / ${this.allTrades.length}` });

    const title = head.createDiv({ cls: "tj-td-title" });
    title.createEl("h1", { text: `${t.symbol} · ${t.direction === "long" ? "Long" : "Short"} · ${t.date} ${t.entryTime || ""}` });
    title.createEl("p", { cls: "tj-td-meta", text: `${t.account} · ${t.accountType} · ${t.quantity} contracts @ ${t.entryPrice ?? "—"} → ${t.exitPrice ?? "—"}` });

    const headActions = head.createDiv({ cls: "tj-td-head-actions" });
    const openNote = headActions.createEl("button", { text: "Open note", cls: "tj-btn tj-mini", attr: { title: "Open the raw markdown note in Obsidian" } });
    openNote.addEventListener("click", () => this.openNote());
    const refresh = headActions.createEl("button", { text: "↻", cls: "tj-btn tj-mini", attr: { title: "Reload from note" } });
    refresh.addEventListener("click", async () => {
      const fresh = await this.plugin.loadTrades();
      const found = fresh.find((x) => x.id === t.id);
      if (found) {
        this.allTrades = fresh;
        this.trade = found;
        this.index = fresh.findIndex((x) => x.id === t.id);
        this.render();
      }
    });
    const delBtn = headActions.createEl("button", { text: "Delete", cls: "tj-btn tj-mini tj-del", attr: { title: "Delete this trade note" } });
    delBtn.addEventListener("click", async () => {
      if (window.confirm(`Delete trade ${t.symbol} (${t.date}, $${t.pnl})?`)) {
        await this.plugin.deleteTrade(t.id);
        await this.plugin.openTradeLog();
      }
    });

    // ---- Main body: number stats + print + review ----
    const body = main.createDiv({ cls: "tj-td-body" });

    // Stats grid
    const stats = body.createDiv({ cls: "tj-td-stats" });
    const stat = (label: string, value: string, tone = "neutral") => {
      const cell = stats.createDiv({ cls: "tj-td-stat" + (tone !== "neutral" ? " " + tone : "") });
      cell.createEl("div", { cls: "tj-td-stat-label", text: label });
      const v = cell.createEl("div", { cls: "tj-td-stat-value " + (tone !== "neutral" ? tone : "") });
      v.textContent = value;
    };
    stat("Net P&L", fmtMoney2(t.pnl), t.pnl >= 0 ? "pos" : "neg");
    stat("Points", `${t.pnlPoints ?? "—"} pts`, (t.pnlPoints ?? 0) >= 0 ? "pos" : "neg");
    stat("Contracts", String(t.quantity ?? 1));
    stat("Entry", `${t.entryPrice ?? "—"} ${t.entryTime || ""}`);
    stat("Exit", `${t.exitPrice ?? "—"} ${t.exitTime || ""}`);
    stat("Gross P&L", fmtMoney2(t.grossPnl), "neutral");
    const totalCosts = (t.commission || 0) + (t.fees || 0);
    stat("Commissions & Fees", `$${totalCosts.toFixed(2)}`, "neutral");

    // ---- Trade Rating (1-5 stars) ----
    const ratingRow = stats.createDiv({ cls: "tj-td-stat tj-td-rating-row" });
    ratingRow.createEl("div", { cls: "tj-td-stat-label", text: "Rating" });
    const starsWrap = ratingRow.createDiv({ cls: "tj-td-stars" });
    for (let s = 1; s <= 5; s++) {
      const star = starsWrap.createEl("button", {
        cls: "tj-td-star" + ((t.rating ?? 0) >= s ? " active" : ""),
        attr: { type: "button", title: `${s} star${s > 1 ? "s" : ""}` },
        text: (t.rating ?? 0) >= s ? "★" : "☆",
      });
      star.addEventListener("click", async () => {
        const newRating = (t.rating ?? 0) === s ? 0 : s; // click again to clear
        this.trade!.rating = newRating;
        await this.saveField("rating" as any, String(newRating));
        this.render();
      });
    }

    // Two-column: screenshot/print + review fields
    const cols = body.createDiv({ cls: "tj-td-cols" });

    // Left: print / screenshot (inline)
    const left = cols.createDiv({ cls: "tj-td-left" });
    left.createEl("h3", { text: "Print / Screenshot" });
    const shot = t.screenshot && t.screenshot.trim();
    if (shot) {
      const imgBox = left.createDiv({ cls: "tj-td-shot" });
      if (shot.toLowerCase() === "added") {
        imgBox.createDiv({ cls: "tj-hint", text: "Print marked as added (no image file linked)." });
      } else {
        const parts = shot.split(/[,;\n]+/);
        let foundAny = false;
        for (const p of parts) {
          const trimmed = p.trim();
          if (!trimmed) continue;
          const resolved = this.resolveImage(trimmed);
          if (resolved) {
            foundAny = true;
            const img = imgBox.createEl("img", { attr: { src: resolved, alt: "trade screenshot" } });
            img.addEventListener("error", () => {
              img.style.opacity = "0.2";
            });
          }
        }
        if (!foundAny) {
          imgBox.createDiv({ cls: "tj-hint", text: `Print not found: ${shot}. Link the image in the note.` });
        }
      }
    } else {
      left.createDiv({ cls: "tj-empty", text: "No print/screenshot attached yet." });
    }

    // Right: review fields (setup, review, mistakes)
    const right = cols.createDiv({ cls: "tj-td-right" });
    right.createEl("h3", { text: "Review" });

    const field = (label: string, value: string, key: "setup" | "review" | "mistake") => {
      right.createEl("label", { text: label, cls: "tj-td-field-label" });
      const area = right.createEl("textarea", { cls: "tj-td-textarea", attr: { rows: "3", placeholder: `Add ${label.toLowerCase()}…` } });
      area.value = value || "";
      area.addEventListener("change", async () => {
        const val = area.value.trim();
        if (val === value) return;
        this.trade![key] = val;
        await this.saveField(key, val);
      });
      return area;
    };
    field("Setup", t.setup, "setup");
    field("Review", t.review, "review");
    field("Mistakes", t.mistake, "mistake");
  }

  async saveField(key: "setup" | "review" | "mistake" | "rating", value: string): Promise<void> {
    try {
      if (this.trade?.id) await updateTradeFields(this.app, (this.app.vault.getAbstractFileByPath(this.trade.id) as TFile), { [key]: value });
    } catch (err) {
      console.error("[trading-journal] failed to save trade field:", err);
      new Notice("Could not save — check the file still exists.");
    }
  }

  async openNote(): Promise<void> {
    const t = this.trade;
    if (!t?.id) return;
    const file = this.app.vault.getAbstractFileByPath(t.id);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    }
  }

  resolveImage(link: string): string | null {
    const raw = (link || "").trim();
    if (!raw) return null;
    const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const target = inner.split("|")[0].split("#")[0].trim();
    const tradesFolder = this.plugin?.getTradesFolder ? this.plugin.getTradesFolder() : "Trading Journal/trades";
    const candidates = [
      raw,
      target,
      tradesFolder + "/prints/" + target,
      "Trading Journal/trades/prints/" + target,
      "Trading Journal/" + target,
      "Trading Journal/trades/" + target,
      "Trading Journal/prints/" + target,
    ];
    for (const c of candidates) {
      try {
        const file = this.app.vault.getAbstractFileByPath(c);
        if (file instanceof TFile && file.extension && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(file.extension.toLowerCase())) {
          return this.app.vault.getResourcePath(file);
        }
      } catch {
        // ignore
      }
    }
    // Maybe it's a full vault path already
    try {
      const f = this.app.vault.getAbstractFileByPath(target);
      if (f instanceof TFile && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes((f.extension || "").toLowerCase())) {
        return this.app.vault.getResourcePath(f);
      }
    } catch {
      // ignore
    }
    return null;
  }

  async openScreenshot(link: string): Promise<void> {
    const raw = (link || "").trim();
    const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
    const target = inner.split("|")[0].split("#")[0].trim();
    const file = this.app.vault.getAbstractFileByPath(target) || this.app.vault.getAbstractFileByPath("Trading Journal/" + target);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    } else {
      new Notice("Attachment not found: " + target);
    }
  }
}