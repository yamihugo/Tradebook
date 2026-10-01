import { typeLabel } from "./lib/accountTypes";

export interface FilterOption {
  id: string;
  label: string;
}

/**
 * Account-type filter chips. The labels come from Manage → Types, so renaming a
 * type there renames it everywhere instead of leaving a stale "Evals" behind.
 */
export function accountFilters(): FilterOption[] {
  return [
    { id: "all", label: "All" },
    { id: "demo", label: typeLabel("demo") },
    { id: "eval", label: typeLabel("eval") },
    { id: "funded", label: typeLabel("funded") },
    { id: "live", label: typeLabel("live") },
    { id: "personal", label: typeLabel("personal") },
    { id: "unknown", label: typeLabel("unknown") },
  ];
}

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

export function svgPath(svg: SVGSVGElement, d: string, cls?: string): SVGPathElement {
  const path = svg.createSvg("path", { cls });
  path.setAttribute("d", d);
  return path;
}

/**
 * App shell — intentionally minimal: no custom in-app nav.
 * Navigation lives in Obsidian's native left sidebar (ribbon icons +
 * command palette), which is the Obsidian-native way to move around.
 */
export function renderAppShell(
  root: HTMLElement,
  plugin: any,
  active: string,
  opts: { extraNav?: { id: string; label: string; fn: () => void }[] } = {}
): HTMLElement {
  void opts;
  void active;
  root.empty();
  root.addClass("tj-app");
  root.toggleClass("tj-privacy", plugin?.settings?.privacyMode === true);
  // Theme & appearance (settings): dotted notebook background + custom accent.
  const theme = plugin?.settings?.theme;
  if (theme) {
    const pattern = theme.pattern || (theme.background === "dots" ? "dots" : "none");
    for (const p of ["none", "dots", "grid", "scanlines", "stars", "aurora", "gradient"]) {
      root.toggleClass("tj-pat-" + p, pattern === p);
    }
    root.toggleClass("tj-font-mono", theme.font === "mono");
    root.toggleClass("tj-font-serif", theme.font === "serif");
    root.toggleClass("tj-glow", theme.glow === true);
    root.style.setProperty("--tj-accent", theme.accent || "");
    root.style.setProperty("--tj-dot", theme.dotColor || "");
    root.style.setProperty("--tj-surface", theme.surface || "");
    root.style.setProperty("--tj-bg", theme.bg || "");
    root.style.setProperty("--tj-bg2", theme.bg2 || theme.bg || "");
    root.style.setProperty("--tj-border", theme.border || "");
  }
  const main = root.createDiv({ cls: "tj-app-main" });
  return main;
}

/**
 * Open this plugin's settings tab, optionally preselecting a sub-tab
 * ("main" | "timezone" | "appearance" | "accounts"). Works across Obsidian
 * versions: prefers app.setting.openTabById, falls back to app.setting.open.
 */
export function openPluginSettings(app: any, plugin: any, tabId?: string): void {
  const setting = app?.setting;
  const pluginId = plugin?.manifest?.id;
  if (!setting || !pluginId) return;
  try {
    const pool: any[] = [
      ...(Array.isArray(setting.settingTabs) ? setting.settingTabs : []),
      ...(Array.isArray(setting.pluginTabs) ? setting.pluginTabs : []),
    ];
    const mine = pool.find((t) => t && t.id === pluginId);
    if (mine && tabId) mine.active = tabId;
    if (typeof setting.openTabById === "function") {
      setting.openTabById(pluginId);
      return;
    }
  } catch (err) {
    console.error("[tradebook] openTabById failed:", err);
  }
  try {
    if (typeof setting.open === "function") setting.open();
    const tabs = setting.settingTabs ?? [];
    const tab = tabs.find((t: any) => t.id === pluginId);
    if (tab && typeof tab.display === "function") tab.display();
  } catch (err) {
    console.error("[tradebook] settings open failed:", err);
  }
}
