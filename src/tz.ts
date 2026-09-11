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
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const utcGuess = Date.UTC(y || 0, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  let result = utcGuess;
  for (let i = 0; i < 3; i++) {
    result = utcGuess - tzOffsetMs(new Date(result), zone);
  }
  return new Date(result);
}

/** Convert a UTC instant to wall-clock parts in `zone`. */
export function toZone(date: Date, zone: string, targetZone = "America/New_York"): { date: string; time: string } {
  const s = localToUtc(dateStrOf(date), timeStrOf(date), zone);
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
  for (const p of fmt.formatToParts(s)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour || "0", 10) % 24;
  if (hour === 24) hour = 0;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, "0")}:${parts.minute}`,
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

export function fmtMoney(n: number, decimals = 0): string {
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n >= 0 ? `+$${abs}` : `-$${abs}`;
}

export function fmtMoney2(n: number): string {
  return fmtMoney(n, 2);
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
