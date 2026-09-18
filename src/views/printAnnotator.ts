import { Notice, TFile } from "obsidian";
import { attachTip } from "../lib/tip";
import type TradebookPlugin from "../main";

type Tool = "rect" | "ellipse" | "arrow" | "pen" | "text";
interface Pt {
  x: number;
  y: number;
}
interface Shape {
  tool: Tool;
  color: string;
  size: number;
  pts: Pt[];
  text?: string;
}

const COLORS = ["#f5b301", "#ad3527", "#227a4a", "#7c5cff", "#ffffff"];

/**
 * Lightweight print annotator. Draws rectangle / ellipse / arrow / freehand /
 * text on top of the trade's image, then bakes it back into the SAME file
 * (name and path unchanged — no extra files on disk).
 */
export class PrintAnnotator {
  private plugin: TradebookPlugin;

  constructor(plugin: TradebookPlugin) {
    this.plugin = plugin;
  }

  open(file: TFile, onSaved?: () => void): void {
    const app = this.plugin.app;
    const ext = (file.extension || "").toLowerCase();
    if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
      new Notice("Only PNG / JPG / WebP prints can be annotated.");
      return;
    }

    document.querySelector(".tj-anno-overlay")?.remove();
    const overlay = document.body.createDiv({ cls: "tj-anno-overlay" });
    const panel = overlay.createDiv({ cls: "tj-anno-panel" });

    let tool: Tool = "rect";
    let color = COLORS[0];
    const size = 4;
    const shapes: Shape[] = [];
    const redo: Shape[] = [];
    let current: Shape | null = null;
    let drawing = false;

    // ---- Toolbar ----
    const bar = panel.createDiv({ cls: "tj-anno-toolbar" });
    const toolBtns: Partial<Record<Tool, HTMLElement>> = {};
    const mkTool = (id: Tool, label: string, title: string) => {
      const b = bar.createEl("button", { cls: "tj-anno-tool", text: label, attr: { type: "button", "aria-label": title } });
      attachTip(b, { title });
      toolBtns[id] = b;
      b.addEventListener("click", () => {
        tool = id;
        (Object.keys(toolBtns) as Tool[]).forEach((k) => toolBtns[k]?.toggleClass("on", k === id));
      });
    };
    mkTool("rect", "▣", "Rectangle");
    mkTool("ellipse", "◯", "Ellipse");
    mkTool("arrow", "↗", "Arrow");
    mkTool("pen", "✎", "Free draw");
    mkTool("text", "T", "Text");
    toolBtns.rect?.addClass("on");

    bar.createDiv({ cls: "tj-anno-sep" });
    for (const c of COLORS) {
      const s = bar.createEl("button", { cls: "tj-anno-swatch" + (c === color ? " on" : ""), attr: { type: "button", "aria-label": c } });
      attachTip(s, { title: c });
      s.style.background = c;
      s.addEventListener("click", () => {
        color = c;
        bar.querySelectorAll(".tj-anno-swatch").forEach((el) => el.removeClass("on"));
        s.addClass("on");
      });
    }

    bar.createDiv({ cls: "tj-anno-sep" });
    const undoB = bar.createEl("button", { cls: "tj-anno-tool", text: "↶", attr: { type: "button", "aria-label": "Undo" } });
    attachTip(undoB, { title: "Undo" });
    const redoB = bar.createEl("button", { cls: "tj-anno-tool", text: "↷", attr: { type: "button", "aria-label": "Redo" } });
    attachTip(redoB, { title: "Redo" });
    bar.createDiv({ cls: "tj-anno-spacer" });
    const resetB = bar.createEl("button", { cls: "tj-anno-btn", text: "Reset", attr: { type: "button" } });
    const cancelB = bar.createEl("button", { cls: "tj-anno-btn", text: "Cancel", attr: { type: "button" } });
    const saveB = bar.createEl("button", { cls: "tj-anno-btn tj-anno-cta", text: "Save", attr: { type: "button" } });

    // ---- Canvas ----
    const wrap = panel.createDiv({ cls: "tj-anno-canvaswrap" });
    const canvas = wrap.createEl("canvas", { cls: "tj-anno-canvas" });
    wrap.createDiv({ cls: "tj-anno-footer", text: `${file.name} · annotations are baked into this same file` });

    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    const c2d = () => canvas.getContext("2d")!;

    const drawShape = (s: Shape) => {
      const c = c2d();
      c.strokeStyle = s.color;
      c.fillStyle = s.color;
      c.lineWidth = s.size;
      c.lineCap = "round";
      c.lineJoin = "round";
      if (s.tool === "rect" && s.pts.length >= 2) {
        const a = s.pts[0], b = s.pts[s.pts.length - 1];
        c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (s.tool === "ellipse" && s.pts.length >= 2) {
        const a = s.pts[0], b = s.pts[s.pts.length - 1];
        c.beginPath();
        c.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        c.stroke();
      } else if (s.tool === "arrow" && s.pts.length >= 2) {
        const a = s.pts[0], b = s.pts[s.pts.length - 1];
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const hl = Math.max(14, s.size * 4);
        c.beginPath();
        c.moveTo(b.x, b.y);
        c.lineTo(b.x - hl * Math.cos(ang - Math.PI / 7), b.y - hl * Math.sin(ang - Math.PI / 7));
        c.lineTo(b.x - hl * Math.cos(ang + Math.PI / 7), b.y - hl * Math.sin(ang + Math.PI / 7));
        c.closePath();
        c.fill();
      } else if (s.tool === "pen" && s.pts.length >= 2) {
        c.beginPath();
        c.moveTo(s.pts[0].x, s.pts[0].y);
        for (const p of s.pts.slice(1)) c.lineTo(p.x, p.y);
        c.stroke();
      } else if (s.tool === "text" && s.pts.length) {
        c.font = `bold ${Math.max(16, s.size * 5)}px sans-serif`;
        c.textBaseline = "top";
        c.fillText(s.text || "", s.pts[0].x, s.pts[0].y);
      }
    };

    const redraw = () => {
      const c = c2d();
      c.clearRect(0, 0, canvas.width, canvas.height);
      if (img.complete && img.naturalWidth) c.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const s of shapes) drawShape(s);
      if (current) drawShape(current);
    };

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      redraw();
    };
    canvas.width = 900;
    canvas.height = 500;
    img.src = app.vault.getResourcePath(file);

    const toCanvas = (e: PointerEvent): Pt => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * canvas.width,
        y: ((e.clientY - r.top) / r.height) * canvas.height,
      };
    };

    canvas.addEventListener("pointerdown", (e) => {
      const p = toCanvas(e);
      if (tool === "text") {
        const txt = window.prompt("Annotation text:");
        if (txt) {
          shapes.push({ tool: "text", color, size, pts: [p], text: txt });
          redraw();
        }
        return;
      }
      drawing = true;
      current = { tool, color, size, pts: [p] };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing || !current) return;
      const p = toCanvas(e);
      if (tool === "pen") current.pts.push(p);
      else current.pts[1] = p;
      redraw();
    });
    const endDraw = () => {
      if (drawing && current) {
        if (current.pts.length >= 2) {
          shapes.push(current);
          redo.length = 0;
        }
        current = null;
        drawing = false;
        redraw();
      }
    };
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointerleave", endDraw);

    undoB.addEventListener("click", () => {
      const s = shapes.pop();
      if (s) {
        redo.push(s);
        redraw();
      }
    });
    redoB.addEventListener("click", () => {
      const s = redo.pop();
      if (s) {
        shapes.push(s);
        redraw();
      }
    });
    resetB.addEventListener("click", () => {
      shapes.length = 0;
      redo.length = 0;
      redraw();
    });
    cancelB.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    saveB.addEventListener("click", async () => {
      saveB.setAttr("disabled", "true");
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
      if (!blob) {
        new Notice("Could not export the annotated image.");
        saveB.removeAttribute("disabled");
        return;
      }
      try {
        await app.vault.modifyBinary(file, await blob.arrayBuffer());
        new Notice("Print annotated and saved.");
        onSaved?.();
        close();
      } catch (err) {
        console.error("[tradebook] annotate save failed", err);
        new Notice("Could not save the annotated print.");
      } finally {
        saveB.removeAttribute("disabled");
      }
    });
  }
}
