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

/**
 * Re-flow a layout into a smaller number of columns (responsive). Items keep
 * their order (top-left to bottom-right) and wrap onto new rows instead of
 * shrinking — the Journalit behaviour. Widths larger than `cols` are capped.
 *
 * `minOf` gives each item a minimum size; an item never re-flows smaller than
 * its minimum, and a minimum wider than `cols` is capped to full width.
 */
export function reflow(
  layout: GridItem[],
  cols: number,
  minOf?: (id: string) => { w: number; h: number } | undefined
): GridItem[] {
  const sorted = [...layout]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((it) => {
      const m = minOf?.(it.i);
      return {
        ...it,
        w: Math.min(Math.max(it.w, m?.w ?? 1), cols),
        h: Math.max(it.h, m?.h ?? 1),
      };
    });
  const placed: GridItem[] = [];
  for (const it of sorted) {
    let y = 0;
    let done = false;
    while (!done) {
      for (let x = 0; x + it.w <= cols; x++) {
        const trial: GridItem = { i: it.i, x, y, w: it.w, h: it.h };
        if (!placed.some((p) => collides(trial, p))) {
          if ((it as any).static) (trial as any).static = true;
          placed.push(trial);
          done = true;
          break;
        }
      }
      if (!done) y++;
    }
  }
  return compactVertical(placed);
}

/** Adapt a saved grid to the viewport without mutating its stored coordinates. */
export function layoutForColumns(
  layout: GridItem[],
  fromCols: number,
  toCols: number,
  minOf?: (id: string) => { w: number; h: number } | undefined,
): GridItem[] {
  if (fromCols === toCols) return layout.map((item) => ({ ...item }));
  if (toCols < fromCols) return reflow(layout, toCols, minOf);
  const ratio = toCols / fromCols;
  const scaled = layout.map((item) => {
    const min = minOf?.(item.i);
    const w = Math.min(toCols, Math.max(min?.w ?? 1, Math.round(item.w * ratio)));
    return { ...item, x: clamp(Math.round(item.x * ratio), 0, toCols - w), w };
  });
  return compactVertical(scaled);
}

export const GRID_COLS = 24;
export const ROW_PX = 44;
export const GAP = 12;

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

function placeAtFirstFreeRow(item: GridItem, placed: GridItem[], fromY: number): GridItem {
  const next = { ...item, y: Math.max(0, fromY) };
  for (let guard = 0; guard < 10000; guard++) {
    const blockers = placed.filter((other) => collides(next, other));
    if (!blockers.length) return next;
    next.y = Math.max(next.y + 1, ...blockers.map((other) => other.y + other.h));
  }
  return next;
}

function placeUp(sorted: GridItem[], exemptId?: string): GridItem[] {
  // Fixed and exempt cards are obstacles from the start of compaction.
  const fixed = sorted.filter((item) => item.static || item.i === exemptId).map((item) => ({ ...item }));
  const placed = [...fixed];
  for (const item of sorted.filter((candidate) => !candidate.static && candidate.i !== exemptId)) {
    placed.push(placeAtFirstFreeRow(item, placed, 0));
  }
  return placed.sort((a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i));
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

/** Move one item, cascade collisions down, then return the exact visible layout. */
export function moveItem(layout: GridItem[], id: string, nx: number, ny: number, compact = true, cols = GRID_COLS): GridItem[] {
  const l = layout.map((it) => ({ ...it }));
  const idx = l.findIndex((it) => it.i === id);
  if (idx < 0) return l;
  const target = l[idx];
  if (target.static) return l;
  target.x = clamp(nx, 0, cols - target.w);
  target.y = Math.max(0, ny);
  target.moved = true;
  return resolveItemLayout(l, id, compact);
}

/** Resize one item, cascading collisions with the same policy as drag. */
export function resizeItem(
  layout: GridItem[],
  id: string,
  nw: number,
  nh: number,
  min?: { w: number; h: number },
  compact = true,
  cols = GRID_COLS
): GridItem[] {
  const l = layout.map((it) => ({ ...it }));
  const it = l.find((x) => x.i === id);
  if (!it || it.static) return l;
  const minW = Math.min(min?.w ?? 1, cols - it.x);
  it.w = clamp(nw, minW, cols - it.x);
  it.h = Math.max(min?.h ?? 1, nh);
  it.moved = true;
  return resolveItemLayout(l, id, compact);
}

/** Keep the edited item in its requested cell and cascade each collision once. */
export function resolveItemLayout(layout: GridItem[], id: string, compact = true): GridItem[] {
  const source = layout.map((item) => ({ ...item }));
  const target = source.find((item) => item.i === id);
  if (!target) return source;
  if (target.static) return compact ? compactVertical(source) : source;

  const fixed = source.filter((item) => item.i !== id && item.static);
  const placed: GridItem[] = fixed.map((item) => ({ ...item }));
  const resolvedTarget = placeAtFirstFreeRow(target, placed, target.y);
  placed.push(resolvedTarget);

  const rest = source
    .filter((item) => item.i !== id && !item.static)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i));
  for (const item of rest) placed.push(placeAtFirstFreeRow(item, placed, item.y));

  // Keep the manipulated item anchored to the requested pointer cell. Compact
  // its neighbors around it, not the target itself: the preview cannot snap the
  // dragged/resized card away from the cell the user chose.
  return compact
    ? compactExcept(placed, id)
    : placed.sort((a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i));
}

/** Place a new widget in the first free cell (top-left scan, like css dense packing). */
export function placeNew(layout: GridItem[], i: string, w: number, h: number, cols = GRID_COLS): GridItem[] {
  const l = layout.map((it) => ({ ...it }));
  if (l.some((x) => x.i === i)) return l;
  const newItem: GridItem = { i, x: 0, y: 0, w: clamp(w, 1, cols), h: Math.max(1, h) };
  let y = 0;
  outer: for (;;) {
    for (let x = 0; x + w <= cols; x++) {
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
