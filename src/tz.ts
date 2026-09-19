export interface TimezoneOption {
  zone: string;
  label: string;
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { zone: "", label: "None — use times as recorded" },
  { zone: "UTC", label: "UTC" },
  { zone: "America/New_York", label: "America/New_York (ET)" },
  { zone: "America/Chicago", label: "America/Chicago (CT)" },
  { zone: "America/Denver", label: "America/Denver (MT)" },
  { zone: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { zone: "America/Vancouver", label: "America/Vancouver" },
  { zone: "America/Toronto", label: "America/Toronto" },
  { zone: "America/Mexico_City", label: "America/Mexico_City" },
  { zone: "America/Anchorage", label: "America/Anchorage" },
  { zone: "America/Sao_Paulo", label: "America/Sao_Paulo" },
  { zone: "America/Argentina/Buenos_Aires", label: "America/Buenos_Aires" },
  { zone: "America/Santiago", label: "America/Santiago" },
  { zone: "America/Bogota", label: "America/Bogota" },
  { zone: "America/Lima", label: "America/Lima" },
  { zone: "Pacific/Honolulu", label: "Pacific/Honolulu" },
  { zone: "Europe/London", label: "Europe/London" },
  { zone: "Europe/Lisbon", label: "Europe/Lisbon (Portugal)" },
  { zone: "Europe/Dublin", label: "Europe/Dublin" },
  { zone: "Europe/Madrid", label: "Europe/Madrid" },
  { zone: "Europe/Paris", label: "Europe/Paris" },
  { zone: "Europe/Berlin", label: "Europe/Berlin" },
  { zone: "Europe/Rome", label: "Europe/Rome" },
  { zone: "Europe/Amsterdam", label: "Europe/Amsterdam" },
  { zone: "Europe/Brussels", label: "Europe/Brussels" },
  { zone: "Europe/Vienna", label: "Europe/Vienna" },
  { zone: "Europe/Zurich", label: "Europe/Zurich" },
  { zone: "Europe/Stockholm", label: "Europe/Stockholm" },
  { zone: "Europe/Oslo", label: "Europe/Oslo" },
  { zone: "Europe/Copenhagen", label: "Europe/Copenhagen" },
  { zone: "Europe/Warsaw", label: "Europe/Warsaw" },
  { zone: "Europe/Prague", label: "Europe/Prague" },
  { zone: "Europe/Budapest", label: "Europe/Budapest" },
  { zone: "Europe/Athens", label: "Europe/Athens" },
  { zone: "Europe/Helsinki", label: "Europe/Helsinki" },
  { zone: "Europe/Kyiv", label: "Europe/Kyiv" },
  { zone: "Europe/Bucharest", label: "Europe/Bucharest" },
  { zone: "Europe/Istanbul", label: "Europe/Istanbul" },
  { zone: "Europe/Moscow", label: "Europe/Moscow" },
  { zone: "Africa/Casablanca", label: "Africa/Casablanca" },
  { zone: "Africa/Lagos", label: "Africa/Lagos" },
  { zone: "Africa/Johannesburg", label: "Africa/Johannesburg" },
  { zone: "Africa/Nairobi", label: "Africa/Nairobi" },
  { zone: "Africa/Cairo", label: "Africa/Cairo" },
  { zone: "Asia/Dubai", label: "Asia/Dubai" },
  { zone: "Asia/Karachi", label: "Asia/Karachi" },
  { zone: "Asia/Kolkata", label: "Asia/Kolkata (India)" },
  { zone: "Asia/Dhaka", label: "Asia/Dhaka" },
  { zone: "Asia/Bangkok", label: "Asia/Bangkok" },
  { zone: "Asia/Jakarta", label: "Asia/Jakarta" },
  { zone: "Asia/Hong_Kong", label: "Asia/Hong_Kong" },
  { zone: "Asia/Shanghai", label: "Asia/Shanghai" },
  { zone: "Asia/Singapore", label: "Asia/Singapore" },
  { zone: "Asia/Manila", label: "Asia/Manila" },
  { zone: "Asia/Kuala_Lumpur", label: "Asia/Kuala_Lumpur" },
  { zone: "Asia/Tokyo", label: "Asia/Tokyo" },
  { zone: "Asia/Seoul", label: "Asia/Seoul" },
  { zone: "Asia/Taipei", label: "Asia/Taipei" },
  { zone: "Australia/Perth", label: "Australia/Perth" },
  { zone: "Australia/Sydney", label: "Australia/Sydney" },
  { zone: "Australia/Melbourne", label: "Australia/Melbourne" },
  { zone: "Australia/Brisbane", label: "Australia/Brisbane" },
  { zone: "Australia/Adelaide", label: "Australia/Adelaide" },
  { zone: "Pacific/Auckland", label: "Pacific/Auckland" },
];

/** The browser/OS time zone as an IANA name. The honest default for a naive CSV:
 *  a broker export made on this machine is usually written in this zone. */
export function detectSystemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A short tag for a zone, for the little label next to a time input: ET, CT, PT. */
export function zoneShortLabel(zone: string): string {
  switch (zone) {
    case "":
      return "";
    case "UTC":
      return "UTC";
    case "America/New_York":
      return "ET";
    case "America/Chicago":
      return "CT";
    case "America/Denver":
      return "MT";
    case "America/Los_Angeles":
      return "PT";
    default:
      return (zone.split("/").pop() || zone).replace(/_/g, " ");
  }
}

/** Offset in ms between the given IANA zone and UTC for a specific instant. */
export function tzOffsetMs(date: Date, zone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const hour = parseInt(parts.hour || "0", 10) % 24;
  return Date.UTC(
    parseInt(parts.year || "0", 10),
    parseInt(parts.month || "1", 10) - 1,
    parseInt(parts.day || "1", 10),
    hour,
    parseInt(parts.minute || "0", 10),
    parseInt(parts.second || "0", 10)
  ) - date.getTime();
}

/** Interpret a local wall-clock (date + HH:MM) in `zone` and return the UTC instant. */
export function localToUtc(dateStr: string, timeStr: string, zone: string): Date {
  // Trades imported without a time (older notes have no entryTime) must not take
  // the whole view down: an empty time simply means midnight.
  const [y, m, d] = String(dateStr ?? "").split("-").map(Number);
  // Seconds matter: a CSV fill time is HH:MM:SS and dropping them made every
  // imported trade land on :00 (they are what tells two fills apart).
  const [hh, mm, ss] = String(timeStr ?? "").split(":").map(Number);
  const utcGuess = Date.UTC(y || 0, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0);
  let result = utcGuess;
  for (let i = 0; i < 3; i++) {
    result = utcGuess - tzOffsetMs(new Date(result), zone);
  }
  return new Date(result);
}

/** Convert a UTC instant to wall-clock parts in `zone`. */
export function toZone(instant: Date, _zone: string, targetZone = "America/New_York"): { date: string; time: string } {
  // `instant` is already a UTC point — format it straight in the target zone.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: targetZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour || "0", 10) % 24;
  if (hour === 24) hour = 0;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, "0")}:${parts.minute}`,
  };
}

/** Like `toZone`, but keeps the seconds — the CSV importer writes HH:MM:SS. */
export function zoneWallParts(instant: Date, zone: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour || "0", 10) % 24;
  if (hour === 24) hour = 0;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, "0")}:${parts.minute}:${parts.second}`,
  };
}

function dateStrOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timeStrOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** True if a DST transition happens within ±1 day of today in `zone`. */
export function isDstTransitionSoon(zone: string): boolean {
  const now = new Date();
  for (let d = -1; d <= 1; d++) {
    const a = new Date(now);
    a.setDate(a.getDate() + d);
    const b = new Date(a);
    b.setDate(b.getDate() + 1);
    if (tzOffsetMs(a, zone) !== tzOffsetMs(b, zone)) return true;
  }
  return false;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateStr(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

let CURRENCY = "$";

/** Set the currency symbol used by money formatting. */
export function setCurrencySymbol(sym: string): void {
  CURRENCY = sym || "$";
}

/** Money, signed, always to the cent. The journal is a record: a P&L that reads
 *  "+$708" when the account holds 708.66 is a number nobody can reconcile
 *  against their commissions. Round only where it is clearly a label
 *  (`fmtMoneyCompact`) or an unsigned size (`fmtMoneyAbs`). */
export function fmtMoney(n: number, decimals = 2): string {
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n >= 0 ? `+${CURRENCY}${abs}` : `-${CURRENCY}${abs}`;
}

/** Money with no leading sign — for amounts that are not gains or losses, like
 *  an account size. `fmtMoney` always signs its output by design. */
export function fmtMoneyAbs(n: number, decimals = 0): string {
  return fmtMoney(Math.abs(n), decimals).replace(/^\+/, "");
}

export function fmtMoney2(n: number): string {
  return fmtMoney(n, 2);
}

/**
 * Money as short as it can still be read: $950 · $1.5K · $25K · $1.2M.
 *
 * For badges and rows where the exact cents are noise — a payout badge that says
 * "$1.000,00" is a receipt, not a label. The full number is always one hover away.
 * No leading sign: an amount taken out is not a gain to celebrate.
 */
export function fmtMoneyCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  const short = (x: number) => (x >= 10 || Number.isInteger(x) ? String(Math.round(x)) : x.toFixed(1));
  if (v < 1000) return `${sign}${CURRENCY}${Math.round(v).toLocaleString()}`;
  if (v < 1_000_000) return `${sign}${CURRENCY}${short(v / 1000)}K`;
  return `${sign}${CURRENCY}${short(v / 1_000_000)}M`;
}

/**
 * A price, or an em dash when the note has none.
 *
 * Journaling by hand or by direct P&L leaves the price fields absent, and the
 * parser turns an absent number into `NaN`. `NaN` printed on screen is a bug in
 * any language: this renders it as "—" so the row reads as "not recorded"
 * instead of broken. Zero counts as "not set" too — that is the convention the
 * rest of the plugin uses for stop loss and imported fills.
 */
export function fmtPrice(v: number | undefined | null, decimals = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "\u2014";
  // Trim the padding: 20,950 reads better than 20,950.00 for a whole number.
  const text = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  return n < 0 ? `-${text.replace("-", "")}` : text;
}

export function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Convert a trade's recorded (local) date+time to the NY date. */
export function toZoneDate(date: string, time: string, zone: string): string {
  return zone ? toZone(new Date(localToUtc(date, time, zone)), zone).date : date;
}

/** Convert a trade's recorded (local) date+time to the NY time (HH:MM). */
export function toZoneTime(date: string, time: string, zone: string): string {
  return zone ? toZone(new Date(localToUtc(date, time, zone)), zone).time : time;
}

/** Today's key in the user's configured zone (NY date). */
export function todayKey(zone: string): string {
  return toZoneDate(todayStr(), "12:00", zone);
}
