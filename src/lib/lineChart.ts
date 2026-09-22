/**
 * Shared line/area chart used by the Home dashboard and the Accounts page.
 * One implementation ⇒ identical colours, axis, date bar and hover everywhere.
 */

import { fmtMoney2 } from "../tz";
import { attachTip } from "./tip";

export interface SecondarySeries {
  values: number[];
  color: string;
  label?: string;
  /** Stroke width in px (default 1.4). */
  width?: number;
  /** Dashed line (used for grouped/projection series). */
  dash?: boolean;
}

/** A dot pinned on the curve — used for deposits and payouts. */
export interface ChartMarker {
  index: number;
  kind: "in" | "out";
  title: string;
}

export interface LineChartOpts {
  values: number[];
  /** ISO date per point (same length as values). */
  dates: string[];
  /** Animation state key (one per logical chart). */
  key: string;
  format?: string;
  showDates?: boolean;
  animations?: boolean;
  secondary?: SecondarySeries[];
  /** Reference line (defaults to 0). The area is green above it, red below,
   *  and the y-axis is centred on it — used for "account value" charts. */
  baseline?: number;
  /** Explicit dashed zero/reference line at a value (even when `fadeFloor`
   *  is set). For a prop account this draws the baseline (account value) while
   *  the fade is anchored to the same level — green above it, red below. */
  baseLine?: number;
  /** Horizontal dashed line (e.g. profit target), in value units. */
  targetLine?: number;
  /** Per-point trailing drawdown level (dashed line that trails the peak). */
  ddLine?: number[];
  /** Value the area fade is anchored to (defaults to the baseline). For a prop
   *  account this is the drawdown floor: green above it, red below. */
  fadeFloor?: number;
  /** Per-point daily delta — used to colour the day dots. */
  dayDeltas?: number[];
  /** Days money moved for a reason that is neither a win nor a loss. A payout
   *  keeps the gold, a deposit reads green, and a fee correction is a cost and
   *  stays muted — only a payout is cash leaving on purpose. */
  dayCash?: Array<{ index: number; kind: "out" | "in" | "cost" }>;
  /** Extra lines for the hover card: [label, value, tone]. */
  hoverLines?: (i: number) => Array<[string, string, string]>;
  /** Inline stroke for the primary line (overrides the default accent). */
  lineColor?: string;
  /** Primary stroke width in px. */
  lineWidth?: number;
  /** Draw lines only — hides the gradient area fill. */
  hideArea?: boolean;
  /** Dots pinned on the curve (deposits / payouts). */
  markers?: ChartMarker[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prevMap = new Map<string, number[]>();

/** Single shared floating tooltip (appended to body so `position: fixed`
 *  is always relative to the viewport, never to a transformed ancestor). */
let globalChartTip: HTMLElement | null = null;
function getGlobalChartTip(): HTMLElement {
  if (!globalChartTip || !globalChartTip.isConnected) {
    globalChartTip = document.createElement("div");
    globalChartTip.id = "tj-eq-global-tip";
    globalChartTip.className = "tj-eq-chart-tip";
    globalChartTip.style.display = "none";
    document.body.appendChild(globalChartTip);
  }
  return globalChartTip;
}

interface EqCardRefs {
  el: HTMLElement;
  val: HTMLElement;
  date: HTMLElement;
  extra: HTMLElement;
}
let globalEqCard: EqCardRefs | null = null;
/** Shared equity hover card. Lives on <body> with `position: fixed`, so a
 *  widget's `overflow: hidden` can never clip it. */
function getGlobalEqCard(): EqCardRefs {
  if (!globalEqCard || !globalEqCard.el.isConnected) {
    const el = document.createElement("div");
    el.className = "tj-eq-card";
    el.style.position = "fixed";
    el.style.zIndex = "1000";
    el.style.display = "none";
    const val = document.createElement("div");
    val.className = "tj-eq-card-val";
    const date = document.createElement("div");
    date.className = "tj-eq-card-date";
    const extra = document.createElement("div");
    extra.className = "tj-eq-extra";
    el.append(val, date, extra);
    document.body.appendChild(el);
    globalEqCard = { el, val, date, extra };
  }
  return globalEqCard;
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const raw = span / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (min <= 0 && max >= 0 && !out.some((t) => Math.abs(t) < 1e-9)) out.push(0);
  return out.sort((a, b) => a - b);
}

/** Catmull-Rom smoothing with clamped control points (never overshoots the plot). */
export function smoothPath(pts: { x: number; y: number }[], yMin = -Infinity, yMax = Infinity): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  const cy = (v: number) => Math.max(yMin, Math.min(yMax, v));
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = cy(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = cy(p2.y - (p3.y - p1.y) / 6);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function resampleSeries(prev: number[], n: number): number[] {
  if (prev.length === n) return prev.slice();
  if (prev.length === 0) return new Array(n).fill(0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / Math.max(1, n - 1)) * (prev.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(prev.length - 1, lo + 1);
    out.push(prev[lo] + (prev[hi] - prev[lo]) * (t - lo));
  }
  return out;
}

function seriesEqual(a: number[] | null, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  return true;
}

const NS = "http://www.w3.org/2000/svg";
function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

export function renderLineChart(container: HTMLElement, opts: LineChartOpts): void {
  const { values, dates } = opts;
  if (!values.length) return;
  if (globalChartTip) globalChartTip.style.display = "none";
  const w = container.clientWidth || 520;
  const h = container.clientHeight || 170;

  const fmtDay = (iso: string) => {
    const [yy, mm, dd] = (iso || "").split("-");
    const mi = parseInt(mm, 10) - 1;
    if (!yy || Number.isNaN(mi) || !dd) return iso || "";
    return `${parseInt(dd, 10)} ${MONTHS[mi] ?? ""}`.trim();
  };

  const secondary = opts.secondary ?? [];
  const base = opts.baseline ?? 0;
  const allVals = [
    ...values,
    ...secondary.flatMap((s) => s.values),
    ...(opts.ddLine ?? []),
    base,
    ...(opts.baseLine !== undefined ? [opts.baseLine] : []),
    ...(opts.targetLine !== undefined ? [opts.targetLine] : []),
  ];
  const finite = allVals.filter((v) => Number.isFinite(v));
  if (!finite.length) return; // nothing plottable
  let maxV = finite.reduce((a, v) => (v > a ? v : a), -Infinity);
  let minV = finite.reduce((a, v) => (v < a ? v : a), Infinity);
  // Tight range: expand 2% so reference lines sit near the edges
  const pad = (maxV - minV || 1) * 0.02;
  minV -= pad;
  maxV += pad;

  const showY = h >= 84 && w >= 140;
  const showX = opts.showDates !== false && h >= 74 && w >= 150 && values.length > 1;
  const padL = showY ? 38 : 8;
  const padR = 24;
  const padT = 10;
  const padB = showX ? 15 : 6;
  const plotW = Math.max(10, w - padL - padR);
  const topY = padT;
  const botY = h - padB;

  const range = maxV - minV || 1;
  const lo = minV;
  const x = (i: number) => padL + (i / Math.max(1, values.length - 1)) * plotW;
  const y = (v: number) => topY + (1 - (v - lo) / range) * (botY - topY);
  const splitVal = opts.fadeFloor !== undefined ? opts.fadeFloor : base;
  const zy = y(splitVal);

  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", class: "tj-eq-svg" });
  const id = "eqg" + Math.random().toString(36).slice(2, 7);
  const defs = svgEl("defs", {});
  svg.appendChild(defs);

  const gUp = svgEl("linearGradient", { id: id + "up", gradientUnits: "userSpaceOnUse", x1: "0", y1: String(topY), x2: "0", y2: String(zy) });
  gUp.appendChild(svgEl("stop", { offset: "0%", class: "tj-eq-grad-up", "stop-opacity": "0.45" }));
  gUp.appendChild(svgEl("stop", { offset: "40%", class: "tj-eq-grad-up", "stop-opacity": "0.24" }));
  gUp.appendChild(svgEl("stop", { offset: "100%", class: "tj-eq-grad-up", "stop-opacity": "0" }));
  defs.appendChild(gUp);

  const gDn = svgEl("linearGradient", { id: id + "dn", gradientUnits: "userSpaceOnUse", x1: "0", y1: String(zy), x2: "0", y2: String(botY) });
  gDn.appendChild(svgEl("stop", { offset: "0%", class: "tj-eq-grad-dn", "stop-opacity": "0" }));
  gDn.appendChild(svgEl("stop", { offset: "60%", class: "tj-eq-grad-dn", "stop-opacity": "0.24" }));
  gDn.appendChild(svgEl("stop", { offset: "100%", class: "tj-eq-grad-dn", "stop-opacity": "0.45" }));
  defs.appendChild(gDn);

  const cUp = svgEl("clipPath", { id: id + "cu" });
  cUp.appendChild(svgEl("rect", { x: "0", y: "0", width: String(w), height: String(Math.max(0, zy)) }));
  defs.appendChild(cUp);
  const cDn = svgEl("clipPath", { id: id + "cd" });
  cDn.appendChild(svgEl("rect", { x: "0", y: String(zy), width: String(w), height: String(Math.max(0, h - zy)) }));
  defs.appendChild(cDn);

  const aUp = svgEl("path", { class: "tj-eq-area", fill: `url(#${id}up)`, "clip-path": `url(#${id}cu)` });
  const aDn = svgEl("path", { class: "tj-eq-area", fill: `url(#${id}dn)`, "clip-path": `url(#${id}cd)` });
  svg.appendChild(aUp);
  svg.appendChild(aDn);
  if (opts.hideArea) {
    aUp.style.display = "none";
    aDn.style.display = "none";
  }

  // Dashed reference line on the baseline (account value). Always drawn when
  // explicitly provided via baseLine, regardless of fadeFloor — this ensures
  // the "green above / red below" split is always readable.
  const zeroVal = opts.baseLine !== undefined ? opts.baseLine : base;
  const showZero = opts.baseLine !== undefined
    ? true // always show when the caller specifies a baseline
    : opts.fadeFloor === undefined && minV <= base && maxV >= base;
  if (showZero) {
    const zy0 = y(zeroVal);
    svg.appendChild(svgEl("line", { x1: String(padL), x2: String(w - padR), y1: String(zy0), y2: String(zy0), class: "tj-eq-zero" }));
  }

  // profit target + trailing drawdown levels (dashed reference lines)
  if (opts.targetLine !== undefined) {
    const ty = y(opts.targetLine);
    if (ty >= topY - 1 && ty <= botY + 1) {
      svg.appendChild(svgEl("line", { x1: String(padL), x2: String(w - padR), y1: String(ty), y2: String(ty), class: "tj-eq-target" }));
      if (w > 200) {
        const t = svgEl("text", {
          x: String(w - padR - 4),
          y: String(Math.max(topY + 8, ty - 4)),
          "text-anchor": "end",
          class: "tj-eq-reflabel",
          fill: "var(--tj-tone-good)",
        });
        t.textContent = "Target";
        svg.appendChild(t);
      }
    }
  }
  if (opts.ddLine && opts.ddLine.length === values.length) {
    svg.appendChild(
      svgEl("path", {
        d: opts.ddLine.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "),
        class: "tj-eq-ddline",
        fill: "none",
      })
    );
    if (w > 200) {
      const li = values.length - 1;
      const ddVal = opts.ddLine![li];
      const ddDiff = values[li] - ddVal;
      const t = svgEl("text", {
        x: String(w - padR - 4),
        y: String(botY - 4),
        "text-anchor": "end",
        class: "tj-eq-reflabel tj-eq-ddlabel",
        fill: "var(--tj-tone-bad)",
      });
      t.textContent = "Drawdown level";
      // Hover tooltip on the label
      t.addEventListener("mouseenter", (e: MouseEvent) => {
        const ddDiff = values[li] - ddVal;
        chartTip.empty();
        chartTip.createDiv({ cls: "tj-eq-tip-label", text: "Drawdown level" });
        chartTip.createDiv({ cls: "tj-eq-tip-value tj-eq-tip-dd", text: fmtMoney2(ddVal) });
        chartTip.createDiv({ cls: "tj-eq-tip-label", text: `Gap: ${fmtMoney2(ddDiff)}` });
        chartTip.style.display = "block";
        positionTip(e);
      });
      t.addEventListener("mousemove", (e: MouseEvent) => {
        positionTip(e);
      });
      t.addEventListener("mouseleave", () => {
        chartTip.style.display = "none";
      });
      svg.appendChild(t);
    }
  }

  const line = svgEl("path", { class: "tj-eq-line", fill: "none", "vector-effect": "non-scaling-stroke" });
  if (opts.lineColor) line.style.stroke = opts.lineColor;
  if (opts.lineWidth !== undefined) line.style.strokeWidth = `${opts.lineWidth}px`;
  svg.appendChild(line);

  const render = (vals: number[]) => {
    const pts = vals.map((v, i) => ({ x: x(i), y: y(v) }));
    const d = smoothPath(pts, topY, botY);
    line.setAttribute("d", d);
    const areaD = `${d} L${x(vals.length - 1).toFixed(1)},${botY.toFixed(1)} L${x(0).toFixed(1)},${botY.toFixed(1)} Z`;
    aUp.setAttribute("d", areaD);
    aDn.setAttribute("d", areaD);
  };

  // y labels (discreet)
  const fmtAxis = (v: number) => {
    const a = Math.abs(v);
    const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : a.toFixed(0);
    return `${v < 0 ? "-" : ""}$${s}`;
  };
  const ticks: number[] = [];
  if (showY) {
    const maxCount = h < 110 ? 3 : h < 190 ? 4 : 5;
    for (const v of niceTicks(lo, lo + range, maxCount)) {
      if (ticks.length === 0 || Math.abs(y(v) - y(ticks[ticks.length - 1])) >= 15) ticks.push(v);
    }
    // Replace the top tick with the target value so the user can read it
    if (opts.targetLine !== undefined && ticks.length >= 2) {
      const lastIdx = ticks.length - 1;
      ticks[lastIdx] = opts.targetLine;
    }
  }
  for (const v of ticks) {
    const t = svgEl("text", { x: "2", y: String(y(v) + 3), class: "tj-eq-ylabel" });
    t.textContent = fmtAxis(v);
    svg.appendChild(t);
  }

  // x date labels
  if (showX) {
    const count = Math.min(values.length, plotW > 340 ? 5 : plotW > 210 ? 3 : 2);
    for (let i = 0; i < count; i++) {
      const idx = count <= 1 ? 0 : Math.round((i / (count - 1)) * (values.length - 1));
      const t = svgEl("text", {
        x: String(x(idx)),
        y: String(h - 4),
        "text-anchor": idx === 0 ? "start" : idx === values.length - 1 ? "end" : "middle",
        class: "tj-eq-xlabel",
      });
      t.textContent = fmtDay(dates[idx] ?? "");
      svg.appendChild(t);
    }
  }

  // secondary muted lines (tagged with data-s so callers can dim/highlight them)
  secondary.forEach((s, si) => {
    const vals = resampleSeries(s.values, values.length);
    const p = svgEl("path", {
      d: smoothPath(vals.map((v, i) => ({ x: x(i), y: y(v) })), topY, botY),
      fill: "none",
      stroke: s.color,
      "stroke-width": String(s.width ?? 1.4),
      class: "tj-eq-sec",
      "data-s": String(si),
    });
    if (s.dash) p.setAttribute("stroke-dasharray", "3 3");
    svg.appendChild(p);
  });

  // Cash-flow dots (deposits / payouts) pinned on the curve.
  for (const m of opts.markers ?? []) {
    const i = Math.max(0, Math.min(values.length - 1, m.index));
    const g = svgEl("g", { class: "tj-eq-mark tj-eq-mark-" + m.kind });
    const dot = svgEl("circle", { cx: x(i).toFixed(2), cy: y(values[i]).toFixed(2), r: "3.4", class: "tj-eq-mark-dot" });
    g.appendChild(dot);
    // our own card, not an SVG <title>: the engine box ignores our type scale
    attachTip(dot, { title: m.title });
    svg.appendChild(g);
  }

  // hover: guide + dot + card
  // one dot per point, coloured by the day result
  if (opts.dayDeltas && values.length > 2 && values.length <= 400) {
    const step = Math.max(1, Math.floor(values.length / 220));
    for (let i = step; i < values.length; i += step) {
      const cash = opts.dayCash?.find((c) => c.index === i);
      const d = svgEl("circle", { r: cash ? "3.2" : "2.6", class: "tj-eq-daydot" + (cash ? " is-cash is-" + cash.kind : "") });
      d.setAttribute("cx", x(i).toFixed(1));
      d.setAttribute("cy", y(values[i]).toFixed(1));
      // A cash day keeps its own colour from the stylesheet: the colour is the point.
      if (!cash) d.setAttribute("fill", (opts.dayDeltas[i] ?? 0) >= 0 ? "var(--tj-chart-good)" : "var(--tj-chart-bad)");
      svg.appendChild(d);
    }
  }
  const dot = svgEl("circle", { class: "tj-eq-dot", r: "4" });
  dot.style.display = "none";
  svg.appendChild(dot);
  const guide = svgEl("line", { class: "tj-eq-guide", y1: String(topY), y2: String(botY) });
  guide.style.display = "none";
  svg.appendChild(guide);
  container.appendChild(svg as unknown as Node);

  // Floating tooltip for DD label hover
  const chartTip = getGlobalChartTip();

  // Position chartTip using viewport coords (fixed positioning)
  const positionTip = (e: MouseEvent) => {
    const tw = chartTip.offsetWidth || 120;
    const th = chartTip.offsetHeight || 50;
    let left = e.clientX - tw / 2;
    let top = e.clientY - th - 14;
    if (left < 4) left = 4;
    if (left + tw > window.innerWidth - 4) left = window.innerWidth - tw - 4;
    if (top < 4) top = e.clientY + 18;
    chartTip.style.left = String(left);
    chartTip.style.top = String(top);
  };

  const cardRefs = getGlobalEqCard();
  const card = cardRefs.el;
  const cardVal = cardRefs.val;
  const cardDate = cardRefs.date;
  const extra = cardRefs.extra;

  svg.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = rect.width ? ((ev.clientX - rect.left) / rect.width) * w : 0;
    const idx = Math.max(0, Math.min(values.length - 1, Math.round(((px - padL) / plotW) * (values.length - 1))));
    const v = values[idx];
    const cx = x(idx);
    const cyy = y(v);
    guide.setAttribute("x1", String(cx));
    guide.setAttribute("x2", String(cx));
    guide.style.display = "block";
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cyy));
    dot.style.display = "block";
    cardVal.setText(fmtMoney2(v));
    // Colour by position vs the baseline: below the account value = loss (red).
    cardVal.toggleClass("tj-pos", v >= base);
    cardVal.toggleClass("tj-neg", v < base);
    cardDate.setText(fmtDay(dates[idx] ?? ""));
    if (opts.hoverLines) {
      extra.empty();
      for (const [label, value, tone] of opts.hoverLines(idx)) {
        const row = extra.createDiv({ cls: "tj-eq-extra-row" });
        row.createSpan({ text: label });
        row.createEl("b", { cls: tone, text: value });
      }
    }
    card.style.display = "block";
    const cw = card.offsetWidth || 132;
    const chh = card.offsetHeight || 92;
    // Viewport coords — the card is body-level and position: fixed.
    let left = rect.left + cx + 14;
    if (left + cw > window.innerWidth - 6) left = rect.left + cx - cw - 14;
    left = Math.max(4, Math.min(left, Math.max(4, window.innerWidth - cw - 4)));
    const top = Math.max(4, Math.min(rect.top + cyy - chh / 2, Math.max(4, window.innerHeight - chh - 4)));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  });
  svg.addEventListener("mouseleave", () => {
    guide.style.display = "none";
    dot.style.display = "none";
    card.style.display = "none";
  });

  render(values);

  // entrance / morph animation
  const animationsOn = opts.animations !== false;
  const prev = prevMap.get(opts.key) ?? null;
  const introDraw = animationsOn && prev === null;
  prevMap.set(opts.key, values.slice());
  if (introDraw) {
    const dur = 750;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      const n = Math.max(2, Math.round(values.length * e));
      render(values.slice(0, n));
      if (t < 1) requestAnimationFrame(tick);
      else render(values);
    };
    requestAnimationFrame(tick);
  } else if (animationsOn && prev && !seriesEqual(prev, values)) {
    const from = resampleSeries(prev, values.length);
    const dur = 650;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      render(values.map((v, i) => from[i] + (v - from[i]) * e));
      if (t < 1) requestAnimationFrame(tick);
      else render(values);
    };
    requestAnimationFrame(tick);
  }
}
