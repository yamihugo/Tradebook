import { ItemView, Notice, TFile, setIcon, type WorkspaceLeaf } from "obsidian";
import type TradebookPlugin from "../main";
import {
  deletePrintInboxEntry,
  groupPrintInboxEntries,
  listPrintInboxEntries,
  savePrintInboxEntry,
  updatePrintInboxEntry,
  type PrintInboxEntry,
  type PrintInboxSource,
} from "../lib/printInbox";
import { dateInZone } from "../lib/periods";
import { zoneWallParts } from "../tz";

export const PRINT_QUEUE_VIEW_TYPE = "tradebook-print-queue";

export class PrintQueueView extends ItemView {
  plugin: TradebookPlugin;
  private entries: PrintInboxEntry[] = [];
  private selectedId = "";
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private selectedEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TradebookPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return PRINT_QUEUE_VIEW_TYPE; }
  getDisplayText(): string { return "Print queue"; }
  getIcon(): string { return "images"; }

  async onOpen(): Promise<void> {
    this.render();
    this.registerDomEvent(this.containerEl, "paste", this.onPaste, true);
    this.registerDomEvent(this.containerEl, "dragover", (event) => {
      event.preventDefault();
      this.contentEl.addClass("tj-print-inbox-dragging");
    }, true);
    this.registerDomEvent(this.containerEl, "dragleave", () => this.contentEl.removeClass("tj-print-inbox-dragging"), true);
    this.registerDomEvent(this.containerEl, "drop", this.onDrop, true);
    const queueRoot = `${this.plugin.getTradesFolder()}/print-inbox/`;
    const refreshForQueueFile = (file: { path: string }): void => {
      if (file.path.startsWith(queueRoot)) void this.refresh();
    };
    this.registerEvent(this.plugin.app.vault.on("create", refreshForQueueFile));
    this.registerEvent(this.plugin.app.vault.on("modify", refreshForQueueFile));
    this.registerEvent(this.plugin.app.vault.on("delete", refreshForQueueFile));
    this.registerEvent(this.plugin.app.vault.on("rename", refreshForQueueFile));
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.entries = await listPrintInboxEntries(this.plugin.app, this.plugin.getTradesFolder());
      if (this.selectedId && !this.entries.some((entry) => entry.id === this.selectedId)) this.selectedId = "";
    } catch (error) {
      console.error("[tradebook] failed to load Print Queue", error);
      new Notice("Could not load the print queue.");
    }
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("tj-print-inbox");

    const header = root.createDiv({ cls: "tj-print-inbox-header" });
    const title = header.createDiv({ cls: "tj-print-inbox-title" });
    const icon = title.createSpan({ cls: "tj-print-inbox-title-icon" });
    setIcon(icon, "images");
    title.createSpan({ text: "Print Queue" });
    this.countEl = header.createSpan({ cls: "tj-print-inbox-count" });
    this.countEl.setText(this.entries.length ? String(this.entries.length) : "");

    const intro = root.createDiv({ cls: "tj-print-inbox-intro" });
    intro.createDiv({ cls: "tj-print-inbox-intro-title", text: "Capture now. Journal later." });
    intro.createDiv({ cls: "tj-print-inbox-intro-copy", text: "Your prints stay here until you are ready to use them." });

    const picker = root.createEl("input", { cls: "tj-print-inbox-picker", attr: { type: "file", accept: "image/*", multiple: "true" } });
    picker.addEventListener("change", () => {
      const files = picker.files ? Array.from(picker.files) : [];
      picker.value = "";
      void this.saveFiles(files, "file");
    });
    const capture = root.createEl("button", { cls: "tj-print-inbox-capture", attr: { type: "button" } });
    const captureIcon = capture.createSpan({ cls: "tj-print-inbox-capture-icon" });
    setIcon(captureIcon, "plus");
    capture.createSpan({ text: "Capture screenshot" });
    capture.addEventListener("click", () => picker.click());

    const hint = root.createDiv({ cls: "tj-print-inbox-hint" });
    hint.createSpan({ text: "Paste, drop, or choose an image" });

    this.listEl = root.createDiv({ cls: "tj-print-inbox-list" });
    this.renderList();

    this.selectedEl = root.createDiv({ cls: "tj-print-inbox-selected" });
    this.renderSelected();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const groups = groupPrintInboxEntries(this.entries);
    if (!groups.length) {
      const empty = this.listEl.createDiv({ cls: "tj-print-inbox-empty" });
      const emptyIcon = empty.createDiv({ cls: "tj-print-inbox-empty-icon" });
      setIcon(emptyIcon, "image-plus");
      empty.createDiv({ cls: "tj-print-inbox-empty-title", text: "No prints yet" });
      empty.createDiv({ cls: "tj-print-inbox-empty-copy", text: "Capture a chart screenshot and it will appear here." });
      return;
    }
    for (const group of groups) {
      const section = this.listEl.createDiv({ cls: "tj-print-inbox-day" });
      const day = section.createDiv({ cls: "tj-print-inbox-day-label" });
      day.createSpan({ text: group.date });
      day.createSpan({ cls: "tj-print-inbox-day-count", text: String(group.entries.length) });
      for (const entry of group.entries) this.renderEntry(section, entry);
    }
  }

  private renderEntry(parent: HTMLElement, entry: PrintInboxEntry): void {
    const row = parent.createDiv({ cls: `tj-print-inbox-entry${entry.id === this.selectedId ? " is-selected" : ""}` });
    row.setAttr("role", "button");
    row.setAttr("tabindex", "0");
    const file = this.plugin.app.vault.getAbstractFileByPath(entry.imagePath);
    const thumb = row.createEl("img", { cls: "tj-print-inbox-thumb", attr: { alt: entry.title } });
    if (file instanceof TFile) thumb.src = this.plugin.app.vault.getResourcePath(file);
    const info = row.createDiv({ cls: "tj-print-inbox-entry-info" });
    info.createDiv({ cls: "tj-print-inbox-entry-title", text: entry.title });
    info.createDiv({ cls: "tj-print-inbox-entry-time", text: this.displayTime(entry.capturedAt) });
    if (entry.note) info.createDiv({ cls: "tj-print-inbox-entry-note", text: entry.note });
    const remove = row.createEl("button", { cls: "tj-print-inbox-entry-remove", attr: { type: "button", "aria-label": "Delete print" } });
    setIcon(remove, "trash-2");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.removeEntry(entry);
    });
    const select = (): void => {
      this.selectedId = entry.id;
      this.render();
    };
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
  }

  private renderSelected(): void {
    if (!this.selectedEl) return;
    this.selectedEl.empty();
    const entry = this.entries.find((item) => item.id === this.selectedId);
    if (!entry) return;
    this.selectedEl.addClass("is-visible");
    const heading = this.selectedEl.createDiv({ cls: "tj-print-inbox-selected-heading" });
    heading.createSpan({ text: "Print note" });
    const note = this.selectedEl.createEl("textarea", { cls: "tj-print-inbox-note", attr: { placeholder: "Optional note…", rows: "3" } });
    note.value = entry.note ?? "";
    const actions = this.selectedEl.createDiv({ cls: "tj-print-inbox-selected-actions" });
    const save = actions.createEl("button", { cls: "tj-print-inbox-save-note", attr: { type: "button" }, text: "Save note" });
    save.addEventListener("click", () => {
      void this.saveNote(entry, note.value);
    });
    const open = actions.createEl("button", { cls: "tj-print-inbox-open", attr: { type: "button" }, text: "Open image" });
    open.addEventListener("click", () => {
      const file = this.plugin.app.vault.getAbstractFileByPath(entry.imagePath);
      if (file instanceof TFile) window.open(this.plugin.app.vault.getResourcePath(file), "_blank", "noopener");
    });
  }

  private displayTime(iso: string): string {
    try { return zoneWallParts(new Date(iso), this.plugin.settings.timeZone).time.slice(0, 5); }
    catch { return iso.slice(11, 16); }
  }

  private onPaste = (event: ClipboardEvent): void => {
    const files = event.clipboardData ? Array.from(event.clipboardData.items).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => !!file) : [];
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void this.saveFiles(files, "paste");
  };

  private onDrop = (event: DragEvent): void => {
    event.preventDefault();
    this.contentEl.removeClass("tj-print-inbox-dragging");
    const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
    if (files.length) void this.saveFiles(files, "drop");
  };

  private async saveFiles(files: File[], source: PrintInboxSource): Promise<void> {
    const images = files.filter((file) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type));
    if (!images.length) { new Notice("Drop or choose an image screenshot."); return; }
    const journalDate = dateInZone(this.plugin.settings.timeZone || "UTC");
    let saved = 0;
    let failed = 0;
    for (const file of images) {
      try {
        await savePrintInboxEntry(this.plugin.app, this.plugin.getTradesFolder(), file, journalDate, source);
        saved += 1;
      } catch (error) {
        failed += 1;
        console.error("[tradebook] failed to save Print Queue entry", error);
      }
    }
    if (saved) await this.refresh();
    if (failed) new Notice(saved ? `${saved} saved; ${failed} could not be saved.` : "Could not save the print to the vault.");
    else new Notice(`${saved} print${saved === 1 ? "" : "s"} saved to the Print Queue.`);
  }

  private async saveNote(entry: PrintInboxEntry, note: string): Promise<void> {
    try {
      await updatePrintInboxEntry(this.plugin.app, this.plugin.getTradesFolder(), { ...entry, note: note.trim() || undefined });
      await this.refresh();
      new Notice("Print note saved.");
    } catch (error) {
      console.error("[tradebook] failed to save print note", error);
      new Notice("Could not save the print note.");
    }
  }

  private async removeEntry(entry: PrintInboxEntry): Promise<void> {
    try {
      await deletePrintInboxEntry(this.plugin.app, this.plugin.getTradesFolder(), entry);
      this.selectedId = "";
      await this.refresh();
      new Notice("Print deleted.");
    } catch (error) {
      console.error("[tradebook] failed to delete print", error);
      new Notice("Could not delete the print.");
    }
  }
}
