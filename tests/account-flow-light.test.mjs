import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { test } from "node:test";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const accountWizardPath = new URL("../src/views/accountWizard.ts", import.meta.url).pathname;
const dom = new JSDOM("<!doctype html><html><body class='theme-light'></body></html>", { pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.Event = dom.window.Event;

const proto = dom.window.HTMLElement.prototype;
proto.createEl = function (tag, opts = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (opts.cls) el.className = opts.cls;
  if (opts.text !== undefined) el.textContent = opts.text;
  for (const [key, value] of Object.entries(opts.attr ?? {})) {
    if (value === true) el.setAttribute(key, "");
    else if (value !== false && value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  this.appendChild(el);
  return el;
};
proto.createDiv = function (opts = {}) { return this.createEl("div", opts); };
proto.createSpan = function (opts = {}) { return this.createEl("span", opts); };
proto.empty = function () { this.replaceChildren(); };
proto.setText = function (text) { this.textContent = String(text); };
proto.setCssStyles = function (styles) { Object.assign(this.style, styles); };
proto.addClass = function (name) { this.classList.add(name); };
proto.removeClass = function (name) { this.classList.remove(name); };
proto.hasClass = function (name) { return this.classList.contains(name); };
proto.toggleClass = function (name, force) { this.classList.toggle(name, force); };

const stubModules = {
  "../props": `export const uniqueAccountName = (name) => name;`,
  "../lib/numeric": `export const freeNumeric = (input) => input;`,
  "../lib/accountRules": `export const isPropType = (type) => ["eval", "funded", "live"].includes(type);`,
  "../lib/tip": `export const attachTip = () => {};`,
  "../lib/firmLogos": `
    export const FIRM_CATALOG = [
      { id: "topstep", label: "Topstep", group: "prop" },
      { id: "broker", label: "Broker", group: "broker" },
      { id: "practice", label: "Practice", group: "practice" },
    ];
    export const firmLabel = (id) => FIRM_CATALOG.find((item) => item.id === id)?.label ?? id;
    export const firmLogoUrl = () => "";
  `,
  "../lib/accountTypes": `
    export const ACCOUNT_SIZES = [50000, 100000];
    export const CREATION_TYPES = [
      { id: "eval", label: "Evaluation", desc: "Rules-based", icon: "target" },
      { id: "funded", label: "Funded", desc: "Payout account", icon: "wallet" },
      { id: "live", label: "Live", desc: "Broker account", icon: "chart" },
    ];
    export const TYPE_CATALOG = CREATION_TYPES;
    export const typeLabel = (type) => TYPE_CATALOG.find((item) => item.id === type)?.label ?? type;
  `,
  "../lib/dates": `
    export const formatDate = (value) => value;
    export const mountDateField = (host, opts) => {
      const wrap = host.createDiv({ cls: "tj-datefield" });
      const input = wrap.createEl("input", { cls: "tj-datefield-input " + (opts.className ?? ""), attr: { type: "text", value: opts.value } });
      input.addEventListener("input", () => opts.onChange(input.value));
      return wrap;
    };
  `,
};

const bundle = await build({
  entryPoints: [accountWizardPath],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [{
    name: "account-wizard-test-host",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "wizard-test" }));
      build.onLoad({ filter: /.*/, namespace: "wizard-test" }, (args) => ({
        contents: args.path === "obsidian" ? "export const setIcon = () => {};" : stubModules[args.path],
        loader: "js",
      }));
      build.onResolve({ filter: /^\.\.\/(?:props|lib\/(?:numeric|accountRules|tip|firmLogos|accountTypes|dates))$/ }, (args) => ({ path: args.path, namespace: "wizard-test" }));
    },
  }],
});
const builtModule = bundle.outputFiles[0];
const { openAccountWizard } = await import(`data:text/javascript;base64,${Buffer.from(builtModule.text).toString("base64")}`);

function hostLightFixture() {
  const page = new JSDOM(`<!doctype html><html><head><style>
    body { --text-normal: #222222; --text-muted: #555555; --background-primary: #ffffff; --background-secondary: #f7f7f7; }
    ${css}
  </style></head><body class="theme-light">
    <div class="tj-modal-overlay"><div class="tj-modal tj-account-wizard"><div class="tj-datefield"></div></div></div>
    <div class="tj-modal-overlay"><div class="tj-modal tj-acc-settings"><div class="tj-account-wizard tj-as-pane"></div></div></div>
    <div class="modal tj-manage-modal"><div class="modal-content tj-manage"><button class="tj-mg-dd-btn" aria-expanded="true"></button></div></div>
    <div class="tj-mg-dd-list is-portal"></div><div class="tj-cal"></div>
  </body></html>`);
  return page;
}

test("Light Accounts surfaces get a readable host palette without leaking into Dark or custom palettes", () => {
  const page = hostLightFixture();
  const { document, getComputedStyle } = page.window;
  const selectors = [
    'body.theme-light > .tj-modal-overlay > .tj-modal.tj-account-wizard:not([style*="--tj-bg:"])',
    'body.theme-light > .tj-modal-overlay > .tj-modal.tj-acc-settings:not([style*="--tj-bg:"])',
    'body.theme-light .tj-manage-modal:not([style*="--tj-bg:"])',
  ];
  for (const selector of selectors) {
    assert.ok(css.includes(selector), `stylesheet defines ${selector}`);
    assert.ok(document.querySelector(selector), `selector matches the actual modal topology: ${selector}`);
  }
  assert.ok(document.querySelector('body.theme-light:has(.tj-manage-modal) .tj-mg-dd-list.is-portal'), "group dropdown portal is covered");
  assert.ok(document.querySelector('body.theme-light:has(> .tj-modal-overlay > .tj-modal.tj-account-wizard:not([style*="--tj-bg:"])) .tj-cal'), "wizard calendar portal is covered");

  const wizard = document.querySelector(".tj-modal.tj-account-wizard");
  assert.match(getComputedStyle(wizard).getPropertyValue("--tj-fg-3"), /66%/, "muted text uses the host-Light contrast ramp");
  assert.match(css, /\.tj-wz-type:focus-visible/);
  assert.match(css, /\.tj-wz-logotile:focus-visible/);
  assert.match(css, /^\.tj-wz-type\.on\s*\{/m, "the original account-type card styling remains in control");
  assert.match(css, /^\.tj-wz-logotile\.on\s*\{/m, "the original brand-tile styling remains in control");
  assert.match(css, /\.tj-mg-dd-item\.is-active/);

  const custom = document.createElement("div");
  custom.className = "tj-modal tj-account-wizard";
  custom.setAttribute("style", "--tj-bg: #202020;");
  const customOverlay = document.createElement("div");
  customOverlay.className = "tj-modal-overlay";
  customOverlay.append(custom);
  document.body.append(customOverlay);
  assert.equal(document.querySelector('body.theme-light > .tj-modal-overlay > .tj-modal.tj-account-wizard[style*="--tj-bg:"]'), custom);
  assert.equal(getComputedStyle(custom).getPropertyValue("--tj-fg-3"), "", "inline custom palette keeps its own ramp");

  document.body.className = "theme-dark";
  assert.equal(document.querySelector("body.theme-light .tj-account-wizard:not([style*='--tj-bg:'])"), null, "Light rules do not match Dark mode");
  page.window.close();
});

test("Add Account type and brand steps are keyboard-operable and still create a dated account", async () => {
  const plugin = {
    settings: { propAccounts: [], dateFormat: "YYYY-MM-DD", timeZone: "UTC" },
    saves: 0,
    reloads: 0,
    async saveSettings() { this.saves += 1; },
    async reloadAllViews() { this.reloads += 1; },
  };
  const hostButtonDefaults = document.createElement("style");
  hostButtonDefaults.textContent = ".tj-account-wizard button[role='radio'] { height: 34px !important; max-height: 34px !important; overflow: hidden !important; }";
  document.head.append(hostButtonDefaults);
  openAccountWizard(plugin);
  const root = document.querySelector(".tj-account-wizard");
  const typeGroup = root.querySelector('[data-tour="wizard-type"]');
  assert.equal(typeGroup.getAttribute("role"), "radiogroup");
  const types = [...typeGroup.querySelectorAll("[role=radio]")];
  assert.equal(types.length, 3);
  assert.equal(types[0].tagName, "DIV", "choice cards must keep their intrinsic card layout instead of inheriting Obsidian's compact button height");
  assert.notEqual(dom.window.getComputedStyle(types[0]).height, "34px");
  const selectedType = types.find((item) => item.getAttribute("aria-checked") === "true");
  assert.ok(selectedType, "one account type is selected initially");
  selectedType.focus();
  const typeKey = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  selectedType.dispatchEvent(typeKey);
  assert.equal(typeKey.defaultPrevented, true);
  assert.equal(document.activeElement, types[1]);
  assert.equal(types[1].getAttribute("aria-checked"), "true");
  types[2].focus();
  types[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
  assert.equal(types[2].getAttribute("aria-checked"), "true", "Space activates a focused radio card");
  types[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  assert.equal(types[1].getAttribute("aria-checked"), "true", "arrow navigation returns to the intended type");

  root.querySelector('[data-tour="wizard-next"]').click();
  const brandGroup = root.querySelector(".tj-wz-sect[role=radiogroup]");
  const brands = [...brandGroup.querySelectorAll(".tj-wz-logotile[role=radio]")];
  assert.ok(brands.length >= 4, "catalog and custom brand choices are available");
  assert.equal(brands[0].tagName, "DIV", "brand choices must retain their plugin-sized tile layout");
  const selectedBrand = brands.find((item) => item.getAttribute("aria-checked") === "true");
  assert.ok(selectedBrand, "one brand is selected initially");
  selectedBrand.focus();
  selectedBrand.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, brands[1]);
  assert.equal(brands[1].getAttribute("aria-checked"), "true");

  root.querySelector('[data-tour="wizard-next"]').click();
  const next = root.querySelector('[data-tour="wizard-next"]');
  assert.equal(next.disabled, true, "size and start date are required before Review");
  root.querySelector('[data-tour="wizard-size"] .tj-dd-btn').click();
  root.querySelector('[data-tour="wizard-size"] .tj-dd-item').click();
  assert.equal(next.disabled, true, "a size alone is not enough");
  const date = root.querySelector(".tj-datefield-input");
  date.value = "2026-09-01";
  date.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(next.disabled, false, "a valid start date completes the required fields");

  next.click();
  assert.match(root.querySelector(".tj-wz-review").textContent, /Account size\$50,000/);
  next.click();
  assert.equal(plugin.settings.propAccounts.length, 1);
  assert.equal(plugin.settings.propAccounts[0].type, "funded");
  assert.equal(plugin.settings.propAccounts[0].firmId, "broker");
  assert.equal(plugin.settings.propAccounts[0].size, 50000);
  assert.equal(plugin.settings.propAccounts[0].createdAt, "2026-09-01");
  assert.equal(plugin.settings.propAccounts[0].rules.maxLoss, 2000);
  assert.equal(plugin.saves, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(plugin.reloads, 1);
  assert.equal(document.querySelector(".tj-modal-overlay"), null, "successful create closes the wizard");
  dom.window.close();
});
