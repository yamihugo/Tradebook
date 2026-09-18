import { ItemView, Notice, TFile, normalizePath } from "obsidian";
import type TradebookPlugin from "../main";

export const PRINT_QUEUE_VIEW_TYPE = "tradebook-print-queue";

/**
 * A single screenshot sitting in the queue, waiting to be dragged onto a trade.
 * Created when the user Ctrl+V pastes an image while this panel is open.
 */
export interface QueuedPrint {
  id: string;
  /** The raw image File (saved to vault on assign). */
  file: File;
  /** Data-URL used for thumbnails. */
  thumb: string;
  /** When it was pasted. */
  ts: number;
  /** Set to true once dragged onto a trade card. */
  used: boolean;
}

/**
 * Singleton queue — lives on the plugin so both the Print Queue sidebar view
 * and the Add Trade page can reach it without import cycles.
 */
declare module "../main" {
  interface TradebookPlugin {
    printQueue: QueuedPrint[];
    printQueueVersion: number;
  }
}

/** Append an image File to the global print queue. Returns the new entry. */
export function enqueuePrint(plugin: TradebookPlugin, file: File): QueuedPrint {
  const thumb = URL.createObjectURL(file);
  const entry: QueuedPrint = {
    id: `pq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    thumb,
    ts: Date.now(),
    used: false,
  };
  plugin.printQueue.push(entry);
  plugin.printQueueVersion++;
  // Notify the sidebar view to re-render if open
  const leaves = plugin.app.workspace.getLeavesOfType(PRINT_QUEUE_VIEW_TYPE);
  for (const leaf of leaves) {
    const v = leaf.view as PrintQueueView;
    if (typeof v.refresh === "function") v.refresh();
  }
  return entry;
}

/** Mark a print as used (called when dragged onto a trade card). */
export function markPrintUsed(plugin: TradebookPlugin, id: string): void {
  const p = plugin.printQueue.find((x) => x.id === id);
  if (p) {
    p.used = true;
    plugin.printQueueVersion++;
  }
}

/** Get all unused prints. */
export function pendingPrints(plugin: TradebookPlugin): QueuedPrint[] {
  return plugin.printQueue.filter((p) => !p.used);
}

/** Clear the entire queue (e.g. after all trades are saved). */
export function clearPrintQueue(plugin: TradebookPlugin): void {
  for (const p of plugin.printQueue) {
    if (p.thumb) URL.revokeObjectURL(p.thumb);
  }
  plugin.printQueue = [];
  plugin.printQueueVersion++;
}

// ---------------------------------------------------------------------------
// VIEW
// ---------------------------------------------------------------------------

export class PrintQueueView extends ItemView {
  plugin: TradebookPlugin;
  private _listEl: HTMLElement | null = null;
  private _countEl: HTMLElement | null = null;
  private _pasteEl: HTMLElement | null = null;
  private _doneEl: HTMLElement | null = null;

  constructor(leaf: any, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return PRINT_QUEUE_VIEW_TYPE; }
  getDisplayText(): string { return "Print Queue"; }
  getIcon(): string { return "clipboard-list"; }

  async onOpen(): Promise<void> {
    this.render();
    this.containerEl.addEventListener("paste", this._onPaste, true);
  }

  async onClose(): Promise<void> {
    this.containerEl.removeEventListener("paste", this._onPaste, true);
  }

  refresh(): void {
    this.render();
  }

  // --- render ---------------------------------------------------------------

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-pq");

    // Header
    const hdr = root.createDiv({ cls: "tj-pq-header" });
    const title = hdr.createSpan({ cls: "tj-pq-title" });
    title.createSpan({ text: "📋 " });
    title.createSpan({ text: "Print Queue" });
    this._countEl = hdr.createSpan({ cls: "tj-pq-count" });
    const clearBtn = hdr.createEl("button", { cls: "tj-pq-clear", text: "Clear" });
    clearBtn.addEventListener("click", () => {
      clearPrintQueue(this.plugin);
      this.render();
    });

    // Paste zone
    this._pasteEl = root.createDiv({ cls: "tj-pq-paste" });
    this._pasteEl.createDiv({ cls: "tj-pq-paste-icon", text: "📋" });
    this._pasteEl.createDiv({ cls: "tj-pq-paste-text", text: "Ctrl+V to paste" });
    this._pasteEl.createDiv({ cls: "tj-pq-paste-hint", text: "Alt+Tab → Ctrl+V → back" });
    this._pasteEl.addEventListener("click", () => {
      // Focus so CtrlV works
      this._pasteEl?.focus();
    });

    // List
    this._listEl = root.createDiv({ cls: "tj-pq-list" });
    this._doneEl = root.createDiv({ cls: "tj-pq-done" });

    this._renderList();
  }

  private _renderList(): void {
    if (!this._listEl || !this._countEl) return;
    this._listEl.empty();
    const all = this.plugin.printQueue;
    const pending = all.filter((p) => !p.used);
    this._countEl.setText(String(pending.length));

    if (pending.length === 0) {
      this._listEl.createDiv({ cls: "tj-pq-empty", text: "No pending prints" });
      return;
    }

    for (const p of pending) {
      const item = this._listEl.createDiv({ cls: "tj-pq-item" });
      item.setAttr("draggable", "true");
      item.dataset.pqId = p.id;

      const img = item.createEl("img", { cls: "tj-pq-thumb" });
      img.src = p.thumb;

      const info = item.createDiv({ cls: "tj-pq-info" });
      const d = new Date(p.ts);
      const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      info.createDiv({ cls: "tj-pq-label", text: p.file.name || `Print ${time}` });
      info.createDiv({ cls: "tj-pq-time", text: `${time} · ${(p.file.size / 1024).toFixed(0)} KB` });

      // Drag events
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("application/x-pq-print", p.id);
        e.dataTransfer!.effectAllowed = "move";
        item.addClass("dragging");
      });
      item.addEventListener("dragend", () => {
        item.removeClass("dragging");
      });

      // Remove button
      const rm = item.createEl("button", { cls: "tj-pq-remove", text: "✕" });
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        URL.revokeObjectURL(p.thumb);
        this.plugin.printQueue = this.plugin.printQueue.filter((x) => x.id !== p.id);
        this.plugin.printQueueVersion++;
        this._renderList();
      });
    }
  }

  // --- paste handler --------------------------------------------------------

  private _onPaste = (e: ClipboardEvent): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let img: File | null = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        img = items[i].getAsFile();
        break;
      }
    }
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    enqueuePrint(this.plugin, img);
    // Flash paste zone
    if (this._pasteEl) {
      this._pasteEl.addClass("flash");
      setTimeout(() => this._pasteEl?.removeClass("flash"), 500);
    }
    this._renderList();
    new Notice("Print queued");
  };
}
