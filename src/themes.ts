// Complete, self-contained themes. No external plugin required.
// Each theme can define: background pattern, background colours, surface,
// border, accent, dot colour, a typeface and an optional glow — so presets
// feel like real themes, not just accent swaps.
// Palettes inspired by well-known schemes (Tokyo Night, Catppuccin, Dracula,
// Nord, Gruvbox, Rose Pine, Kanagawa, Cyberpunk).

export type ThemePattern = "none" | "dots" | "grid" | "scanlines" | "stars" | "aurora" | "gradient";
export type ThemeFont = "sans" | "mono" | "serif";

export interface ThemeDef {
  id: string;
  name: string;
  pattern: ThemePattern;
  font: ThemeFont;
  /** Accent ("" = inherit Obsidian's accent). */
  accent: string;
  /** Dot / pattern colour. */
  dotColor: string;
  /** Background base ("" = Obsidian background). */
  bg: string;
  /** Second background colour (for the gradient pattern). */
  bg2: string;
  /** Card / panel surface ("" = theme default). */
  surface: string;
  /** Border tint ("" = theme default). */
  border: string;
  /** Subtle neon glow on accent elements. */
  glow: boolean;
}

const t = (
  id: string, name: string, pattern: ThemePattern, font: ThemeFont,
  accent: string, dotColor: string, bg: string, bg2: string, surface: string, border: string, glow = false
): ThemeDef => ({ id, name, pattern, font, accent, dotColor, bg, bg2, surface, border, glow });

export const THEMES: ThemeDef[] = [
  // Follows Obsidian entirely.
  t("default", "Default", "none", "sans", "", "", "", "", "", ""),
  // Dotted notebook on the Obsidian background.
  t("dotted", "Dotted Notebook", "dots", "sans", "", "", "", "", "", ""),

  // Tokyo Night — downtown lights: dark blue, stars, blue/purple accents.
  t("tokyo", "Tokyo Night", "stars", "sans", "#7aa2f7", "#3b4261", "#1a1b26", "#16161e", "#1f2335", "#2f334d"),
  // Tech — grid + monospace + cyan glow.
  t("tech", "Tech", "grid", "mono", "#00e5ff", "#1f3b44", "#0f171c", "#0b1116", "#162329", "#22333b", true),
  // Midnight — ultra dark, barely-there contrast.
  t("midnight", "Midnight", "none", "sans", "#7c5cff", "#2a2c3a", "#0b0e14", "#0b0e14", "#14171f", "#242833"),
  // Notion — warm neutral, amber.
  t("notion", "Notion", "none", "sans", "#d97706", "#3a352e", "#1f1d1a", "#1f1d1a", "#26231f", "#3a352e"),
  // Ocean — deep blue gradient.
  t("ocean", "Ocean", "gradient", "sans", "#0ea5e9", "#1e3a5f", "#0d1b26", "#0a2f45", "#122635", "#1e3a5f"),
  // Forest — green dots + serif.
  t("forest", "Forest", "dots", "serif", "#22c55e", "#2f4f3f", "#0f1a14", "#0f1a14", "#16241b", "#274233"),
  // Mono — grayscale grid + monospace.
  t("mono", "Mono", "grid", "mono", "#9aa0a6", "#2c2e33", "#141517", "#141517", "#1e2024", "#33363b"),
  // Paper — warm dots + serif (notebook feel).
  t("paper", "Paper", "dots", "serif", "#b08d57", "#c9c2b8", "#1a1712", "#1a1712", "#241f18", "#3a3226"),
  // Cyberpunk — neon scanlines + monospace + strong glow.
  t("cyber", "Cyberpunk", "scanlines", "mono", "#ff2d95", "#3a1a52", "#140b1e", "#1e1030", "#1e1030", "#3a1a52", true),
  // Kanagawa — ink + gold, soft aurora.
  t("kanagawa", "Kanagawa", "aurora", "serif", "#dca561", "#2a2a37", "#1f1f28", "#16161d", "#2a2a37", "#3a3a4a"),
  // Rose Pine — muted rose/pine, soft gradient.
  t("rosepine", "Rose Pine", "gradient", "sans", "#ebbcba", "#31748f", "#191724", "#26233a", "#1f1d2e", "#403d52"),
  // Gruvbox — retro warm, dots.
  t("gruvbox", "Gruvbox", "dots", "mono", "#d79921", "#504945", "#282828", "#282828", "#32302f", "#504945"),
  // Nord — arctic aurora, icy blue.
  t("nord", "Nord", "aurora", "sans", "#88c0d0", "#4c566a", "#2e3440", "#3b4252", "#3b4252", "#4c566a"),
];

export function themeById(id: string | undefined): ThemeDef {
  return THEMES.find((x) => x.id === id) ?? THEMES[0];
}
