/**
 * Date formatting/parsing that honours the user's Date format setting.
 * Stored dates are always ISO (YYYY-MM-DD); only the display changes.
 */

import { openCalendar } from "./calendar";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string, fmt?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "";
  const [, y, mo, d] = m;
  switch (fmt) {
    case "DD/MM/YYYY":
      return `${d}/${mo}/${y}`;
    case "MM/DD/YYYY":
      return `${mo}/${d}/${y}`;
    case "D MMM YYYY":
      return `${parseInt(d, 10)} ${MON[parseInt(mo, 10) - 1]} ${y}`;
    default:
      return `${y}-${mo}-${d}`;
  }
}

export function datePlaceholder(fmt?: string): string {
  switch (fmt) {
    case "DD/MM/YYYY":
      return "DD/MM/YYYY";
    case "MM/DD/YYYY":
      return "MM/DD/YYYY";
    case "D MMM YYYY":
      return "D MMM YYYY";
    default:
      return "YYYY-MM-DD";
  }
}

/** Parse a typed date (in the chosen format, or ISO) back to ISO, or "" if invalid. */
export function parseDateInput(text: string, fmt?: string): string {
  const t = (text || "").trim();
  let y = "";
  let mo = "";
  let d = "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    [, y, mo, d] = m;
  } else if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(t))) {
    if (fmt === "MM/DD/YYYY") [, mo, d, y] = m;
    else [, d, mo, y] = m;
  }
  if (!y) return "";
  const mm = parseInt(mo, 10);
  const dd = parseInt(d, 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export interface DateFieldOpts {
  value: string;
  format?: string;
  /** Journal Timezone: the calendar's "today" is today there, never here. */
  zone: string;
  onChange: (iso: string) => void;
  className?: string;
  calendarZIndex?: number;
}

/**
 * A date field that *displays* the user's format (native <input type="date">
 * always shows the browser locale, which is why the setting seemed ignored).
 * Clicking the field opens the plugin's own themed calendar (lib/calendar.ts);
 * typing a date still works and is parsed back to ISO.
 */
export function mountDateField(host: HTMLElement, opts: DateFieldOpts): HTMLInputElement {
  const wrap = host.createDiv({ cls: "tj-datefield" });
  const input = wrap.createEl("input", {
    cls: "tj-datefield-input" + (opts.className ? " " + opts.className : ""),
    attr: { type: "text", value: formatDate(opts.value, opts.format), placeholder: datePlaceholder(opts.format) },
  });

  const commit = (iso: string): void => {
    if (!iso) return;
    input.value = formatDate(iso, opts.format);
    opts.onChange(iso);
  };
  const open = (): void => {
    openCalendar(wrap, {
      value: parseDateInput(input.value, opts.format) || opts.value || "",
      onPick: commit,
      zIndex: opts.calendarZIndex,
      zone: opts.zone,
    });
  };

  // The whole field is the hit area: the glyph is drawn by CSS and the text
  // input can be narrower than the row, so a click next to it opens too.
  wrap.addEventListener("click", open);

  // Typing still works as a fallback (and is the only path on a keyboard until
  // the calendar is opened with ArrowDown).
  input.addEventListener("input", () => {
    const iso = parseDateInput(input.value, opts.format);
    if (iso) opts.onChange(iso);
  });
  input.addEventListener("blur", () => {
    const iso = parseDateInput(input.value, opts.format);
    if (iso) input.value = formatDate(iso, opts.format);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(parseDateInput(input.value, opts.format));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      open();
    }
  });
  return input;
}

/** Date for a *file name*: same as formatDate but with "/" → "-" (illegal in names). */
export function formatDateFile(iso: string, fmt?: string): string {
  return formatDate(iso, fmt).replace(/[/\\:]/g, "-");
}

/** Extra tokens so the search finds a date typed in any common form. */
export function dateSearchTokens(iso: string, fmt?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "";
  const [, y, mo, d] = m;
  return [iso, formatDate(iso, fmt), `${d}/${mo}/${y}`, `${d}${mo}${y.slice(2)}`, `${d}/${mo}`].join(" ");
}
