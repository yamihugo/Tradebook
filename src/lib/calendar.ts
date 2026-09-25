/**
 * A themed month calendar, shared by every date field in the plugin.
 *
 * A native <input type="date"> opens a picker drawn by the operating system,
 * which cannot be styled and reads as a foreign body in the journal. This is
 * our own: Monday-based grid, accent on the selected day, Today, and keyboard
 * navigation. Pure DOM (no Obsidian APIs) so it stays testable.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

import { todayKey } from "../tz";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const pad = (n: number): string => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysInMonth = (y: number, m: number): number => new Date(y, m + 1, 0).getDate();
/** Monday-based weekday index (0 = Monday). */
const mondayIndex = (y: number, m: number, d: number): number => (new Date(y, m, d).getDay() + 6) % 7;
/** An ISO day as a local date, for the grid's calendar arithmetic only. */
const isoToJs = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export interface CalendarOpts {
  /** The selected day as ISO (YYYY-MM-DD), or "". */
  value?: string;
  /** Called with the ISO day the trader picked. */
  onPick: (iso: string) => void;
  /** Optional stacking override when the calendar is opened inside a popover. */
  zIndex?: number;
  /** Journal Timezone — "today" and the Today button mean today *there*. */
  zone: string;
}

/** The close function of whichever calendar is currently open. */
let active: (() => void) | null = null;

/** Close the open calendar, if any. */
export function closeCalendar(): void {
  active?.();
}

/** Open a calendar anchored under `anchor`. Returns a function that closes it. */
export function openCalendar(anchor: HTMLElement, opts: CalendarOpts): () => void {
  closeCalendar();

  const doc = anchor.ownerDocument;
  const win = doc.defaultView ?? window;
  const selected = opts.value || "";

  // Today is today in the Journal Timezone — the host zone has no say in it.
  const todayIso = todayKey(opts.zone);
  const start = /^(\d{4})-(\d{2})-(\d{2})/.exec(selected);
  const cursor = start ? new Date(+start[1], +start[2] - 1, +start[3]) : isoToJs(todayIso);

  const el = doc.createElement("div");
  el.className = "tj-cal";
  if (opts.zIndex !== undefined) el.style.zIndex = String(opts.zIndex);
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Calendar");

  const head = doc.createElement("div");
  head.className = "tj-cal-head";
  const prev = doc.createElement("button");
  prev.type = "button";
  prev.className = "tj-cal-nav";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", "Previous month");
  const title = doc.createElement("span");
  title.className = "tj-cal-title";
  const next = doc.createElement("button");
  next.type = "button";
  next.className = "tj-cal-nav";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next month");
  head.append(prev, title, next);

  const grid = doc.createElement("div");
  grid.className = "tj-cal-grid";

  const foot = doc.createElement("div");
  foot.className = "tj-cal-foot";
  const todayBtn = doc.createElement("button");
  todayBtn.type = "button";
  todayBtn.className = "tj-cal-today";
  todayBtn.textContent = "Today";
  foot.append(todayBtn);

  el.append(head, grid, foot);
  doc.body.append(el);

  const dayButton = (y: number, m: number, d: number, out: boolean): HTMLButtonElement => {
    const nd = new Date(y, m, d);
    const iso = isoOf(nd.getFullYear(), nd.getMonth(), nd.getDate());
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "tj-cal-day" + (out ? " is-out" : "");
    b.textContent = String(d);
    b.setAttribute("aria-label", iso);
    if (iso === todayIso) b.classList.add("is-today");
    if (iso === selected) b.classList.add("is-sel");
    b.tabIndex = -1;
    b.addEventListener("click", () => pick(iso));
    return b;
  };

  const render = (): void => {
    const vy = cursor.getFullYear();
    const vm = cursor.getMonth();
    title.textContent = `${MONTHS[vm]} ${vy}`;
    grid.replaceChildren();
    for (const w of WEEKDAYS) {
      const s = doc.createElement("span");
      s.className = "tj-cal-wd";
      s.textContent = w;
      grid.append(s);
    }
    const lead = mondayIndex(vy, vm, 1);
    for (let i = lead - 1; i >= 0; i--) grid.append(dayButton(vy, vm, -i, true));
    const dim = daysInMonth(vy, vm);
    for (let d = 1; d <= dim; d++) grid.append(dayButton(vy, vm, d, false));
    const trail = (7 - ((lead + dim) % 7)) % 7;
    for (let d = 1; d <= trail; d++) grid.append(dayButton(vy, vm, dim + d, true));
  };

  const focusCursor = (): void => {
    const iso = isoOf(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const b = grid.querySelector<HTMLButtonElement>(`button[aria-label="${iso}"]`);
    b?.focus();
  };

  const place = (): void => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + w > win.innerWidth - 8) left = win.innerWidth - 8 - w;
    if (left < 8) left = 8;
    if (top + h > win.innerHeight - 8 && r.top - 6 - h > 8) top = r.top - 6 - h;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  const shift = (days: number): void => {
    cursor.setDate(cursor.getDate() + days);
    render();
    place();
    focusCursor();
  };

  const shiftMonth = (delta: number): void => {
    cursor.setMonth(cursor.getMonth() + delta);
    render();
    place();
    focusCursor();
  };

  const pick = (iso: string): void => {
    close();
    opts.onPick(iso);
  };

  const onDocDown = (e: Event): void => {
    const t = e.target as Node | null;
    if (t && (el.contains(t) || anchor.contains(t))) return;
    close();
  };

  const onKey = (e: KeyboardEvent): void => {
    const stop = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "Escape":
        stop();
        close();
        break;
      case "ArrowLeft":
        stop();
        shift(-1);
        break;
      case "ArrowRight":
        stop();
        shift(1);
        break;
      case "ArrowUp":
        stop();
        shift(-7);
        break;
      case "ArrowDown":
        stop();
        shift(7);
        break;
      case "PageUp":
        stop();
        shiftMonth(-1);
        break;
      case "PageDown":
        stop();
        shiftMonth(1);
        break;
      case "Enter":
        stop();
        pick(isoOf(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
        break;
      default:
        break;
    }
  };

  const close = (): void => {
    doc.removeEventListener("mousedown", onDocDown, true);
    doc.removeEventListener("keydown", onKey, true);
    win.removeEventListener("resize", place);
    win.removeEventListener("scroll", place, true);
    el.remove();
    if (active === close) active = null;
  };

  prev.addEventListener("click", () => shiftMonth(-1));
  next.addEventListener("click", () => shiftMonth(1));
  todayBtn.addEventListener("click", () => pick(todayIso));

  doc.addEventListener("mousedown", onDocDown, true);
  doc.addEventListener("keydown", onKey, true);
  win.addEventListener("resize", place);
  win.addEventListener("scroll", place, true);
  active = close;

  render();
  place();
  focusCursor();
  return close;
}
