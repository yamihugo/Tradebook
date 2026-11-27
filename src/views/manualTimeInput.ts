interface ManualTimeParts {
  hour: number;
  minute: number;
  second: number;
  period: "AM" | "PM";
}

let pickerSequence = 0;
let activeManualTimePickerClose: (() => void) | null = null;

function normalizeManualTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function partsFromStoredTime(value: string): ManualTimeParts | null {
  const normalized = normalizeManualTime(value);
  if (!normalized) return null;
  const [hourText, minuteText, secondText] = normalized.split(":");
  const hour24 = Number(hourText);
  return {
    hour: hour24 % 12 || 12,
    minute: Number(minuteText),
    second: Number(secondText),
    period: hour24 < 12 ? "AM" : "PM",
  };
}

function partsFromTypedTime(value: string): ManualTimeParts | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  const period = match[4]?.toUpperCase() as ManualTimeParts["period"] | undefined;
  if (minutes > 59 || seconds > 59) return null;

  let hour24 = hours;
  if (period) {
    if (hours < 1 || hours > 12) return null;
    hour24 = (hours % 12) + (period === "PM" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }

  return partsFromStoredTime(`${pad(hour24)}:${pad(minutes)}:${pad(seconds)}`);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function displayTime(parts: ManualTimeParts): string {
  return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ${parts.period}`;
}

function storedTimeFromParts(parts: ManualTimeParts): string {
  const hour24 = (parts.hour % 12) + (parts.period === "PM" ? 12 : 0);
  return `${pad(hour24)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/** Parse a display/typed clock using the same rules as the shared time editor. */
export function parseManualTimeInput(value: string): string | null {
  const parts = partsFromTypedTime(value);
  return parts ? storedTimeFromParts(parts) : null;
}

function secondsFromParts(parts: ManualTimeParts): number {
  const hour24 = (parts.hour % 12) + (parts.period === "PM" ? 12 : 0);
  return hour24 * 3600 + parts.minute * 60 + parts.second;
}

function partsFromSeconds(total: number): ManualTimeParts {
  const secondsInDay = 24 * 60 * 60;
  const wrapped = ((total % secondsInDay) + secondsInDay) % secondsInDay;
  const hour24 = Math.floor(wrapped / 3600);
  const minute = Math.floor((wrapped % 3600) / 60);
  const second = wrapped % 60;
  return {
    hour: hour24 % 12 || 12,
    minute,
    second,
    period: hour24 < 12 ? "AM" : "PM",
  };
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  cls: string,
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  return parent.createEl(tag, { cls, attr: attrs });
}

type ManualTimePart = "hour" | "minute" | "second";

interface ManualTimeWheel {
  element: HTMLDivElement;
  items: Map<number, HTMLDivElement>;
  part: ManualTimePart;
  label: string;
  min: number;
  max: number;
}

const WHEEL_OFFSETS = [-2, -1, 0, 1, 2] as const;

function wrapWheelValue(value: number, min: number, max: number): number {
  const span = max - min + 1;
  return ((value - min) % span + span) % span + min;
}

function createWheelColumn(
  parent: HTMLElement,
  label: string,
  part: ManualTimePart,
  min: number,
  max: number,
): ManualTimeWheel {
  const wrap = createElement(parent, "div", "tj-time-wheel-wrap");
  const caption = createElement(wrap, "span", "tj-time-wheel-label");
  caption.textContent = label;
  const element = createElement(wrap, "div", `tj-time-wheel tj-time-${part}`, {
    role: "spinbutton",
    tabindex: "0",
    "aria-label": label,
    "aria-valuemin": String(min),
    "aria-valuemax": String(max),
  });
  const items = new Map<number, HTMLDivElement>();
  for (const offset of WHEEL_OFFSETS) {
    const item = createElement(element, "div", "tj-time-wheel-item", {
      "data-offset": String(offset),
      "aria-hidden": "true",
    });
    items.set(offset, item);
  }
  return { element, items, part, label, min, max };
}

/** Mount the app-owned, seconds-precision time control for Manual Trade. */
export function mountManualTimeInput(
  host: HTMLElement,
  value: string,
  onSet: (value: string) => void,
  ariaLabel?: string,
  options: { portal?: boolean } = {},
): HTMLInputElement {
  const doc = host.ownerDocument;
  const initialParts = partsFromStoredTime(value);
  let parts: ManualTimeParts = initialParts ?? { hour: 12, minute: 0, second: 0, period: "AM" };
  let committed = initialParts ? normalizeManualTime(value) ?? "" : "";
  const label = ariaLabel ?? "Time";
  const id = `tj-time-picker-${pickerSequence++}`;

  const root = createElement(host, "div", "tj-time-control");
  const control = createElement(root, "div", "tj-time-input-wrap");
  const input = createElement(control, "input", "tj-add-input tj-time-text", {
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
  });
  input.value = initialParts ? displayTime(initialParts) : "";
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);

  const toggle = createElement(control, "button", "tj-time-toggle", {
    type: "button",
    "aria-label": `Open ${label} picker`,
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    "aria-controls": id,
  });
  createElement(toggle, "span", "tj-time-clock-icon", { "aria-hidden": "true" });

  const picker = createElement(root, "div", "tj-time-picker", {
    id,
    role: "dialog",
    "aria-label": `Set ${label.toLowerCase()}`,
  });
  picker.hidden = true;
  const heading = createElement(picker, "div", "tj-time-picker-head");
  const title = createElement(heading, "span", "tj-time-picker-title");
  title.textContent = "Set time";
  const digitalInput = createElement(picker, "input", "tj-time-digital", {
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": `Type ${label.toLowerCase()}`,
  });
  digitalInput.value = initialParts ? displayTime(initialParts) : "";
  const wheels = createElement(picker, "div", "tj-time-wheels", { role: "group", "aria-label": "Hour, minute, and second" });
  const hourWheel = createWheelColumn(wheels, "Hour", "hour", 1, 12);
  const minuteWheel = createWheelColumn(wheels, "Minute", "minute", 0, 59);
  const secondWheel = createWheelColumn(wheels, "Second", "second", 0, 59);
  const wheelColumns = [hourWheel, minuteWheel, secondWheel];
  const period = createElement(picker, "div", "tj-time-period", { role: "group", "aria-label": "AM or PM" });
  const periodButtons: HTMLButtonElement[] = [];
  for (const name of ["AM", "PM"] as const) {
    const button = createElement(period, "button", "tj-time-period-btn", {
      type: "button",
      "aria-pressed": String(parts.period === name),
    });
    button.textContent = name;
    periodButtons.push(button);
  }
  const footer = createElement(picker, "div", "tj-time-picker-foot");
  footer.textContent = "Scroll or drag · ↑ / ↓ adjusts";

  const syncWheels = (next: ManualTimeParts, syncDigital = true) => {
    parts = next;
    for (const wheel of wheelColumns) {
      const number = next[wheel.part];
      wheel.element.setAttribute("aria-valuenow", String(number));
      wheel.element.setAttribute(
        "aria-valuetext",
        wheel.part === "hour" ? `${pad(number)} ${next.period}` : pad(number),
      );
      for (const [offset, item] of wheel.items) {
        item.textContent = pad(wrapWheelValue(number + offset, wheel.min, wheel.max));
        item.classList.toggle("is-selected", offset === 0);
      }
    }
    periodButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.textContent === next.period));
    });
    if (syncDigital) digitalInput.value = displayTime(next);
  };
  const restoreCommitted = () => {
    const restored = partsFromStoredTime(committed) ?? { hour: 12, minute: 0, second: 0, period: "AM" as const };
    syncWheels(restored);
    const value = committed ? displayTime(restored) : "";
    input.value = value;
    digitalInput.value = value;
  };
  const commitParts = (next: ManualTimeParts) => {
    const canonical = storedTimeFromParts(next);
    const changed = canonical !== committed;
    committed = canonical;
    syncWheels(next);
    input.value = displayTime(next);
    digitalInput.value = displayTime(next);
    if (changed) onSet(canonical);
  };
  const commitWheelValue = (wheel: ManualTimeWheel, value: number) => {
    commitParts({ ...parts, [wheel.part]: wrapWheelValue(value, wheel.min, wheel.max) });
  };
  syncWheels(parts);

  periodButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextPeriod = button.textContent === "PM" ? "PM" : "AM";
      commitParts({ ...parts, period: nextPeriod });
    });
  });
  for (const wheel of wheelColumns) {
    let wheelRemainder = 0;
    let wheelResetTimer: number | null = null;
    let dragStartY: number | null = null;
    let dragStartValue = 0;
    let lastDragStep = 0;
    let dragged = false;
    let suppressClick = false;
    const resetClickSuppression = () => {
      const win = doc.defaultView;
      if (win) win.setTimeout(() => { suppressClick = false; }, 0);
    };
    wheel.element.addEventListener("keydown", (event) => {
      if (event.key === "Home") {
        event.preventDefault();
        commitWheelValue(wheel, wheel.min);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        commitWheelValue(wheel, wheel.max);
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const secondsPerStep = wheel.part === "hour" ? 3600 : wheel.part === "minute" ? 60 : 1;
      commitParts(partsFromSeconds(secondsFromParts(parts) + direction * secondsPerStep));
      wheel.element.focus();
    });
    wheel.element.addEventListener("wheel", (event) => {
      event.preventDefault();
      wheelRemainder += event.deltaY;
      const steps = Math.trunc(wheelRemainder / 28);
      if (steps !== 0) {
        wheelRemainder -= steps * 28;
        commitWheelValue(wheel, parts[wheel.part] + steps);
      }
      const win = doc.defaultView;
      if (wheelResetTimer !== null) win?.clearTimeout(wheelResetTimer);
      if (win) wheelResetTimer = win.setTimeout(() => { wheelRemainder = 0; wheelResetTimer = null; }, 120);
    }, { passive: false });
    wheel.element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      dragStartY = event.clientY;
      dragStartValue = parts[wheel.part];
      lastDragStep = 0;
      dragged = false;
      try { wheel.element.setPointerCapture(event.pointerId); } catch { /* Synthetic and unsupported pointer capture. */ }
    });
    wheel.element.addEventListener("pointermove", (event) => {
      if (dragStartY === null) return;
      const step = Math.trunc((dragStartY - event.clientY) / 28);
      if (step === lastDragStep) return;
      dragged = true;
      lastDragStep = step;
      commitWheelValue(wheel, dragStartValue + step);
    });
    wheel.element.addEventListener("pointerup", () => {
      if (dragged) {
        suppressClick = true;
        resetClickSuppression();
      }
      dragStartY = null;
    });
    wheel.element.addEventListener("pointercancel", () => { dragStartY = null; });
    for (const [offset, item] of wheel.items) {
      item.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        if (offset !== 0) commitWheelValue(wheel, parts[wheel.part] + offset);
      });
    }
  }
  const bindTypedTime = (field: HTMLInputElement, isDigitalField: boolean) => {
    field.addEventListener("input", () => {
      const next = partsFromTypedTime(field.value);
      if (!next) return;
      syncWheels(next, !isDigitalField);
      if (isDigitalField) input.value = displayTime(next);
    });
    field.addEventListener("change", () => {
      const next = partsFromTypedTime(field.value);
      if (!next) {
        restoreCommitted();
        return;
      }
      commitParts(next);
    });
  };
  bindTypedTime(input, false);
  bindTypedTime(digitalInput, true);

  const positionPicker = () => {
    const win = doc.defaultView;
    if (!win) return;
    const inset = 8;
    const modal = root.closest(".tj-addtrade-modal");
    const pane = root.closest(".modal-content") ?? modal;
    const paneRect = pane?.getBoundingClientRect();
    const minLeft = Math.max(inset, paneRect && paneRect.width > 0 ? paneRect.left + inset : inset);
    const maxRight = Math.min(
      win.innerWidth - inset,
      paneRect && paneRect.width > 0 ? paneRect.right - inset : win.innerWidth - inset,
    );
    const width = Math.max(0, Math.min(356, maxRight - minLeft));
    const anchor = control.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const desiredHeight = picker.getBoundingClientRect().height || 320;
    let left = anchor.right - width;
    left = Math.max(minLeft, Math.min(left, maxRight - width));

    const minTop = Math.max(inset, paneRect && paneRect.height > 0 ? paneRect.top + inset : inset);
    const maxBottom = Math.min(
      win.innerHeight - inset,
      paneRect && paneRect.height > 0 ? paneRect.bottom - inset : win.innerHeight - inset,
    );
    const belowTop = anchor.bottom + inset;
    const aboveTop = anchor.top - desiredHeight - inset;
    const belowSpace = Math.max(0, maxBottom - belowTop);
    const aboveSpace = Math.max(0, anchor.top - inset - minTop);
    let top: number;
    let availableHeight: number;
    if (belowSpace >= desiredHeight) {
      top = belowTop;
      availableHeight = belowSpace;
    } else if (aboveSpace >= desiredHeight) {
      top = aboveTop;
      availableHeight = aboveSpace;
    } else if (belowSpace >= aboveSpace) {
      top = belowTop;
      availableHeight = belowSpace;
    } else {
      top = minTop;
      availableHeight = aboveSpace;
    }
    const maxHeight = Math.max(0, Math.min(desiredHeight, availableHeight));
    picker.setCssStyles({
      position: options.portal ? "fixed" : "absolute",
      left: `${Math.round(left - (options.portal ? 0 : rootRect.left))}px`,
      top: `${Math.round(top - (options.portal ? 0 : rootRect.top))}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
    });
  };
  let escapeHandler: ((event: KeyboardEvent) => void) | null = null;
  let pointerHandler: ((event: PointerEvent) => void) | null = null;
  let scrollHandler: (() => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  let removalObserver: MutationObserver | null = null;
  let isOpen = false;
  const closePicker = (returnFocus = false) => {
    if (!isOpen) return;
    isOpen = false;
    if (activeManualTimePickerClose === closePicker) activeManualTimePickerClose = null;
    if (escapeHandler) {
      doc.removeEventListener("keydown", escapeHandler, true);
      escapeHandler = null;
    }
    if (pointerHandler) {
      doc.removeEventListener("pointerdown", pointerHandler, true);
      pointerHandler = null;
    }
    if (scrollHandler) {
      doc.removeEventListener("scroll", scrollHandler, true);
      scrollHandler = null;
    }
    if (resizeHandler) {
      doc.defaultView?.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    removalObserver?.disconnect();
    removalObserver = null;
    picker.hidden = true;
    if (options.portal) root.appendChild(picker);
    picker.classList.remove("is-floating");
    picker.classList.remove("is-portal");
    picker.setCssStyles({ position: "", left: "", top: "", width: "", maxHeight: "" });
    root.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", `Open ${label} picker`);
    if (returnFocus) input.focus();
  };
  const openPicker = (focusFirstSegment = false) => {
    if (isOpen) return;
    activeManualTimePickerClose?.();
    isOpen = true;
    activeManualTimePickerClose = closePicker;
    if (options.portal) doc.body.appendChild(picker);
    picker.classList.toggle("is-portal", !!options.portal);
    picker.hidden = false;
    picker.classList.add("is-floating");
    root.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", `Close ${label} picker`);
    // Keep interactive wheels and the digital editor inside Obsidian's Modal scope.
    positionPicker();
    if (focusFirstSegment) hourWheel.element.focus();
    escapeHandler = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePicker(true);
    };
    doc.addEventListener("keydown", escapeHandler, true);
    pointerHandler = (event) => {
      const target = event.target;
      if (target && "nodeType" in target) {
        const node = target as Node;
        if (root.contains(node) || picker.contains(node)) return;
      }
      closePicker();
    };
    doc.addEventListener("pointerdown", pointerHandler, true);
    scrollHandler = positionPicker;
    resizeHandler = positionPicker;
    doc.addEventListener("scroll", scrollHandler, true);
    doc.defaultView?.addEventListener("resize", resizeHandler);
    const Observer = doc.defaultView?.MutationObserver;
    if (Observer) {
      removalObserver = new Observer(() => {
        if (!root.isConnected) closePicker();
      });
      removalObserver.observe(doc.body, { childList: true, subtree: true });
    }
  };
  toggle.addEventListener("click", () => {
    if (isOpen) closePicker();
    else openPicker(true);
  });
  input.addEventListener("click", () => openPicker());
  input.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (isOpen) hourWheel.element.focus();
    else openPicker(true);
  });

  return input;
}