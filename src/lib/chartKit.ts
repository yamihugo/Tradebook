/**
 * chartKit — the small set of chart shapes the journal reuses.
 *
 * Pure-ish and DOM-in: an adapter in a widget computes the values, the shape
 * renders them. Four shapes cover the Home/Dashboard widgets:
 *   - bar row   (bucket → value, optional stacked overlay)
 *   - dumbbell  (before → after, per-row scale)
 *   - arc gauge (a ring with an optional inner label)
 *   - ribbon    (ordered sequence of up/down marks)
 *
 * No styling lives here beyond class names; the CSS is owned by styles.css and
 * added with the widget that first uses the shape.
 */

import { attachTip } from "./tip";

const SVG_NS = "http://www.w3.org/2000/svg";

// ------------------------------------------------------------------ arc gauge

export interface GaugeSpec {
  /** 0..100. */
  pct: number;
  /** CSS color or custom-property value; default `--interactive-accent`. */
  color?: string;
  /** Big inner label. */
  label?: string;
  /** Small inner sub-label. */
  sublabel?: string;
  /** viewBox size; default 130. */
  size?: number;
  /** Circle radius; default 52. */
  radius?: number;
  /** Ring stroke width; default 9. */
  stroke?: number;
  /** Extra class on the root. */
  className?: string;
  /** Extra class on the <svg>. */
  svgClassName?: string;
  /** Animate the arc from 0 to `pct`. */
  animate?: boolean;
  durationMs?: number;
}

/** A ring gauge with an optional inner label. Returns the root element. */
export function renderGauge(host: HTMLElement, spec: GaugeSpec): HTMLElement {
  const size = spec.size ?? 130;
  const radius = spec.radius ?? 52;
  const stroke = spec.stroke ?? 9;
  const c = size / 2;
  const root = host.createDiv({ cls: "tj-arc" + (spec.className ? " " + spec.className : "") });
  root.style.setProperty("--tj-arc-color", spec.color ?? "var(--interactive-accent)");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "tj-arc-svg" + (spec.svgClassName ? " " + spec.svgClassName : ""));

  const circle = (cls: string): SVGCircleElement => {
    const el = document.createElementNS(SVG_NS, "circle");
    el.setAttribute("cx", String(c));
    el.setAttribute("cy", String(c));
    el.setAttribute("r", String(radius));
    el.setAttribute("fill", "none");
    el.setAttribute("stroke-width", String(stroke));
    el.setAttribute("class", cls);
    return el;
  };

  const track = circle("tj-arc-track");
  const fill = circle("tj-arc-fill");
  fill.setAttribute("stroke-linecap", "round");
  fill.setAttribute("pathLength", "100");
  fill.setAttribute("transform", `rotate(-90 ${c} ${c})`);

  const clampPct = (p: number): number => Math.max(0, Math.min(100, p));
  const setPct = (p: number): void => fill.setAttribute("stroke-dasharray", `${clampPct(p)} 100`);
  setPct(spec.pct);

  svg.appendChild(track);
  svg.appendChild(fill);
  root.appendChild(svg as unknown as Node);

  if (spec.label !== undefined || spec.sublabel !== undefined) {
    const num = root.createDiv({ cls: "tj-arc-num" });
    if (spec.label !== undefined) num.createSpan({ cls: "tj-arc-big", text: spec.label });
    if (spec.sublabel !== undefined) num.createSpan({ cls: "tj-arc-small", text: spec.sublabel });
  }

  if (spec.animate) {
    const dur = spec.durationMs ?? 800;
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setPct(spec.pct * e);
      if (t < 1) requestAnimationFrame(step);
      else setPct(spec.pct);
    };
    requestAnimationFrame(step);
  }

  return root;
}

// ------------------------------------------------------------------- bar row

export interface BarRowItem {
  key: string;
  /** Axis label under the column. */
  label: string;
  /** Signed value; the magnitude drives the bar height. */
  value: number;
  /** Optional stacked overlay as a 0..1 fraction of the bar (e.g. win rate). */
  overlay?: number;
  tone?: "pos" | "mid" | "neg" | "neutral";
  /** Tooltip shown on hover. */
  tip?: { title: string; value?: string; sub?: string };
  /** Draw an empty slot (no data at this bucket). */
  empty?: boolean;
}

export interface BarRowSpec {
  items: BarRowItem[];
  /** Magnitude the tallest bar maps to; default = max |value|. */
  max?: number;
  className?: string;
  /** Show every Nth axis label; default picks ~5 labels. */
  axisEvery?: number;
}

/** A row of vertical bars with an optional stacked overlay. Returns the root. */
export function renderBarRow(host: HTMLElement, spec: BarRowSpec): HTMLElement {
  const max = spec.max ?? Math.max(...spec.items.map((i) => Math.abs(i.value)), 1);
  const every = spec.axisEvery ?? Math.max(1, Math.ceil(spec.items.length / 5));
  const wrap = host.createDiv({ cls: "tj-barrow" + (spec.className ? " " + spec.className : "") });
  const track = wrap.createDiv({ cls: "tj-barrow-track" });
  const labels = wrap.createDiv({ cls: "tj-barrow-axis" });

  spec.items.forEach((it, i) => {
    const col = track.createDiv({ cls: "tj-barrow-col" });
    const tone = it.tone ?? (it.value >= 0 ? "pos" : "neg");
    const bar = col.createEl("i", { cls: "tj-barrow-bar " + tone });
    if (it.empty || it.value === 0) {
      bar.addClass("is-empty");
      bar.style.height = "0%";
    } else {
      bar.style.height = `${Math.max(2, (Math.abs(it.value) / max) * 100)}%`;
    }
    if (it.overlay !== undefined) {
      const ov = bar.createEl("b", { cls: "tj-barrow-overlay" });
      ov.style.height = `${Math.max(0, Math.min(1, it.overlay)) * 100}%`;
    }
    if (it.tip) attachTip(col, it.tip);
    labels.createSpan({
      cls: "tj-barrow-tick",
      text: i % every === 0 || i === spec.items.length - 1 ? it.label : "",
    });
  });

  return wrap;
}

// ------------------------------------------------------------------ dumbbell

export interface DumbbellRow {
  key: string;
  label: string;
  before: number | null;
  after: number | null;
  /** `true` = improvement, `false` = decline, `null` = neutral/unknown. */
  better: boolean | null;
  format: (v: number) => string;
  /** Pre-formatted delta chip (e.g. "↑ +0.42R"). */
  deltaText?: string;
  /** Coverage reason shown when a side is missing. */
  note?: string;
}

export interface DumbbellSpec {
  rows: DumbbellRow[];
  /** Shared scale bounds. Ignored when `perRowScale` is true (the default). */
  min?: number;
  max?: number;
  /** Scale each row to its own min/max; default true. */
  perRowScale?: boolean;
  className?: string;
}

/** Before → after dumbbells, one row per metric. Returns the root. */
export function renderDumbbell(host: HTMLElement, spec: DumbbellSpec): HTMLElement {
  const perRow = spec.perRowScale !== false;
  const wrap = host.createDiv({ cls: "tj-dumbbell" + (spec.className ? " " + spec.className : "") });

  for (const row of spec.rows) {
    const line = wrap.createDiv({ cls: "tj-dumbbell-row" });
    line.createDiv({ cls: "tj-dumbbell-label", text: row.label });
    const track = line.createDiv({ cls: "tj-dumbbell-track" });

    if (row.before === null && row.after === null) {
      track.createDiv({ cls: "tj-dumbbell-empty", text: row.note ?? "—" });
      continue;
    }

    const values = [row.before, row.after].filter((v): v is number => v !== null);
    const lo = !perRow && spec.min !== undefined ? spec.min : Math.min(...values);
    const hi = !perRow && spec.max !== undefined ? spec.max : Math.max(...values);
    const span = hi - lo || 1;
    const pos = (v: number): number => ((v - lo) / span) * 100;

    if (row.before !== null && row.after !== null) {
      const a = Math.min(pos(row.before), pos(row.after));
      const b = Math.max(pos(row.before), pos(row.after));
      const verdict = row.better === true ? "is-better" : row.better === false ? "is-worse" : "";
      const seg = track.createDiv({ cls: "tj-dumbbell-line " + verdict });
      seg.style.left = `${a}%`;
      seg.style.width = `${b - a}%`;
    }
    if (row.before !== null) {
      const dot = track.createDiv({ cls: "tj-dumbbell-dot is-before" });
      dot.style.left = `${pos(row.before)}%`;
    }
    if (row.after !== null) {
      const dot = track.createDiv({ cls: "tj-dumbbell-dot is-after" });
      dot.style.left = `${pos(row.after)}%`;
    }

    if (row.deltaText) {
      const verdict = row.better === true ? "is-better" : row.better === false ? "is-worse" : "";
      line.createDiv({ cls: "tj-dumbbell-delta " + verdict, text: row.deltaText });
    }
    if (row.note) line.createDiv({ cls: "tj-dumbbell-note", text: row.note });
  }

  return wrap;
}

// -------------------------------------------------------------------- ribbon

export interface RibbonItem {
  key: string;
  /** Positive = win, negative = loss, 0 = break-even. */
  result: number;
  tip?: { title: string; sub?: string };
}

export interface RibbonSpec {
  items: RibbonItem[];
  className?: string;
}

/** An ordered W/L ribbon, oldest to newest. Returns the root. */
export function renderRibbon(host: HTMLElement, spec: RibbonSpec): HTMLElement {
  const wrap = host.createDiv({ cls: "tj-ribbon" + (spec.className ? " " + spec.className : "") });
  for (const it of spec.items) {
    const tone = it.result > 0 ? "pos" : it.result < 0 ? "neg" : "flat";
    const mark = wrap.createEl("i", { cls: "tj-ribbon-mark " + tone });
    if (it.tip) attachTip(mark, it.tip);
  }
  return wrap;
}

// Test hook, same pattern as the other pure-ish modules.
if (typeof window !== "undefined") {
  (window as any).__tjChartKit = { renderGauge, renderBarRow, renderDumbbell, renderRibbon };
}
