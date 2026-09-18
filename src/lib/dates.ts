/**
 * Date formatting/parsing that honours the user's Date format setting.
 * Stored dates are always ISO (YYYY-MM-DD); only the display changes.
 */

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
  onChange: (iso: string) => void;
  className?: string;
}

/**
 * A date field that *displays* the user's format (native <input type="date">
 * always shows the browser locale, which is why the setting seemed ignored).
 * A small calendar button opens the native picker when a real date is needed.
 */
export function mountDateField(host: HTMLElement, opts: DateFieldOpts): HTMLInputElement {
  const wrap = host.createDiv({ cls: "tj-datefield" });
  const input = wrap.createEl("input", {
    cls: "tj-datefield-input" + (opts.className ? " " + opts.className : ""),
    attr: { type: "text", value: formatDate(opts.value, opts.format), placeholder: datePlaceholder(opts.format) },
  });
  // Invisible native input on top: clicking the field opens the OS calendar
  // (the native input always shows the OS format, so we keep our own display).
  const native = wrap.createEl("input", { cls: "tj-datefield-native", attr: { type: "date" } }) as HTMLInputElement;
  // Inline, not just in the stylesheet: inside a modal Obsidian's own rules for
  // `input[type="date"]` can outrank a class, and the field would stretch and
  // push the visible value off its corner. Inline styles cannot be outranked
  // without `!important`, so the picker stays a 1px invisible line for good.
  native.style.cssText =
    "position:absolute;left:0;bottom:0;width:100%;height:1px;opacity:0;pointer-events:none;" +
    "border:0;padding:0;margin:0;background:transparent;appearance:none;box-shadow:none;";
  native.value = opts.value || "";

  const sync = () => {
    if (!native.value) return;
    input.value = formatDate(native.value, opts.format);
    opts.onChange(native.value);
  };
  native.addEventListener("change", sync);
  native.addEventListener("input", sync);

  // Clicking the field opens the OS calendar straight away (anchored to the field).
  const openPicker = () => {
    try {
      (native as any).showPicker?.();
    } catch {
      /* older engine: fall back to focusing the native input */
      native.focus();
    }
  };
  // The whole field is the hit area: the glyph is drawn by CSS and the text input
  // can be narrower than the row, so a click next to it must open the calendar too.
  wrap.addEventListener("click", openPicker);
  input.addEventListener("click", openPicker);

  // Typing still works as a fallback and keeps the native picker in sync.
  input.addEventListener("input", () => {
    const iso = parseDateInput(input.value, opts.format);
    if (iso) {
      native.value = iso;
      opts.onChange(iso);
    }
  });
  input.addEventListener("blur", () => {
    const iso = parseDateInput(input.value, opts.format);
    if (iso) input.value = formatDate(iso, opts.format);
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
