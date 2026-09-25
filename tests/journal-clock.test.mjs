import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

/**
 * The journal clock, end to end.
 *
 * Where `tests/temporal-foundation.test.mjs` proves how a raw stamp becomes an
 * instant, this file proves what the product then does with it: one canonical
 * instant, rendered through the Journal Timezone, decides the day, the hour,
 * Today, the period and the order of the rows — and the computer's zone decides
 * nothing at all.
 */

const result = await build({
  entryPoints: {
    instant: new URL("../src/lib/instant.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    periods: new URL("../src/lib/periods.ts", import.meta.url).pathname,
    sessions: new URL("../src/lib/sessions.ts", import.meta.url).pathname,
    fills: new URL("../src/lib/fills.ts", import.meta.url).pathname,
    processSignals: new URL("../src/lib/process.ts", import.meta.url).pathname,
    tradeTable: new URL("../src/lib/tradeTable.ts", import.meta.url).pathname,
    fees: new URL("../src/lib/fees.ts", import.meta.url).pathname,
    storage: new URL("../src/storage.ts", import.meta.url).pathname,
    tz: new URL("../src/tz.ts", import.meta.url).pathname,
  },
  outdir: "bundle",
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        b.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents: [
            "export const App = class {};",
            "export const TFile = class {};",
            "export const TFolder = class {};",
            "export const normalizePath = (p) => p;",
            "export const setIcon = () => {};",
          ].join("\n"),
          loader: "js",
        }));
      },
    },
  ],
});
const loadBundle = (name) => {
  const output = result.outputFiles.find((file) => file.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`);
};
const [instant, scope, periods, sessions, fills, processSignals, tradeTable, fees, storage, tz] = await Promise.all([
  loadBundle("instant"),
  loadBundle("scope"),
  loadBundle("periods"),
  loadBundle("sessions"),
  loadBundle("fills"),
  loadBundle("processSignals"),
  loadBundle("tradeTable"),
  loadBundle("fees"),
  loadBundle("storage"),
  loadBundle("tz"),
]);

const NY = "America/New_York";
const LISBON = "Europe/Lisbon";
const dayKeyIn = (zone) => scope.journalDayKey(zone);

/** A trade whose only temporal truth is its instant (plus the recorded fields). */
const at = (over = {}) => ({
  id: "t",
  date: "2026-01-15",
  entryTime: "09:30:00",
  exitTime: "10:45:00",
  symbol: "NQ",
  account: "A",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  pnl: 200,
  commission: 0,
  fees: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// 1–4. One instant, one journal zone, one civil reading.

test("a New York entry reads as the trader's Lisbon clock", () => {
  const cases = [
    ["2026-01-15T14:30:00.000Z", "09:30:00", "14:30:00", "2026-01-15", "2026-01-15", "winter, both UTC−0/+0 and −5"],
    ["2026-07-15T13:30:00.000Z", "09:30:00", "14:30:00", "2026-07-15", "2026-07-15", "summer, both on DST"],
    ["2026-03-09T13:30:00.000Z", "09:30:00", "13:30:00", "2026-03-09", "2026-03-09", "US on DST, EU not yet"],
    ["2026-10-26T13:30:00.000Z", "09:30:00", "13:30:00", "2026-10-26", "2026-10-26", "EU back on winter, US still on DST"],
  ];
  for (const [iso, inNy, inLisbon, dayNy, dayLisbon, why] of cases) {
    const t = at({ entryInstant: iso, date: "1970-01-01", entryTime: "00:00:00" });
    assert.equal(instant.tradeEntryTimeInZone(t, NY), inNy, `NY reads ${inNy} (${why})`);
    assert.equal(instant.tradeEntryTimeInZone(t, LISBON), inLisbon, `Lisbon reads ${inLisbon} (${why})`);
    assert.equal(instant.tradeDayInZone(t, NY), dayNy, why);
    assert.equal(instant.tradeDayInZone(t, LISBON), dayLisbon, why);
  }
});

test("the recorded fields never decide the day once an instant exists", () => {
  // The note says 1 January; the instant says otherwise, and the instant wins.
  const t = at({ date: "2026-01-01", entryTime: "23:59:00", entryInstant: "2026-07-15T13:30:00.000Z" });
  assert.equal(instant.tradeDayInZone(t, NY), "2026-07-15");
  assert.equal(instant.tradeEntryTimeInZone(t, NY), "09:30:00");
  // Without an instant the note is its own record — nothing is rebuilt.
  const legacy = at({ date: "2026-01-01", entryTime: "23:59:00" });
  assert.equal(instant.tradeDayInZone(legacy, LISBON), "2026-01-01");
  assert.equal(instant.tradeEntryTimeInZone(legacy, LISBON), "23:59:00");
});

// ---------------------------------------------------------------------------
// 12. The host zone decides nothing.

const deterministicOutputs = () => {
  const t = at({
    entryInstant: "2026-03-09T13:30:00.000Z",
    exitInstant: "2026-03-09T17:00:00.000Z",
    date: "2026-03-09",
    entryTime: "09:30:00",
    exitTime: "13:00:00",
  });
  return {
    dayKey: dayKeyIn(NY)(t),
    entryInLisbon: instant.tradeEntryTimeInZone(t, LISBON),
    hold: instant.holdMinutesOf(t),
    period: periods.periodBounds("thisweek", periods.dateInZone(NY, new Date("2026-03-09T12:00:00Z"))),
    todayInJournal: periods.dateInZone(NY, new Date("2026-03-09T12:00:00Z")),
    session: sessions.sessionOf(t, LISBON),
    net: fees.netPnl(t),
  };
};

test("the same instant and Journal Timezone give the same answer in any host zone", () => {
  const saved = process.env.TZ;
  process.env.TZ = "Pacific/Auckland";
  const south = deterministicOutputs();
  process.env.TZ = "America/Los_Angeles";
  const west = deterministicOutputs();
  process.env.TZ = "Etc/GMT+12";
  const far = deterministicOutputs();
  if (saved === undefined) delete process.env.TZ;
  else process.env.TZ = saved;

  assert.deepEqual(south, west, "Auckland and Los Angeles see the same journal");
  assert.deepEqual(west, far, "…and so does UTC−12");
  assert.equal(south.todayInJournal, "2026-03-09", "today in New York, on a fixed instant");
});

// ---------------------------------------------------------------------------
// 13. Changing the Journal Timezone changes the representation, nothing else.

test("a journal zone change moves only the civil reading", () => {
  const t = at({ entryInstant: "2026-03-09T23:30:00.000Z", exitInstant: "2026-03-10T01:00:00.000Z" });
  const before = {
    instant: t.entryInstant,
    net: fees.netPnl(t),
    identity: storage.tradeKey(t),
    pnl: t.pnl,
  };
  for (const zone of [NY, LISBON, "Asia/Tokyo", "Pacific/Auckland"]) {
    dayKeyIn(zone)(t);
    instant.tradeEntryTimeInZone(t, zone);
    instant.holdMinutesOf(t);
    assert.equal(t.entryInstant, before.instant, `${zone}: the instant never moves`);
    assert.equal(fees.netPnl(t), before.net, `${zone}: nor the P&L`);
    assert.equal(storage.tradeKey(t), before.identity, `${zone}: nor the trade's identity`);
    assert.equal(t.pnl, before.pnl);
  }
  // The day is the representation: 23:30Z is the 9th in New York and Lisbon,
  // and the 10th in Tokyo.
  assert.equal(dayKeyIn(NY)(t), "2026-03-09");
  assert.equal(dayKeyIn(LISBON)(t), "2026-03-09");
  assert.equal(dayKeyIn("Asia/Tokyo")(t), "2026-03-10");
});

// ---------------------------------------------------------------------------
// 14. The calendar day is exactly the set the Trade Log opens that day.

test("the day the calendar shows is the set the Trade Log opens", () => {
  const zone = NY;
  const key = dayKeyIn(zone);
  const trades = [
    // Morning of the 9th.
    at({ id: "a", entryInstant: "2026-03-09T14:30:00.000Z", date: "2026-03-09" }),
    // 23:30Z on the 9th = 19:30 in New York → still the 9th.
    at({ id: "b", entryInstant: "2026-03-09T23:30:00.000Z", date: "2026-03-09" }),
    // 01:30Z on the 10th = 21:30 in New York on the 9th → the 9th, even though
    // the recorded date says the 10th.
    at({ id: "c", entryInstant: "2026-03-10T01:30:00.000Z", date: "2026-03-10" }),
    // 13:30Z on the 10th = 09:30 in New York → the 10th.
    at({ id: "d", entryInstant: "2026-03-10T13:30:00.000Z", date: "2026-03-10" }),
  ];

  // What the calendar buckets.
  const buckets = new Map();
  for (const t of trades) buckets.set(key(t), [...(buckets.get(key(t)) ?? []), t.id]);
  assert.deepEqual(buckets.get("2026-03-09").sort(), ["a", "b", "c"]);
  assert.deepEqual(buckets.get("2026-03-10").sort(), ["d"]);

  // What the Trade Log opens for that day: the same key, the same bounds.
  const bounds = periods.periodDayBounds(periods.periodBounds("today", "2026-03-09"), zone);
  const open = trades.filter((t) => periods.dateWithinPeriod(key(t), bounds)).map((t) => t.id);
  assert.deepEqual(open.sort(), buckets.get("2026-03-09"), "identical sets, not merely equal counts");

  // The previous day is a different set, and the two do not overlap.
  const prev = trades.filter((t) =>
    periods.dateWithinPeriod(key(t), periods.periodDayBounds(periods.periodBounds("yesterday", "2026-03-09"), zone))
  );
  assert.deepEqual(prev.map((t) => t.id), [], "nothing of ours traded on the 8th");
  assert.deepEqual(open.filter((id) => prev.includes(id)), [], "the two days share nothing");
});

// ---------------------------------------------------------------------------
// 15. Today comes from the current instant and the Journal Timezone.

test("Today is the journal's today, never the host's", () => {
  const now = new Date("2026-03-09T12:00:00Z");
  assert.equal(periods.dateInZone(NY, now), "2026-03-09", "08:00 in New York");
  assert.equal(periods.dateInZone(LISBON, now), "2026-03-09", "12:00 in Lisbon");
  assert.equal(periods.dateInZone("Pacific/Kiritimati", now), "2026-03-10", "UTC+14 rolls over");
  assert.equal(periods.dateInZone("Etc/GMT+12", now), "2026-03-09", "UTC−12 does not");
  // `todayKey` is the same expression with the live instant behind it.
  assert.equal(tz.todayKey(NY), periods.dateInZone(NY), "todayKey(zone) is dateInZone(zone)");
  assert.equal(tz.todayKey(""), periods.dateInZone(""), "an empty journal zone means as-recorded");
});

test("adjacent civil periods never overlap", () => {
  const today = "2026-03-09";
  const pairs = ["yesterday", "thisweek", "lastweek", "1m", "lastmonth", "thisquarter", "lastquarter", "thisyear", "lastyear"];
  for (const period of pairs) {
    const current = periods.periodBounds(period, today);
    const previous = periods.previousPeriodBounds(period, today);
    if (!current.start || !previous?.start || !previous.end) continue;
    assert.ok(previous.end < current.start, `${period}: ${previous.end} ends before ${current.start} begins`);
    assert.ok(previous.start <= previous.end, `${period}: the previous window itself is ordered`);
  }
  // Today and yesterday touch but do not overlap.
  assert.equal(periods.periodBounds("yesterday", today).end, "2026-03-08");
  assert.equal(periods.periodBounds("today", today).start, "2026-03-09");
  assert.equal(periods.dateWithinPeriod("2026-03-08", periods.periodBounds("today", today)), false);
  assert.equal(periods.dateWithinPeriod("2026-03-09", periods.periodBounds("yesterday", today)), false);
});

// ---------------------------------------------------------------------------
// 16. Sessions stay ET, whatever zone the journal is set to.

test("a session is market time, not journal time", () => {
  // 13:30Z in September is 09:30 EDT — the New York open.
  const t = at({ entryInstant: "2026-09-15T13:30:00.000Z", date: "2026-09-15", entryTime: "09:30:00" });
  for (const zone of [NY, LISBON, "Asia/Tokyo", "Pacific/Auckland"]) {
    assert.equal(sessions.sessionOf(t, zone), "newyork", `${zone}: 09:30 ET is the open`);
  }
  // 19:30Z is 15:30 EDT — mid-session, and still "newyork" in any journal zone.
  const mid = at({ entryInstant: "2026-09-15T19:30:00.000Z" });
  for (const zone of [NY, LISBON, "Asia/Tokyo"]) {
    assert.equal(sessions.sessionOf(mid, zone), "newyork");
  }
  // 21:00Z is 17:00 EDT — after the close.
  const after = at({ entryInstant: "2026-09-15T21:00:00.000Z" });
  assert.equal(sessions.sessionOf(after, NY), "off");
  assert.equal(sessions.sessionOf(after, LISBON), "off");

  // A note with no instant is read in the zone the caller says it was written
  // in (the journal's), and still lands on the ET cut: 14:30 Lisbon = 09:30 ET.
  const civil = { date: "2026-09-15", entryTime: "14:30:00" };
  assert.equal(sessions.sessionOf(civil, LISBON), "newyork");
});

// ---------------------------------------------------------------------------
// 18. A trade that crosses midnight belongs to the journal's civil day.

test("a cross-midnight trade lands on the journal's civil day", () => {
  const t = at({ entryInstant: "2026-01-16T03:30:00.000Z", date: "2026-01-16", entryTime: "03:30:00" });
  assert.equal(instant.tradeDayInZone(t, NY), "2026-01-15", "22:30 in New York on the 15th");
  assert.equal(instant.tradeDayInZone(t, "UTC"), "2026-01-16", "…and already the 16th in UTC");
  assert.equal(dayKeyIn(NY)(t), "2026-01-15", "the Trade Log day follows the journal zone");
});

// ---------------------------------------------------------------------------
// 19. A duration across DST is the time it really took.

test("hold time across a DST change comes from the instants", () => {
  // 06:30Z (01:30 EST) → 10:30Z (06:30 EDT): four real hours across the jump.
  const real = at({
    entryInstant: "2026-03-08T06:30:00.000Z",
    exitInstant: "2026-03-08T10:30:00.000Z",
    entryTime: "01:30:00",
    exitTime: "06:30:00",
  });
  assert.equal(instant.holdMinutesOf(real), 240, "4h of real elapsed time");
  assert.equal(tradeTable.holdFmtOf(real), "4h");

  // The same recorded clocks without an instant are a civil reading — five
  // hours, because the clock skipped 02:00–03:00 in between.
  const civil = at({ entryTime: "01:30:00", exitTime: "06:30:00" });
  assert.equal(instant.holdMinutesOf(civil), 300, "the wall clock says 5h");
});

// ---------------------------------------------------------------------------
// 20. Fills that cross midnight keep their real order.

test("fills are ordered by their instants, not by the clock", () => {
  const t = at({
    entryPrice: 20000,
    exitPrice: 20010,
    quantity: 2,
    fills: [
      { side: "buy", time: "23:50:00", instant: "2026-01-15T23:50:00.000Z", qty: 1, price: 20000 },
      { side: "buy", time: "00:10:00", instant: "2026-01-16T00:10:00.000Z", qty: 1, price: 20001 },
    ],
  });
  const set = fills.fillSet(t);
  assert.deepEqual(
    set.entries.map((f) => f.time),
    ["23:50:00", "00:10:00"],
    "the 00:10 fill is the second one, not the first"
  );
  assert.deepEqual(
    set.entries.map((f) => f.instant),
    ["2026-01-15T23:50:00.000Z", "2026-01-16T00:10:00.000Z"]
  );
  // The comparator itself, in both directions.
  const a = { time: "23:50:00", instant: "2026-01-15T23:50:00.000Z" };
  const b = { time: "00:10:00", instant: "2026-01-16T00:10:00.000Z" };
  assert.ok(fills.compareFills(a, b) < 0, "instant order wins over clock order");
  assert.ok(fills.compareFills({ time: "09:00:00" }, { time: "10:00:00" }) < 0, "notes without instants fall back to the clock");
  // A synthetic fill stands for the real event and carries its instant.
  const inferred = fills.fillSet(at({ exitPrice: 20010, entryInstant: "2026-01-15T14:30:00.000Z", exitInstant: "2026-01-15T15:45:00.000Z" }));
  assert.equal(inferred.entries[0].instant, "2026-01-15T14:30:00.000Z", "B3: an inferred fill inherits the entry's instant");
  assert.equal(inferred.exits[0].instant, "2026-01-15T15:45:00.000Z", "B3: …and the exit's");
});


// ---------------------------------------------------------------------------
// The ledger's own day rows, and the process signals' day/gap.

test("the Trade Log groups rows by the journal's day, not the note's date", () => {
  const fakePlugin = { settings: { timeZone: NY, dateFormat: "YYYY-MM-DD" } };
  const rows = [
    // Recorded on the 16th, 10:00 EST on the 16th → journal day 16.
    at({ id: "afternoon", date: "2026-01-16", entryTime: "09:30:00", entryInstant: "2026-01-16T15:00:00.000Z" }),
    // Recorded on the 17th, 09:00 EST on the 16th → journal day 16 too.
    at({ id: "morning", date: "2026-01-17", entryTime: "10:30:00", entryInstant: "2026-01-16T14:00:00.000Z" }),
    // Recorded on the 16th, 10:00 EST on the 17th → journal day 17.
    at({ id: "tomorrow", date: "2026-01-16", entryTime: "10:00:00", entryInstant: "2026-01-17T15:00:00.000Z" }),
  ];
  const grouped = tradeTable.orderedTradeRows(rows, null, fakePlugin, true);
  assert.deepEqual(
    grouped.map((row) => row.rep.id),
    ["morning", "afternoon", "tomorrow"],
    "the two trades the journal calls the 16th share a day, in the order they happened"
  );

  // Reading the day from the note's date would land `morning` (recorded the
  // 17th) with the 17th — a different ledger, and the reason the grouping uses
  // the journal's key instead.
  assert.notDeepEqual(
    grouped.map((row) => row.rep.id),
    ["tomorrow", "afternoon", "morning"],
    "…which is how the recorded dates alone would have ordered these rows"
  );

  // Ungrouped, the ledger reads newest first — also from the instant.
  const flat = tradeTable.orderedTradeRows(rows, null, fakePlugin, false);
  assert.deepEqual(
    flat.map((row) => row.rep.id),
    ["tomorrow", "afternoon", "morning"],
    "newest journal day first, then the clock"
  );
});

test("process signals use the journal's day and the gap the clock really had", () => {
  const trades = [
    at({
      id: "loss",
      date: "2026-01-16",
      pnl: -100,
      entryInstant: "2026-01-16T14:00:00.000Z",
      exitInstant: "2026-01-16T14:30:00.000Z",
      entryTime: "09:00:00",
      exitTime: "09:30:00",
    }),
    at({
      id: "re",
      date: "2026-01-16",
      pnl: 50,
      entryInstant: "2026-01-16T14:40:00.000Z",
      entryTime: "09:40:00",
    }),
  ];
  const signals = processSignals.computeProcessSignals(trades, dayKeyIn(NY));
  assert.equal(signals.revengeCount, 1, "a re-entry 10 minutes after the loss, same journal day");
  assert.equal(signals.tradeCount, 2);

  // A day key that puts the two trades apart kills the signal — "same day" is
  // the caller's day, not the note's recorded date.
  const apart = processSignals.computeProcessSignals(trades, (t) => t.id);
  assert.equal(apart.revengeCount, 0, "different days: not a re-entry");

  // The same two trades with only a recorded date (no instants): the civil
  // clock still answers, so pre-contract notes behave as they always did.
  const civil = [
    at({ id: "loss", date: "2026-01-16", pnl: -100, entryTime: "09:00:00", exitTime: "09:30:00" }),
    at({ id: "re", date: "2026-01-16", pnl: 50, entryTime: "09:40:00" }),
  ];
  assert.equal(processSignals.computeProcessSignals(civil, dayKeyIn(NY)).revengeCount, 1);
});
