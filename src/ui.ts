import { AccountType, Trade } from "./types";
import { isFiniteNumber, toZoneDate } from "./tz";

export interface FilterOption {
  id: string;
  label: string;
}

export const ACCOUNT_FILTERS: FilterOption[] = [
  { id: "all", label: "All" },
  { id: "demo", label: "Demo" },
  { id: "eval", label: "Evals" },
  { id: "funded", label: "Fundeds" },
  { id: "live", label: "Live" },
];

export const SCOPE_OPTIONS: FilterOption[] = [
  { id: "all", label: "All journal trades" },
  { id: "demo", label: "Demo trades" },
  { id: "eval", label: "Eval trades" },
  { id: "funded", label: "Funded trades" },
  { id: "unknown", label: "Other trades" },
];

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function kpiCard(
  parent: HTMLElement,
  label: string,
  value: string,
  tone: string,
  sub?: string
): void {
  const card = parent.createDiv({ cls: `tj-kpi ${tone}` });
  card.createDiv({ cls: "tj-kpi-label", text: label });
  card.createDiv({ cls: "tj-kpi-value", text: value });
  if (sub) card.createDiv({ cls: "tj-kpi-sub", text: sub });
}

export function svgLine(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cls?: string
): SVGLineElement {
  const line = svg.createSvg("line", { cls });
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  return line;
}

export function svgPath(svg: SVGSVGElement, d: string, cls?: string): SVGPathElement {
  const path = svg.createSvg("path", { cls });
  path.setAttribute("d", d);
  return path;
}

export function pathFromPoints(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    d += ` L${points[i].x.toFixed(1)},${points[i].y.toFixed(1)}`;
  }
  return d;
}

export function renderAreaChart(
  svg: SVGSVGElement,
  lineD: string,
  zeroY: number,
  height: number,
  width: number,
  x0: number,
  x1: number
): void {
  const id = "hjz" + Math.random().toString(36).slice(2, 7);
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = svg.createSvg("defs", {});
    svg.prepend(defs);
  }
  const clip = (clipId: string, y: number, h: number) => {
    defs!.createSvg("clipPath", { attr: { id: clipId } }).createSvg("rect", {
      attr: { x: "0", y: String(y), width: String(width), height: String(Math.max(0, h - y)) },
    });
  };
  clip(id + "up", 0, zeroY);
  clip(id + "dn", zeroY, height);

  const areaD = `${lineD} L${x1.toFixed(1)},${zeroY.toFixed(1)} L${x0.toFixed(1)},${zeroY.toFixed(1)} Z`;
  svgPath(svg, areaD, "tj-chart-area pos").setAttribute("clip-path", `url(#${id}up)`);
  svgPath(svg, areaD, "tj-chart-area neg").setAttribute("clip-path", `url(#${id}dn)`);
  svgPath(svg, lineD, "tj-chart-line pos").setAttribute("clip-path", `url(#${id}up)`);
  svgPath(svg, lineD, "tj-chart-line neg").setAttribute("clip-path", `url(#${id}dn)`);
}

export function cumulativeEquitySeries(trades: Trade[], zone = ""): { date: string; cum: number }[] {
  const valid = trades.filter((t) => t && isFiniteNumber(t.pnl) && typeof t.date === "string" && t.date);
  const sorted = [...valid].sort((a, b) => {
    const da = zone ? toZoneDate(a.date, a.entryTime || "00:00", zone) : a.date;
    const db = zone ? toZoneDate(b.date, b.entryTime || "00:00", zone) : b.date;
    return da.localeCompare(db) || (a.id || "").localeCompare(b.id || "");
  });
  const points: { date: string; cum: number }[] = [{ date: "Start", cum: 0 }];
  if (sorted.length === 0) return points;
  let cum = 0;
  for (const t of sorted) {
    cum += t.pnl;
    const d = zone ? toZoneDate(t.date, t.entryTime || "00:00", zone) : t.date;
    const last = points[points.length - 1];
    if (last && last.date !== "Start" && last.date === d) {
      last.cum = cum;
    } else {
      points.push({ date: d, cum });
    }
  }
  return points;
}

export function attachTooltip(parent: HTMLElement): {
  show: (x: number, y: number, text: string) => void;
  hide: () => void;
} {
  const tip = parent.createDiv({ cls: "tj-tooltip" });
  return {
    show: (x: number, y: number, text: string) => {
      const rect = parent.getBoundingClientRect();
      tip.setText(text);
      tip.style.left = `${clamp(x - rect.left, 6, Math.max(6, rect.width - 40))}px`;
      tip.style.top = `${clamp(y - rect.top, 6, Math.max(6, rect.height - 30))}px`;
      tip.style.opacity = "1";
    },
    hide: () => {
      tip.style.opacity = "0";
    },
  };
}

/**
 * App shell with a simple header + optional off-canvas left panel.
 * - No heavy top bar: only a slim header with the TJ brand (clickable) that
 *   opens/closes the left "tools" panel, and a discreet Add Trade action.
 * - Navigation items are plain text (no emojis).
 */
export function renderAppShell(
  root: HTMLElement,
  plugin: any,
  active: string,
  opts: { extraNav?: { id: string; label: string; fn: () => void }[] } = {}
): HTMLElement {
  root.empty();
  root.addClass("tj-app");

  const NAV_ITEMS: { id: string; label: string; fn: () => void }[] = [
    { id: "dashboard", label: "Dashboard", fn: () => plugin.openDashboard() },
    { id: "calendar", label: "Calendar", fn: () => plugin.openCalendar() },
    { id: "tradelog", label: "Trade Log", fn: () => plugin.openTradeLog() },
    { id: "accounts", label: "Accounts", fn: () => plugin.openAccounts() },
  ];
  const LEFT_EXTRA = opts.extraNav ? [...opts.extraNav] : [];
  const leftItems = [...NAV_ITEMS, ...LEFT_EXTRA.map((e) => ({ id: e.id, label: e.label, fn: e.fn }))];

  // ---- Slim header: TJ brand (menu) + Centered Tabs (Dashboard, Calendar, Accounts) ----
  const header = root.createDiv({ cls: "tj-app-header" });
  const brand = header.createEl("button", { cls: "tj-app-brand", attr: { type: "button", title: "Menu (TJ)" } });
  brand.createSpan({ text: "TJ" });
  brand.addEventListener("click", () => {
    nav.classList.toggle("open");
  });

  const centerTrack = header.createDiv({ cls: "tj-app-header-track" });
  const TOP_TABS = [
    { id: "dashboard", label: "Dashboard", fn: () => plugin.openDashboard() },
    { id: "calendar", label: "Calendar", fn: () => plugin.openCalendar() },
    { id: "accounts", label: "Accounts", fn: () => plugin.openAccounts() },
  ];
  for (const t of TOP_TABS) {
    const tabBtn = centerTrack.createEl("button", {
      cls: "tj-app-tab" + (active === t.id ? " active" : ""),
      attr: { type: "button" },
      text: t.label,
    });
    tabBtn.addEventListener("click", () => t.fn());
  }

  const addBtn = header.createEl("button", { cls: "mod-cta tj-btn tj-app-add", attr: { type: "button", title: "Add a new trade" } });
  addBtn.createSpan({ text: "+ Add Trade" });
  addBtn.addEventListener("click", () => plugin.openAddPanel());

  // ---- Off-canvas left panel — opens with the TJ brand, closes on choice ----
  const nav = root.createDiv({ cls: "tj-app-nav" });
  nav.createDiv({ cls: "tj-app-nav-title", text: "Trading Journal" });
  for (const it of leftItems) {
    const b = nav.createEl("button", {
      cls: "tj-app-nav-item" + (active === it.id ? " active" : ""),
      attr: { type: "button", title: it.label },
    });
    b.createSpan({ cls: "tj-app-nav-label", text: it.label });
    b.addEventListener("click", () => {
      it.fn();
      nav.classList.remove("open");
    });
  }
  // Add Trade in sidebar nav so it's globally accessible (and keeps test querySelector('.tj-app-add') passing)
  const navAdd = nav.createEl("button", { cls: "tj-app-nav-item tj-app-add", attr: { type: "button", title: "Add a new trade" } });
  navAdd.createSpan({ cls: "tj-app-nav-label", text: "+ Add Trade" });
  navAdd.addEventListener("click", () => {
    plugin.openAddPanel();
    nav.classList.remove("open");
  });

  const closeBtn = nav.createEl("button", { cls: "tj-app-nav-item tj-app-nav-close", attr: { type: "button", title: "Close" } });
  closeBtn.createSpan({ cls: "tj-app-nav-label", text: "Close" });
  closeBtn.addEventListener("click", () => {
    nav.classList.remove("open");
  });

  const main = root.createDiv({ cls: "tj-app-main" });
  return main;
}
