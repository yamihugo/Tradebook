/** Tradebook brand mark — two candlesticks, the sober mark the plugin signs with.
 *
 *  Registered once in `onload()` via `addIcon()`, then used anywhere with
 *  `setIcon(el, BRAND_ICON_ID)`. Obsidian renders the inner SVG inside a
 *  `0 0 100 100` view box, so all geometry below assumes 100×100.
 */
export const BRAND_ICON_ID = "tradebook-mark";

const stroke = (w: number): string =>
  `fill:none;stroke:currentColor;stroke-width:${w};stroke-linecap:round;stroke-linejoin:round`;

/** Inner SVG markup only (no outer <svg>): two candlesticks, minimal and neutral. */
export const BRAND_ICON_SVG =
  `<rect x="26" y="34" width="14" height="34" rx="4" style="${stroke(7)}"/>` +
  `<path d="M33 22 L33 34" style="${stroke(7)}"/>` +
  `<path d="M33 68 L33 82" style="${stroke(7)}"/>` +
  `<rect x="58" y="22" width="14" height="42" rx="4" style="${stroke(7)}"/>` +
  `<path d="M65 12 L65 22" style="${stroke(7)}"/>` +
  `<path d="M65 64 L65 78" style="${stroke(7)}"/>`;
