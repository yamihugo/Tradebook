/**
 * chartKit — the small set of chart shapes the journal reuses.
 *
 * Pure-ish and DOM-in: an adapter in a widget computes the values, the shape
 * renders them. Shapes:
 *   - continuous bar (one horizontal track, segments coloured by result)
 *   - treemap        (tiles sized by activity, coloured by result)
 *   - dumbbell       (before → after, per-row scale)
 *   - arc gauge      (a ring with an optional inner label)
 *   - ribbon         (ordered sequence of up/down marks)
 *
 * NO VERTICAL BARS: performance-by-X widgets use a continuous bar or a treemap.
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

// ---------------------------------------------------------- continuous bar

export interface ContinuousSegment {
  key: string;
  /** Label shown under the segment (when `showLabels`). */
  label: string;
  /** Signed value; drives the colour, and the width when no `weightOf`. */
  value: number;
  tone?: "pos" | "mid" | "neg" | "neutral";
  tip?: { title: string; value?: string; sub?: string };
}

export interface ContinuousBarSpec {
  segments: ContinuousSegment[];
  /** Segment width. Default: equal widths (a timeline). Use |value| to size by result. */
  weightOf?: (s: ContinuousSegment) => number;
  className?: string;
  /** Render a label row aligned under the track. */
  showLabels?: boolean;
}

/**
 * One horizontal track split into proportional segments — the Journalit
 * "continuous bar". Never vertical. Returns the root element.
 */
export function renderContinuousBar(host: HTMLElement, spec: ContinuousBarSpec): HTMLElement {
  const wrap = host.createDiv({ cls: "tj-cbar" + (spec.className ? " " + spec.className : "") });
  const track = wrap.createDiv({ cls: "tj-cbar-track" });
  const weightOf = (s: ContinuousSegment): number => Math.max(1, spec.weightOf ? spec.weightOf(s) : 1);

  for (const s of spec.segments) {
    const tone = s.tone ?? (s.value >= 0 ? "pos" : "neg");
    const seg = track.createDiv({ cls: "tj-cbar-seg " + tone });
    seg.style.flex = `${weightOf(s)} 1 0`;
    if (s.tip) attachTip(seg, s.tip);
  }

  if (spec.showLabels) {
    const labels = wrap.createDiv({ cls: "tj-cbar-labels" });
    for (const s of spec.segments) {
      const l = labels.createSpan({ cls: "tj-cbar-label", text: s.label });
      l.style.flex = `${weightOf(s)} 1 0`;
    }
  }
  return wrap;
}

// --------------------------------------------------------------- status row

export type StatusState = "ok" | "warn" | "bad" | "neutral";

export interface StatusItem {
  key: string;
  label: string;
  state: StatusState;
  tip?: { title: string; value?: string; sub?: string };
}

export interface StatusRowSpec {
  items: StatusItem[];
  className?: string;
  /** Render a label row under the squares. Default true. */
  showLabels?: boolean;
}

/**
 * Small separate squares, one colour each, by task state (ok / warn / bad /
 * neutral), with labels below. A pass/fail checklist — not a bar. Returns the
 * root element.
 */
export function renderStatusRow(host: HTMLElement, spec: StatusRowSpec): HTMLElement {
  const wrap = host.createDiv({ cls: "tj-statusrow" + (spec.className ? " " + spec.className : "") });
  for (const it of spec.items) {
    const item = wrap.createDiv({ cls: "tj-status-item" });
    const sq = item.createDiv({ cls: "tj-status-square " + it.state });
    if (it.tip) attachTip(sq, it.tip);
    if (spec.showLabels !== false) item.createDiv({ cls: "tj-status-label", text: it.label });
  }
  return wrap;
}

// ------------------------------------------------------------------ treemap

export interface TreemapTile {
  key: string;
  label: string;
  /** Net result — drives the colour and the value text. */
  net: number;
  /** Activity — drives the tile width. */
  count: number;
  wins: number;
  tip?: { title: string; value?: string; sub?: string };
}

export interface TreemapSpec {
  tiles: TreemapTile[];
  className?: string;
  /** Tiles beyond this are merged into "Other". Default 6. */
  maxTiles?: number;
  formatMoney?: (v: number) => string;
}

/**
 * Activity-sized tiles coloured by result (the account page's treemap, lifted
 * here so every breakdown shares one implementation). Returns the root element.
 */
export function renderTreemap(host: HTMLElement, spec: TreemapSpec): HTMLElement {
  const maxTiles = spec.maxTiles ?? 6;
  const fmt = spec.formatMoney ?? ((v: number) => String(v));
  const wrap = host.createDiv({ cls: "tj-treemap" + (spec.className ? " " + spec.className : "") });

  let tiles = spec.tiles;
  if (tiles.length > maxTiles) {
    const head = tiles.slice(0, maxTiles);
    const rest = tiles.slice(maxTiles);
    const merged = rest.reduce(
      (a, t) => ({ key: "other", label: "Other", net: a.net + t.net, count: a.count + t.count, wins: a.wins + t.wins }),
      { key: "other", label: "Other", net: 0, count: 0, wins: 0 }
    );
    tiles = [...head, merged];
  }

  const maxAbs = Math.max(...tiles.map((t) => Math.abs(t.net)), 1);
  const total = tiles.reduce((a, t) => a + t.count, 0) || 1;

  for (const t of tiles) {
    const tile = wrap.createDiv({ cls: "tj-treemap-tile" });
    tile.style.flex = `${Math.max(1, t.count)} 1 0`;
    const good = t.net >= 0;
    const strength = 0.14 + (Math.abs(t.net) / maxAbs) * 0.34;
    tile.style.background = good
      ? `linear-gradient(160deg, rgba(52,209,122,${strength.toFixed(2)}), rgba(34,122,74,${(strength * 0.5).toFixed(2)}))`
      : `linear-gradient(160deg, rgba(255,93,72,${strength.toFixed(2)}), rgba(143,43,30,${(strength * 0.5).toFixed(2)}))`;
    tile.createDiv({ cls: "tj-treemap-t", text: t.label });
    tile.createDiv({ cls: "tj-treemap-v " + (good ? "tj-pos" : "tj-neg"), text: fmt(t.net) });
    tile.createDiv({ cls: "tj-treemap-w", text: `${t.count ? Math.round((t.wins / t.count) * 100) : 0}% win` });
    attachTip(
      tile,
      t.tip ?? {
        title: t.label,
        value: fmt(t.net),
        sub: `${t.count} trades (${Math.round((t.count / total) * 100)}% of activity)`,
      }
    );
  }
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
  (window as any).__tjChartKit = { renderGauge, renderContinuousBar, renderStatusRow, renderTreemap, renderDumbbell, renderRibbon };
}
