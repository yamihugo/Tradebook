/**
 * Tiny shared hover-card helper.
 *
 * A single tip can exist at a time, it lives on <body> (so it is never clipped
 * by a widget's overflow), and a global guard removes it the moment the pointer
 * leaves an anchor — so a tip can never get "stuck" on screen.
 */

let active: HTMLElement | null = null;
let activeAnchor: Element | null = null;
let focusAnchor: Element | null = null;
let restoringFocus: Element | null = null;
let guardInstalled = false;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function cancelDismiss(): void {
  if (dismissTimer !== null) clearTimeout(dismissTimer);
  dismissTimer = null;
}

function scheduleDismiss(): void {
  cancelDismiss();
  dismissTimer = setTimeout(() => { dismissTimer = null; killTip(); }, 200);
}

function inTipCorridor(e: MouseEvent): boolean {
  if (!active || !activeAnchor) return false;
  const a = activeAnchor.getBoundingClientRect();
  const t = active.getBoundingClientRect();
  if (a.right <= a.left || a.bottom <= a.top || t.right <= t.left || t.bottom <= t.top) return false;
  const { clientX: x, clientY: y } = e;
  const inside = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  if (inside(a) || inside(t)) return true;
  // Interpolate the facing edges only across the gap, not their bounding box.
  const vertical = (upper: DOMRect, lower: DOMRect) => {
    if (upper.bottom >= lower.top || y < upper.bottom || y > lower.top) return false;
    const ratio = (y - upper.bottom) / (lower.top - upper.bottom);
    return x >= upper.left + (lower.left - upper.left) * ratio
      && x <= upper.right + (lower.right - upper.right) * ratio;
  };
  const horizontal = (left: DOMRect, right: DOMRect) => {
    if (left.right >= right.left || x < left.right || x > right.left) return false;
    const ratio = (x - left.right) / (right.left - left.right);
    return y >= left.top + (right.top - left.top) * ratio
      && y <= left.bottom + (right.bottom - left.bottom) * ratio;
  };
  return vertical(a, t) || vertical(t, a) || horizontal(a, t) || horizontal(t, a);
}

function leaveTip(e: MouseEvent): void {
  if (activeAnchor) {
    if (!inTipCorridor(e)) killTip();
  } else scheduleDismiss();
}

function clearTip(): void {
  cancelDismiss();
  activeAnchor = null;
  focusAnchor = null;
  const tip = active;
  active = null;
  tip?.remove();
}

function hasFocusedTip(): boolean {
  return !!focusAnchor && (document.activeElement === focusAnchor || document.activeElement === active);
}

export function killTip(): void {
  if (!hasFocusedTip()) clearTip();
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
      if (!active || (focusAnchor && document.activeElement === focusAnchor)) return;
      const el = e.target as HTMLElement | null;
      if ((!el || !el.closest || !el.closest(".tj-tip-anchor")) && !inTipCorridor(e) && dismissTimer === null) killTip();
    },
    true
  );
  // Escape dismisses: additional content shown on hover must be dismissable
  // without moving the pointer (WCAG 1.4.13).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const anchor = active && active.contains(document.activeElement) ? focusAnchor : null;
    clearTip();
    if (anchor instanceof HTMLElement && anchor.isConnected) {
      restoringFocus = anchor;
      try { anchor.focus(); } finally { restoringFocus = null; }
    }
  });
}

export interface TipParts {
  title?: string;
  value?: string;
  tone?: "pos" | "neg" | "";
  sub?: string;
}

/** Refresh only the currently displayed card belonging to this anchor. */
export function refreshTipDescription(anchor: Element, description: string): void {
  if (activeAnchor !== anchor) return;
  const sub = active?.querySelector(".tj-tip-sub");
  if (sub) sub.textContent = description;
}

export function showTip(parts: TipParts, extraCls = ""): void {
  if (hasFocusedTip()) return;
  guardTips();
  clearTip();
  const tip = document.body.createDiv({ cls: `tj-tip tj-tip-anchor ${extraCls}`.trim() });
  active = tip;
  tip.addEventListener("mouseenter", cancelDismiss);
  tip.addEventListener("mouseleave", leaveTip);
  if (parts.title) tip.createDiv({ cls: "tj-tip-title", text: parts.title });
  if (parts.value) tip.createDiv({ cls: `tj-tip-value ${parts.tone ?? ""}`.trim(), text: parts.value });
  if (parts.sub) tip.createDiv({ cls: "tj-tip-sub", text: parts.sub });
}

export function moveTip(e: MouseEvent): void {
  if (!active || hasFocusedTip()) return;
  const pad = 12;
  const w = active.offsetWidth || 120;
  const h = active.offsetHeight || 60;
  let left = e.clientX + pad;
  let top = e.clientY - h - pad;
  if (left + w > window.innerWidth - 8) left = e.clientX - w - pad;
  if (top < 8) top = e.clientY + pad;
  active.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  active.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
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
 * Never put `aria-label` on a tip anchor: Obsidian then draws its own tooltip on
 * top of ours, and the reader gets two cards. The accessible name goes in a
 * `tj-sr-only` span inside the control instead.
 */
export function attachTip(el: Element, parts: TipParts | (() => TipParts), extraCls = ""): void {
  // The guard (`guardTips`) drops any tip whose pointer is not over a
  // `tj-tip-anchor`, so the anchor must carry the class itself — otherwise the
  // card is killed on the next mousemove and never gets to be read.
  el.classList.add("tj-tip-anchor");
  const show = (e?: MouseEvent) => {
    if (hasFocusedTip()) return;
    cancelDismiss();
    showTip(typeof parts === "function" ? parts() : parts, extraCls);
    if (active) activeAnchor = el;
    if (e) {
      moveTip(e);
      return;
    }
    // Keyboard focus has no pointer: drop the card just under the control.
    if (!active) return;
    const r = el.getBoundingClientRect();
    active.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - (active.offsetWidth || 160) - 8))}px`;
    const h = active.offsetHeight || 60;
    const top = r.bottom + 8 + h <= window.innerHeight - 8 ? r.bottom + 8 : r.top - h - 8;
    active.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
  };
  el.addEventListener("mouseenter", (e) => { if (focusAnchor !== el) show(e as MouseEvent); });
  el.addEventListener("mousemove", (e) => { if (focusAnchor !== el) moveTip(e as MouseEvent); });
  el.addEventListener("mouseleave", (e) => { if (focusAnchor !== el) leaveTip(e as MouseEvent); });
  el.addEventListener("focus", () => {
    if (restoringFocus === el) return;
    clearTip(); show(); focusAnchor = el;
    if (active && active.scrollHeight > active.clientHeight) {
      active.tabIndex = 0;
      active.setAttribute("role", "region");
      active.setAttribute("aria-label", "Scrollable explanation");
      active.addEventListener("blur", () => clearTip());
    }
  });
  el.addEventListener("keydown", (event) => {
    const e = event as KeyboardEvent;
    if (e.key === "Tab" && !e.shiftKey && active?.tabIndex === 0 && focusAnchor === el) {
      e.preventDefault(); active.focus();
    }
  });
  el.addEventListener("blur", (event) => {
    if (focusAnchor === el && (event as FocusEvent).relatedTarget !== active) clearTip();
  });
}
