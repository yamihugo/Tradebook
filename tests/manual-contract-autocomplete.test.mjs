import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { test } from "node:test";

const dom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>", {
  pretendToBeVisual: true,
});
const win = dom.window;
Object.assign(globalThis, {
  document: win.document,
  window: win,
  MutationObserver: win.MutationObserver,
});

const proto = win.HTMLElement.prototype;
proto.createEl = function (tag, options = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text !== undefined) el.textContent = options.text;
  for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, String(value));
  this.appendChild(el);
  return el;
};
proto.createDiv = function (options = {}) { return this.createEl("div", options); };
proto.createSpan = function (options = {}) { return this.createEl("span", options); };
proto.addClass = function (...names) { this.classList.add(...names); };
proto.removeClass = function (...names) { this.classList.remove(...names); };
proto.hasClass = function (name) { return this.classList.contains(name); };
proto.toggleClass = function (name, force) { this.classList.toggle(name, force); };
proto.setText = function (text) { this.textContent = text; };
proto.empty = function () { this.replaceChildren(); };
proto.setCssStyles = function (styles) {
  for (const [name, value] of Object.entries(styles)) {
    if (value === "") this.style.removeProperty(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
    else this.style[name] = value;
  }
};

const built = await build({
  entryPoints: [new URL("../src/lib/dropdown.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{
    name: "stub-tips",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/tip$/ }, () => ({ path: "tip", namespace: "stub" }));
      buildApi.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: "export const attachTip = () => {};",
        loader: "js",
      }));
    },
  }],
});
const bundle = built.outputFiles[0].text;
const dropdowns = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);

const contractItems = [
  { value: "NQ", label: "NQ (mini) — E-mini Nasdaq 100" },
  { value: "MNQ", label: "MNQ (micro) — Micro E-mini Nasdaq 100" },
  { value: "ES", label: "ES (mini) — E-mini S&P 500" },
];

function mountPicker() {
  document.body.className = "theme-light";
  document.body.innerHTML = "<div class='tj-addtrade-modal'><div class='tj-addpanel'><div class='tj-add-ctl' id='host'></div></div></div>";
  const host = document.getElementById("host");
  const input = dropdowns.mountAutocomplete(host, contractItems, "", {
    placeholder: "Contract…",
    ariaLabel: "Symbol",
  });
  const list = document.getElementById(input.getAttribute("aria-controls"));
  input.getBoundingClientRect = () => ({
    left: 40, right: 280, top: 100, bottom: 134, width: 240, height: 34,
    x: 40, y: 100, toJSON: () => ({}),
  });
  Object.defineProperty(list, "offsetWidth", { configurable: true, get: () => 320 });
  Object.defineProperty(list, "offsetHeight", { configurable: true, get: () => 150 });
  return { host, input, list };
}

function key(input, value) {
  const event = new win.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

test("Manual Trade contract picker has an app-owned combobox instead of native datalist UI", () => {
  assert.equal(typeof dropdowns.mountAutocomplete, "function", "dropdown module exposes the controlled autocomplete");
  const { input } = mountPicker();
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.hasAttribute("list"), false, "the control does not request browser-owned datalist UI");
  assert.equal(document.querySelector("datalist"), null);
});

test("open contract portal matches only the host-Light Manual Trade dropdown scope", () => {
  const { input } = mountPicker();
  const selector = 'body.theme-light:has(.tj-addtrade-modal:not([style*="--tj-bg:"]) .tj-addpanel:not([style*="--tj-bg:"]) .tj-add-ctl .tj-mg-dd-btn[aria-expanded="true"])';
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.ok(css.includes(`${selector} .tj-mg-dd-list.is-portal`), "existing Light portal rule styles the app-owned list");

  input.focus();
  assert.equal(document.body.matches(selector), true, "open trigger scopes the body-mounted list");
  document.querySelector(".tj-addpanel").setAttribute("style", "--tj-bg: #202020");
  assert.equal(document.body.matches(selector), false, "custom palettes remain excluded");
  document.querySelector(".tj-addpanel").removeAttribute("style");
  document.body.classList.remove("theme-light");
  assert.equal(document.body.matches(selector), false, "Dark mode remains excluded");
});

test("contract suggestions filter by symbol or description while free text remains editable", () => {
  const { input, list } = mountPicker();
  input.focus();
  assert.equal(list.parentElement, document.body, "the popup escapes modal clipping as a body portal");
  assert.equal(list.getAttribute("role"), "listbox");
  assert.equal(list.querySelectorAll('[role="option"]').length, 3);

  input.value = "nasdaq";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  assert.deepEqual(
    [...list.querySelectorAll('[role="option"]')].map((row) => row.dataset.acValue),
    ["NQ", "MNQ"],
  );

  input.value = "MY CUSTOM CONTRACT";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  assert.equal(input.value, "MY CUSTOM CONTRACT");
  assert.equal(list.querySelectorAll('[role="option"]').length, 0);
  assert.match(list.textContent, /still enter any contract/);
});

test("contract suggestions support arrow selection and commit the chosen value", () => {
  const { input, list } = mountPicker();
  let committed = "";
  input.addEventListener("change", () => { committed = input.value; });
  input.focus();

  key(input, "ArrowDown");
  const firstId = input.getAttribute("aria-activedescendant");
  assert.ok(firstId);
  key(input, "ArrowDown");
  const secondId = input.getAttribute("aria-activedescendant");
  assert.notEqual(secondId, firstId);
  assert.equal(list.querySelector(`#${secondId}`).dataset.acValue, "MNQ");

  const enter = key(input, "Enter");
  assert.equal(enter.defaultPrevented, true);
  assert.equal(committed, "MNQ");
  assert.equal(input.value, "MNQ");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(list.classList.contains("is-portal"), false);
});

test("Escape and outside click close the list without clearing typed text", () => {
  const { input, list } = mountPicker();
  input.focus();
  input.value = "CUSTOM";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  key(input, "Escape");
  assert.equal(input.value, "CUSTOM");
  assert.equal(input.getAttribute("aria-expanded"), "false");

  input.focus();
  document.body.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(input.value, "CUSTOM");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(list.classList.contains("is-portal"), false);
});
