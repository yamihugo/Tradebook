/**
 * Tiny shared hover-card helper.
 *
 * A single tip can exist at a time, it lives on <body> (so it is never clipped
 * by a widget's overflow), and a global guard removes it the moment the pointer
 * leaves an anchor — so a tip can never get "stuck" on screen.
 */

let active: HTMLElement | null = null;
let guardInstalled = false;

export function killTip(): void {
  if (active) {
    active.remove();
    active = null;
  }
}

/**
 * Install (once) a document-level safety net: whenever the pointer is over
 * something that is NOT a tip anchor, drop the tip.
 * Anchors must have the `tj-tip-anchor` class.
 */
export function guardTips(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!active) return;
      const el = e.target as HTMLElement | null;
      if (!el || !el.closest || !el.closest(".tj-tip-anchor")) killTip();
    },
    true
  );
  // Escape dismisses: additional content shown on hover must be dismissable
  // without moving the pointer (WCAG 1.4.13).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") killTip();
  });
}

export interface TipParts {
  title?: string;
  value?: string;
  tone?: "pos" | "neg" | "";
  sub?: string;
}

export function showTip(parts: TipParts, extraCls = ""): void {
  guardTips();
  killTip();
  const tip = document.body.createDiv({ cls: `tj-tip tj-tip-anchor ${extraCls}`.trim() });
  active = tip;
  if (parts.title) tip.createDiv({ cls: "tj-tip-title", text: parts.title });
  if (parts.value) tip.createDiv({ cls: `tj-tip-value ${parts.tone ?? ""}`.trim(), text: parts.value });
  if (parts.sub) tip.createDiv({ cls: "tj-tip-sub", text: parts.sub });
}

export function moveTip(e: MouseEvent): void {
  if (!active) return;
  const pad = 12;
  const w = active.offsetWidth || 120;
  const h = active.offsetHeight || 60;
  let left = e.clientX + pad;
  let top = e.clientY - h - pad;
  if (left + w > window.innerWidth - 8) left = e.clientX - w - pad;
  if (top < 8) top = e.clientY + pad;
  active.style.left = `${left}px`;
  active.style.top = `${top}px`;
}

/**
 * Wire a hover card onto a control.
 *
 * Native `title` tooltips are drawn by the engine: a black box whose font,
 * colour and delay we do not control, and which never appears on keyboard focus.
 * This uses our own tip — same card as the charts, same type scale — and it
 * shows on focus too, so a keyboard user gets the same explanation as a mouse
 * user (WCAG 1.4.13 Content on Hover or Focus).
 *
 * The button keeps its `aria-label`: the tip is a nicety, the accessible name is
 * the contract.
 */
export function attachTip(el: Element, parts: TipParts, extraCls = ""): void {
  const show = (e?: MouseEvent) => {
    showTip(parts, extraCls);
    if (e) {
      moveTip(e);
      return;
    }
    // Keyboard focus has no pointer: drop the card just under the control.
    if (!active) return;
    const r = el.getBoundingClientRect();
    active.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - (active.offsetWidth || 160) - 8))}px`;
    active.style.top = `${r.bottom + 8}px`;
  };
  el.addEventListener("mouseenter", (e) => show(e as MouseEvent));
  el.addEventListener("mousemove", (e) => moveTip(e as MouseEvent));
  el.addEventListener("mouseleave", killTip);
  el.addEventListener("focus", () => show());
  el.addEventListener("blur", killTip);
}
