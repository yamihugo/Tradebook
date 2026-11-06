/**
 * chartKit — the chart shapes the journal reuses.
 *
 * Pure-ish and DOM-in: an adapter in a widget computes the values, the shape
 * renders them. Shapes:
 *   - treemap        (tiles sized by activity, coloured by result)
 *
 * NO VERTICAL BARS: performance-by-X widgets use a treemap.
 *
 * No styling lives here beyond class names; the CSS is owned by styles.css and
 * added with the widget that first uses the shape.
 */

import { attachTip } from "./tip";

// ------------------------------------------------------------------ treemap

export interface TreemapTile {
  key: string;
  label: string;
  /** Net result — drives the colour and the value text. */
  net: number;
  /** Activity — drives the tile width. */
  count: number;
  /** Net-positive results in the bucket. */
  wins: number;
  /** Wins + losses: the win-rate denominator. Break-evens stay out of it. */
  decided: number;
  tip?: { title: string; value?: string; sub?: string };
}

export interface TreemapSpec {
  tiles: TreemapTile[];
  className?: string;
  /** Tiles beyond this are merged into "Other". Default 6. */
  maxTiles?: number;
  formatMoney?: (v: number) => string;
  /** When set, tiles become clickable (e.g. to open the Trade Log filtered). */
  onTileClick?: (tile: TreemapTile) => void;
  /** Key of the tile to mark as active (an outline), when clickable. */
  activeKey?: string;
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
  let mergedTile: TreemapTile | null = null;
  if (tiles.length > maxTiles) {
    const head = tiles.slice(0, maxTiles);
    const rest = tiles.slice(maxTiles);
    mergedTile = rest.reduce(
      (a, t) => ({
        key: "other",
        label: "Other",
        net: a.net + t.net,
        count: a.count + t.count,
        wins: a.wins + t.wins,
        decided: a.decided + t.decided,
      }),
      { key: "other", label: "Other", net: 0, count: 0, wins: 0, decided: 0 }
    );
    tiles = [...head, mergedTile];
  }

  const maxAbs = Math.max(...tiles.map((t) => Math.abs(t.net)), 1);
  const total = tiles.reduce((a, t) => a + t.count, 0) || 1;

  for (const t of tiles) {
    const tile = wrap.createDiv({ cls: "tj-treemap-tile" });
    tile.style.flex = `${Math.max(1, t.count)} 1 0`;
    const good = t.net >= 0;
    const strength = 0.14 + (Math.abs(t.net) / maxAbs) * 0.34;
    // Colour comes from CSS, built on the tone tokens; only the intensity travels inline.
    tile.addClass(good ? "pos" : "neg");
    tile.style.setProperty("--tj-tile-strength", strength.toFixed(2));
    tile.createDiv({ cls: "tj-treemap-t", text: t.label });
    tile.createDiv({ cls: "tj-treemap-v " + (good ? "tj-pos" : "tj-neg"), text: fmt(t.net) });
    tile.createDiv({ cls: "tj-treemap-w", text: t.decided ? `${Math.round((t.wins / t.decided) * 100)}% win` : "—" });
    const tip = t.tip ?? {
      title: t.label,
      value: fmt(t.net),
      sub: `${t.count} trades (${Math.round((t.count / total) * 100)}% of activity)`,
    };
    if (spec.onTileClick && t !== mergedTile) {
      tile.addClass("tj-treemap-tile-click");
      if (spec.activeKey === t.key) tile.addClass("is-active");
      attachTip(tile, { ...tip, sub: [tip.sub, "Click to open in the Trade Log."].filter(Boolean).join(" ") });
      tile.addEventListener("click", () => spec.onTileClick!(t));
    } else {
      attachTip(tile, tip);
    }
  }
  return wrap;
}


// Test hook, same pattern as the other pure-ish modules.
if (typeof window !== "undefined") {
  window.__tjChartKit = { renderTreemap };
}
