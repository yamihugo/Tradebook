// Trading Score & Radar — the one implementation both Home and Analytics use.
//
// It lives in its own module (not on a view) so a future Trading Score change
// cannot be applied to one page and forgotten on the other: the widget grid
// renders it through a single call, and HomeView and DashboardView share that
// call. The widget keeps Tradebook's own five-axis radar and responsive rules.
//
// Responsive behaviour, all measured from the widget's own box:
//   - the SVG viewBox is the measured pixel box, so the aspect always matches
//     and the radar is never letter-boxed; if the box settles a frame later
//     (fonts/layout) the drawing is redrawn so the viewBox keeps matching —
//     otherwise the whole drawing scales down and the radar + labels shrink;
//   - the radius is anisotropic (wide enough for the widest axis name on the
//     left/right spokes, shallow above/below) so the radar is as large as the
//     labels allow and never clips them;
//   - the numeric score is ALWAYS below the radar, stacked at every size;
//   - labels drop before they become specks, the scope line drops before that,
//     and below a readable minimum only the numeric score remains.

import type { ScoreResult } from "../lib/score";
import { SCORE_BAND_TOKEN } from "../lib/score";
import { attachTip, killTip, moveTip, showTip } from "../lib/tip";

const NS = "http://www.w3.org/2000/svg";

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Render the Trading Score into `body`. `animate` plays the first-draw morph;
 * the caller owns the "already animated" flag.
 */
export function renderTradingScore(
  body: HTMLElement,
  result: ScoreResult,
  scopeLabel: string,
  animate: boolean
): void {
  const axes = result.axes;
  const score = result.score;
  const band = result.band ? SCORE_BAND_TOKEN[result.band] : "var(--tj-fg-3)";
  const readableBand = result.band
    ? `color-mix(in srgb, ${band} 50%, var(--tj-fg-1))`
    : "var(--tj-fg-3)";

  // Short scope: the full label ("Last 30 decisions · through 23 Sep 2026 ·
  // All accounts") repeats what the period bar and account chip already say, so
  // the card keeps only the account and the sample size; the full line lives in
  // the hover.
  const shortScope = (label: string): string => {
    const parts = label.split("·").map((s) => s.trim()).filter(Boolean);
    const tail = parts.length ? parts[parts.length - 1] : label;
    const m = /\d+/.exec(label);
    return m ? `${tail} · ${m[0]}` : tail;
  };

  const bodyW = body.clientWidth || 0;
  const bodyH = body.clientHeight || 0;
  const measured = bodyW > 0 && bodyH > 0;
  // Below a readable minimum the radar is dropped and only the score shows;
  // unmeasured (first paint / headless) keeps the radar so nothing flickers.
  const hasRadar = !measured || (bodyW >= 84 && bodyH >= 96);
  const showScope = !measured || bodyH >= 150;

  const box = body.createDiv({ cls: "tj-chart-box tj-radar-box tj-score2" + (hasRadar ? "" : " is-mini") });
  box.style.setProperty("--tj-score-color", readableBand);
  box.style.setProperty("--tj-score-plot-color", band);

  // Foot first (score + one short line), so the SVG can take the rest.
  const foot = box.createDiv({ cls: "tj-score-foot" });
  foot.createDiv({ cls: "tj-score-big", text: score === null ? "—" : String(Math.round(score)) });
  const meta = foot.createDiv({ cls: "tj-score-meta" });
  const phase = meta.createSpan({
    cls: "tj-score-phase" + (result.complete ? "" : " is-provisional"),
    text: result.complete ? "Complete" : `Provisional · ${result.availableAxes}/5 axes`,
    attr: { tabindex: "0" },
  });
  attachTip(phase, {
    title: result.complete ? "Trading Score" : "Provisional score",
    sub: [
      result.complete
        ? "All five axes available."
        : `Average of the ${result.availableAxes} available axes; not directly comparable to a complete score.`,
      result.missing.length ? `Missing: ${result.missing.map((a) => a.label).join(", ")}.` : "",
      scopeLabel,
    ].filter(Boolean).join(" "),
  }, "tj-score-tip");
  if (showScope) {
    const scope = meta.createSpan({ cls: "tj-score-scope", text: shortScope(scopeLabel) });
    attachTip(scope, { title: scopeLabel });
  }

  if (!hasRadar) return;

  const n = axes.length;
  const svg = svgEl("svg", { viewBox: "0 0 300 300", preserveAspectRatio: "xMidYMid meet", class: "tj-chart tj-radar", width: "100%", height: "100%" });
  box.insertBefore(svg as unknown as Node, foot);

  const draw = (animateNow: boolean): { W: number; H: number } => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // Measure the SVG's real box and use those pixels as the viewBox, so the
    // aspect matches exactly (no letter-box) and the radius follows the space
    // that is actually there. The label reserve is anisotropic: as wide as the
    // widest axis name needs on the left/right spokes, shallow above/below.
    const W = Math.max(60, svg.clientWidth || box.clientWidth || 300);
    const H = Math.max(60, svg.clientHeight || (box.clientHeight - (foot.offsetHeight || 0)) || 300);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const showLabels = W >= 280 && H >= 180;
    const padX = showLabels ? 38 : 8;
    const padY = showLabels ? 14 : 8;
    const cx = W / 2, cy = H / 2;
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
    const fill = svgEl("path", { class: "tj-radar-fill" + (result.complete ? "" : " is-partial") });
    fill.setAttribute("stroke-dasharray", "4 3");
    svg.appendChild(fill);
    const shapeAt = (scale: number) => {
      if (!result.complete) {
        let segments = "";
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          if (axes[i].value === null || axes[next].value === null) continue;
          const a = pt(i, ((axes[i].value as number) / 100) * r * scale);
          const b = pt(next, ((axes[next].value as number) / 100) * r * scale);
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
    fill.setAttribute("d", shapeAt(animateNow ? 0 : 1));
    if (animateNow) {
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
  };

  const first = draw(animate);
  // The card body can still settle a frame after this draw (web font metrics,
  // a footer that wraps). If the SVG ends up a different size, redraw so the
  // viewBox keeps matching — a stale, larger viewBox scales the whole drawing
  // down, which is what makes the radar and its labels look shrunken.
  requestAnimationFrame(() => {
    if (!svg.isConnected) return;
    const w2 = svg.clientWidth || 0;
    const h2 = svg.clientHeight || 0;
    if (w2 > 0 && h2 > 0 && (Math.abs(w2 - first.W) > 1 || Math.abs(h2 - first.H) > 1)) draw(false);
  });
}
