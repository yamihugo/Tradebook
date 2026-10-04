// Trading Score — the one implementation both Home and Analytics use.
//
// It lives in its own module (not on a view) so a future Trading Score change
// cannot be applied to one page and forgotten on the other. v3 reports five
// axes in two groups, drawn as the familiar five-axis radar; the total and its
// named state chip, and the two group sub-scores, sit alongside. When the card
// is too small for a readable radar, the same five axes read as labelled bars
// instead — no card is ever left without a reading.
//
// Journal hygiene (review, rating, stops) is not graded here; it lives in
// Focus Areas and the account's Discipline score.

import type { ScoreResult, ScoreAxis, ScoreBand } from "../lib/score";
import { SCORE_BAND_TOKEN, SCORE_BAND_LABEL } from "../lib/score";
import { attachTip, killTip, moveTip, showTip } from "../lib/tip";

const NS = "http://www.w3.org/2000/svg";

const bandOf = (v: number): ScoreBand =>
  v < 30 ? "bad" : v < 50 ? "low" : v < 70 ? "mid" : v < 90 ? "good" : "top";

/** Short scope: the full label repeats the period bar and account chip, so the
 *  card keeps only the account and the sample size; the full line lives in the hover. */
const shortScope = (label: string): string => {
  const parts = label.split("·").map((s) => s.trim()).filter(Boolean);
  const tail = parts.length ? parts[parts.length - 1] : label;
  const m = /\d+/.exec(label);
  return m ? `${tail} · ${m[0]}` : tail;
};

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Draw the five labelled bars — the small-card fallback for the radar. */
function renderAxisRows(box: HTMLElement, result: ScoreResult, animate: boolean): void {
  const list = box.createDiv({ cls: "tj-score-rows" });
  for (const axis of result.axes) {
    const row = list.createDiv({ cls: "tj-score-row" + (axis.value === null ? " is-na" : "") });
    const head = row.createDiv({ cls: "tj-score-row-head" });
    head.createDiv({ cls: "tj-score-axis-label", text: axis.label });
    head.createDiv({ cls: "tj-score-axis-value", text: axis.value === null ? "—" : String(Math.round(axis.value)) });
    const track = row.createDiv({ cls: "tj-score-track" });
    const fill = track.createDiv({ cls: "tj-score-fill" });
    if (axis.value !== null) {
      fill.style.background = SCORE_BAND_TOKEN[bandOf(axis.value)];
      const width = `${Math.max(2, Math.min(100, axis.value))}%`;
      if (animate) {
        fill.setCssStyles({ width: "0%" });
        requestAnimationFrame(() => {
          if (fill.isConnected) fill.style.width = width;
        });
      } else {
        fill.style.width = width;
      }
    }
    attachTip(row, {
      title: axis.label,
      value: axis.value === null ? "Not enough data" : `${Math.round(axis.value)} pts`,
      sub: [axis.observed, axis.context, axis.reason].filter(Boolean).join(" "),
    });
  }
}

/** Draw the radar. Returns the measured box so a later settle can redraw it. */
function drawRadar(svg: SVGElement, box: HTMLElement, textHost: HTMLElement, axes: ScoreAxis[], complete: boolean, animate: boolean): { W: number; H: number } {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = Math.max(60, svg.clientWidth || box.clientWidth || 300);
  const H = Math.max(60, svg.clientHeight || (box.clientHeight - (textHost.offsetHeight || 0)) || 300);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const showLabels = W >= 280 && H >= 180;
  const padX = showLabels ? 38 : 8;
  const padY = showLabels ? 14 : 8;
  const cx = W / 2;
  const cy = H / 2;
  const n = axes.length;
  const r = Math.max(16, Math.min(W / 2 - padX, H / 2 - padY));
  const labelDist = showLabels ? 8 : 0;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, dist: number) => ({ x: cx + Math.cos(angle(i)) * dist, y: cy + Math.sin(angle(i)) * dist });

  for (const pct of [0.25, 0.5, 0.75, 1]) {
    let d = "";
    for (let i = 0; i < n; i++) {
      const p = pt(i, r * pct);
      d += (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1) + " ";
    }
    svg.appendChild(svgEl("path", { d: d + "Z", class: "tj-radar-ring" }));
  }
  for (let i = 0; i < n; i++) {
    const p = pt(i, r);
    svg.appendChild(svgEl("line", {
      x1: String(cx), y1: String(cy), x2: String(p.x), y2: String(p.y),
      class: "tj-radar-axis" + (axes[i].value === null ? " is-na" : ""),
    }));
  }
  if (showLabels) {
    for (let i = 0; i < n; i++) {
      const p = pt(i, r + labelDist);
      const lbl = svgEl("text", {
        x: String(p.x), y: String(p.y), "text-anchor": "middle", "dominant-baseline": "central",
        class: "tj-radar-label" + (axes[i].value === null ? " is-na" : ""),
      });
      lbl.textContent = axes[i].label;
      svg.appendChild(lbl);
    }
  }
  const fill = svgEl("path", { class: "tj-radar-fill" + (complete ? "" : " is-partial") });
  fill.setAttribute("stroke-dasharray", "4 3");
  svg.appendChild(fill);
  const shapeAt = (scale: number) => {
    if (!complete) {
      let segments = "";
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        if (axes[i].value === null || axes[next].value === null) continue;
        const a = pt(i, ((axes[i].value as number) / 100) * r * scale);
        const b = pt(next, ((axes[next].value) / 100) * r * scale);
        segments += `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)} `;
      }
      return segments.trim();
    }
    let d = "";
    for (let i = 0; i < n; i++) {
      const p = pt(i, ((axes[i].value as number) / 100) * r * scale);
      d += (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1) + " ";
    }
    return d + "Z";
  };
  fill.setAttribute("d", shapeAt(animate ? 0 : 1));
  if (animate) {
    const dur = 700;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      fill.setAttribute("d", shapeAt(e));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  for (let i = 0; i < n; i++) {
    if (axes[i].value === null) continue;
    const p = pt(i, ((axes[i].value as number) / 100) * r);
    svg.appendChild(svgEl("circle", { cx: String(p.x), cy: String(p.y), r: "3.5", class: "tj-radar-dot" }));
  }

  // Each spoke owns its evidence detail; unavailable axes remain visible but
  // are never plotted at the zero point.
  for (let i = 0; i < n; i++) {
    const p = pt(i, r);
    const axis = axes[i];
    const hit = svgEl("circle", {
      cx: String(p.x), cy: String(p.y), r: "22", fill: "transparent",
      class: "tj-tip-anchor", tabindex: "0",
    });
    const showAxis = () => showTip(
      {
        title: axis.label,
        value: axis.value === null ? "Not enough data" : `${Math.round(axis.value)} pts`,
        sub: [axis.observed, axis.context, axis.reason].filter(Boolean).join(" "),
      },
      "tj-score-tip"
    );
    hit.addEventListener("mouseenter", showAxis);
    hit.addEventListener("focus", showAxis);
    hit.addEventListener("mousemove", (e) => moveTip(e));
    hit.addEventListener("mouseleave", () => killTip());
    hit.addEventListener("blur", () => killTip());
    svg.appendChild(hit);
  }
  return { W, H };
}

/**
 * Render the Trading Score into `body`. `animate` plays the first-draw morph;
 * the caller owns the "already animated" flag.
 */
export function renderTradingScore(
  body: HTMLElement,
  result: ScoreResult,
  scopeLabel: string,
  animate: boolean,
  header?: HTMLElement
): void {
  const band = result.band ? SCORE_BAND_TOKEN[result.band] : "var(--tj-fg-3)";
  const readableBand = result.band
    ? `color-mix(in srgb, ${band} 50%, var(--tj-fg-1))`
    : "var(--tj-fg-3)";

  const bodyW = body.clientWidth || 0;
  const bodyH = body.clientHeight || 0;
  const measured = bodyW > 0 && bodyH > 0;
  // Below a readable minimum the radar is dropped for the bar fallback;
  // unmeasured (first paint / headless) keeps the radar so nothing flickers.
  const hasRadar = !measured || (bodyW >= 84 && bodyH >= 96);
  const showScope = !measured || bodyH >= 150;

  const box = body.createDiv({ cls: "tj-score2" + (hasRadar ? "" : " is-mini") });
  box.style.setProperty("--tj-score-color", readableBand);
  box.style.setProperty("--tj-score-plot-color", band);

  // The total and its named band ride on the card title line (right), like the
  // Focus Areas coverage — the body stays all radar. The header outlives body
  // redraws, so drop the previous head before adding a fresh one.
  if (header) header.querySelector(".tj-score-head")?.remove();
  const head = (header ?? box).createDiv({ cls: "tj-score-head" });
  if (header) {
    const controls = header.querySelector(".tj-card-controls");
    if (controls) header.insertBefore(head, controls);
  }
  const big = head.createDiv({ cls: "tj-score-big", text: result.score === null ? "—" : String(Math.round(result.score)) });
  attachTip(big, {
    title: "Trading Score",
    value: result.score === null ? "Not enough data" : String(Math.round(result.score)),
    sub: [
      result.complete
        ? "All five axes available."
        : `Mean of the ${result.availableAxes} available axes, pulled toward neutral by coverage; not directly comparable to a complete score.`,
      result.missing.length ? `Missing: ${result.missing.map((a) => a.label).join(", ")}.` : "",
      scopeLabel,
    ].filter(Boolean).join(" "),
  });
  if (result.band) {
    const bandWord = head.createSpan({ cls: "tj-score-band", text: SCORE_BAND_LABEL[result.band] });
    attachTip(bandWord, {
      title: "Score band",
      sub: "Developing < 30 · Fair < 50 · Solid < 70 · Strong < 90 · Leading ≥ 90. A reading, never an unlock.",
    });
  }

  // Two sub-scores: how the money read vs how you traded.
  const groups = box.createDiv({ cls: "tj-score-groups" });
  let firstGroup = true;
  const group = (label: string, value: number | null): void => {
    if (value === null) return;
    if (!firstGroup) groups.createSpan({ cls: "tj-score-group-sep", text: "·" });
    firstGroup = false;
    const span = groups.createSpan({ cls: "tj-score-group" });
    span.createSpan({ text: `${label} ` });
    span.createSpan({ cls: "tj-score-group-v", text: String(Math.round(value)) });
  };
  group("Discipline", result.groups.discipline);
  group("Result", result.groups.result);

  // Foot: completeness and scope.
  const foot = box.createDiv({ cls: "tj-score-foot" });
  const phase = foot.createDiv({
    cls: "tj-score-phase" + (result.complete ? "" : " is-provisional"),
    text: result.complete ? "Complete" : `Provisional · ${result.availableAxes}/5 axes`,
  });
  attachTip(phase, {
    title: result.complete ? "Trading Score" : "Provisional score",
    sub: [
      result.complete
        ? "All five axes available."
        : `Average of the ${result.availableAxes} available axes; not directly comparable to a complete score.`,
      result.missing.length ? `Missing: ${result.missing.map((a) => a.label).join(", ")}.` : "",
    ].filter(Boolean).join(" "),
  });
  const scope = showScope ? foot.createDiv({ cls: "tj-score-scope", text: shortScope(scopeLabel) }) : null;
  if (scope) attachTip(scope, { title: scopeLabel });

  if (!hasRadar) {
    // Small card: the five axes read as bars; the scope is the only thing to drop.
    renderAxisRows(box, result, animate);
    if (body.clientHeight > 0 && body.scrollHeight > body.clientHeight && scope) scope.setCssStyles({ display: "none" });
    return;
  }

  const svg = svgEl("svg", { viewBox: "0 0 300 300", preserveAspectRatio: "xMidYMid meet", class: "tj-chart tj-radar", width: "100%", height: "100%" });
  box.insertBefore(svg, foot);

  const first = drawRadar(svg, box, head, result.axes, result.complete, animate);
  // The card body can still settle a frame after this draw (web font metrics,
  // a footer that wraps). If the SVG ends up a different size, redraw so the
  // viewBox keeps matching — a stale, larger viewBox scales the whole drawing
  // down, which is what makes the radar and its labels look shrunken.
  requestAnimationFrame(() => {
    if (!svg.isConnected) return;
    const w2 = svg.clientWidth || 0;
    const h2 = svg.clientHeight || 0;
    if (w2 > 0 && h2 > 0 && (Math.abs(w2 - first.W) > 1 || Math.abs(h2 - first.H) > 1)) {
      drawRadar(svg, box, head, result.axes, result.complete, false);
    }
  });
}
