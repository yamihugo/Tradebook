import { Notice } from "obsidian";

export interface PrintPickOptions {
  tag?: string;
  compact?: boolean;
  onChange?: (hasFile: boolean) => void;
  /** Suggested base name (no extension). Re-read live so it tracks the trade
   *  fields (date/symbol/account) unless the user edits the name themselves. */
  namePrefix?: () => string;
}

export class PrintPick {
  el: HTMLElement;
  tag?: string;
  onChange?: (hasFile: boolean) => void;
  private namePrefix?: () => string;
  private _nameEdited = false;
  private _file: File | null = null;
  private objUrl = "";
  private nameInput: HTMLInputElement | null = null;
  /** True while the pointer is over this zone (or it is focused). */
  private _hovered = false;
  /** Document-level paste: hovering this zone + Ctrl+V pastes the clipboard image. */
  private _onDocPaste = (e: ClipboardEvent): void => {
    if (!this._hovered && document.activeElement !== this.el) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          e.stopPropagation();
          this.setFile(file);
        }
        return;
      }
    }
  };

  constructor(parent: HTMLElement, opts: PrintPickOptions = {}) {
    this.tag = opts.tag;
    this.onChange = opts.onChange;
    this.namePrefix = opts.namePrefix;
    this.el = parent.createDiv({ cls: "tj-printpick" + (opts.compact ? " compact" : "") });
    // Focusable + hover-aware so Ctrl+V works without hunting for a paste button.
    this.el.setAttr("tabindex", "0");
    this.el.addEventListener("mouseenter", () => (this._hovered = true));
    this.el.addEventListener("mouseleave", () => (this._hovered = false));
    this.el.addEventListener("focus", () => (this._hovered = true));
    this.el.addEventListener("blur", () => (this._hovered = false));
    document.addEventListener("paste", this._onDocPaste, true);
    this.render();
  }

  baseName(): string {
    return `print-${(this._file?.name || "print").replace(/\.[^.]+$/, "") || "print"}`;
  }

  /** Name suggested by the trade context (date/symbol/account). */
  suggestedName(): string {
    const s = this.namePrefix ? this.namePrefix().trim() : "";
    return s || this.baseName();
  }

  /** Keep the (unedited) name in sync when trade fields change. */
  refreshName(): void {
    if (!this.nameInput || this._nameEdited) return;
    this.nameInput.value = this.suggestedName();
  }

  /** Full-screen preview (the hook where the annotation editor will live). */
  openPreview(): void {
    if (!this.objUrl) return;
    document.querySelector(".tj-print-overlay")?.remove();
    const overlay = document.body.createDiv({ cls: "tj-print-overlay" });
    const img = overlay.createEl("img", { cls: "tj-print-overlay-img" });
    img.src = this.objUrl;
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
  }

  setFile(file: File): void {
    if (!file.type.startsWith("image/")) {
      new Notice("That's not an image — drop a screenshot (PNG/JPG/etc).");
      return;
    }
    this.revoke();
    this._file = file;
    this.objUrl = URL.createObjectURL(file);
    this.render();
    this.onChange?.(true);
  }

  revoke(): void {
    if (this.objUrl) {
      URL.revokeObjectURL(this.objUrl);
      this.objUrl = "";
    }
  }

  dispose(): void {
    document.removeEventListener("paste", this._onDocPaste, true);
    this.revoke();
  }

  getFile(): File | null {
    return this._file;
  }

  getInnerName(): string {
    if (!this._file) return "";
    const ext = (this._file.name.split(".").pop() || "png").toLowerCase();
    const raw = (this._nameEdited && this.nameInput ? this.nameInput.value : this.suggestedName()).trim();
    const base = raw || this.baseName();
    // Keep spaces (matches the trade filename convention) and strip bad chars.
    const safe = base
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[.\s-]+|[.\s-]+$/g, "");
    return `${safe}.${ext}`;
  }

  get hasFile(): boolean {
    return !!this._file;
  }

  render(): void {
    this.el.empty();
    if (this._file) {
      const preview = this.el.createDiv({ cls: "tj-printpick-preview" });
      this.el.classList.add("tj-printpick-filled");
      this.el.querySelector(".tj-printpick-thumbwrap")?.remove();
      const img = preview.createDiv({ cls: "tj-printpick-thumbwrap" }).createEl("img", { cls: "tj-printpick-thumb" });
      img.title = "Click to view / annotate";
      img.addEventListener("error", () => {
        img.style.opacity = "0.25";
      });
      img.src = this.objUrl;
      img.addEventListener("click", () => this.openPreview());
      const meta = preview.createDiv({ cls: "tj-printpick-meta" });
      meta.createEl("span", { text: "Name:", cls: "tj-form-label" });
      const prevName = this.nameInput ? this.nameInput.value : "";
      this.nameInput = meta.createEl("input", {
        cls: "tj-printpick-name",
        attr: { value: this._nameEdited && prevName ? prevName : this.suggestedName(), spellcheck: "false" },
      });
      this.nameInput.addEventListener("input", () => {
        this._nameEdited = true;
      });
      meta.createEl("button", { text: "✕ Remove", cls: "tj-btn" }).addEventListener("click", () => {
        this._file = null;
        this.nameInput = null;
        this.revoke();
        this.el.classList.remove("tj-printpick-filled");
        this.render();
        this.onChange?.(false);
      });
      return;
    }
    const empty = this.el.createDiv({ cls: "tj-printpick-empty" });
    empty.createEl("div", { text: "Click to browse · drop a print · or hover & press Ctrl+V", cls: "tj-printpick-hint" });
    const fileInput = empty.createEl("input", { type: "file", attr: { accept: "image/*" } });
    fileInput.style.display = "none";
    // Clicking anywhere in the rectangle opens the file browser.
    empty.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) {
        this.setFile(fileInput.files[0]);
        fileInput.value = "";
      }
    });
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    empty.addEventListener("dragenter", (e) => { stop(e); empty.addClass("over"); }, true);
    empty.addEventListener("dragover", (e) => { stop(e); empty.addClass("over"); }, true);
    empty.addEventListener("dragleave", (e) => { stop(e); empty.removeClass("over"); }, true);
    empty.addEventListener("drop", (e) => {
      stop(e);
      empty.removeClass("over");
      const file = e.dataTransfer?.files?.[0];
      if (file) this.setFile(file);
    }, true);
    // Paste is handled at the document level (see _onDocPaste) so that simply
    // hovering this rectangle + Ctrl+V pastes the clipboard image.
  }
}
