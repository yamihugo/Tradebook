import { Notice, TFile, setIcon } from "obsidian";
import { attachTip } from "../lib/tip";
import type TradebookPlugin from "../main";

type Tool = "select" | "rect" | "ellipse" | "arrow" | "line" | "pen" | "text" | "eraser";
interface Pt {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type FillStyleName = "solid" | "hachure" | "cross-hatch";
type StrokeStyleName = "solid" | "dashed" | "dotted";
type Arrowhead = "none" | "arrow";

interface Shape {
  id: string;
  tool: Tool;
  pts: Pt[];
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyleName;
  strokeWidth: number;
  strokeStyle: StrokeStyleName;
  opacity: number;
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  text?: string;
  fontSize?: number;
  /** Pre-sidebar sidecar flag — read on load, superseded by backgroundColor. */
  filled?: boolean;
}

let shapeSeq = 0;
const nextShapeId = () => `anno-${++shapeSeq}`;

/** Sidecar written next to the print: the shapes, so a save stays editable. */
interface AnnotatorFile {
  version: 1;
  shapes: Shape[];
}

const IMG_EXT = /\.(?:png|jpe?g|webp)$/i;
const ANNOTATED_RE = /-annotated\.(?:png|jpe?g|webp)$/i;

/** Text badge padding — fixed in pixels, never scaled by resize. */
const TEXT_PAD_X = 8;
const TEXT_PAD_Y = 6;
const TEXT_LINE = 1.2;

const PALETTE: { hex: string; name: string }[] = [
  { hex: "#7c5cff", name: "Purple" },
  { hex: "#4a9eff", name: "Blue" },
  { hex: "#34d17a", name: "Green" },
  { hex: "#f5b301", name: "Yellow" },
  { hex: "#ff8d6b", name: "Orange" },
  { hex: "#ff5d48", name: "Red" },
  { hex: "#ffffff", name: "White" },
];

/** Background choices: the palette at 30% alpha, plus no fill at all. */
const BG_CHOICES: { value: string; name: string }[] = [
  ...PALETTE.map((c) => ({ value: `${c.hex}4d`, name: c.name })),
  { value: "transparent", name: "Transparent" },
];

/** Hatch tiles are tiny and reusable — build each colour/style pair once. */
const hatchCache = new Map<string, CanvasPattern>();
function hatchPattern(
  ctx: CanvasRenderingContext2D,
  color: string,
  style: "hachure" | "cross-hatch",
): CanvasPattern | null {
  const key = `${color}|${style}`;
  const hit = hatchCache.get(key);
  if (hit) return hit;
  const size = 8;
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const oc = off.getContext("2d");
  if (!oc) return null;
  oc.strokeStyle = color;
  oc.lineWidth = 1;
  oc.beginPath();
  if (style === "hachure") {
    oc.moveTo(0, size);
    oc.lineTo(size, 0);
  } else {
    oc.moveTo(0, size);
    oc.lineTo(size, 0);
    oc.moveTo(0, 0);
    oc.lineTo(size, size);
  }
  oc.stroke();
  const pattern = ctx.createPattern(off, "repeat");
  if (pattern) hatchCache.set(key, pattern);
  return pattern;
}

interface ArrowGeometry {
  points: Pt[];
  path: (c: CanvasRenderingContext2D) => void;
  startAngle: number;
  endAngle: number;
}

/**
 * The one source of truth for an arrow / line path. Two points draw a plain
 * segment; three or more are smoothed with Catmull-Rom → cubic Bézier so the
 * curve passes through every edited point. Drawing, hit-testing and the
 * selection box all read this, so they can never disagree.
 */
function arrowGeometry(pts: Pt[]): ArrowGeometry {
  const n = pts.length;
  const segs: { p1: Pt; p2: Pt; cp1: Pt; cp2: Pt }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < n ? pts[i + 2] : pts[i + 1];
    segs.push({
      p1,
      p2,
      cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
    });
  }
  const path = (c: CanvasRenderingContext2D) => {
    c.moveTo(pts[0].x, pts[0].y);
    for (const s of segs) c.bezierCurveTo(s.cp1.x, s.cp1.y, s.cp2.x, s.cp2.y, s.p2.x, s.p2.y);
  };
  // Sample for hit-test / bounding box: 32 points per segment.
  const points: Pt[] = [pts[0]];
  for (const s of segs) {
    for (let i = 1; i <= 32; i++) {
      const t = i / 32;
      const mt = 1 - t;
      points.push({
        x: mt * mt * mt * s.p1.x + 3 * mt * mt * t * s.cp1.x + 3 * mt * t * t * s.cp2.x + t * t * t * s.p2.x,
        y: mt * mt * mt * s.p1.y + 3 * mt * mt * t * s.cp1.y + 3 * mt * t * t * s.cp2.y + t * t * t * s.p2.y,
      });
    }
  }
  const first = segs[0];
  const last = segs[segs.length - 1];
  return {
    points,
    path,
    startAngle: Math.atan2(first.cp1.y - first.p1.y, first.cp1.x - first.p1.x),
    endAngle: Math.atan2(last.p2.y - last.cp2.y, last.p2.x - last.cp2.x),
  };
}

/**
 * Lightweight print annotator. Draws rectangle / ellipse / arrow / line /
 * freehand / text on top of the trade's image.
 *
 * Three files per print:
 *   <base>.png           the original image — never written by us
 *   <base>.json          the shapes, so the drawing stays editable
 *   <base>-annotated.png the composite (original + shapes) for display
 */
export class PrintAnnotator {
  private plugin: TradebookPlugin;

  constructor(plugin: TradebookPlugin) {
    this.plugin = plugin;
  }

  open(file: TFile, onSaved?: (annotatedName: string) => void): void {
    const app = this.plugin.app;
    const ext = (file.extension || "").toLowerCase();
    if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
      new Notice("Only PNG / JPG / WebP prints can be annotated.");
      return;
    }

    // Everything (JSON, composite, original) hangs off the same base name,
    // whether we were handed the original or a previous composite.
    const basePath = file.path.replace(ANNOTATED_RE, "").replace(IMG_EXT, "");
    const jsonPath = `${basePath}.json`;
    const annotatedPath = `${basePath}-annotated.png`;

    // The canvas always starts from the ORIGINAL image: the composite is for
    // display, the shapes in the JSON are what we edit.
    let source: TFile = file;
    if (ANNOTATED_RE.test(file.path)) {
      for (const e of ["png", "jpg", "jpeg", "webp"]) {
        const f = app.vault.getAbstractFileByPath(`${basePath}.${e}`);
        if (f instanceof TFile) { source = f; break; }
      }
    }

    document.querySelector(".tj-anno-overlay")?.remove();
    const overlay = document.body.createDiv({ cls: "tj-anno-overlay" });
    const panel = overlay.createDiv({ cls: "tj-anno-panel" });

    let tool: Tool = "select";
    let currentStrokeColor = PALETTE[0].hex;
    let currentBackgroundColor = "transparent";
    let currentFillStyle: FillStyleName = "solid";
    let currentStrokeWidth = 4;
    let currentStrokeStyle: StrokeStyleName = "solid";
    let currentOpacity = 100;
    let currentStartArrowhead: Arrowhead = "none";
    let currentEndArrowhead: Arrowhead = "arrow";
    const shapes: Shape[] = [];
    const redo: Shape[] = [];
    let current: Shape | null = null;
    let drawing = false;
    let selected: Shape | null = null;
    let hoverCursor = "default";
    let moving = false;
    let resizing = false;
    let moveStart = { x: 0, y: 0 };
    let moveOrig: Pt[] = [];
    let resizeHandle = "";
    let resizeOrigBox: Box = { x: 0, y: 0, w: 0, h: 0 };
    let resizeOrigPts: Pt[] = [];
    let resizeOrigFont = 16;
    /** Sidebar sync hook — assigned by buildSidebar, called after any selection / order change. */
    let syncSidebar: () => void = () => {};
    /** Point editing (arrow / line / pen): drag points, insert at midpoints. */
    let editingPoints = false;
    let editingShape: Shape | null = null;
    let draggingHandle: { index: number } | null = null;
    let dragOrigPt: Pt = { x: 0, y: 0 };

    const exitPointEdit = () => {
      editingPoints = false;
      editingShape = null;
      draggingHandle = null;
    };
    const canEditPoints = (s: Shape | null): s is Shape =>
      !!s && (s.tool === "arrow" || s.tool === "line" || s.tool === "pen");

    // ---- Toolbar ----
    const bar = panel.createDiv({ cls: "tj-anno-toolbar" });
    const mkIcon = (parent: HTMLElement, cls: string, icon: string, label: string): HTMLButtonElement => {
      const b = parent.createEl("button", { cls, attr: { type: "button" } });
      b.createSpan({ cls: "tj-sr-only", text: label });
      setIcon(b, icon);
      attachTip(b, { title: label });
      return b;
    };

    const toolBtns: Partial<Record<Tool, HTMLElement>> = {};
    const setTool = (id: Tool) => {
      tool = id;
      exitPointEdit();
      if (id !== "select") selected = null;
      hoverCursor = id === "select" ? "default" : "crosshair";
      (Object.keys(toolBtns) as Tool[]).forEach((k) => toolBtns[k]?.toggleClass("is-active", k === id));
      updateCursor();
      redraw();
      rebuildSidebar();
    };
    const mkTool = (id: Tool, icon: string, label: string) => {
      const b = mkIcon(bar, "tj-anno-tool", icon, label);
      toolBtns[id] = b;
      b.addEventListener("click", () => setTool(id));
    };
    mkTool("select", "mouse-pointer-2", "Select");
    mkTool("rect", "square", "Rectangle");
    mkTool("ellipse", "circle", "Ellipse");
    mkTool("arrow", "arrow-up-right", "Arrow");
    mkTool("line", "minus", "Line");
    mkTool("pen", "pencil", "Free draw");
    mkTool("text", "type", "Text");
    mkTool("eraser", "eraser", "Eraser");
    toolBtns.select?.addClass("is-active");

    bar.createDiv({ cls: "tj-anno-sep" });
    const undoB = mkIcon(bar, "tj-anno-tool", "undo-2", "Undo");
    const redoB = mkIcon(bar, "tj-anno-tool", "redo-2", "Redo");
    const fitB = mkIcon(bar, "tj-anno-tool", "maximize", "Fit");
    bar.createDiv({ cls: "tj-anno-spacer" });
    const actions = bar.createDiv({ cls: "tj-anno-actions" });
    const resetB = actions.createEl("button", { cls: "tj-actionbtn", text: "Reset", attr: { type: "button" } });
    const cancelB = actions.createEl("button", { cls: "tj-actionbtn", text: "Cancel", attr: { type: "button" } });
    const saveB = actions.createEl("button", { cls: "tj-actionbtn is-primary", text: "Save", attr: { type: "button" } });

    // ---- Canvas + viewport ----
    const body = panel.createDiv({ cls: "tj-anno-body" });
    const sidebar = body.createDiv({ cls: "tj-anno-sidebar" });
    const canvasArea = body.createDiv({ cls: "tj-anno-canvasarea" });
    const wrap = canvasArea.createDiv({ cls: "tj-anno-canvaswrap" });
    const canvas = wrap.createEl("canvas", { cls: "tj-anno-canvas" });

    const close = () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      ro.disconnect();
      overlay.remove();
    };
    const isTyping = () => {
      const ae = document.activeElement as HTMLElement | null;
      return !!ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" || ae.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && (e.key === "]" || e.key === "}" || e.key === "[" || e.key === "{")) {
        e.preventDefault();
        const toEnd = e.key === "]" || e.key === "}";
        if (e.shiftKey) {
          if (toEnd) bringToFront(); else sendToBack();
        } else {
          moveLayer(toEnd ? 1 : -1);
        }
        return;
      }
      if (e.key === "Escape") {
        if (editingPoints) {
          // Leave the handles, keep the selection.
          exitPointEdit();
          redraw();
          return;
        }
        if (selected) {
          selected = null;
          redraw();
          syncSidebar();
        } else close();
        return;
      }
      if (!mod && (e.key === "e" || e.key === "E")) {
        if (editingPoints) {
          exitPointEdit();
          redraw();
        } else if (canEditPoints(selected)) {
          editingPoints = true;
          editingShape = selected;
          redraw();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.code === "Space") {
        spaceDown = true;
        updateCursor();
        e.preventDefault();
        return;
      }
      const shortcuts: Record<string, Tool> = {
        "1": "select", "2": "rect", "3": "ellipse", "4": "arrow",
        "5": "line", "6": "pen", "7": "text", "8": "eraser",
        v: "select", V: "select",
      };
      const t = shortcuts[e.key];
      if (t) {
        e.preventDefault();
        setTool(t);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown = false;
        updateCursor();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);

    const c2d = () => canvas.getContext("2d")!;

    const dpr = window.devicePixelRatio || 1;
    const view = { x: 0, y: 0, scale: 1 };
    let viewW = 0;
    let viewH = 0;
    let fitted = false;
    let spaceDown = false;
    let panning = false;
    let panStart = { x: 0, y: 0 };
    let viewStart = { x: 0, y: 0 };

    const updateCursor = () => {
      if (panning) { canvas.style.cursor = "grabbing"; return; }
      if (spaceDown) { canvas.style.cursor = "grab"; return; }
      canvas.style.cursor = tool === "select" ? hoverCursor : "crosshair";
    };

    const drawShape = (s: Shape, c: CanvasRenderingContext2D) => {
      c.strokeStyle = s.strokeColor;
      c.fillStyle = s.strokeColor;
      c.lineWidth = s.strokeWidth;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.globalAlpha = s.opacity / 100;
      c.setLineDash(s.strokeStyle === "dashed" ? [8, 6] : s.strokeStyle === "dotted" ? [2, 4] : []);
      const fillPaint = (): string | CanvasPattern | null => {
        if (s.tool !== "rect" && s.tool !== "ellipse") return null;
        const bg = s.backgroundColor;
        if (!bg || bg === "transparent") return null;
        return s.fillStyle === "solid" ? bg : hatchPattern(c, bg, s.fillStyle);
      };
      if (s.tool === "rect" && s.pts.length >= 2) {
        const a = s.pts[0], b = s.pts[s.pts.length - 1];
        const paint = fillPaint();
        if (paint) {
          c.fillStyle = paint;
          c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        }
        c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (s.tool === "ellipse" && s.pts.length >= 2) {
        const a = s.pts[0], b = s.pts[s.pts.length - 1];
        c.beginPath();
        c.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        const paint = fillPaint();
        if (paint) {
          c.fillStyle = paint;
          c.fill();
        }
        c.stroke();
      } else if ((s.tool === "line" || s.tool === "arrow") && s.pts.length >= 2) {
        const geo = arrowGeometry(s.pts);
        c.beginPath();
        geo.path(c);
        c.stroke();
        if (s.tool === "arrow") {
          const a = s.pts[0], b = s.pts[s.pts.length - 1];
          // Length 2.5× the stroke (10–24), half-width 0.6× that: slim and
          // proportional, apex centred on the tangent.
          const hl = Math.min(24, Math.max(10, s.strokeWidth * 2.5));
          const hw = hl * 0.6;
          const drawHead = (at: Pt, angle: number) => {
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const bx = at.x - hl * cosA;
            const by = at.y - hl * sinA;
            const px = -sinA * hw;
            const py = cosA * hw;
            c.beginPath();
            c.moveTo(at.x, at.y);
            c.lineTo(bx + px, by + py);
            c.lineTo(bx - px, by - py);
            c.closePath();
            c.fillStyle = s.strokeColor;
            c.fill();
          };
          if ((s.startArrowhead ?? "none") === "arrow") {
            // Apex sits at `a`; the nose must face away from the body, i.e.
            // opposite to the travel direction at the start.
            drawHead(a, geo.startAngle + Math.PI);
          }
          if ((s.endArrowhead ?? "arrow") === "arrow") {
            drawHead(b, geo.endAngle);
          }
        }
      } else if (s.tool === "pen" && s.pts.length >= 2) {
        c.beginPath();
        c.moveTo(s.pts[0].x, s.pts[0].y);
        for (const p of s.pts.slice(1)) c.lineTo(p.x, p.y);
        c.stroke();
      } else if (s.tool === "text" && s.pts.length) {
        const fs = s.fontSize ?? 16;
        c.font = `${fs}px ${getComputedStyle(canvas).fontFamily}`;
        const m = c.measureText(s.text || "");
        const px = s.pts[0].x;
        const py = s.pts[0].y;
        const bx = px - TEXT_PAD_X;
        const by = py - TEXT_PAD_Y;
        const bw = m.width + TEXT_PAD_X * 2;
        const bh = fs * TEXT_LINE + TEXT_PAD_Y * 2;
        const bg = s.backgroundColor;
        if (bg && bg !== "transparent") {
          const paint = s.fillStyle === "solid" ? bg : hatchPattern(c, bg, s.fillStyle);
          if (paint) {
            c.fillStyle = paint;
            c.fillRect(bx, by, bw, bh);
          }
          c.strokeStyle = s.strokeColor;
          c.lineWidth = s.strokeWidth;
          c.strokeRect(bx, by, bw, bh);
        }
        c.textBaseline = "top";
        c.fillStyle = s.strokeColor;
        c.fillText(s.text || "", px, py);
      }
      c.setLineDash([]);
      c.globalAlpha = 1;
    };

    // ---- Selection geometry ----
    const accent = () => getComputedStyle(canvas).getPropertyValue("--interactive-accent").trim() || "#7c5cff";
    const textFont = (size: number) => `${size}px ${getComputedStyle(canvas).fontFamily}`;

    const measureText = (text: string, size: number): number => {
      const c = c2d();
      c.save();
      c.font = textFont(size);
      const w = c.measureText(text).width;
      c.restore();
      return w;
    };

    const bboxOf = (s: Shape): Box => {
      if (s.tool === "text") {
        // The badge, not the baseline: selection handles sit on the visible box.
        const fs = s.fontSize ?? 16;
        const w = measureText(s.text || "", fs);
        return {
          x: s.pts[0].x - TEXT_PAD_X,
          y: s.pts[0].y - TEXT_PAD_Y,
          w: w + TEXT_PAD_X * 2,
          h: fs * TEXT_LINE + TEXT_PAD_Y * 2,
        };
      }
      if ((s.tool === "arrow" || s.tool === "line") && s.pts.length >= 2) {
        // The curve can bulge outside the endpoint box, so measure the path.
        const geo = arrowGeometry(s.pts);
        const xs = geo.points.map((p) => p.x);
        const ys = geo.points.map((p) => p.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        };
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of s.pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    };

    const insideBox = (p: Pt, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

    const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };

    const hitsPolyline = (p: Pt, pts: Pt[], threshold: number): boolean => {
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(p, pts[i], pts[i + 1]) <= threshold) return true;
      }
      return false;
    };

    const hitTest = (p: Pt, s: Shape): boolean => {
      // Polyline tools pick with the same tolerance: 8 canvas px + half stroke.
      const lineTol = 8 + s.strokeWidth / 2;
      if ((s.tool === "arrow" || s.tool === "line") && s.pts.length >= 2) {
        const geo = arrowGeometry(s.pts);
        return hitsPolyline(p, geo.points, lineTol);
      }
      if (s.tool === "pen" && s.pts.length >= 2) {
        return hitsPolyline(p, s.pts, lineTol);
      }
      const tol = Math.max(8 / view.scale, s.strokeWidth);
      const b = bboxOf(s);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    };

    const topShapeAt = (p: Pt): Shape | null => {
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitTest(p, shapes[i])) return shapes[i];
      }
      return null;
    };

    const HANDLES: Record<string, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
      nw: { x: -1, y: -1 }, n: { x: 0, y: -1 }, ne: { x: 1, y: -1 },
      e: { x: 1, y: 0 }, se: { x: 1, y: 1 }, s: { x: 0, y: 1 },
      sw: { x: -1, y: 1 }, w: { x: -1, y: 0 },
    };
    const handlePoints = (b: Box): { id: string; x: number; y: number }[] => [
      { id: "nw", x: b.x, y: b.y },
      { id: "n", x: b.x + b.w / 2, y: b.y },
      { id: "ne", x: b.x + b.w, y: b.y },
      { id: "e", x: b.x + b.w, y: b.y + b.h / 2 },
      { id: "se", x: b.x + b.w, y: b.y + b.h },
      { id: "s", x: b.x + b.w / 2, y: b.y + b.h },
      { id: "sw", x: b.x, y: b.y + b.h },
      { id: "w", x: b.x, y: b.y + b.h / 2 },
    ];
    const handleCursor = (id: string): string => {
      const a = HANDLES[id];
      if (a.x !== 0 && a.y !== 0) return a.x === a.y ? "nwse-resize" : "nesw-resize";
      return a.x !== 0 ? "ew-resize" : "ns-resize";
    };
    const screenBox = (s: Shape): Box => {
      const b = bboxOf(s);
      return { x: view.x + b.x * view.scale, y: view.y + b.y * view.scale, w: b.w * view.scale, h: b.h * view.scale };
    };

    const drawSelection = (c: CanvasRenderingContext2D) => {
      if (!selected) return;
      const b = screenBox(selected);
      c.save();
      c.setLineDash([5, 4]);
      c.lineWidth = 1;
      c.strokeStyle = accent();
      c.strokeRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1);
      c.setLineDash([]);
      for (const hp of handlePoints(b)) {
        c.fillStyle = "#ffffff";
        c.fillRect(hp.x - 4, hp.y - 4, 8, 8);
        c.strokeStyle = accent();
        c.strokeRect(hp.x - 4, hp.y - 4, 8, 8);
      }
      c.restore();
    };

    /** Point-editing handles, drawn in screen space so they never zoom. */
    const drawPointHandles = (c: CanvasRenderingContext2D) => {
      if (!editingPoints || !editingShape) return;
      const pts = editingShape.pts;
      const toScreen = (q: Pt) => ({ x: view.x + q.x * view.scale, y: view.y + q.y * view.scale });
      c.save();
      // Midpoint ("add a point") handles sit under the real points.
      for (let i = 0; i < pts.length - 1; i++) {
        const a = toScreen(pts[i]), b = toScreen(pts[i + 1]);
        c.beginPath();
        c.arc((a.x + b.x) / 2, (a.y + b.y) / 2, 3, 0, Math.PI * 2);
        c.fillStyle = "rgba(255, 255, 255, 0.85)";
        c.fill();
        c.setLineDash([2, 2]);
        c.strokeStyle = accent();
        c.lineWidth = 1;
        c.stroke();
        c.setLineDash([]);
      }
      for (const q of pts) {
        const sp = toScreen(q);
        c.beginPath();
        c.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
        c.fillStyle = "#ffffff";
        c.fill();
        c.strokeStyle = accent();
        c.lineWidth = 1.5;
        c.stroke();
      }
      c.restore();
    };

    const redraw = () => {
      const c = c2d();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, viewW, viewH);
      if (!img.complete || !img.naturalWidth) return;
      c.save();
      c.translate(view.x, view.y);
      c.scale(view.scale, view.scale);
      c.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
      for (const s of shapes) drawShape(s, c);
      if (current) drawShape(current, c);
      c.restore();
      drawSelection(c);
      drawPointHandles(c);
    };

    const img = new Image();

    /** Fit the whole print inside the panel with a small margin, then centre it. */
    const fitToView = () => {
      if (!img.naturalWidth) return;
      const scale = Math.min((viewW - 48) / img.naturalWidth, (viewH - 48) / img.naturalHeight);
      view.scale = Math.max(0.1, Math.min(8, scale));
      view.x = (viewW - img.naturalWidth * view.scale) / 2;
      view.y = (viewH - img.naturalHeight * view.scale) / 2;
    };

    const tryFit = () => {
      if (fitted || !img.complete || !img.naturalWidth || viewW <= 1 || viewH <= 1) return;
      fitToView();
      fitted = true;
    };

    img.onload = () => {
      tryFit();
      redraw();
    };
    img.src = app.vault.getResourcePath(source);

    const resize = () => {
      viewW = wrap.clientWidth || 1;
      viewH = wrap.clientHeight || 1;
      canvas.style.width = `${viewW}px`;
      canvas.style.height = `${viewH}px`;
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      tryFit();
      redraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    // ---- Sidebar: style controls live here, the toolbar stays for tools ----
    const buildSidebar = () => {
      const section = (labelText: string): HTMLElement => {
        const sec = sidebar.createDiv({ cls: "tj-anno-sidebar-section" });
        sec.createSpan({ cls: "tj-anno-sidebar-label", text: labelText });
        return sec.createDiv({ cls: "tj-anno-sidebar-row" });
      };

      // A) Stroke colour
      const strokeRow = section("Stroke");
      const strokeSwatches: HTMLElement[] = [];
      for (const c of PALETTE) {
        const sw = strokeRow.createEl("button", { cls: "tj-anno-sidebar-swatch", attr: { type: "button" } });
        sw.createSpan({ cls: "tj-sr-only", text: c.name });
        attachTip(sw, { title: c.name });
        sw.style.backgroundColor = c.hex;
        strokeSwatches.push(sw);
        sw.addEventListener("click", () => {
          currentStrokeColor = c.hex;
          if (selected) selected.strokeColor = c.hex;
          strokeSwatches.forEach((el, i) => el.toggleClass("is-active", PALETTE[i].hex === currentStrokeColor));
          redraw();
        });
      }
      strokeSwatches.forEach((el, i) => el.toggleClass("is-active", PALETTE[i].hex === currentStrokeColor));

      // B) Background — same colours at 30%, plus no fill at all
      const bgRow = section("Background");
      const bgSwatches: HTMLElement[] = [];
      for (const choice of BG_CHOICES) {
        const sw = bgRow.createEl("button", { cls: "tj-anno-sidebar-swatch is-checker", attr: { type: "button" } });
        sw.createSpan({ cls: "tj-sr-only", text: choice.name });
        attachTip(sw, { title: choice.name });
        if (choice.value !== "transparent") sw.style.backgroundColor = choice.value;
        bgSwatches.push(sw);
        sw.addEventListener("click", () => {
          currentBackgroundColor = choice.value;
          if (selected) selected.backgroundColor = choice.value;
          bgSwatches.forEach((el, i) => el.toggleClass("is-active", BG_CHOICES[i].value === currentBackgroundColor));
          redraw();
        });
      }
      bgSwatches.forEach((el, i) => el.toggleClass("is-active", BG_CHOICES[i].value === currentBackgroundColor));

      // C) Stroke width
      const widths = [
        { label: "S", value: 2, tip: "Thin stroke" },
        { label: "M", value: 4, tip: "Medium stroke" },
        { label: "L", value: 8, tip: "Thick stroke" },
      ];
      const widthRow = section("Stroke width");
      const widthBtns: HTMLElement[] = [];
      for (const w of widths) {
        const b = widthRow.createEl("button", { cls: "tj-anno-sidebar-btn", text: w.label, attr: { type: "button" } });
        attachTip(b, { title: w.tip });
        widthBtns.push(b);
        b.addEventListener("click", () => {
          currentStrokeWidth = w.value;
          if (selected) selected.strokeWidth = w.value;
          widthBtns.forEach((el, i) => el.toggleClass("is-active", widths[i].value === currentStrokeWidth));
          redraw();
        });
      }
      widthBtns.forEach((el, i) => el.toggleClass("is-active", widths[i].value === currentStrokeWidth));

      // D) Stroke style
      const styles = [
        { label: "—", value: "solid" as StrokeStyleName, tip: "Solid" },
        { label: "--", value: "dashed" as StrokeStyleName, tip: "Dashed" },
        { label: "···", value: "dotted" as StrokeStyleName, tip: "Dotted" },
      ];
      const styleRow = section("Stroke style");
      const styleBtns: HTMLElement[] = [];
      for (const st of styles) {
        const b = styleRow.createEl("button", { cls: "tj-anno-sidebar-btn", text: st.label, attr: { type: "button" } });
        attachTip(b, { title: st.tip });
        styleBtns.push(b);
        b.addEventListener("click", () => {
          currentStrokeStyle = st.value;
          if (selected) selected.strokeStyle = st.value;
          styleBtns.forEach((el, i) => el.toggleClass("is-active", styles[i].value === currentStrokeStyle));
          redraw();
        });
      }
      styleBtns.forEach((el, i) => el.toggleClass("is-active", styles[i].value === currentStrokeStyle));

      // E) Opacity
      const opacityRow = section("Opacity");
      const opacityInput = opacityRow.createEl("input", {
        cls: "tj-anno-sidebar-slider",
        attr: { type: "range", min: "0", max: "100", step: "1" },
      });
      opacityInput.value = String(currentOpacity);
      opacityInput.addEventListener("input", () => {
        const v = Number(opacityInput.value);
        currentOpacity = v;
        if (selected) {
          selected.opacity = v;
          redraw();
        }
      });

      // F) Fill style — rect/ellipse fills only; text and lines ignore it.
      const fillStyles: { value: FillStyleName; icon: string; fallback: string; tip: string }[] = [
        { value: "solid", icon: "square", fallback: "▣", tip: "Solid fill" },
        { value: "hachure", icon: "lines", fallback: "▨", tip: "Hachure fill" },
        { value: "cross-hatch", icon: "grid-2x2", fallback: "▩", tip: "Cross-hatch fill" },
      ];
      const fillRow = section("Fill style");
      const fillBtns: HTMLElement[] = [];
      for (const f of fillStyles) {
        const b = fillRow.createEl("button", {
          cls: "tj-anno-sidebar-btn tj-anno-sidebar-iconbtn",
          attr: { type: "button" },
        });
        b.createSpan({ cls: "tj-sr-only", text: f.tip });
        let hasIcon = false;
        try {
          setIcon(b, f.icon);
          hasIcon = !!b.querySelector("svg");
        } catch {
          hasIcon = false;
        }
        if (!hasIcon) b.createSpan({ text: f.fallback });
        attachTip(b, { title: f.tip });
        fillBtns.push(b);
        b.addEventListener("click", () => {
          currentFillStyle = f.value;
          if (selected) {
            selected.fillStyle = f.value;
            redraw();
          }
          syncSidebar();
        });
      }

      // Tool extras — arrow only (rebuildSidebar decides visibility).
      if (tool === "arrow") {
        const headModes: { label: string; tip: string; start: Arrowhead; end: Arrowhead }[] = [
          { label: "←", tip: "Arrowhead at start", start: "arrow", end: "none" },
          { label: "→", tip: "Arrowhead at end", start: "none", end: "arrow" },
          { label: "↔", tip: "Arrowheads on both ends", start: "arrow", end: "arrow" },
        ];
        const headRow = section("Arrowheads");
        const headBtns: HTMLElement[] = [];
        for (const m of headModes) {
          const b = headRow.createEl("button", {
            cls: "tj-anno-sidebar-btn",
            text: m.label,
            attr: { type: "button" },
          });
          attachTip(b, { title: m.tip });
          headBtns.push(b);
          b.addEventListener("click", () => {
            currentStartArrowhead = m.start;
            currentEndArrowhead = m.end;
            if (selected && selected.tool === "arrow") {
              selected.startArrowhead = m.start;
              selected.endArrowhead = m.end;
              redraw();
            }
            headBtns.forEach((el, i) =>
              el.toggleClass(
                "is-active",
                currentStartArrowhead === headModes[i].start && currentEndArrowhead === headModes[i].end,
              ),
            );
          });
        }
        headBtns.forEach((el, i) =>
          el.toggleClass(
            "is-active",
            currentStartArrowhead === headModes[i].start && currentEndArrowhead === headModes[i].end,
          ),
        );
      }

      // G) Layers
      const layerDefs: { icon: string; tip: string; run: () => void }[] = [
        { icon: "chevrons-down", tip: "Send to back", run: () => sendToBack() },
        { icon: "arrow-down", tip: "Move backward", run: () => moveLayer(-1) },
        { icon: "arrow-up", tip: "Move forward", run: () => moveLayer(1) },
        { icon: "chevrons-up", tip: "Bring to front", run: () => bringToFront() },
      ];
      const layerRow = section("Layers");
      const layerBtns: HTMLButtonElement[] = [];
      for (const d of layerDefs) {
        const b = layerRow.createEl("button", {
          cls: "tj-anno-sidebar-btn tj-anno-sidebar-iconbtn",
          attr: { type: "button" },
        });
        b.createSpan({ cls: "tj-sr-only", text: d.tip });
        setIcon(b, d.icon);
        attachTip(b, { title: d.tip });
        b.addEventListener("click", () => d.run());
        layerBtns.push(b);
      }

      // H) Actions
      const actionDefs: { icon: string; tip: string; run: () => void }[] = [
        { icon: "copy", tip: "Duplicate", run: () => duplicateSelected() },
        { icon: "trash", tip: "Delete", run: () => deleteSelected() },
      ];
      const actionRow = section("Actions");
      const actionBtns: HTMLButtonElement[] = [];
      for (const d of actionDefs) {
        const b = actionRow.createEl("button", {
          cls: "tj-anno-sidebar-btn tj-anno-sidebar-iconbtn",
          attr: { type: "button" },
        });
        b.createSpan({ cls: "tj-sr-only", text: d.tip });
        setIcon(b, d.icon);
        attachTip(b, { title: d.tip });
        b.addEventListener("click", () => d.run());
        actionBtns.push(b);
      }

      // One place that reflects selection + layer position onto the sidebar.
      syncSidebar = () => {
        const idx = selected ? shapes.indexOf(selected) : -1;
        const last = shapes.length - 1;
        const atBack = idx > 0;
        const atFront = idx >= 0 && idx < last;
        layerBtns[0].disabled = !atBack;
        layerBtns[1].disabled = !atBack;
        layerBtns[2].disabled = !atFront;
        layerBtns[3].disabled = !atFront;
        actionBtns.forEach((b) => { b.disabled = idx < 0; });
        const fillValue = selected ? selected.fillStyle : currentFillStyle;
        fillBtns.forEach((el, i) => el.toggleClass("is-active", fillStyles[i].value === fillValue));
        opacityInput.value = String(selected ? selected.opacity : currentOpacity);
      };
      syncSidebar();
    };
    /** The sidebar is rebuilt from scratch — tool extras show up or disappear. */
    const rebuildSidebar = () => {
      sidebar.empty();
      buildSidebar();
    };
    buildSidebar();

    // Shapes come from the sidecar; a missing or broken one just means "draw
    // again" — never a Notice, never a crash.
    void (async () => {
      try {
        if (!(await app.vault.adapter.exists(jsonPath))) return;
        const parsed = JSON.parse(await app.vault.adapter.read(jsonPath)) as AnnotatorFile;
        if (!parsed || !Array.isArray(parsed.shapes)) return;
        for (const raw of parsed.shapes) {
          const s = raw as Partial<Shape> & { color?: string; size?: number };
          if (!s || !Array.isArray(s.pts)) continue;
          // Old sidecars carry color/size/filled; normalise once so nothing
          // legacy is ever written back.
          const stroke = s.strokeColor ?? s.color ?? "#7c5cff";
          shapes.push({
            id: s.id || nextShapeId(),
            tool: s.tool ?? "pen",
            pts: s.pts.map((p) => ({ x: p.x, y: p.y })),
            strokeColor: stroke,
            backgroundColor: s.backgroundColor ?? (s.filled ? stroke : "transparent"),
            fillStyle: s.fillStyle ?? "solid",
            strokeWidth: s.strokeWidth ?? s.size ?? 4,
            strokeStyle: s.strokeStyle ?? "solid",
            opacity: s.opacity ?? 100,
            startArrowhead: s.startArrowhead,
            endArrowhead: s.endArrowhead,
            text: s.text,
            fontSize: s.fontSize,
          });
        }
        redraw();
      } catch (err) {
        console.error("[tradebook] could not read annotation sidecar", err);
      }
    })();

    const toCanvas = (e: MouseEvent): Pt => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left - view.x) / view.scale,
        y: (e.clientY - r.top - view.y) / view.scale,
      };
    };

    // Text is typed in a floating textarea, then baked into the canvas like
    // every other shape — no live text objects, no separate layer.
    const startText = (e: PointerEvent) => {
      const p = toCanvas(e);
      const cr = canvas.getBoundingClientRect();
      const ta = document.createElement("textarea");
      ta.className = "tj-anno-textinput";
      ta.style.position = "absolute";
      ta.style.left = `${e.clientX - cr.left}px`;
      ta.style.top = `${e.clientY - cr.top}px`;
      ta.style.minWidth = "80px";
      ta.style.minHeight = "24px";
      ta.style.padding = "2px 4px";
      ta.style.background = "rgba(0,0,0,0.6)";
      ta.style.color = currentStrokeColor;
      ta.style.border = "1px dashed currentColor";
      ta.style.outline = "none";
      ta.style.fontSize = "16px";
      ta.style.fontFamily = "inherit";
      ta.style.lineHeight = "1.2";
      ta.style.resize = "none";
      ta.style.zIndex = "10";
      ta.setAttribute("rows", "1");
      ta.removeAttribute("placeholder");
      wrap.appendChild(ta);
      // Focus after layout, or the browser fires blur immediately and the
      // commit path removes the textarea before a single key lands.
      requestAnimationFrame(() => ta.focus());
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const value = ta.value.trim();
        ta.remove();
        if (value) {
          shapes.push({
            id: nextShapeId(),
            tool: "text",
            pts: [p],
            strokeColor: currentStrokeColor,
            backgroundColor: currentBackgroundColor,
            fillStyle: currentFillStyle,
            strokeWidth: currentStrokeWidth,
            strokeStyle: currentStrokeStyle,
            opacity: currentOpacity,
            fontSize: 16,
            text: value,
          });
          redo.length = 0;
          redraw();
        }
      };
      const cancel = () => {
        if (done) return;
        done = true;
        ta.remove();
      };
      ta.addEventListener("blur", commit);
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancel(); }
      });
    };

    // ---- Selection: move, resize, delete ----
    const screenPoint = (e: PointerEvent): Pt => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const handleAt = (sp: Pt): string | null => {
      if (!selected) return null;
      for (const hp of handlePoints(screenBox(selected))) {
        if (Math.abs(hp.x - sp.x) <= 6 && Math.abs(hp.y - sp.y) <= 6) return hp.id;
      }
      return null;
    };

    const startMove = (e: PointerEvent, p: Pt, s: Shape) => {
      moving = true;
      moveStart = p;
      moveOrig = s.pts.map((q) => ({ ...q }));
      canvas.setPointerCapture(e.pointerId);
    };

    const startResize = (e: PointerEvent, handle: string, s: Shape) => {
      resizing = true;
      resizeHandle = handle;
      resizeOrigBox = bboxOf(s);
      resizeOrigPts = s.pts.map((q) => ({ ...q }));
      resizeOrigFont = s.fontSize ?? 16;
      canvas.setPointerCapture(e.pointerId);
    };

    const applyResize = (p: Pt) => {
      if (!selected) return;
      const axes = HANDLES[resizeHandle];
      let left = resizeOrigBox.x, right = resizeOrigBox.x + resizeOrigBox.w;
      let top = resizeOrigBox.y, bottom = resizeOrigBox.y + resizeOrigBox.h;
      if (axes.x === -1) left = p.x; else if (axes.x === 1) right = p.x;
      if (axes.y === -1) top = p.y; else if (axes.y === 1) bottom = p.y;
      const nx = Math.min(left, right);
      const ny = Math.min(top, bottom);
      const nw = Math.max(1, Math.abs(right - left));
      const nh = Math.max(1, Math.abs(bottom - top));
      if (selected.tool === "text") {
        const scale = resizeOrigBox.h !== 0 ? nh / resizeOrigBox.h : 1;
        selected.fontSize = Math.max(6, resizeOrigFont * scale);
        // The handle parks the badge corner; padding stays fixed at 8/6.
        selected.pts[0].x = nx + TEXT_PAD_X;
        selected.pts[0].y = ny + TEXT_PAD_Y;
        return;
      }
      const sx = resizeOrigBox.w !== 0 ? nw / resizeOrigBox.w : 1;
      const sy = resizeOrigBox.h !== 0 ? nh / resizeOrigBox.h : 1;
      selected.pts.forEach((q, i) => {
        q.x = nx + (resizeOrigPts[i].x - resizeOrigBox.x) * sx;
        q.y = ny + (resizeOrigPts[i].y - resizeOrigBox.y) * sy;
      });
    };

    const selectPointerDown = (e: PointerEvent) => {
      const sp = screenPoint(e);
      const p = toCanvas(e);
      if (selected) {
        const handle = handleAt(sp);
        if (handle) { startResize(e, handle, selected); return; }
        if (insideBox(p, bboxOf(selected))) { startMove(e, p, selected); return; }
      }
      const hit = topShapeAt(p);
      if (hit) {
        selected = hit;
        startMove(e, p, hit);
      } else {
        selected = null;
      }
      redraw();
      rebuildSidebar();
    };

    const updateHover = (sp: Pt) => {
      let cur = "default";
      if (selected) {
        const handle = handleAt(sp);
        if (handle) cur = handleCursor(handle);
        else if (insideBox(toCanvasFrom(sp), bboxOf(selected))) cur = "move";
      }
      hoverCursor = cur;
      updateCursor();
    };
    const toCanvasFrom = (sp: Pt): Pt => ({ x: (sp.x - view.x) / view.scale, y: (sp.y - view.y) / view.scale });

    /** Which point-editing handle (if any) sits under the pointer. */
    const pointHandleAt = (p: Pt): { kind: "point" | "mid"; index: number } | null => {
      if (!editingPoints || !editingShape) return null;
      const th = 8 / view.scale;
      const pts = editingShape.pts;
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(p.x - pts[i].x, p.y - pts[i].y) <= th) return { kind: "point", index: i };
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        if (Math.hypot(p.x - mx, p.y - my) <= th) return { kind: "mid", index: i };
      }
      return null;
    };

    canvas.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(0.1, Math.min(8, view.scale * factor));
      view.x = px - (px - view.x) * (newScale / view.scale);
      view.y = py - (py - view.y) * (newScale / view.scale);
      view.scale = newScale;
      redraw();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
      if (spaceDown || e.button === 1) {
        e.preventDefault();
        panning = true;
        panStart = { x: e.clientX, y: e.clientY };
        viewStart = { x: view.x, y: view.y };
        canvas.setPointerCapture(e.pointerId);
        updateCursor();
        return;
      }
      if (editingPoints && editingShape) {
        const p = toCanvas(e);
        const handle = pointHandleAt(p);
        if (handle) {
          if (handle.kind === "point") {
            draggingHandle = { index: handle.index };
          } else {
            // Grabbing a midpoint inserts the point, which then follows the pointer.
            const pts = editingShape.pts;
            const mid = {
              x: (pts[handle.index].x + pts[handle.index + 1].x) / 2,
              y: (pts[handle.index].y + pts[handle.index + 1].y) / 2,
            };
            pts.splice(handle.index + 1, 0, mid);
            draggingHandle = { index: handle.index + 1 };
            redraw();
          }
          dragOrigPt = { ...editingShape.pts[draggingHandle.index] };
          moveStart = p;
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        if (!insideBox(p, bboxOf(editingShape))) {
          // Click outside the shape and its handles: leave edit mode.
          exitPointEdit();
          redraw();
        } else if (tool === "select") {
          // Handles are live — the whole shape must not slide with them.
          return;
        }
      }
      if (tool === "select") {
        selectPointerDown(e);
        return;
      }
      if (tool === "eraser") {
        const hit = topShapeAt(toCanvas(e));
        if (hit) {
          const idx = shapes.indexOf(hit);
          if (idx >= 0) {
            shapes.splice(idx, 1);
            redo.push(hit);
          }
          if (selected === hit) selected = null;
          if (editingShape === hit) exitPointEdit();
          redraw();
          syncSidebar();
        }
        return;
      }
      if (selected) { selected = null; redraw(); }
      if (tool === "text") {
        startText(e);
        return;
      }
      const p = toCanvas(e);
      drawing = true;
      current = {
        id: nextShapeId(),
        tool,
        pts: [p],
        strokeColor: currentStrokeColor,
        backgroundColor: currentBackgroundColor,
        fillStyle: currentFillStyle,
        strokeWidth: currentStrokeWidth,
        strokeStyle: currentStrokeStyle,
        opacity: currentOpacity,
        ...(tool === "arrow"
          ? {
              startArrowhead: currentStartArrowhead,
              endArrowhead: currentEndArrowhead,
            }
          : {}),
      };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (panning) {
        view.x = viewStart.x + (e.clientX - panStart.x);
        view.y = viewStart.y + (e.clientY - panStart.y);
        redraw();
        return;
      }
      if (draggingHandle && editingShape) {
        const p = toCanvas(e);
        const pt = editingShape.pts[draggingHandle.index];
        if (pt) {
          pt.x = dragOrigPt.x + (p.x - moveStart.x);
          pt.y = dragOrigPt.y + (p.y - moveStart.y);
          redraw();
        }
        return;
      }
      if (moving && selected) {
        const p = toCanvas(e);
        const dx = p.x - moveStart.x, dy = p.y - moveStart.y;
        selected.pts.forEach((q, i) => {
          q.x = moveOrig[i].x + dx;
          q.y = moveOrig[i].y + dy;
        });
        redraw();
        return;
      }
      if (resizing) {
        applyResize(toCanvas(e));
        redraw();
        return;
      }
      if (!drawing || !current) {
        if (tool === "select") updateHover(screenPoint(e));
        return;
      }
      const p = toCanvas(e);
      if (tool === "pen") current.pts.push(p);
      else current.pts[1] = p;
      redraw();
    });
    const endDraw = () => {
      if (draggingHandle) {
        draggingHandle = null;
        return;
      }
      if (panning) {
        panning = false;
        updateCursor();
        return;
      }
      if (moving) { moving = false; return; }
      if (resizing) { resizing = false; return; }
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

    canvas.addEventListener("dblclick", (e) => {
      const p = toCanvas(e);
      if (editingPoints && editingShape) {
        // Double-click removes an intermediate point; endpoints stay.
        const handle = pointHandleAt(p);
        if (handle && handle.kind === "point" && handle.index > 0 && handle.index < editingShape.pts.length - 1) {
          editingShape.pts.splice(handle.index, 1);
          redraw();
        }
        return;
      }
      const hit = topShapeAt(p);
      if (hit && canEditPoints(hit)) {
        selected = hit;
        editingPoints = true;
        editingShape = hit;
        redraw();
        syncSidebar();
      }
    });

    const doUndo = () => {
      const s = shapes.pop();
      if (s) {
        redo.push(s);
        if (selected === s) selected = null;
        if (editingShape === s) exitPointEdit();
        redraw();
        syncSidebar();
      }
    };
    const doRedo = () => {
      const s = redo.pop();
      if (s) {
        shapes.push(s);
        redraw();
        syncSidebar();
      }
    };
    const duplicateSelected = () => {
      if (!selected) return;
      const clone: Shape = {
        ...selected,
        id: nextShapeId(),
        pts: selected.pts.map((q) => ({ x: q.x + 16, y: q.y + 16 })),
      };
      shapes.push(clone);
      redo.length = 0;
      selected = clone;
      redraw();
      syncSidebar();
    };
    const deleteSelected = () => {
      if (!selected) return;
      const idx = shapes.indexOf(selected);
      if (idx < 0) return;
      shapes.splice(idx, 1);
      redo.push(selected);
      if (editingShape === selected) exitPointEdit();
      selected = null;
      redraw();
      syncSidebar();
    };
    const moveLayer = (dir: 1 | -1) => {
      if (!selected) return;
      const i = shapes.indexOf(selected);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= shapes.length) return;
      shapes.splice(i, 1);
      shapes.splice(j, 0, selected);
      redraw();
      syncSidebar();
    };
    const sendToBack = () => {
      if (!selected) return;
      const i = shapes.indexOf(selected);
      if (i <= 0) return;
      shapes.splice(i, 1);
      shapes.unshift(selected);
      redraw();
      syncSidebar();
    };
    const bringToFront = () => {
      if (!selected) return;
      const i = shapes.indexOf(selected);
      if (i < 0 || i >= shapes.length - 1) return;
      shapes.splice(i, 1);
      shapes.push(selected);
      redraw();
      syncSidebar();
    };

    undoB.addEventListener("click", doUndo);
    redoB.addEventListener("click", doRedo);
    fitB.addEventListener("click", () => {
      fitToView();
      redraw();
    });
    resetB.addEventListener("click", () => {
      shapes.length = 0;
      redo.length = 0;
      selected = null;
      exitPointEdit();
      redraw();
      syncSidebar();
    });
    cancelB.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    // Export at the print's own resolution, not the zoomed viewport, so the
    // saved file stays the whole chart — the view is only how we look at it.
    const exportBlob = (): Promise<Blob | null> => {
      const out = document.createElement("canvas");
      out.width = img.naturalWidth;
      out.height = img.naturalHeight;
      const c = out.getContext("2d")!;
      c.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
      for (const s of shapes) drawShape(s, c);
      return new Promise((res) => out.toBlob((b) => res(b), "image/png"));
    };

    saveB.addEventListener("click", async () => {
      saveB.setAttr("disabled", "true");
      try {
        const payload: AnnotatorFile = { version: 1, shapes };
        await app.vault.adapter.write(jsonPath, JSON.stringify(payload, null, 2));

        const blob: Blob | null = await exportBlob();
        if (!blob) {
          new Notice("Could not export the annotated image.");
          return;
        }
        const data = await blob.arrayBuffer();
        const existing = app.vault.getAbstractFileByPath(annotatedPath);
        if (existing instanceof TFile) await app.vault.modifyBinary(existing, data);
        else await app.vault.createBinary(annotatedPath, data);

        new Notice("Print annotated and saved.");
        onSaved?.(annotatedPath.split("/").pop() as string);
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
