/**
 * Canonical time — instants against civil values.
 *
 * Two kinds of time value live in this journal and they are never the same thing:
 *
 * - A **civil value** (`CivilDate` `YYYY-MM-DD`, `CivilTime` `HH:MM[:SS]`) is a
 *   wall clock: it means nothing without the zone it was written in. Notes store
 *   civil values, because that is what a trader reads and edits.
 * - An **instant** (`InstantIso`, `…Z`) is a point on the timeline: what a fill
 *   actually was, and the only value that survives a change of journal zone.
 *
 * Every conversion between the two is DST-aware and **never guesses**:
 *
 * - A stamp that names its own zone (`Z`, `±HH:MM`) is a true instant and wins
 *   over any source zone — no interpretation is applied on top of it.
 * - A naive stamp is interpreted only in the zone the reader says it was written
 *   in. If that zone has no wall clock for the value, the result is `gap` (the
 *   hour the clock jumped over); if it has two, the result is `ambiguous` (the
 *   hour the clock played twice). Both are reported, never rounded into a
 *   plausible instant.
 * - A naive stamp with no zone is `need-zone`, never "whatever zone this
 *   computer happens to be in".
 *
 * Nothing in here reads a system clock for its zone: the same input produces the
 * same instant on every machine.
 */

import { tzOffsetMs, zoneWallParts } from "../tz";
import type { InstantSource } from "../types";

/** A calendar date, `YYYY-MM-DD` — a day in *some* zone, never an instant. */
export type CivilDate = string;
/** A wall-clock time of day, `HH:MM` or `HH:MM:SS` — never an instant. */
export type CivilTime = string;
/** A UTC instant, `YYYY-MM-DDTHH:MM:SS.sssZ`. */
export type InstantIso = string;

/** Why an instant could not be pinned. `gap`/`ambiguous`/`need-zone` are DST and
 *  provenance questions; `invalid` means the input was not a date-time at all. */
export type InstantIssue = "gap" | "ambiguous" | "need-zone";

interface InstantBase {
  /** The civil date as written (or `""` when the input had none). */
  date: CivilDate;
  /** The civil time as written (or `""`). */
  time: CivilTime;
  /** Zone used to read a civil value; `""` when the stamp named its own zone. */
  zone: string;
}

export type InstantResolution =
  | (InstantBase & { status: "ok"; instant: Date; iso: InstantIso; source: InstantSource })
  /** No wall clock exists here — the clock jumped over this hour. */
  | (InstantBase & { status: "gap" })
  /** Two wall clocks exist here — the clock played this hour twice. */
  | (InstantBase & { status: "ambiguous"; instants: Date[]; isos: InstantIso[] })
  /** Naive stamp and no zone to read it in. Never resolved against the OS. */
  | (InstantBase & { status: "need-zone" })
  /** Not a date-time, not a real calendar date, or not a known zone. */
  | (InstantBase & { status: "invalid"; reason: "stamp" | "date" | "time" | "zone" });

// ---------------------------------------------------------------- civil values

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** True for a real `YYYY-MM-DD` calendar date. `2026-02-30` is not one. */
export function isCivilDate(v: unknown): v is CivilDate {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  return y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** True for `HH:MM` or `HH:MM:SS` within a day. */
export function isCivilTime(v: unknown): v is CivilTime {
  if (typeof v !== "string") return false;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(v.trim());
  if (!m) return false;
  return +m[1] <= 23 && +m[2] <= 59 && (m[3] === undefined || +m[3] <= 59);
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The next calendar date after `date` — used when an exit wrapped past midnight. */
export function nextCivilDate(date: CivilDate): CivilDate {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

// ------------------------------------------------------------------- zones

const zoneOk = new Map<string, boolean>();

/** True when the IANA zone is one this platform can read. Cached. */
export function isValidZone(zone: string): boolean {
  if (!zone) return false;
  const known = zoneOk.get(zone);
  if (known !== undefined) return known;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    ok = true;
  } catch {
    ok = false;
  }
  zoneOk.set(zone, ok);
  return ok;
}

// --------------------------------------------------------- wall clock → instant

function timeOfDay(raw: string): { h: number; m: number; s: number; ms: number } | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,9}))?$/.exec(text);
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  const s = m[3] === undefined ? 0 : +m[3];
  if (h > 23 || mi > 59 || s > 59) return null;
  const frac = m[4] ? Number((m[4] + "000").slice(0, 3)) : 0;
  return { h, m: mi, s, ms: frac };
}

/**
 * Read a civil date+time in `zone` and return every instant that wall clock
 * really stands for: one for a normal value, none inside a spring-forward gap,
 * two inside a fall-back replay.
 *
 * Candidates come from the offsets on either side of the value (yesterday, today,
 * tomorrow — a transition is never closer than that) and each one is kept only
 * if the zone formats back to exactly the clock that was asked for. The check is
 * a round trip, so a fixed offset can never launder a DST wall clock.
 */
export function instantFromWall(
  date: CivilDate,
  time: CivilTime,
  zone: string,
  source: InstantSource = "source-zone"
): InstantResolution {
  const base = { date: isCivilDate(date) ? date : String(date ?? ""), time: String(time ?? ""), zone };
  if (!zone) return { ...base, zone: "", status: "need-zone" };
  if (!isValidZone(zone)) return { ...base, status: "invalid", reason: "zone" };
  if (!isCivilDate(date)) return { ...base, status: "invalid", reason: "date" };
  const tod = timeOfDay(time);
  if (!tod) return { ...base, status: "invalid", reason: "time" };

  const [y, mo, d] = date.split("-").map(Number);
  // The fraction lives on the candidate, never on the instant we ask the zone
  // about: `tzOffsetMs` truncates to whole seconds, so an offset read from a
  // millisecond-bearing guess is shifted by the fraction — `.123` came back as
  // `.246`, and `.500` drifted a whole second and turned a normal hour into a
  // false `gap`. The offset itself only ever changes on a whole second, and
  // adding <1s back keeps the candidate inside the same second the round-trip
  // below checks, so the check still sees exactly the clock that was asked for.
  const utcBase = Date.UTC(y, mo - 1, d, tod.h, tod.m, tod.s, 0);
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) offsets.add(tzOffsetMs(new Date(utcBase + delta), zone));

  const wantedDate = date;
  const wantedTime = `${pad2(tod.h)}:${pad2(tod.m)}:${pad2(tod.s)}`;
  const found: Date[] = [];
  for (const off of offsets) {
    const inst = new Date(utcBase - off + tod.ms);
    if (Number.isNaN(inst.getTime())) continue;
    const wall = zoneWallParts(inst, zone);
    if (wall.date === wantedDate && wall.time === wantedTime) found.push(inst);
  }
  found.sort((a, b) => a.getTime() - b.getTime());

  if (found.length === 1) {
    const instant = found[0];
    return { ...base, status: "ok", instant, iso: instant.toISOString(), source };
  }
  if (found.length === 0) return { ...base, status: "gap" };
  return { ...base, status: "ambiguous", instants: found, isos: found.map((i) => i.toISOString()) };
}

// ----------------------------------------------------------- raw stamp parsing

interface Stamp {
  date: CivilDate;
  time: CivilTime;
  offset?: string;
}

/**
 * One grammar for every dialect the plugin has seen: ISO with `-`, US with `/`,
 * a space or `T` before the time, an optional fraction, an optional AM/PM and an
 * optional trailing zone. The fraction and the zone are parsed **before** the
 * value is touched — truncating at the first dot used to swallow the `Z` and
 * turn an instant into a naive stamp.
 */
const STAMP_RE =
  /^(\d{1,4})([/-])(\d{1,2})\2(\d{1,4})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(\.\d+)?\s*(am|pm)?\s*(z|[+-]\d{1,2}:?\d{2})?$/i;

function normalizeOffset(raw: string): string | null {
  if (/^z$/i.test(raw)) return "Z";
  const m = /^([+-])(\d{1,2}):?(\d{2})$/.exec(raw);
  if (!m) return null;
  const h = +m[2];
  const mi = +m[3];
  if (h > 23 || mi > 59) return null;
  return `${m[1]}${pad2(h)}:${pad2(mi)}`;
}

function parseStamp(raw: string): Stamp | null {
  const m = STAMP_RE.exec(raw.trim());
  if (!m) return null;
  const [, a, , b, c, hh, mm, ss, frac, meridiem, off] = m;
  const aNum = parseInt(a, 10);
  const cNum = parseInt(c, 10);
  let year: number;
  let month: number;
  let day: number;
  if (aNum > 1000) {
    year = aNum;
    month = parseInt(b, 10);
    day = cNum;
  } else {
    year = cNum < 100 ? 2000 + cNum : cNum;
    month = aNum;
    day = parseInt(b, 10);
  }
  // `Date.UTC` rewrites years below 100 into 19xx — never accept one.
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;

  let hour = parseInt(hh, 10);
  const minute = parseInt(mm, 10);
  const second = ss === undefined ? 0 : parseInt(ss, 10);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (meridiem) {
    const pm = /^pm$/i.test(meridiem);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    if (hour > 23) return null;
  }

  let offset: string | undefined;
  if (off) {
    const norm = normalizeOffset(off);
    if (!norm) return null;
    offset = norm;
  }
  const ms = frac ? Number((frac.slice(1) + "000").slice(0, 3)) : 0;
  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    time: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}${ms ? `.${String(ms).padStart(3, "0")}` : ""}`,
    offset,
  };
}

/** Seconds since midnight — so an exit earlier than its entry is seen as a wrap. */
export function secondsOfDay(time: CivilTime): number | null {
  const t = timeOfDay(time);
  return t ? t.h * 3600 + t.m * 60 + t.s : null;
}

// ---------------------------------------------------------- timestamp contract

export interface ParseInstantOpts {
  /** Zone a naive stamp was written in. Absent means "unknown", not "system". */
  sourceZone?: string;
}

/**
 * The one timestamp reader: `Z`/offset first (a true instant), then naive in the
 * declared source zone (DST-checked), then `need-zone`. Never the OS zone.
 */
export function parseInstant(raw: string, opts: ParseInstantOpts = {}): InstantResolution {
  const text = String(raw ?? "").trim();
  const sourceZone = (opts.sourceZone ?? "").trim();
  if (!text) return { date: "", time: "", zone: sourceZone, status: "invalid", reason: "stamp" };

  const stamp = parseStamp(text);
  if (!stamp) return { date: "", time: "", zone: sourceZone, status: "invalid", reason: "stamp" };

  if (stamp.offset) {
    const iso = `${stamp.date}T${stamp.time}${stamp.offset}`;
    const instant = new Date(iso);
    if (Number.isNaN(instant.getTime())) {
      return { date: stamp.date, time: stamp.time, zone: "", status: "invalid", reason: "stamp" };
    }
    // Re-read the instant so the stored ISO is always the canonical `…Z` form.
    return { date: stamp.date, time: stamp.time, zone: "", status: "ok", instant, iso: instant.toISOString(), source: "offset" };
  }

  if (!sourceZone) {
    return { date: stamp.date, time: stamp.time, zone: "", status: "need-zone" };
  }
  return instantFromWall(stamp.date, stamp.time, sourceZone, "source-zone");
}

// ------------------------------------------------------------- manual entries

export type ManualPin =
  | { status: "ok"; zone: string; entryInstant?: InstantIso; exitInstant?: InstantIso; source: "journal-zone" }
  | { status: "no-zone"; zone: "" }
  | { status: InstantIssue | "invalid"; zone: string; field: "entry" | "exit"; issue: InstantResolution };

/**
 * Pin the instants of a hand-written trade.
 *
 * Both times are read in the journal zone; an exit whose wall clock is earlier
 * than its entry belongs to the next day, the same wrap `holdFmt` already shows.
 * Nothing here ever picks between two candidates or nudges a missing hour: a
 * trade that cannot be pinned comes back as the reason, so the form can say so
 * and refuse the write.
 */
export function pinManualInstants(
  date: CivilDate,
  entryTime: CivilTime,
  exitTime: CivilTime,
  zone: string
): ManualPin {
  if (!zone) return { status: "no-zone", zone: "" };

  const entryRaw = String(entryTime ?? "").trim();
  const exitRaw = String(exitTime ?? "").trim();
  const entry = entryRaw ? instantFromWall(date, entryRaw, zone, "journal-zone") : null;
  if (entry && entry.status !== "ok") return { status: entry.status, zone, field: "entry", issue: entry };

  let exitDate = date;
  const entrySec = secondsOfDay(entryRaw);
  const exitSec = secondsOfDay(exitRaw);
  if (exitRaw && entrySec !== null && exitSec !== null && exitSec < entrySec) exitDate = nextCivilDate(date);
  const exit = exitRaw ? instantFromWall(exitDate, exitRaw, zone, "journal-zone") : null;
  if (exit && exit.status !== "ok") return { status: exit.status, zone, field: "exit", issue: exit };

  return {
    status: "ok",
    zone,
    source: "journal-zone",
    entryInstant: entry && entry.status === "ok" ? entry.iso : undefined,
    exitInstant: exit && exit.status === "ok" ? exit.iso : undefined,
  };
}

// ------------------------------------------------------------- canonical readers
//
// How the journal *reads* a trade. The canonical instant is the source of truth
// for when something happened; a zone turns it into the civil values a person
// reads. The recorded `date` / `entryTime` / `exitTime` stay what they always
// were — the note's representation — and are consulted only when the note has no
// instant (older notes), never to rebuild one.

/** The temporal fields a reader needs. Structurally satisfied by `Trade`. */
export interface TemporalFields {
  date?: string;
  entryTime?: string;
  exitTime?: string;
  entryInstant?: string;
  exitInstant?: string;
}

function instantOf(iso?: string): Date | null {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** The entry instant, or null when the note predates the contract. */
export function entryInstantDate(t: TemporalFields): Date | null {
  return instantOf(t.entryInstant);
}

/** The exit instant, or null when the note predates the contract. */
export function exitInstantDate(t: TemporalFields): Date | null {
  return instantOf(t.exitInstant);
}

/**
 * The day a trade belongs to, in `zone`: the entry instant rendered in that
 * zone, or the note's recorded date when there is no instant. No instant is ever
 * rebuilt from `date` + `entryTime` — the recorded pair is a representation.
 * An empty zone means "as recorded", so the recorded date is the answer.
 */
export function tradeDayInZone(t: TemporalFields, zone: string): string {
  const instant = entryInstantDate(t);
  if (instant && zone) return zoneWallParts(instant, zone).date;
  return String(t.date ?? "");
}

/** Entry wall clock (`HH:MM:SS`) in `zone`, from the instant when there is one. */
export function tradeEntryTimeInZone(t: TemporalFields, zone: string): string {
  const instant = entryInstantDate(t);
  if (instant && zone) return zoneWallParts(instant, zone).time;
  return String(t.entryTime ?? "");
}

/** Exit wall clock (`HH:MM:SS`) in `zone`, from the instant when there is one. */
export function tradeExitTimeInZone(t: TemporalFields, zone: string): string {
  const instant = exitInstantDate(t);
  if (instant && zone) return zoneWallParts(instant, zone).time;
  return String(t.exitTime ?? "");
}

/** The entry's hour (0–23) in `zone`, from the instant when there is one. */
export function tradeHourInZone(t: TemporalFields, zone: string): number | null {
  const seconds = secondsOfDay(tradeEntryTimeInZone(t, zone));
  return seconds === null ? null : Math.floor(seconds / 3600);
}

/**
 * How long the trade was held, in minutes: `exit − entry` on the real instants
 * when both exist (a hold across midnight or a DST change is the time it really
 * took), otherwise the recorded wall clock with the usual midnight wrap — the
 * same convention `holdFmt` has always shown. Null when nothing can be measured.
 */
export function holdMinutesOf(t: TemporalFields): number | null {
  const entry = entryInstantDate(t);
  const exit = exitInstantDate(t);
  if (entry && exit) {
    const minutes = (exit.getTime() - entry.getTime()) / 60000;
    // An exit before its entry is not a duration; a zero-length hold is.
    return minutes >= 0 ? minutes : null;
  }
  const start = secondsOfDay(String(t.entryTime ?? ""));
  const end = secondsOfDay(String(t.exitTime ?? ""));
  if (start === null || end === null) return null;
  const seconds = end >= start ? end - start : end + 86400 - start;
  return seconds >= 0 ? seconds / 60 : null;
}
