// A lightweight, dependency-free implementation of the classic
// react-grid-layout interactions (the same engine Journalit uses for its
// dashboard widgets):
//   - fixed column grid (GRID_COLS)
//   - items {i, x, y, w, h}
//   - drag: collision resolution + live compaction around the dragged item
//   - drop: full vertical compaction (cards snap up into place)
//   - resize: clamped w/h + compaction around the resized item
// All functions are pure (no DOM) so they can be unit-tested.

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  static?: boolean;
  moved?: boolean;
}

export const GRID_COLS = 12;
export const ROW_PX = 56;
export const GAP = 14;

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

/** Do two grid rects overlap? Same-cell items never "collide" with themselves. */
export function collides(a: GridItem, b: GridItem): boolean {
  if (a.i === b.i) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Number of rows the layout occupies. */
export function gridRows(layout: GridItem[]): number {
  return layout.reduce((m, it) => Math.max(m, it.y + it.h), 0);
}

function placeUp(sorted: GridItem[], exemptId?: string): GridItem[] {
  const placed: GridItem[] = [];
  for (const it of sorted) {
    if (it.static || it.i === exemptId) {
      placed.push({ ...it });
      continue;
    }
    const cur = { ...it };
    let y = 0;
    for (let guard = 0; guard < 500; guard++) {
      const blockers = placed.filter((p) => collides({ ...cur, y }, p));
      if (blockers.length === 0) break;
      y = Math.max(...blockers.map((p) => p.y + p.h));
    }
    cur.y = y;
    placed.push(cur);
  }
  return placed;
}

/** Compact all items upward (classic vertical compaction, rgl default). */
export function compactVertical(layout: GridItem[]): GridItem[] {
  const sorted = [...layout.map((it) => ({ ...it }))].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i)
  );
  return placeUp(sorted);
}

/** Compact every item except `exemptId` — the item being dragged stays put. */
export function compactExcept(layout: GridItem[], exemptId: string): GridItem[] {
  const sorted = [...layout.map((it) => ({ ...it }))].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i)
  );
  return placeUp(sorted, exemptId);
}

/**
 * Simulate dragging `id` to grid cell (nx, ny).
 * Conflicting cards are pushed below the dragged card, then everything else
 * compacts upward around it (live "widget" feel).
 */
export function moveItem(layout: GridItem[], id: string, nx: number, ny: number): GridItem[] {
  const l = layout.map((it) => ({ ...it }));
  const idx = l.findIndex((it) => it.i === id);
  if (idx < 0) return l;
  const it = l[idx];
  if (it.static) return l;
  it.x = clamp(nx, 0, GRID_COLS - it.w);
  it.y = Math.max(0, ny);
  it.moved = true;
  let guard = 0;
  while (guard++ < 500) {
    const blockers = l.filter((o) => o !== it && collides(it, o));
    if (blockers.length === 0) break;
    for (const o of blockers) o.y = it.y + it.h;
  }
  return compactExcept(l, id);
}

/** Simulate resizing `id` to (nw, nh), keeping its top-left corner fixed. */
export function resizeItem(layout: GridItem[], id: string, nw: number, nh: number): GridItem[] {
  const l = layout.map((it) => ({ ...it }));
  const it = l.find((x) => x.i === id);
  if (!it || it.static) return l;
  it.w = clamp(nw, 1, GRID_COLS - it.x);
  it.h = Math.max(1, nh);
  it.moved = true;
  return compactExcept(l, id);
}

/** Place a new widget in the first free cell (top-left scan, like css dense packing). */
export function placeNew(layout: GridItem[], i: string, w: number, h: number): GridItem[] {
  const l = layout.map((it) => ({ ...it }));
  if (l.some((x) => x.i === i)) return l;
  const newItem: GridItem = { i, x: 0, y: 0, w, h };
  let y = 0;
  outer: for (;;) {
    for (let x = 0; x + w <= GRID_COLS; x++) {
      if (!l.some((p) => collides({ ...newItem, x, y }, p))) {
        newItem.x = x;
        newItem.y = y;
        break outer;
      }
    }
    y++;
  }
  l.push(newItem);
  return compactVertical(l);
}

// Test hook for the smoke harness (jsdom): the pure engine is easy to verify.
if (typeof window !== "undefined") {
  (window as any).__tjGrid = {
    GRID_COLS,
    ROW_PX,
    GAP,
    collides,
    compactVertical,
    compactExcept,
    moveItem,
    resizeItem,
    placeNew,
    gridRows,
  };
}