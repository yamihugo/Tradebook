import { Notice, TFile } from "obsidian";
import type TradingJournalPlugin from "../main";
import { Trade } from "../types";
import { updateTradeFields } from "../storage";
import { fmtMoney2 } from "../tz";

/**
 * Big TradeZella-style pop-up for viewing + editing a single trade.
 * Layout: two main areas side by side — the print/screenshot on the left
 * (large square) and everything else on the right (stats, rating, review)
 * stacked vertically like a mini dashboard. Closing it drops you right back
 * where you were (calendar, trade log, dashboard, day log…).
 */
export function openTradeModal(plugin: TradingJournalPlugin, trade: Trade): void {
  const overlay = document.body.createDiv({ cls: "tj-modal-overlay" });
  const modal = overlay.createDiv({ cls: "tj-modal tj-trade-modal" });

  // ---- Head: title + close ----
  const head = modal.createDiv({ cls: "tj-modal-head" });
  head.createEl("h2", {
    text: `${trade.symbol} ${trade.direction === "long" ? "Long" : "Short"} · ${trade.date} · ${trade.account || ""}`.trim(),
  });
  const closeBtn = head.createEl("button", { text: "✕", cls: "tj-btn tj-mini", attr: { title: "Close" } });
  closeBtn.addEventListener("click", () => overlay.remove());

  const cols = modal.createDiv({ cls: "tj-trade-modal-cols" });

  // ---- LEFT: print / screenshot (big) ----
  const left = cols.createDiv({ cls: "tj-trade-modal-left" });
  const shot = (trade.screenshot || "").trim();
  if (!shot) {
    left.createDiv({ cls: "tj-empty", text: "No print/screenshot attached yet." });
  } else if (shot.toLowerCase() === "added") {
    left.createDiv({ cls: "tj-hint", text: "Print marked as added (no image file linked)." });
  } else {
    const parts = shot.split(/[,;\n]+/);
    let foundAny = false;
    for (const p of parts) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      const resolved = resolveImage(plugin, trimmed);
      if (resolved) {
        foundAny = true;
        const img = left.createEl("img", { attr: { src: resolved, alt: "trade screenshot" }, cls: "tj-trade-modal-img" });
        img.addEventListener("error", () => {
          img.style.opacity = "0.2";
        });
      }
    }
    if (!foundAny) {
      left.createDiv({ cls: "tj-hint", text: `Print not found: ${shot}. Link the image in the note.` });
    }
  }

  // ---- RIGHT: stats + rating + review fields ----
  const right = cols.createDiv({ cls: "tj-trade-modal-right" });

  // Stat chips (compact dashboard row)
  const stats = right.createDiv({ cls: "tj-kpis tj-trade-modal-stats" });
  const statKpi = (label: string, value: string, tone = "neutral") => {
    const c = stats.createDiv({ cls: "tj-kpi " + tone + " tj-trade-modal-kpi" });
    c.createDiv({ cls: "tj-kpi-label", text: label });
    c.createDiv({ cls: "tj-kpi-value", text: value });
  };
  statKpi("Net P&L", fmtMoney2(trade.pnl), trade.pnl >= 0 ? "pos" : "neg");
  statKpi("Points", `${trade.pnlPoints ?? "—"} pts`, (trade.pnlPoints ?? 0) >= 0 ? "pos" : "neg");
  statKpi("Qty", String(trade.quantity ?? 1));
  statKpi("Entry", `${trade.entryPrice ?? "—"} ${trade.entryTime || ""}`);
  statKpi("Exit", `${trade.exitPrice ?? "—"} ${trade.exitTime || ""}`);
  const totalCosts = (trade.commission || 0) + (trade.fees || 0);
  statKpi("Costs", `$${totalCosts.toFixed(2)}`);

  // Rating stars
  const ratingRow = right.createDiv({ cls: "tj-trade-modal-rating" });
  ratingRow.createEl("label", { text: "Rating", cls: "tj-td-field-label" });
  const starsWrap = ratingRow.createDiv({ cls: "tj-td-stars" });
  const renderStars = (current: number) => {
    starsWrap.empty();
    for (let s = 1; s <= 5; s++) {
      const star = starsWrap.createEl("button", {
        cls: "tj-td-star" + (current >= s ? " active" : ""),
        attr: { type: "button", title: `${s} star${s > 1 ? "s" : ""}` },
        text: current >= s ? "★" : "☆",
      });
      star.addEventListener("click", () => {
        const next = current === s ? 0 : s;
        trade.rating = next;
        void saveTradeField(plugin, trade, "rating", String(next));
        renderStars(next);
      });
    }
  };
  renderStars(trade.rating ?? 0);

  // Review fields (Setup / Review / Mistakes)
  const field = (label: string, value: string, key: "setup" | "review" | "mistake") => {
    right.createEl("label", { text: label, cls: "tj-td-field-label" });
    const area = right.createEl("textarea", {
      cls: "tj-td-textarea tj-trade-modal-textarea",
      attr: { rows: "3", placeholder: `Add ${label.toLowerCase()}…` },
    });
    area.value = value || "";
    area.addEventListener("change", () => {
      const val = area.value.trim();
      if (val === value) return;
      (trade as any)[key] = val;
      void saveTradeField(plugin, trade, key, val);
    });
  };
  field("Setup", trade.setup, "setup");
  field("Review", trade.review, "review");
  field("Mistakes", trade.mistake, "mistake");

  // Open note link (raw markdown)
  const foot = modal.createDiv({ cls: "tj-trade-modal-foot" });
  const noteBtn = foot.createEl("button", { text: "Open note", cls: "tj-btn tj-mini", attr: { title: "Open the raw markdown note in Obsidian" } });
  noteBtn.addEventListener("click", async () => {
    if (!trade.id) return;
    const file = plugin.app.vault.getAbstractFileByPath(trade.id);
    if (file instanceof TFile) {
      const leaf = plugin.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      plugin.app.workspace.revealLeaf(leaf);
    }
  });

  // Click outside closes
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function saveTradeField(plugin: TradingJournalPlugin, trade: Trade, key: string, value: string): Promise<void> {
  if (!trade.id) return Promise.resolve();
  const file = plugin.app.vault.getAbstractFileByPath(trade.id);
  if (!(file instanceof TFile)) return Promise.resolve();
  return updateTradeFields(plugin.app, file, { [key]: value }).catch((err) => {
    console.error("[trading-journal] failed to save trade field:", err);
    new Notice("Could not save — check the file still exists.");
  });
}

function resolveImage(plugin: TradingJournalPlugin, link: string): string | null {
  const raw = (link || "").trim();
  if (!raw) return null;
  const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const target = inner.split("|")[0].split("#")[0].trim();
  const tradesFolder = plugin?.getTradesFolder ? plugin.getTradesFolder() : "Trading Journal/trades";
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
      const file = plugin.app.vault.getAbstractFileByPath(c);
      if (file instanceof TFile && file.extension && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(file.extension.toLowerCase())) {
        return plugin.app.vault.getResourcePath(file);
      }
    } catch {
      // ignore (mock environments may lack getResourcePath)
    }
  }
  try {
    const f = plugin.app.vault.getAbstractFileByPath(target);
    if (f instanceof TFile && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes((f.extension || "").toLowerCase())) {
      return plugin.app.vault.getResourcePath(f);
    }
  } catch {
    // ignore
  }
  return null;
}