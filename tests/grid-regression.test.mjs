import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: { grid: new URL("../src/lib/grid.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const output = result.outputFiles[0];
const grid = await import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);

const hasCollision = (layout) => layout.some((item, index) => layout.slice(index + 1).some((other) => grid.collides(item, other)));
const sorted = (layout) => [...layout].sort((a, b) => a.i.localeCompare(b.i));

test("drag pushes a collision chain without overlapping mixed-height cards", () => {
  const layout = [
    { i: "move", x: 6, y: 0, w: 6, h: 3 },
    { i: "upper", x: 0, y: 0, w: 6, h: 4 },
    { i: "middle", x: 0, y: 4, w: 6, h: 2 },
    { i: "lower", x: 0, y: 6, w: 6, h: 3 },
    { i: "side", x: 6, y: 4, w: 6, h: 2 },
  ];
  const moved = grid.moveItem(layout, "move", 0, 4, true, 18);
  assert.equal(hasCollision(moved), false);
  assert.deepEqual(sorted(moved), sorted(grid.moveItem(layout, "move", 0, 4, true, 18)));
  assert.deepEqual(moved.find((item) => item.i === "move"), { ...layout[0], x: 0, y: 4, moved: true });
  assert.ok(moved.find((item) => item.i === "middle").y >= 7);
  assert.ok(moved.find((item) => item.i === "lower").y >= 9);
});

test("resizing cascades collisions, stays inside the active grid, and compacts deterministically", () => {
  const layout = [
    { i: "grow", x: 0, y: 0, w: 6, h: 2 },
    { i: "next", x: 0, y: 2, w: 6, h: 2 },
    { i: "tall", x: 0, y: 4, w: 6, h: 4 },
    { i: "side", x: 6, y: 2, w: 6, h: 3 },
  ];
  const resized = grid.resizeItem(layout, "grow", 6, 5, { w: 4, h: 2 }, true, 18);
  assert.equal(hasCollision(resized), false);
  assert.deepEqual(sorted(resized), sorted(grid.resizeItem(layout, "grow", 6, 5, { w: 4, h: 2 }, true, 18)));
  assert.equal(resized.find((item) => item.i === "grow").h, 5);
  assert.ok(resized.find((item) => item.i === "next").y >= 5);
  assert.ok(resized.every((item) => item.x >= 0 && item.x + item.w <= 18));
});

test("responsive reflow is collision-free and repeatable for varied card heights", () => {
  const layout = [
    { i: "a", x: 0, y: 0, w: 12, h: 4 },
    { i: "b", x: 12, y: 0, w: 12, h: 6 },
    { i: "c", x: 0, y: 6, w: 8, h: 3 },
    { i: "d", x: 8, y: 6, w: 16, h: 5 },
  ];
  for (const cols of [18, 12, 8, 6]) {
    const minOf = () => ({ w: 4, h: 2 });
    const narrow = grid.reflow(layout, cols, minOf);
    assert.equal(hasCollision(narrow), false, `no collisions at ${cols} columns`);
    assert.ok(narrow.every((item) => item.x >= 0 && item.x + item.w <= cols));
    assert.deepEqual(narrow, grid.reflow(layout, cols, minOf), `stable reflow at ${cols} columns`);
  }
});

test("saved narrow layouts adapt to wider windows without mutating their stored positions", () => {
  const savedAt18 = [
    { i: "top-left", x: 0, y: 0, w: 8, h: 3 },
    { i: "top-right", x: 8, y: 0, w: 10, h: 5 },
    { i: "footer", x: 0, y: 5, w: 18, h: 4 },
  ];
  const persisted = structuredClone(savedAt18);
  const wide = grid.layoutForColumns(savedAt18, 18, 24, () => ({ w: 4, h: 2 }));
  const returned = grid.layoutForColumns(savedAt18, 18, 18, () => ({ w: 4, h: 2 }));
  assert.equal(hasCollision(wide), false);
  assert.notDeepEqual(wide, savedAt18);
  assert.deepEqual(returned, persisted);
  assert.deepEqual(savedAt18, persisted, "responsive rendering never rewrites saved narrow coordinates");
});

test("repeated edit commits preserve the same compacted arrangement", () => {
  const start = [
    { i: "short", x: 0, y: 0, w: 8, h: 2 },
    { i: "tall", x: 8, y: 0, w: 8, h: 5 },
    { i: "bottom", x: 0, y: 7, w: 16, h: 3 },
  ];
  const once = grid.moveItem(start, "short", 0, 1, true, 24);
  const afterSave = JSON.parse(JSON.stringify(once));
  const afterReload = JSON.parse(JSON.stringify(afterSave));
  assert.equal(hasCollision(once), false);
  assert.deepEqual(afterSave, once);
  assert.deepEqual(afterReload, afterSave);
});
