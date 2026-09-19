#!/usr/bin/env node
/**
 * UX audit — the automated half of docs/UX-GUIDELINES.md.
 *
 * It measures, it does not guess: contrast ratios, the type scale, weights,
 * em-based sizes, line-height and target sizes, straight out of styles.css.
 *
 *   node tools/ux-audit.mjs            # report
 *   node tools/ux-audit.mjs --strict   # exit 1 when errors are found
 *
 * Errors are rules with a normative source (WCAG). Warnings are scale
 * discipline — see docs/UX-GUIDELINES.md §9 for the known debt.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "styles.css"), "utf8");
const strict = process.argv.includes("--strict");

/* ------------------------------------------------------------------ colour */

const relLum = (hex) => {
  const h = hex.replace("#", "");
  const chan = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = chan.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** The surfaces we actually paint on, from the Obsidian dark theme. */
const PAGE = "#1e1f22";
const CARD = "#222326";

const TEXT = [
  ["--tj-fg-1", "#dcddde", "body text"],
  ["--tj-fg-2", "#a8aeb4", "secondary"],
  ["--tj-fg-3", "#8a9099", "quietest (micro-labels)"],
  ["--text-faint", "#6b7075", "theme token — not AA-safe"],
  ["--text-muted", "#9aa0a6", "theme token"],
  ["--text-normal", "#dcddde", "theme token"],
];

const ACCENTS = [
  ["green", "#34d17a"],
  ["red", "#ff5d48"],
  ["amber", "#d9a441"],
  ["blue", "#4aa8ff"],
  ["violet", "#a882ff"],
  ["teal", "#7de2d1"],
];

/* --------------------------------------------------------------- stylesheet */

/** Dots and badges that are indicators, not targets — the control around them
 *  is the thing you hit. §5 */
const DECORATIVE = [
  ".tj-symw-dot",
  ".tj-revdot",
  ".tj-acct-h1-dot",
  ".tj-filterbtn-count",
  ".tj-wz-leader-dot",
  ".tj-acc-dot",
  ".tj-acc-bdot",
  ".tj-acc-streakdot",
  // Import review + Add manual trade: the dot states whether an account (or a
  // file name) is in. The control is the whole `label.tj-import-acc` /
  // `label.tj-add-acc` row or the mapping row it sits in, all full-width rows
  // around 30px tall.
  ".tj-import-accdot",
  ".tj-import-mapdot",
  ".tj-add-accdot",
];

/** Real targets that satisfy the SC 2.5.8 *spacing* exception: a 24px circle
 *  centred on them never meets another target or another undersized target.
 *  Each one names the gap that makes it true. */
const SPACED = [
  ".tj-anno-swatch", // palette row, ≥8px apart (18 + 8 = 26)
  ".tj-theme-dot", // 2-up theme cards, ≥10px apart (20 + 10 = 30)
  ".tj-info-dot", // sits with its own label; nearest other target is a whole cell away
  ".tj-mg-dot", // ≥7px from the name field, 10 + 14 = 24
  ".tj-mg-swatch", // palette grid, 10px gap (15 + 10 = 25)
];

/** Decorative glyphs (emoji, trophy, big warning icon) carry no text, so the
 *  type scale — and its minimum size — do not apply to them. §1.1 */
const GLYPH_EXEMPT = [".tj-delete-icon", ".tj-eval-trophy", ".tj-trophy-big"];
const isGlyph = (sel) => GLYPH_EXEMPT.some((g) => sel.includes(g));
const notATarget = (sel) => DECORATIVE.some((c) => sel.includes(c)) || SPACED.some((c) => sel.includes(c));

/** Text that can wrap: this is where SC 1.4.12 actually bites. */
const WRAPPING = /(hint|note|desc|sub|msg|text|tip|label|value|title|detail|body)/i;

const tokenValue = (name) => {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
  return m ? m[1] : null;
};

const lines = css.split("\n");

/** Every font-size / line-height, tagged with the rule it belongs to. */
const fontSizes = [];
const lineHeights = [];
let sel = "";
lines.forEach((line, i) => {
  const t = line.trim();
  if (t.includes("{") && !t.startsWith("@")) sel = t.split("{")[0].trim();
  const fs = line.match(/font-size:\s*([0-9.]+)(px|em|rem)/);
  if (fs) fontSizes.push({ value: parseFloat(fs[1]), unit: fs[2], line: i + 1, raw: fs[0], sel });
  const lh = line.match(/line-height:\s*([0-9.]+)\s*;/);
  if (lh) lineHeights.push({ value: parseFloat(lh[1]), line: i + 1, sel });
});

const tokenSizes = [...css.matchAll(/font-size:\s*var\(--tj-fs-([a-z]+)\)/g)].map((m) => m[1]);
const tokenCount = tokenSizes.length;

const weights = new Map();
for (const [, w] of css.matchAll(/font-weight:\s*(\d+)/g)) weights.set(w, (weights.get(w) ?? 0) + 1);

/** Blocks with a selector and a body, for the target-size heuristic. */
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), body: m[2], index: css.slice(0, m.index).split("\n").length }))
  .filter((b) => !b.sel.startsWith("@"));

const SMALL_CONTROL = /(btn|button|dot|grip|icon|close|swatch|move|check|-x\b|chip|pill)/i;
/** Decorative innards — the button around them is the target, not the glyph. */
const ICON_ONLY = /(svg|::before|::after|\bicon\b|\bhub\b|-spinner)/i;
const smallTargets = [];
for (const b of blocks) {
  const first = b.sel.split(",")[0].trim();
  if (!SMALL_CONTROL.test(first)) continue;
  if (ICON_ONLY.test(first) || isGlyph(first) || notATarget(first)) continue;
  const w = b.body.match(/(?:^|[;\s])width:\s*([0-9.]+)px/);
  const h = b.body.match(/(?:^|[;\s])height:\s*([0-9.]+)px/);
  if (!w && !h) continue;
  const size = Math.min(w ? parseFloat(w[1]) : 99, h ? parseFloat(h[1]) : 99);
  if (size < 24) smallTargets.push({ sel: first, size, line: b.index });
}

/* ------------------------------------------------------------------ report */

const title = (t) => console.log(`\n${t}`);

console.log("UX audit — docs/UX-GUIDELINES.md");

title("1. Contrast (WCAG 2.2 SC 1.4.3 — 4.5:1 for normal text)");
const contrastErrors = [];
for (const [name, fallback, what] of TEXT) {
  const hex = tokenValue(name.replace(/^--/, "")) ?? fallback;
  const isOurs = name.startsWith("--tj-");
  const ok = contrast(hex, PAGE) >= 4.5;
  if (!ok && isOurs) contrastErrors.push(name);
  const note = isOurs ? "" : "  (theme token — use --tj-fg-3 instead)";
  console.log(
    `  ${name.padEnd(14)} ${hex}  page ${contrast(hex, PAGE).toFixed(2)}:1  card ${contrast(hex, CARD).toFixed(2)}:1  ` +
      `${ok ? "AA ✓" : "FAILS AA"}${note}   ${what}`,
  );
}
for (const [name, hex] of ACCENTS) {
  const page = contrast(hex, PAGE);
  console.log(`  ${name.padEnd(14)} ${hex}  page ${page.toFixed(2)}:1  card ${contrast(hex, CARD).toFixed(2)}:1  ${page >= 4.5 ? "AA ✓" : "large only"}`);
}

title("2. Type scale (docs §1.1 — 9.5 / 11 / 12.5 / 13.5 / 15 / 19 / 24 / 28)");
const SCALE = [9.5, 11, 12.5, 13.5, 15, 19, 24, 28];
const px = fontSizes.filter((f) => f.unit === "px" && !isGlyph(f.sel));
const histogram = new Map();
for (const f of px) histogram.set(f.value, (histogram.get(f.value) ?? 0) + 1);
const offScale = px.filter((f) => !SCALE.includes(f.value));
console.log(`  ${tokenCount} declarations on the scale tokens, ${px.length} literal px left`);
if (histogram.size) console.log("  literals: " + [...histogram.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}px×${n}`).join("  "));
const tooSmall = px.filter((f) => f.value < 9.5);
for (const f of tooSmall) console.log(`  ERROR §1.1 line ${f.line}: ${f.value}px (${f.sel}) is below the 9.5px floor`);
const glyphs = fontSizes.filter((f) => isGlyph(f.sel));
if (glyphs.length) console.log(`  decorative glyphs (exempt): ${glyphs.map((g) => `${g.sel} ${g.value}${g.unit}`).join(", ")}`);

title("3. Weights (docs §1.2 — 400 / 600 / 700)");
const offWeights = [...weights.entries()].filter(([w]) => !["400", "600", "700"].includes(w));
console.log("  " + [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w}×${n}`).join("  "));
if (offWeights.length) console.log(`  off-scale: ${offWeights.map(([w]) => w).join(", ")}  (${offWeights.reduce((s, [, n]) => s + n, 0)} declarations)`);

title("4. Parent-relative sizes (docs §1.6 — banned in UI text)");
const rel = fontSizes.filter((f) => f.unit !== "px" && !isGlyph(f.sel));
console.log(`  ${rel.length} declarations inherit their size from the parent`);
for (const f of rel.slice(0, 6)) console.log(`  ${f.value}${f.unit}  ${f.sel}  (line ${f.line})`);

title("5. Text spacing (WCAG 2.2 SC 1.4.12 — nothing may be clipped at line-height 1.5)");
// Two house thresholds: copy that runs in sentences needs air (1.4); short
// values and titles may sit tighter (1.25) as long as they never clip.
const PARAGRAPH = /(hint|note|desc|detail|msg|tip|body|text)/i;
const SHORT = /(value|label|title|sub)/i;
const tight = lineHeights.filter((l) => l.value > 0 && l.value < 1.4);
const tightText = tight.filter((l) => {
  const s = l.sel.split(",")[0];
  const min = PARAGRAPH.test(s) ? 1.4 : SHORT.test(s) ? 1.25 : 0;
  return min > 0 && l.value < min;
});
console.log(`  ${lineHeights.length} unitless line-heights, ${tight.length} below 1.4 — ${tightText.length} below their own floor`);
for (const l of tightText.slice(0, 8)) console.log(`  ${l.value}  ${l.sel.split(",")[0]}  (line ${l.line})`);
if (tightText.length > 8) console.log(`  … ${tightText.length - 8} more`);

title("6. Target size (WCAG 2.2 SC 2.5.8 — ≥ 24×24)");
console.log(`  ${smallTargets.length} controls painted smaller than 24px`);
for (const t of smallTargets.slice(0, 10)) console.log(`  ${String(t.size).padStart(5)}px  ${t.sel}  (line ${t.line})`);
if (smallTargets.length > 10) console.log(`  … ${smallTargets.length - 10} more`);

title("7. Legacy token use");
const faint = (css.match(/var\(--text-faint/g) ?? []).length;
console.log(`  var(--text-faint) used ${faint}× — migrate to var(--tj-fg-3) (docs §2.1)`);

/* ---------------------------------------------------------------- summary */

title("Summary");
console.log(`  contrast errors: ${contrastErrors.length}`);
console.log(`  literal px sizes: ${px.length} (off-scale ${offScale.length})   parent-relative: ${rel.length}   off-scale weights: ${offWeights.reduce((s, [, n]) => s + n, 0)}`);
console.log(`  tight line-heights on wrapping text: ${tightText.length}   small targets: ${smallTargets.length}   faint usages: ${faint}`);
const failed = contrastErrors.length + tooSmall.length;
if (failed && strict) {
  console.log("\nFAILED (--strict)");
  process.exit(1);
}
console.log(failed ? "\nFAILED" : "\nno normative violations found");
