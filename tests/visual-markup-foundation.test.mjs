import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const annotator = readFileSync(new URL("../src/views/printAnnotator.ts", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/views/tradeDetailView.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("visual markup uses the approved product language", () => {
  assert.match(detail, /text: "Mark up"/);
  assert.match(detail, /Mark up selected screenshot/);
  assert.doesNotMatch(detail, /text: "Annotate"/);
  assert.match(annotator, /Print marked up and saved/);
  assert.match(annotator, /Could not save the marked-up print/);
});

test("visual markup history restores complete snapshots for undo and redo", () => {
  assert.match(annotator, /interface HistorySnapshot/);
  assert.match(annotator, /const undoStack: HistorySnapshot\[\] = \[\]/);
  assert.match(annotator, /const redoStack: HistorySnapshot\[\] = \[\]/);
  assert.match(annotator, /shapes\.splice\(0, shapes\.length, \.\.\.cloneShapes\(state\.shapes\)\)/);
  assert.match(annotator, /redoStack\.push\(snapshot\(\)\)/);
  assert.match(annotator, /undoStack\.push\(snapshot\(\)\)/);
  assert.doesNotMatch(annotator, /const redo: Shape\[\]/);
});

test("visual markup cancels interrupted pointer operations", () => {
  assert.match(annotator, /canvas\.addEventListener\("pointercancel"/);
  assert.match(annotator, /canvas\.addEventListener\("lostpointercapture"/);
  assert.match(annotator, /const endDraw = \(cancelled = false\)/);
  assert.doesNotMatch(annotator, /canvas\.addEventListener\("pointerleave"/);
});

test("visual markup reports load and save state and writes the composite before the sidecar", () => {
  assert.match(annotator, /tj-anno-save-state/);
  assert.match(annotator, /Unsaved changes/);
  assert.match(annotator, /Save failed — retry/);
  assert.match(annotator, /saveB\.setAttr\("disabled", "true"\)/);
  const compositeWrite = annotator.indexOf("modifyBinary(existing, data)");
  const sidecarWrite = annotator.indexOf("adapter.write(jsonPath");
  assert.ok(compositeWrite >= 0 && sidecarWrite > compositeWrite, "composite must be written before sidecar");
});

test("visual markup viewer exposes the intended zoom and pan guidance", () => {
  assert.match(detail, /wheel zooms around the pointer/);
  assert.match(detail, /dragging pans the image/);
  assert.match(detail, /Scroll to zoom · drag to pan · Esc to close/);
  assert.match(css, /\.tj-td-lightbox-hint/);
});

test("visual markup uses contextual appearance controls and independent fill opacity", () => {
  assert.match(annotator, /const activeTool = selected\?\.tool \?\? tool/);
  assert.match(annotator, /isText \? "Text color" : isShape \? "Outline color" : "Color"/);
  assert.match(annotator, /const fillOpacity = \(s\.fillOpacity \?\? s\.opacity \?\? 100\) \/ 100/);
  assert.match(annotator, /const strokeOpacity = \(s\.strokeOpacity \?\? s\.opacity \?\? 100\) \/ 100/);
  assert.match(annotator, /section\("Fill opacity"\)/);
  assert.match(annotator, /section\("Text size"\)/);
  assert.match(annotator, /const BG_CHOICES[\s\S]*value: c\.hex/);
  assert.match(annotator, /hasEmbeddedAlpha/);
  assert.match(annotator, /let currentTextBackgroundColor = "transparent"/);
  assert.match(annotator, /backgroundColor: currentTextBackgroundColor/);
  assert.match(annotator, /else if \(isText\) currentTextBackgroundColor = choice\.value/);
});

test("text does not inherit a previous shape fill by default", () => {
  const textBlock = annotator.match(/tool: "text",[\s\S]*?text: value,[\s\S]*?\n          \}\);/);
  assert.ok(textBlock, "text creation block should exist");
  assert.match(textBlock[0], /backgroundColor: currentTextBackgroundColor/);
  assert.match(textBlock[0], /fillOpacity: currentTextFillOpacity/);
});

test("text supports explicit typography without an editing border", () => {
  assert.match(annotator, /fontWeight\?: "normal" \| "bold"/);
  assert.match(annotator, /fontStyle\?: "normal" \| "italic"/);
  assert.match(annotator, /section\("Text weight"\)/);
  assert.match(annotator, /section\("Text style"\)/);
  assert.match(annotator, /fontWeight: currentFontWeight/);
  assert.match(annotator, /fontStyle: currentFontStyle/);
  assert.match(annotator, /ta\.setCssStyles\(\{ border: "none" \}\)/);
  assert.match(css, /\.tj-anno-textinput[\s\S]*background: transparent !important/);
  assert.match(css, /\.tj-anno-textinput[\s\S]*border: none !important/);
});

test("fit control is labelled as an image reset and has a keyboard equivalent", () => {
  assert.match(annotator, /mkIcon\(viewActions, "tj-anno-tool", "maximize", "Fit image"\)/);
  assert.match(annotator, /if \(e\.key === "0"\)[\s\S]*fitToView\(\);[\s\S]*redraw\(\);/);
});

test("view controls expose zoom out, zoom in and the current percentage", () => {
  assert.match(annotator, /mkIcon\(viewActions, "tj-anno-tool", "minus", "Zoom out"\)/);
  assert.match(annotator, /mkIcon\(viewActions, "tj-anno-tool", "plus", "Zoom in"\)/);
  assert.match(annotator, /cls: "tj-anno-zoom-label"/);
  assert.match(annotator, /const zoomAt = \(factor: number/);
  assert.match(annotator, /zoomOutB\.addEventListener\("click"/);
  assert.match(annotator, /zoomInB\.addEventListener\("click"/);
  assert.match(css, /\.tj-anno-view-actions/);
});

test("clicking the zoom percentage resets the view to 100%", () => {
  assert.match(annotator, /"aria-label": "Reset zoom to 100%"/);
  assert.match(annotator, /zoomLabel\.addEventListener\("click", \(\) => zoomAt\(1 \/ view\.scale\)\)/);
  assert.match(css, /\.tj-anno-zoom-label:hover/);
});

test("zoom percentage stays a quiet text control", () => {
  assert.match(css, /\.tj-anno-zoom-label[\s\S]*background: transparent !important/);
  assert.match(css, /\.tj-anno-zoom-label[\s\S]*box-shadow: none !important/);
  assert.match(css, /\.tj-anno-zoom-label:hover[\s\S]*background: transparent !important/);
});
