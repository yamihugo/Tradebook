import { Notice } from "obsidian";

export interface PrintPickOptions {
  tag?: string;
  compact?: boolean;
  onChange?: (hasFile: boolean) => void;
}

export class PrintPick {
  el: HTMLElement;
  tag?: string;
  onChange?: (hasFile: boolean) => void;
  private _file: File | null = null;
  private objUrl = "";
  private nameInput: HTMLInputElement | null = null;

  constructor(parent: HTMLElement, opts: PrintPickOptions = {}) {
    this.tag = opts.tag;
    this.onChange = opts.onChange;
    this.el = parent.createDiv({ cls: "tj-printpick" + (opts.compact ? " compact" : "") });
    this.render();
  }

  baseName(): string {
    return `print-${(this._file?.name || "print").replace(/\.[^.]+$/, "") || "print"}`;
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
    this.revoke();
  }

  getFile(): File | null {
    return this._file;
  }

  getInnerName(): string {
    if (!this._file) return "";
    const ext = (this._file.name.split(".").pop() || "png").toLowerCase();
    const base = (this.nameInput?.value || this.baseName()).trim() || this.baseName();
    return `${base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}.${ext}`;
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
      img.addEventListener("error", () => {
        img.style.opacity = "0.25";
      });
      img.src = this.objUrl;
      const meta = preview.createDiv({ cls: "tj-printpick-meta" });
      meta.createEl("span", { text: "Name:", cls: "tj-form-label" });
      this.nameInput = meta.createEl("input", {
        cls: "tj-printpick-name",
        attr: { value: this.baseName(), spellcheck: "false" },
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
    empty.createEl("div", { text: "🖼 Drop a print here, or press Ctrl+V to paste", cls: "tj-printpick-hint" });
    const browse = empty.createEl("button", { text: "Browse…", cls: "tj-btn" });
    const fileInput = empty.createEl("input", { type: "file", attr: { accept: "image/*" } });
    fileInput.style.display = "none";
    browse.addEventListener("click", () => fileInput.click());
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
    empty.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      let img: File | null = null;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith("image/")) {
            img = items[i].getAsFile();
            break;
          }
        }
      }
      if (img) {
        e.preventDefault();
        e.stopPropagation();
        this.setFile(img);
      }
    });
  }
}
