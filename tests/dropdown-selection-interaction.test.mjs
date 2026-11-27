import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const win = dom.window;
Object.assign(globalThis, { document: win.document, window: win, MutationObserver: win.MutationObserver });
Object.assign(win.HTMLElement.prototype, {
  createEl(tag, options = {}) {
    const element = this.ownerDocument.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text !== undefined) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, String(value));
    this.append(element);
    return element;
  },
  createDiv(options = {}) { return this.createEl("div", options); },
  createSpan(options = {}) { return this.createEl("span", options); },
  empty() { this.replaceChildren(); },
  addClass(...names) { this.classList.add(...names); },
  removeClass(...names) { this.classList.remove(...names); },
  hasClass(name) { return this.classList.contains(name); },
  toggleClass(name, force) { this.classList.toggle(name, force); },
  setText(text) { this.textContent = text; },
  setAttr(name, value) { this.setAttribute(name, value); },
  setCssStyles(styles) {
    for (const [name, value] of Object.entries(styles)) {
      if (value === "") this.style.removeProperty(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
      else this.style[name] = value;
    }
  },
});

const built = await build({
  entryPoints: [new URL("../src/lib/dropdown.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{
    name: "stub-tips",
    setup(builder) {
      builder.onResolve({ filter: /^\.\/tip$/ }, () => ({ path: "tip", namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const attachTip = () => {};", loader: "js" }));
    },
  }],
});
const dropdown = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

function pointerClick(target) {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    target.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Psychology and Execution/Mistakes multi-select stay open until options are selected", async () => {
  for (const [label, chosen] of [["Psychology", []], ["Execution / Mistakes", []]]) {
    const host = document.body.createDiv();
    const changed = [];
    const picker = dropdown.mountMultiDropdown(host, [
      { id: "first", label: "First" },
      { id: "second", label: "Second" },
    ], chosen, (values) => changed.push(values));
    const trigger = picker.querySelector(".tj-mg-dd-btn");
    pointerClick(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", `${label}: trigger opens the picker`);
    const list = document.querySelector(".tj-mg-dd-list.is-portal");
    assert.ok(list, `${label}: list is present in the body portal`);
    const first = [...list.querySelectorAll("[data-dd-value]")].find((row) => row.dataset.ddValue === "first");
    assert.ok(first, `${label}: option is available`);
    pointerClick(first);
    await tick();
    assert.equal(trigger.getAttribute("aria-expanded"), "true", `${label}: selecting an item does not dismiss the multi-select`);
    assert.deepEqual(changed.at(-1), ["first"]);
  }
  pointerClick(document.body);
  await tick();
  assert.equal(document.querySelector(".tj-mg-dd-list.is-portal"), null, "outside click closes the active selector");
});

test("Why did I close? forwards the selected reason and closes the single-select menu", () => {
  const host = document.body.createDiv();
  let selected = "";
  const picker = dropdown.mountDropdown(host, [
    { id: "stop", label: "Stop reached" },
    { id: "target", label: "Target reached" },
  ], "", (id) => { selected = id; });
  const trigger = picker.querySelector(".tj-mg-dd-btn");
  pointerClick(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const list = document.querySelector(".tj-mg-dd-list.is-portal");
  assert.ok(list);
  const option = [...list.querySelectorAll("[data-dd-value]")].find((row) => row.dataset.ddValue === "target");
  assert.ok(option);
  pointerClick(option);
  assert.equal(selected, "target", "the selected reason reaches the consumer callback");
  assert.equal(trigger.getAttribute("aria-expanded"), "false", "single-select closes after selection");
  assert.equal(trigger.querySelector(".tj-mg-dd-val").textContent, "Target reached");
});

test.after(() => dom.window.close());
