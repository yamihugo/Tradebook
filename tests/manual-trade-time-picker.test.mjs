import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const dom = new JSDOM("<!doctype html><html><body><div id='modal' class='modal tj-addtrade-modal'><div id='pane' class='modal-content'><div class='tj-addtrade-body'><div id='host'></div></div></div></div></body></html>", {
  pretendToBeVisual: true,
});
const win = dom.window;
Object.assign(globalThis, { document: win.document, window: win });

win.HTMLElement.prototype.createEl = function (tag, options = {}) {
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.type) el.setAttribute("type", String(options.type));
  for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, String(value));
  this.appendChild(el);
  return el;
};
win.HTMLElement.prototype.setCssStyles = function (styles) {
  for (const [name, value] of Object.entries(styles)) this.style[name] = String(value);
};

const built = await build({
  entryPoints: [new URL("../src/views/manualTimeInput.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const manualTimeInput = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const panel = readFileSync(new URL("../src/views/addTradePanel.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function mount(value, onSet = () => {}, ariaLabel = "Entry time") {
  const host = document.getElementById("host");
  host.replaceChildren();
  return manualTimeInput.mountManualTimeInput(host, value, onSet, ariaLabel);
}

test("Manual Trade time control mounts three centered, keyboard-accessible wheels", () => {
  const cases = [
    { stored: "09:30:07", visible: "09:30:07 AM", segments: ["09", "30", "07"], period: "AM" },
    { stored: "00:00:00", visible: "12:00:00 AM", segments: ["12", "00", "00"], period: "AM" },
    { stored: "12:05:06", visible: "12:05:06 PM", segments: ["12", "05", "06"], period: "PM" },
    { stored: "18:42:05", visible: "06:42:05 PM", segments: ["06", "42", "05"], period: "PM" },
  ];
  for (const [index, item] of cases.entries()) {
    const input = mount(item.stored);
    assert.equal(input.type, "text");
    assert.equal(input.value, item.visible);
    assert.equal(input.readOnly, false, "direct typing remains available");
    assert.equal(input.disabled, false);
    assert.equal(input.getAttribute("aria-label"), "Entry time");
    assert.ok(input.classList.contains("tj-add-input"));
    assert.ok(input.classList.contains("tj-time-text"));

    const control = input.closest(".tj-time-control");
    assert.ok(control);
    const toggle = control.querySelector(".tj-time-toggle");
    assert.equal(toggle.getAttribute("aria-haspopup"), "dialog");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    const picker = document.getElementById(toggle.getAttribute("aria-controls"));
    assert.equal(picker.getAttribute("role"), "dialog");
    assert.equal(picker.hidden, true);
    const wheels = [...picker.querySelectorAll('[role="spinbutton"]')];
    assert.deepEqual(wheels.map((wheel) => wheel.getAttribute("aria-valuenow")), item.segments.map(Number).map(String));
    assert.deepEqual(wheels.map((wheel) => wheel.tabIndex), [0, 0, 0]);
    for (let part = 0; part < wheels.length; part += 1) {
      const selected = wheels[part].querySelector(".tj-time-wheel-item.is-selected");
      assert.ok(selected, "each wheel has one centered selected value");
      assert.equal(selected.textContent, item.segments[part]);
      assert.equal(wheels[part].querySelectorAll(".tj-time-wheel-item").length, 5);
    }
    const activePeriod = picker.querySelector('.tj-time-period-btn[aria-pressed="true"]');
    assert.equal(activePeriod.textContent, item.period);
    if (index === 0) assert.equal(toggle.getAttribute("aria-label"), "Open Entry time picker");
  }
});

test("picker stays beside its field and within the scrollable Manual Trade modal", () => {
  const input = mount("09:30:07");
  const modal = document.getElementById("modal");
  const pane = document.getElementById("pane");
  pane.getBoundingClientRect = () => ({ left: 200, right: 760, top: 100, bottom: 600, width: 560, height: 500, x: 200, y: 100, toJSON() {} });
  const root = input.closest(".tj-time-control");
  root.getBoundingClientRect = () => ({ left: 600, right: 740, top: 300, bottom: 336, width: 140, height: 36, x: 600, y: 300, toJSON() {} });
  const control = input.parentElement;
  control.getBoundingClientRect = () => ({ left: 600, right: 740, top: 300, bottom: 336, width: 140, height: 36, x: 600, y: 300, toJSON() {} });
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  picker.getBoundingClientRect = () => ({ left: 0, right: 356, top: 0, bottom: 280, width: 356, height: 280, x: 0, y: 0, toJSON() {} });

  toggle.click();

  assert.equal(picker.parentElement, input.closest(".tj-time-control"));
  assert.ok(modal.contains(picker), "interactive segments remain inside the modal focus scope");
  assert.equal(picker.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(picker.classList.contains("is-floating"));
  assert.equal(picker.style.position, "absolute", "the popover stays in the modal's focus and scroll scope");
  const rootRect = root.getBoundingClientRect();
  const left = rootRect.left + Number.parseFloat(picker.style.left);
  const top = rootRect.top + Number.parseFloat(picker.style.top);
  const width = Number.parseFloat(picker.style.width);
  const height = Number.parseFloat(picker.style.maxHeight);
  assert.ok(left >= 208 && left + width <= 752, "popover stays within the modal's horizontal bounds");
  assert.ok(top >= 108 && top + height <= 592, "popover stays within the visible scroll pane");
  assert.ok(Math.abs(top - control.getBoundingClientRect().bottom) < 16, "popover opens adjacent to the field that triggered it");
  toggle.click();
});

test("Entry and Actual Exit pickers each anchor to their own field", () => {
  const entryInput = mount("09:30:07", () => {}, "Entry time");
  const pane = document.getElementById("pane");
  pane.getBoundingClientRect = () => ({ left: 200, right: 760, top: 100, bottom: 600, width: 560, height: 500, x: 200, y: 100, toJSON() {} });
  const rect = (left, top, width = 140, height = 36) => ({ left, right: left + width, top, bottom: top + height, width, height, x: left, y: top, toJSON() {} });
  const entryRoot = entryInput.closest(".tj-time-control");
  const entryControl = entryInput.parentElement;
  entryRoot.getBoundingClientRect = () => rect(500, 180);
  entryControl.getBoundingClientRect = () => rect(500, 180);
  const entryToggle = entryRoot.querySelector(".tj-time-toggle");
  const entryPicker = document.getElementById(entryToggle.getAttribute("aria-controls"));
  entryPicker.getBoundingClientRect = () => rect(0, 0, 356, 280);

  const exitHost = document.createElement("div");
  pane.appendChild(exitHost);
  const exitInput = manualTimeInput.mountManualTimeInput(exitHost, "11:02:05", () => {}, "Actual exit time");
  const exitRoot = exitInput.closest(".tj-time-control");
  const exitControl = exitInput.parentElement;
  exitRoot.getBoundingClientRect = () => rect(500, 540);
  exitControl.getBoundingClientRect = () => rect(500, 540);
  const exitToggle = exitRoot.querySelector(".tj-time-toggle");
  const exitPicker = document.getElementById(exitToggle.getAttribute("aria-controls"));
  exitPicker.getBoundingClientRect = () => rect(0, 0, 356, 280);

  entryToggle.click();
  assert.ok(Math.abs(entryRoot.getBoundingClientRect().top + Number.parseFloat(entryPicker.style.top) - entryControl.getBoundingClientRect().bottom - 8) < 1);
  exitToggle.click();
  const exitTop = exitRoot.getBoundingClientRect().top + Number.parseFloat(exitPicker.style.top);
  const exitBottom = exitTop + Number.parseFloat(exitPicker.style.maxHeight);
  assert.equal(entryPicker.hidden, true);
  assert.equal(exitPicker.hidden, false);
  assert.ok(Math.abs(exitControl.getBoundingClientRect().top - exitBottom - 8) < 1, "exit picker flips above its own field when needed");
  assert.ok(exitTop >= 108 && exitBottom <= 592, "flipped picker remains inside the visible modal frame");
  exitToggle.click();
});

test("opening the picker focuses the hour wheel and exposes its selected value", () => {
  const input = mount("09:30:07");
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();
  const hour = picker.querySelector(".tj-time-hour");

  assert.equal(document.activeElement, hour);
  assert.equal(hour.getAttribute("aria-valuenow"), "9");
  assert.equal(hour.getAttribute("aria-valuetext"), "09 AM");
});

test("time wheels retain keyboard focus under the host modal focus trap", () => {
  const input = mount("09:30:07");
  const modal = document.getElementById("modal");
  const date = modal.createEl("input", { cls: "tj-datefield-input" });
  const guard = (event) => {
    if (!modal.contains(event.target)) date.focus();
  };
  document.addEventListener("focusin", guard, true);
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));

  try {
    toggle.click();
    assert.equal(document.activeElement, picker.querySelector(".tj-time-hour"));
    assert.ok(modal.contains(picker), "interactive picker remains inside the modal focus scope");
  } finally {
    document.removeEventListener("focusin", guard, true);
    toggle.click();
    date.remove();
  }
});

test("picker toggle closes the floating popover", () => {
  const input = mount("09:30:07");
  const control = input.closest(".tj-time-control");
  const toggle = control.querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));

  toggle.click();
  assert.equal(picker.parentElement, control);
  toggle.click();

  assert.equal(picker.hidden, true);
  assert.equal(picker.parentElement, control);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(!control.classList.contains("is-open"));
});

test("Escape closes the picker and returns it to the field", () => {
  const input = mount("09:30:07");
  const control = input.closest(".tj-time-control");
  const toggle = control.querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));

  toggle.click();
  picker.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  assert.equal(picker.hidden, true);
  assert.equal(picker.parentElement, control);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, input, "Escape returns keyboard focus to the editable time field");
});

test("pointer interaction inside the picker stays open and outside interaction closes it", () => {
  const input = mount("09:30:07");
  const control = input.closest(".tj-time-control");
  const toggle = control.querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));

  toggle.click();
  picker.querySelector('[role="spinbutton"]').dispatchEvent(new win.MouseEvent("pointerdown", { bubbles: true }));
  assert.equal(picker.hidden, false, "interacting with a segment does not dismiss the picker");
  document.getElementById("modal").dispatchEvent(new win.MouseEvent("pointerdown", { bubbles: true }));

  assert.equal(picker.hidden, true);
  assert.equal(picker.parentElement, control);
});

test("clicking the editable time field opens the picker without disabling typing", () => {
  const input = mount("09:30:07");
  const control = input.closest(".tj-time-control");
  const toggle = control.querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));

  input.click();

  assert.equal(input.readOnly, false);
  assert.equal(picker.hidden, false);
  assert.equal(picker.parentElement, control);
  toggle.click();
});

test("only one Manual Trade time picker can be open at a time", () => {
  const firstInput = mount("09:30:07");
  const firstControl = firstInput.closest(".tj-time-control");
  const firstToggle = firstControl.querySelector(".tj-time-toggle");
  const firstPicker = document.getElementById(firstToggle.getAttribute("aria-controls"));
  firstToggle.click();

  const secondHost = document.createElement("div");
  document.getElementById("host").appendChild(secondHost);
  const secondInput = manualTimeInput.mountManualTimeInput(secondHost, "10:00:00", () => {}, "Exit time");
  const secondControl = secondInput.closest(".tj-time-control");
  const secondToggle = secondControl.querySelector(".tj-time-toggle");
  const secondPicker = document.getElementById(secondToggle.getAttribute("aria-controls"));
  secondToggle.click();

  assert.equal(firstPicker.hidden, true);
  assert.equal(firstPicker.parentElement, firstControl);
  assert.equal(secondPicker.hidden, false);
  assert.equal(secondPicker.parentElement, secondControl);
  secondToggle.click();
});

test("open picker follows its field when the modal scrolls or resizes", () => {
  const input = mount("09:30:07");
  const pane = document.getElementById("pane");
  pane.getBoundingClientRect = () => ({ left: 200, right: 760, top: 100, bottom: 600, width: 560, height: 500, x: 200, y: 100, toJSON() {} });
  const control = input.parentElement;
  let anchor = { left: 300, right: 440, top: 200, bottom: 236, width: 140, height: 36, x: 300, y: 200, toJSON() {} };
  control.getBoundingClientRect = () => anchor;
  const timeRoot = input.closest(".tj-time-control");
  let rootRect = { left: 300, right: 440, top: 200, bottom: 236, width: 140, height: 36, x: 300, y: 200, toJSON() {} };
  timeRoot.getBoundingClientRect = () => rootRect;
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  picker.getBoundingClientRect = () => ({ left: 0, right: 320, top: 0, bottom: 280, width: 320, height: 280, x: 0, y: 0, toJSON() {} });
  toggle.click();
  const initialTop = picker.style.top;
  const initialLeft = picker.style.left;

  anchor = { left: 300, right: 440, top: 300, bottom: 336, width: 140, height: 36, x: 300, y: 300, toJSON() {} };
  rootRect = { left: 300, right: 440, top: 300, bottom: 336, width: 140, height: 36, x: 300, y: 300, toJSON() {} };
  pane.dispatchEvent(new win.Event("scroll", { bubbles: true }));
  assert.equal(rootRect.top + Number.parseFloat(picker.style.top), anchor.bottom + 8, "scrolling keeps the popover adjacent to the scrolled field");
  anchor = { left: 350, right: 490, top: 300, bottom: 336, width: 140, height: 36, x: 350, y: 300, toJSON() {} };
  rootRect = { left: 350, right: 490, top: 300, bottom: 336, width: 140, height: 36, x: 350, y: 300, toJSON() {} };
  win.dispatchEvent(new win.Event("resize"));
  assert.notEqual(picker.style.left, initialLeft, "resize re-evaluates horizontal placement");
  toggle.click();
});

test("removing an open time control closes its in-tree popover", async () => {
  const input = mount("09:30:07");
  const root = input.closest(".tj-time-control");
  const toggle = root.querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();

  root.remove();
  await new Promise((resolve) => win.setTimeout(resolve, 0));

  assert.equal(picker.hidden, true);
  assert.equal(root.contains(picker), true);
});

test("AM/PM buttons update the displayed and stored time", () => {
  const committed = [];
  const input = mount("09:30:07", (value) => committed.push(value));
  const control = input.closest(".tj-time-control");
  const toggle = control.querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();
  const pm = picker.querySelector('.tj-time-period-btn:not([aria-pressed="true"])');
  pm.click();

  assert.equal(input.value, "09:30:07 PM");
  assert.deepEqual(committed, ["21:30:07"]);
  assert.equal(pm.getAttribute("aria-pressed"), "true");
  toggle.click();
});

test("ArrowUp on seconds carries through minute, hour, and midnight", () => {
  const committed = [];
  const input = mount("23:59:59", (value) => committed.push(value));
  const control = input.closest(".tj-time-control");
  const toggle = control.querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();
  const seconds = picker.querySelector(".tj-time-second");
  assert.equal(document.activeElement, picker.querySelector(".tj-time-hour"), "the toggle opens into the first wheel");
  seconds.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));

  assert.deepEqual(committed, ["00:00:00"]);
  assert.equal(input.value, "12:00:00 AM");
  assert.equal(picker.querySelector(".tj-time-hour").getAttribute("aria-valuenow"), "12");
  assert.equal(picker.querySelector('.tj-time-period-btn[aria-pressed="true"]').textContent, "AM");
  toggle.click();
});

test("clicking a neighboring wheel value commits the selected time", () => {
  const committed = [];
  const input = mount("09:30:07", (value) => committed.push(value));
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();
  const minute = picker.querySelector(".tj-time-minute");
  const nextMinute = minute.querySelector('.tj-time-wheel-item[data-offset="1"]');
  assert.equal(nextMinute.textContent, "31");
  nextMinute.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  assert.deepEqual(committed, ["09:31:07"]);
  assert.equal(minute.getAttribute("aria-valuenow"), "31");
  assert.equal(input.value, "09:31:07 AM");
  toggle.click();
});

test("scrolling a wheel changes only its time component and commits canonical time", () => {
  const committed = [];
  const input = mount("09:30:07", (value) => committed.push(value));
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();
  const minute = picker.querySelector(".tj-time-minute");
  const event = new win.WheelEvent("wheel", { deltaY: 32, bubbles: true, cancelable: true });
  minute.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(committed, ["09:31:07"]);
  assert.equal(input.value, "09:31:07 AM");
  toggle.click();
});

test("dragging a wheel updates its value without a follow-up click", () => {
  const committed = [];
  const input = mount("09:30:07", (value) => committed.push(value));
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();
  const minute = picker.querySelector(".tj-time-minute");
  minute.dispatchEvent(new win.MouseEvent("pointerdown", { pointerId: 5, clientY: 100, bubbles: true }));
  minute.dispatchEvent(new win.MouseEvent("pointermove", { pointerId: 5, clientY: 42, bubbles: true }));
  minute.dispatchEvent(new win.MouseEvent("pointerup", { pointerId: 5, clientY: 42, bubbles: true }));
  minute.dispatchEvent(new win.MouseEvent("click", { clientY: 42, bubbles: true }));

  assert.deepEqual(committed, ["09:32:07"]);
  assert.equal(minute.getAttribute("aria-valuenow"), "32");
  assert.equal(input.value, "09:32:07 AM");
  toggle.click();
});

test("ArrowDown from the editable field opens the hour wheel", () => {
  const input = mount("09:30:07");
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  const event = new win.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });

  input.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(picker.hidden, false);
  assert.equal(picker.parentElement, input.closest(".tj-time-control"));
  assert.equal(document.activeElement, picker.querySelector(".tj-time-hour"));
  toggle.click();
});

test("typed 12-hour and 24-hour values commit in canonical HH:mm:ss", () => {
  const committed = [];
  const input = mount("09:30:07", (value) => committed.push(value));

  input.value = "10:12:34 PM";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  assert.deepEqual(committed, [], "typing remains editable until the change is committed");
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.deepEqual(committed, ["22:12:34"]);
  assert.equal(input.value, "10:12:34 PM");

  input.value = "23:05";
  input.dispatchEvent(new win.Event("input", { bubbles: true }));
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.deepEqual(committed, ["22:12:34", "23:05:00"]);
  assert.equal(input.value, "11:05:00 PM");
});

test("digital time display edits the wheels and serializes the committed value", () => {
  const committed = [];
  const input = mount("09:30:07", (value) => committed.push(value));
  const toggle = input.closest(".tj-time-control").querySelector(".tj-time-toggle");
  const picker = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.click();
  const digital = picker.querySelector(".tj-time-digital");
  digital.value = "10:12:34 PM";
  digital.dispatchEvent(new win.Event("input", { bubbles: true }));
  assert.equal(picker.querySelector(".tj-time-hour").getAttribute("aria-valuetext"), "10 PM");
  assert.equal(input.value, "10:12:34 PM");
  digital.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.deepEqual(committed, ["22:12:34"]);
  assert.equal(digital.value, "10:12:34 PM");
  toggle.click();
});

test("legacy single-digit hours are normalized for the wheel display", () => {
  const input = mount("9:04:05");
  assert.equal(input.value, "09:04:05 AM");
});

test("picker styling follows host theme tokens and layers above the modal", () => {
  const timeStyles = styles.slice(styles.indexOf(".tj-time-picker {"));
  assert.match(timeStyles, /\.tj-time-picker\.is-floating\s*\{/);
  assert.match(timeStyles, /\.tj-time-picker\[hidden\]\s*\{\s*display:\s*none\s*;/);
  assert.match(timeStyles, /\.tj-time-picker[\s\S]*?background:\s*var\(--background-primary\)/);
  assert.match(timeStyles, /\.tj-time-picker[\s\S]*?color:\s*var\(--text-normal\)/);
  assert.match(timeStyles, /\.tj-time-wheel[\s\S]*?border-color:\s*var\(--interactive-accent\)/);
  assert.doesNotMatch(timeStyles, /\.tj-time-picker[\s\S]{0,1000}color-scheme\s*:/);
});

test("entry and each actual exit use the shared time-control component", () => {
  assert.match(
    panel,
    /return mountManualTimeInput\(\s*host,\s*value,\s*\(v\)\s*=>\s*\{\s*onSet\(v\);\s*paint\(\);\s*\},\s*ariaLabel,?\s*\)/,
  );
  assert.doesNotMatch(panel, /input\.addEventListener\("change",\s*\(\)\s*=>\s*paint\(\)\)/);
  assert.match(panel, /timeInput\(field\("Entry time"/);
  assert.match(panel, /const time = timeInput\(/);
});
