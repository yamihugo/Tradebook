import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

/**
 * The temporal contract, end to end.
 *
 * Every row here is a date the reader got wrong once: the hour a clock jumped
 * over, the hour it played twice, the zone the machine happened to be in. The
 * rule under test is always the same one — pin an instant only when there is
 * exactly one, say so otherwise, and never resolve it against this computer.
 */

const result = await build({
  entryPoints: {
    instant: new URL("../src/lib/instant.ts", import.meta.url).pathname,
    csv: new URL("../src/csv.ts", import.meta.url).pathname,
    storage: new URL("../src/storage.ts", import.meta.url).pathname,
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
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
const [instant, csv, storage, copy] = await Promise.all([
  loadBundle("instant"),
  loadBundle("csv"),
  loadBundle("storage"),
  loadBundle("copy"),
]);

const NY = "America/New_York";
const LISBON = "Europe/Lisbon";

// 2026, for the record: US DST 8 Mar → 1 Nov, EU (Lisbon) 29 Mar → 25 Oct.
const US_GAP_DAY = "2026-03-08";
const US_REPLAY_DAY = "2026-11-01";
const EU_GAP_DAY = "2026-03-29";
const EU_REPLAY_DAY = "2026-10-25";

// ----------------------------------------------------------- civil vs instant

test("civil values are only ever civil values", () => {
  assert.equal(instant.isCivilDate("2026-02-28"), true);
  assert.equal(instant.isCivilDate("2028-02-29"), true, "a leap year's 29th is a date");
  assert.equal(instant.isCivilDate("2026-02-30"), false, "not a real calendar date");
  assert.equal(instant.isCivilDate("2026-13-01"), false);
  assert.equal(instant.isCivilDate("26-03-01"), false, "two-digit years are not ISO civil dates");
  assert.equal(instant.isCivilTime("09:30"), true);
  assert.equal(instant.isCivilTime("09:30:15"), true);
  assert.equal(instant.isCivilTime("24:00"), false);
  assert.equal(instant.nextCivilDate("2026-01-31"), "2026-02-01");
  assert.equal(instant.nextCivilDate("2026-12-31"), "2027-01-01");
});

// ------------------------------------------------------- offset always wins

test("a stamp that names its own zone is already an instant", () => {
  const z = instant.parseInstant("2026-01-15T15:00:00Z", { sourceZone: NY });
  assert.equal(z.status, "ok");
  assert.equal(z.source, "offset", "the stamp's zone wins over any source zone");
  assert.equal(z.iso, "2026-01-15T15:00:00.000Z");

  // The old reader truncated at the first dot and swallowed the Z.
  const frac = instant.parseInstant("2026-01-15T15:00:00.123Z", { sourceZone: NY });
  assert.equal(frac.status, "ok");
  assert.equal(frac.iso, "2026-01-15T15:00:00.123Z");
  assert.equal(frac.source, "offset");

  const off = instant.parseInstant("2026-01-15 15:00:00 -05:00", { sourceZone: LISBON });
  assert.equal(off.status, "ok");
  assert.equal(off.source, "offset");
  assert.equal(off.iso, "2026-01-15T20:00:00.000Z", "the offset is the truth, not the zone we were offered");

  const us = instant.parseInstant("01/15/2026 10:00:00 AM", { sourceZone: NY });
  assert.equal(us.status, "ok");
  assert.equal(us.source, "source-zone");
  assert.equal(us.iso, "2026-01-15T15:00:00.000Z", "10am EST is 15:00Z");
});

// ------------------------------------------------------------- the zone table

test("naive stamps are read in the declared zone, in both halves of the year", () => {
  const cases = [
    [NY, "2026-01-15 15:00", "2026-01-15T20:00:00.000Z", "NY winter (UTC−5)"],
    [NY, "2026-07-15 15:00", "2026-07-15T19:00:00.000Z", "NY summer (UTC−4)"],
    [LISBON, "2026-01-15 15:00", "2026-01-15T15:00:00.000Z", "Lisbon winter (UTC+0)"],
    [LISBON, "2026-07-15 15:00", "2026-07-15T14:00:00.000Z", "Lisbon summer (UTC+1)"],
    // 15 Mar 2026: the US is on summer time, the EU is not yet — the two clocks
    // are four hours apart, not five, and the reader must not assume either.
    [NY, "2026-03-15 15:00", "2026-03-15T19:00:00.000Z", "US on DST, EU not (NY)"],
    [LISBON, "2026-03-15 15:00", "2026-03-15T15:00:00.000Z", "US on DST, EU not (Lisbon)"],
    // 30 Oct 2026: the EU is back on winter time, the US is not yet.
    [NY, "2026-10-30 15:00", "2026-10-30T19:00:00.000Z", "EU on winter, US not (NY)"],
    [LISBON, "2026-10-30 15:00", "2026-10-30T15:00:00.000Z", "EU on winter, US not (Lisbon)"],
  ];
  for (const [zone, stamp, iso, label] of cases) {
    const r = instant.parseInstant(stamp, { sourceZone: zone });
    assert.equal(r.status, "ok", `${label}: expected one instant`);
    assert.equal(r.source, "source-zone", label);
    assert.equal(r.iso, iso, label);
  }
});

// -------------------------------------------------------------- DST, refused

test("an hour that never happened is a gap, not a guess", () => {
  const ny = instant.parseInstant(`${US_GAP_DAY} 02:30`, { sourceZone: NY });
  assert.equal(ny.status, "gap", "New York jumps 02:00 → 03:00 on 8 Mar 2026");

  const lisbon = instant.parseInstant(`${EU_GAP_DAY} 01:30`, { sourceZone: LISBON });
  assert.equal(lisbon.status, "gap", "Lisbon jumps 01:00 → 02:00 on 29 Mar 2026");

  // Just outside the gap everything is normal — the refusal is about the hour.
  assert.equal(instant.parseInstant(`${US_GAP_DAY} 01:30`, { sourceZone: NY }).status, "ok");
  assert.equal(instant.parseInstant(`${US_GAP_DAY} 03:30`, { sourceZone: NY }).status, "ok");
});

test("an hour that happened twice offers two instants, never one", () => {
  const ny = instant.parseInstant(`${US_REPLAY_DAY} 01:30`, { sourceZone: NY });
  assert.equal(ny.status, "ambiguous");
  assert.equal(ny.instants.length, 2, "EDT and EST both hold 01:30");
  assert.deepEqual(ny.isos, ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);

  const lisbon = instant.parseInstant(`${EU_REPLAY_DAY} 01:30`, { sourceZone: LISBON });
  assert.equal(lisbon.status, "ambiguous");
  assert.equal(lisbon.instants.length, 2);
  assert.deepEqual(lisbon.isos, ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
});

test("a naive stamp with no zone is never read in the machine's zone", () => {
  const r = instant.parseInstant("2026-01-15 15:00");
  assert.equal(r.status, "need-zone");

  const empty = instant.parseInstant("2026-01-15 15:00", { sourceZone: "" });
  assert.equal(empty.status, "need-zone");
});

test("the OS zone changes nothing about the instant we return", () => {
  const wanted = instant.parseInstant("2026-01-15 15:00", { sourceZone: NY });
  const saved = process.env.TZ;

  process.env.TZ = "Pacific/Auckland";
  const south = instant.parseInstant("2026-01-15 15:00", { sourceZone: NY });
  const naiveSouth = instant.parseInstant("2026-01-15 15:00");

  process.env.TZ = "America/Los_Angeles";
  const west = instant.parseInstant("2026-01-15 15:00", { sourceZone: NY });
  const naiveWest = instant.parseInstant("2026-01-15 15:00");

  if (saved === undefined) delete process.env.TZ;
  else process.env.TZ = saved;

  assert.equal(south.iso, wanted.iso, "a declared zone is read the same on any machine");
  assert.equal(west.iso, wanted.iso);
  assert.equal(naiveSouth.status, "need-zone", "Auckland must not become the answer");
  assert.equal(naiveWest.status, "need-zone", "Los Angeles must not become the answer either");
});

// ------------------------------------------------------- manual, the same way

test("a hand-written trade is pinned in the journal zone", () => {
  const pin = instant.pinManualInstants("2026-01-15", "09:30", "10:45", NY);
  assert.equal(pin.status, "ok");
  assert.equal(pin.source, "journal-zone");
  assert.equal(pin.zone, NY);
  assert.equal(pin.entryInstant, "2026-01-15T14:30:00.000Z");
  assert.equal(pin.exitInstant, "2026-01-15T15:45:00.000Z");
});

test("an exit that wraps past midnight belongs to the next day", () => {
  const pin = instant.pinManualInstants("2026-01-15", "23:00", "00:30", NY);
  assert.equal(pin.status, "ok");
  assert.equal(pin.entryInstant, "2026-01-16T04:00:00.000Z");
  assert.equal(pin.exitInstant, "2026-01-16T05:30:00.000Z", "00:30 is the following morning");
});

test("the form is told which time refused, instead of being rounded", () => {
  const gap = instant.pinManualInstants(US_GAP_DAY, "02:30", "09:30", NY);
  assert.equal(gap.status, "gap");
  assert.equal(gap.field, "entry");

  const exitGap = instant.pinManualInstants(US_GAP_DAY, "01:00", "02:30", NY);
  assert.equal(exitGap.status, "gap");
  assert.equal(exitGap.field, "exit", "the wrap only applies to an exit earlier than its entry");

  const ambiguous = instant.pinManualInstants(US_REPLAY_DAY, "00:30", "01:30", NY);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.field, "exit");
  assert.equal(ambiguous.issue.instants.length, 2);

  const exitAmbiguous = instant.pinManualInstants(US_REPLAY_DAY, "01:30", "09:30", NY);
  assert.equal(exitAmbiguous.status, "ambiguous");
  assert.equal(exitAmbiguous.field, "entry");

  const noZone = instant.pinManualInstants("2026-01-15", "09:30", "10:45", "");
  assert.equal(noZone.status, "no-zone", "no zone means no instant — never the OS zone");

  const badDate = instant.pinManualInstants("2026-02-30", "09:30", "10:45", NY);
  assert.equal(badDate.status, "invalid");
  assert.equal(badDate.field, "entry");
});

// ------------------------------------------------------------------ the file

const HEADER = "Timestamp,Account,Symbol,Side,Quantity,Filled Qty,Avg Fill Price,Order ID,Order Type";

const ROWS = [
  // A normal winter round trip, naive stamps read in the source zone, scaled in
  // so the fills are written out (a flat 1-in 1-out has no fills block).
  `01/15/2026 09:30:00,Live-01,NQ,Buy,2,2,20000.00,ord1,Market`,
  `01/15/2026 09:45:00,Live-01,NQ,Sell,1,1,20010.00,ord2,Market`,
  `01/15/2026 09:50:00,Live-01,NQ,Sell,1,1,20020.00,ord3,Market`,
  // A round trip stamped with true instants.
  `2026-07-15T13:00:00Z,Live-01,ES,Buy,1,1,6000.00,ord4,Market`,
  `2026-07-15T13:30:00Z,Live-01,ES,Sell,1,1,6005.00,ord5,Market`,
  // The hour New York skipped, and the hour it played twice.
  `03/08/2026 02:30:00,Live-01,RTY,Buy,1,1,2000.00,ord6,Market`,
  `11/01/2026 01:30:00,Live-01,RTY,Buy,1,1,2000.00,ord7,Market`,
  // A row the reader cannot read at all, and a ticket that never traded (its
  // fill columns are the empty ones).
  `not-a-date,Live-01,CL,Buy,1,1,70.00,ord8,Market`,
  `01/15/2026 10:00:00,Live-01,CL,Sell,1,,,ord9,Limit`,
].join("\n");

const parseTrades = (text, zones) => csv.parseTradeovateCsv(text, [], zones);

test("an import pins every instant it writes, and counts what it refused", () => {
  const out = parseTrades(`${HEADER}\n${ROWS}\n`, { sourceZone: NY, journalZone: NY });

  assert.deepEqual(out.timeIssues, { gap: 1, ambiguous: 1, noZone: 0 });
  assert.equal(out.skipped, 1, "only the unreadable stamp is skipped");
  assert.equal(out.unfilled, 1, "the ticket that never traded is not an error");
  assert.equal(out.trades.length, 2, "the refused rows are not traded away silently");

  const [nq, es] = out.trades;
  assert.equal(nq.entryInstant, "2026-01-15T14:30:00.000Z");
  assert.equal(nq.exitInstant, "2026-01-15T14:50:00.000Z", "the instant of the fill that flattened it");
  assert.equal(nq.instantSource, "source-zone");
  assert.equal(nq.sourceZone, NY, "the zone the stamps were written in, recorded");
  assert.equal(nq.entryTime, "09:30:00", "the note still reads the wall clock");
  assert.equal(nq.fills.length, 3, "scaled trade: both legs and the partial exit");
  assert.equal(nq.fills[0].instant, "2026-01-15T14:30:00.000Z", "each fill keeps its own instant");
  assert.equal(nq.fills[2].instant, "2026-01-15T14:50:00.000Z");

  assert.equal(es.entryInstant, "2026-07-15T13:00:00.000Z");
  assert.equal(es.exitInstant, "2026-07-15T13:30:00.000Z");
  assert.equal(es.instantSource, "offset", "a stamped instant needs no zone to be read");
  assert.equal(es.sourceZone, undefined, "…so no source zone is claimed");
  assert.ok(
    out.warnings.some((w) => w.includes("DST gap") && w.includes("repeated hour")),
    `the review says why: ${JSON.stringify(out.warnings)}`
  );
});

test("with no zone chosen, only stamps that name their own zone are imported", () => {
  const out = parseTrades(`${HEADER}\n${ROWS}\n`, { journalZone: NY });
  assert.deepEqual(out.timeIssues, { gap: 0, ambiguous: 0, noZone: 5 }, "every naive row is refused");
  assert.equal(out.trades.length, 1, "the Z-stamped round trip needs no zone at all");
  assert.equal(out.trades[0].instantSource, "offset");
  assert.equal(out.trades[0].sourceZone, undefined);
  assert.equal(out.unfilled, 1, "an unfilled ticket still needs no zone");
  assert.equal(out.skipped, 1, "the unreadable row is still unreadable");
  assert.ok(out.warnings.some((w) => w.includes("no zone and none was chosen")));
});

// --------------------------------------------------- sub-second timestamps

test("a naive stamp keeps its fraction exactly — no drift, no false gap", () => {
  const cases = [
    [NY, "2026-01-15 15:00:00.123", "2026-01-15T20:00:00.123Z", "NY winter .123"],
    [NY, "2026-01-15 15:00:00.500", "2026-01-15T20:00:00.500Z", "NY winter .500 (was a false gap)"],
    [NY, "2026-01-15 15:00:00.900", "2026-01-15T20:00:00.900Z", "NY winter .900 (was a false gap)"],
    [NY, "2026-07-15 15:00:00.750", "2026-07-15T19:00:00.750Z", "NY summer .750"],
    ["Europe/Lisbon", "2026-07-15 15:00:00.060", "2026-07-15T14:00:00.060Z", "Lisbon summer .060"],
    // A half-hour offset used to drift the same way.
    ["Asia/Kathmandu", "2026-01-15 15:00:00.500", "2026-01-15T09:15:00.500Z", "Kathmandu (+5:45) .500"],
  ];
  for (const [zone, stamp, iso, label] of cases) {
    const r = instant.parseInstant(stamp, { sourceZone: zone });
    assert.equal(r.status, "ok", `${label}: a fraction is never a DST gap`);
    assert.equal(r.iso, iso, label);
    assert.equal(r.source, "source-zone", label);
  }
});

test("a stamp that already names its zone keeps its fraction too", () => {
  const z = instant.parseInstant("2026-01-15T15:00:00.123Z", { sourceZone: NY });
  assert.equal(z.status, "ok");
  assert.equal(z.iso, "2026-01-15T15:00:00.123Z");
  assert.equal(z.source, "offset");

  const off = instant.parseInstant("2026-01-15 15:00:00.456+05:30", { sourceZone: NY });
  assert.equal(off.status, "ok");
  assert.equal(off.iso, "2026-01-15T09:30:00.456Z");
  assert.equal(off.source, "offset");
});

test("a fill's own fraction reaches its canonical instant", () => {
  const header = "Timestamp,Account,Symbol,Side,Quantity,Filled Qty,Avg Fill Price,Order ID,Order Type";
  const rows = [
    `01/15/2026 09:30:00.250,Live-01,NQ,Buy,2,2,20000.00,ord1,Market`,
    `01/15/2026 09:45:00.750,Live-01,NQ,Sell,1,1,20010.00,ord2,Market`,
    `01/15/2026 09:50:00.750,Live-01,NQ,Sell,1,1,20020.00,ord3,Market`,
  ].join("\n");
  const out = csv.parseTradeovateCsv(`${header}\n${rows}\n`, [], { sourceZone: NY, journalZone: NY });
  const t = out.trades[0];
  assert.equal(t.entryInstant, "2026-01-15T14:30:00.250Z");
  assert.equal(t.fills[0].instant, "2026-01-15T14:30:00.250Z", "the entry fill carries the same fraction");
  assert.equal(t.fills[2].instant, "2026-01-15T14:50:00.750Z");
});

// --------------------------------------------------------- an offset wins again

test("an explicit offset still resolves inside a gap and inside a replay", () => {
  // 8 Mar 2026, 02:30 does not exist on New York's wall — but `−05:00` is a
  // moment on the timeline, not a clock reading, so there is nothing to skip.
  const inGap = instant.parseInstant("2026-03-08 02:30:00 -05:00", { sourceZone: NY });
  assert.equal(inGap.status, "ok");
  assert.equal(inGap.source, "offset");
  assert.equal(inGap.iso, "2026-03-08T07:30:00.000Z", "and New York reads it as 03:30 EDT");

  const zOnGapDay = instant.parseInstant("2026-03-08T07:30:00Z", { sourceZone: NY });
  assert.equal(zOnGapDay.status, "ok");
  assert.equal(zOnGapDay.iso, "2026-03-08T07:30:00.000Z");

  // 1 Nov 2026, 01:30 happens twice — each offset picks one of them, and only
  // the naive reading of the same clock is refused.
  const edt = instant.parseInstant("2026-11-01 01:30:00 -04:00", { sourceZone: NY });
  const est = instant.parseInstant("2026-11-01 01:30:00 -05:00", { sourceZone: NY });
  assert.equal(edt.status, "ok");
  assert.equal(est.status, "ok");
  assert.equal(edt.iso, "2026-11-01T05:30:00.000Z");
  assert.equal(est.iso, "2026-11-01T06:30:00.000Z");
  assert.notEqual(edt.iso, est.iso, "both are real, and they are different instants");
  assert.equal(instant.parseInstant("2026-11-01 01:30:00", { sourceZone: NY }).status, "ambiguous");
});

// ------------------------------------------------- zones outside the big two

test("a 30-minute transition is read as a gap or as two instants", () => {
  // Lord Howe moves at 02:00, and in half hours: 02:00→02:30 forward,
  // 02:00→01:30 back.
  const gap = instant.parseInstant("2026-10-04 02:15", { sourceZone: "Australia/Lord_Howe" });
  assert.equal(gap.status, "gap");

  const replay = instant.parseInstant("2026-04-05 01:45", { sourceZone: "Australia/Lord_Howe" });
  assert.equal(replay.status, "ambiguous");
  assert.deepEqual(replay.isos, ["2026-04-04T14:45:00.000Z", "2026-04-04T15:15:00.000Z"]);
});

test("a 45-minute offset is read exactly", () => {
  const k = instant.parseInstant("2026-01-15 15:00", { sourceZone: "Asia/Kathmandu" });
  assert.equal(k.status, "ok");
  assert.equal(k.iso, "2026-01-15T09:15:00.000Z", "+5:45");

  const c = instant.parseInstant("2026-01-15 15:00", { sourceZone: "Pacific/Chatham" });
  assert.equal(c.status, "ok");
  assert.equal(c.iso, "2026-01-15T01:15:00.000Z", "+13:45 in southern summer");
});

// ------------------------------------------------------------- refusals stay

test("what is not a date or a zone is refused, not repaired", () => {
  const badDate = instant.parseInstant("2026-02-30 10:00", { sourceZone: NY });
  assert.equal(badDate.status, "invalid");
  assert.equal(badDate.reason, "stamp");

  const badTime = instant.parseInstant("2026-01-15 25:00", { sourceZone: NY });
  assert.equal(badTime.status, "invalid");
  assert.equal(badTime.reason, "stamp");

  const badZone = instant.parseInstant("2026-01-15 10:00", { sourceZone: "Not/AZone" });
  assert.equal(badZone.status, "invalid");
  assert.equal(badZone.reason, "zone");

  const notATime = instant.instantFromWall("2026-01-15", "quarter past", NY);
  assert.equal(notATime.status, "invalid");
  assert.equal(notATime.reason, "time");

  const notADate = instant.instantFromWall("2026-13-01", "10:00", NY);
  assert.equal(notADate.status, "invalid");
  assert.equal(notADate.reason, "date");
});

// ------------------------------------------------------------- provenance

const ZONE_HEADER = "Timestamp,Account,Symbol,Side,Quantity,Filled Qty,Avg Fill Price,Order ID,Order Type";

test("This computer is recorded as this computer's zone, not the file's", () => {
  const rows = [
    `01/15/2026 09:30:00,Live-01,NQ,Buy,1,1,20000.00,ord1,Market`,
    `01/15/2026 09:45:00,Live-01,NQ,Sell,1,1,20010.00,ord2,Market`,
  ].join("\n");

  const named = csv.parseTradeovateCsv(`${ZONE_HEADER}\n${rows}\n`, [], {
    sourceZone: "Europe/Lisbon",
    journalZone: NY,
  });
  assert.equal(named.trades[0].instantSource, "source-zone", "a zone the reader named for the file");
  assert.equal(named.trades[0].sourceZone, "Europe/Lisbon");

  const computer = csv.parseTradeovateCsv(`${ZONE_HEADER}\n${rows}\n`, [], {
    sourceZone: "Europe/Lisbon",
    systemSource: true,
    journalZone: NY,
  });
  const t = computer.trades[0];
  assert.equal(t.instantSource, "system-zone", "this computer's zone is not a statement about the file");
  assert.equal(t.sourceZone, "Europe/Lisbon", "…and the zone is still recorded, so the reading is reproducible");
  assert.equal(t.entryInstant, named.trades[0].entryInstant, "the instant itself does not change");
});

test("a mixed file is never recorded as `offset`", () => {
  const rows = [
    `01/15/2026 09:30:00,Live-01,NQ,Buy,2,2,20000.00,ord1,Market`,
    `2026-01-15T14:45:00Z,Live-01,NQ,Sell,1,1,20010.00,ord2,Market`,
    `01/15/2026 09:50:00,Live-01,NQ,Sell,1,1,20020.00,ord3,Market`,
  ].join("\n");

  const named = csv.parseTradeovateCsv(`${ZONE_HEADER}\n${rows}\n`, [], {
    sourceZone: NY,
    journalZone: NY,
  });
  assert.equal(named.trades[0].instantSource, "source-zone", "one naive row makes the whole trade zone-read");

  const computer = csv.parseTradeovateCsv(`${ZONE_HEADER}\n${rows}\n`, [], {
    sourceZone: NY,
    systemSource: true,
    journalZone: NY,
  });
  assert.equal(computer.trades[0].instantSource, "system-zone");
  assert.equal(computer.trades[0].entryInstant, "2026-01-15T14:30:00.000Z", "instants stay pinned either way");

  // All-offset stays `offset`, whatever the reader would have picked for naive rows.
  const allOffset = csv.parseTradeovateCsv(
    `${ZONE_HEADER}\n2026-01-15T14:30:00Z,Live-01,NQ,Buy,1,1,20000.00,ord1,Market\n2026-01-15T14:45:00Z,Live-01,NQ,Sell,1,1,20010.00,ord2,Market\n`,
    [],
    { sourceZone: NY, systemSource: true, journalZone: NY }
  );
  assert.equal(allOffset.trades[0].instantSource, "offset");
  assert.equal(allOffset.trades[0].sourceZone, undefined);
});

test("journalZone empty: instants still pinned, no timezone written, no machine zone used", () => {
  const rows = [
    `01/15/2026 09:30:00,Live-01,NQ,Buy,1,1,20000.00,ord1,Market`,
    `01/15/2026 09:45:00,Live-01,NQ,Sell,1,1,20010.00,ord2,Market`,
  ].join("\n");
  const zones = { sourceZone: NY, journalZone: "" };

  const saved = process.env.TZ;
  process.env.TZ = "Pacific/Auckland";
  const south = csv.parseTradeovateCsv(`${ZONE_HEADER}\n${rows}\n`, [], zones).trades[0];
  process.env.TZ = "America/Los_Angeles";
  const west = csv.parseTradeovateCsv(`${ZONE_HEADER}\n${rows}\n`, [], zones).trades[0];
  if (saved === undefined) delete process.env.TZ;
  else process.env.TZ = saved;

  for (const t of [south, west]) {
    assert.equal(t.entryInstant, "2026-01-15T14:30:00.000Z", "a canonical instant never comes from the machine");
    assert.equal(t.exitInstant, "2026-01-15T14:45:00.000Z");
    assert.equal(t.timezone, undefined, "no journal zone to record, so none is claimed");
    assert.equal(t.instantSource, "source-zone");
    assert.equal(t.sourceZone, NY);
    // With the journal zone unset the civil values are the file's own clock,
    // read in the zone the file was read in — not in this machine's zone.
    assert.equal(t.entryTime, "09:30:00", "the civil reading follows the source zone");
    assert.equal(t.exitTime, "09:45:00");
    assert.equal(t.date, "2026-01-15");
  }
  assert.equal(south.entryInstant, west.entryInstant, "the machine must not change the answer");
  assert.deepEqual(
    [south.date, south.entryTime, south.exitTime],
    [west.date, west.entryTime, west.exitTime],
    "…nor the civil values written into the note"
  );
});

// ------------------------------------------------------------- copy legs

const LEG_BASE = {
  id: "base-1",
  date: "2026-01-15",
  entryTime: "09:30:00",
  exitTime: "09:50:00",
  entryInstant: "2026-01-15T14:30:00.123Z",
  exitInstant: "2026-01-15T14:50:00.000Z",
  sourceZone: NY,
  instantSource: "source-zone",
  timezone: NY,
  symbol: "NQ",
  direction: "long",
  quantity: 2,
  entryPrice: 20000,
  exitPrice: 20020,
  pnl: 400,
  pnlPoints: 10,
  account: "Live-01",
  accountType: "live",
  fills: [
    { side: "buy", time: "09:30:00", instant: "2026-01-15T14:30:00.123Z", qty: 2, price: 20000 },
    { side: "sell", time: "09:45:00", instant: "2026-01-15T14:45:00.000Z", qty: 1, price: 20010, pnl: 200, fees: 2 },
    { side: "sell", time: "09:50:00", instant: "2026-01-15T14:50:00.000Z", qty: 1, price: 20020, pnl: 200, fees: 2 },
  ],
};

test("a copy leg carries the leader's instants and every fill's", () => {
  const account = { id: "leg-1", name: "Leg One", firmId: "f1", programId: "p1", size: 50000, type: "funded" };
  const leg = copy.buildLeg(LEG_BASE, account, { from: "2026-01-01", ratio: 1 });

  assert.equal(leg.entryInstant, LEG_BASE.entryInstant, "the leg lives on the leader's timeline");
  assert.equal(leg.exitInstant, LEG_BASE.exitInstant);
  assert.equal(leg.sourceZone, NY);
  assert.equal(leg.instantSource, "source-zone");
  assert.equal(leg.timezone, NY, "and in the leader's wall clock");

  assert.ok(Array.isArray(leg.fills) && leg.fills.length === 3, "a scaled base keeps its fills");
  assert.equal(leg.fills[0].instant, "2026-01-15T14:30:00.123Z", "the fraction survives the copy");
  assert.equal(leg.fills[2].instant, "2026-01-15T14:50:00.000Z");
  assert.equal(leg.isCopiedTrade, true, "…and it is still identifiable as a leg");
});

// ------------------------------------------------------------ what is stored

const NOTE_TRADE = {
  id: "t-1",
  date: "2026-01-15",
  entryTime: "09:30:00",
  exitTime: "09:45:00",
  entryInstant: "2026-01-15T14:30:00.000Z",
  exitInstant: "2026-01-15T14:45:00.000Z",
  sourceZone: NY,
  instantSource: "source-zone",
  timezone: NY,
  symbol: "NQ",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  pnl: 200,
  pnlPoints: 10,
  account: "Live-01",
  accountType: "live",
  fills: [
    { side: "buy", time: "09:30:00", instant: "2026-01-15T14:30:00.000Z", qty: 1, price: 20000 },
    { side: "sell", time: "09:45:00", instant: "2026-01-15T14:45:00.000Z", qty: 1, price: 20010, pnl: 200, fees: 2 },
  ],
};

test("instants survive the note they are written to", () => {
  const md = storage.tradeToMarkdown(NOTE_TRADE);
  assert.ok(md.includes('entry_instant: "2026-01-15T14:30:00.000Z"'), "entry instant in frontmatter");
  assert.ok(md.includes('exit_instant: "2026-01-15T14:45:00.000Z"'), "exit instant in frontmatter");
  assert.ok(md.includes(`source_zone: "${NY}"`), "where the stamps came from");
  assert.ok(md.includes('instant_source: "source-zone"'), "how the instants were pinned");
  assert.ok(md.includes('instant: "2026-01-15T14:30:00.000Z"'), "each fill keeps its own");

  const back = storage.parseTradeFromMarkdown(md);
  assert.equal(back.entryInstant, NOTE_TRADE.entryInstant);
  assert.equal(back.exitInstant, NOTE_TRADE.exitInstant);
  assert.equal(back.sourceZone, NY);
  assert.equal(back.instantSource, "source-zone");
  assert.equal(back.fills[0].instant, NOTE_TRADE.fills[0].instant);
  assert.equal(back.fills[1].instant, NOTE_TRADE.fills[1].instant);
  assert.equal(back.fills[1].pnl, 200, "the fill's own numbers are untouched");
});

test("a note written before the contract keeps its honest absence", () => {
  const legacy = { ...NOTE_TRADE };
  delete legacy.entryInstant;
  delete legacy.exitInstant;
  delete legacy.sourceZone;
  delete legacy.instantSource;
  for (const f of legacy.fills) delete f.instant;

  const md = storage.tradeToMarkdown(legacy);
  assert.ok(!md.includes("entry_instant"), "no fabricated UTC is written for an old note");
  assert.ok(!md.includes("instant_source"));

  const back = storage.parseTradeFromMarkdown(md);
  assert.equal(back.entryInstant, undefined);
  assert.equal(back.exitInstant, undefined);
  assert.equal(back.sourceZone, undefined);
  assert.equal(back.instantSource, undefined);
  assert.equal(back.fills[0].instant, undefined);
  assert.equal(back.timezone, NY, "the zone an old note did record is still read");
});
