import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

/**
 * The TradeSea stamp reader.
 *
 * TradeSea's export writes a timestamp the plugin could not read at all: the
 * date and the clock are separated by a comma, and the zone is a letter
 * abbreviation (`EDT`, `MEZ`) rather than a `Z` or a `±HH:MM` offset. These
 * tests prove the reader now reads both dialects the vendor writes — the US
 * `M/D/YYYY, H:MM:SS AM TZ` and the European `D.M.YYYY, HH:MM:SS TZ` — that it
 * reports the zone as coming from the file, that an abbreviation outside the
 * map is refused rather than guessed, and that nothing which parsed before
 * changed.
 */

const result = await build({
  entryPoints: {
    instant: new URL("../src/lib/instant.ts", import.meta.url).pathname,
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
          contents: ["export const App = class {};", "export const TFile = class {};", "export const normalizePath = (p) => p;"].join("\n"),
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
const instant = await loadBundle("instant");

const NY = "America/New_York";

// ---------------------------------------------------- synthetic export-shaped stamps, in order
//
// Synthetic stamps below preserve the export grammar and ordering, newest first. 8 April 2026 is still on US summer time,
// so `EDT` is UTC−4 and every wall clock reads four hours later in UTC.

const SYNTHETIC_STAMPS = [
  ["4/8/2026, 10:10:05 AM EDT", "2026-04-08T14:10:05.000Z"],
  ["4/8/2026, 10:09:05 AM EDT", "2026-04-08T14:09:05.000Z"],
  ["4/8/2026, 10:04:42 AM EDT", "2026-04-08T14:04:42.000Z"],
  ["4/8/2026, 10:04:42 AM EDT", "2026-04-08T14:04:42.000Z"],
  ["4/8/2026, 10:03:39 AM EDT", "2026-04-08T14:03:39.000Z"],
  ["4/8/2026, 10:03:01 AM EDT", "2026-04-08T14:03:01.000Z"],
  ["4/8/2026, 9:51:23 AM EDT", "2026-04-08T13:51:23.000Z"],
  ["4/8/2026, 9:47:30 AM EDT", "2026-04-08T13:47:30.000Z"],
  ["4/8/2026, 9:47:18 AM EDT", "2026-04-08T13:47:18.000Z"],
  ["4/8/2026, 9:47:07 AM EDT", "2026-04-08T13:47:07.000Z"],
];

test("synthetic TradeSea stamps parse, in order, to the right instants", () => {
  SYNTHETIC_STAMPS.forEach(([stamp, iso], i) => {
    const r = instant.parseInstant(stamp);
    assert.equal(r.status, "ok", `${stamp}: expected one instant`);
    assert.equal(r.iso, iso, `${stamp}: expected ${iso}`);
    assert.equal(r.source, "source-zone", `${stamp}: the file states its own zone`);
    assert.equal(r.zone, NY, `${stamp}: read in New York, as the file says`);
    if (i > 0) {
      assert.ok(
        r.instant.getTime() <= instant.parseInstant(SYNTHETIC_STAMPS[i - 1][0]).instant.getTime(),
        `${stamp}: the file is written newest first and must stay in order`
      );
    }
  });
});

// ---------------------------------------------------------- the two dialects

test("a European TradeSea stamp reads the same moment as its US twin", () => {
  const us = instant.parseInstant("4/8/2026, 10:10:05 AM EDT");
  const eu = instant.parseInstant("8.4.2026, 16:10:05 MEZ");

  assert.equal(us.status, "ok");
  assert.equal(eu.status, "ok");
  assert.equal(us.iso, "2026-04-08T14:10:05.000Z", "10:10 EDT is 14:10Z");
  assert.equal(eu.iso, us.iso, "16:10 in Berlin is the same moment as 10:10 in New York");
  assert.equal(us.zone, NY);
  assert.equal(eu.zone, "Europe/Berlin", "MEZ is the German name for the Berlin clock");
  assert.equal(us.source, "source-zone");
  assert.equal(eu.source, "source-zone");
});

test("a declared source zone never overrides the zone the stamp states", () => {
  const r = instant.parseInstant("4/8/2026, 10:10:05 AM EDT", { sourceZone: "Europe/Lisbon" });
  assert.equal(r.status, "ok");
  assert.equal(r.iso, "2026-04-08T14:10:05.000Z", "the file's zone wins, not the dropdown's");
  assert.equal(r.zone, NY);
  assert.equal(r.source, "source-zone");
});

test("every abbreviation the map carries names its IANA zone", () => {
  const cases = [
    ["EST", NY],
    ["EDT", NY],
    ["CST", "America/Chicago"],
    ["CDT", "America/Chicago"],
    ["MST", "America/Denver"],
    ["MDT", "America/Denver"],
    ["PST", "America/Los_Angeles"],
    ["PDT", "America/Los_Angeles"],
    ["CET", "Europe/Berlin"],
    ["CEST", "Europe/Berlin"],
    ["MEZ", "Europe/Berlin"],
    ["MESZ", "Europe/Berlin"],
    ["WET", "Europe/Lisbon"],
    ["WEST", "Europe/Lisbon"],
    ["UTC", "UTC"],
    ["GMT", "UTC"],
  ];
  for (const [abbr, zone] of cases) {
    const r = instant.parseInstant(`4/8/2026, 10:10:05 AM ${abbr}`);
    assert.equal(r.status, "ok", `${abbr}: expected one instant`);
    assert.equal(r.zone, zone, `${abbr} names ${zone}`);
    assert.equal(r.source, "source-zone", abbr);
  }
});

// ------------------------------------------------------------------ refusals

test("an abbreviation the map does not carry is refused, never guessed", () => {
  const r = instant.parseInstant("4/8/2026, 10:10:05 AM XYZ");
  assert.equal(r.status, "need-zone", "an unknown abbreviation has no zone to read");
  assert.equal(r.iso, undefined, "no instant is invented");
  assert.equal(r.instant, undefined);
  assert.equal(r.zone, "", "no zone is claimed for it either");
});

// ------------------------------------------------------------- regression guard
//
// Every form that parsed before this change must parse byte-for-byte the same.

test("the pre-existing stamp forms still parse identically", () => {
  const z = instant.parseInstant("2026-01-15T15:00:00Z", { sourceZone: NY });
  assert.equal(z.status, "ok");
  assert.equal(z.source, "offset", "a `Z` is a true instant");
  assert.equal(z.iso, "2026-01-15T15:00:00.000Z");

  const frac = instant.parseInstant("2026-01-15T15:00:00.123Z");
  assert.equal(frac.status, "ok");
  assert.equal(frac.iso, "2026-01-15T15:00:00.123Z", "the fraction is not swallowed");
  assert.equal(frac.source, "offset");

  const off = instant.parseInstant("2026-01-15 15:00:00 -05:00", { sourceZone: "Europe/Lisbon" });
  assert.equal(off.status, "ok");
  assert.equal(off.source, "offset", "an explicit offset wins over any zone");
  assert.equal(off.iso, "2026-01-15T20:00:00.000Z");

  const us = instant.parseInstant("01/15/2026 10:00:00 AM", { sourceZone: NY });
  assert.equal(us.status, "ok");
  assert.equal(us.source, "source-zone");
  assert.equal(us.iso, "2026-01-15T15:00:00.000Z", "a space-separated US stamp is still read");

  const iso = instant.parseInstant("2026-01-15 15:00", { sourceZone: NY });
  assert.equal(iso.status, "ok");
  assert.equal(iso.iso, "2026-01-15T20:00:00.000Z");

  const naive = instant.parseInstant("2026-01-15 15:00");
  assert.equal(naive.status, "need-zone", "a naive stamp with no zone is still refused");
  assert.equal(instant.parseInstant("2026-01-15 15:00", { sourceZone: "" }).status, "need-zone");

  const gap = instant.parseInstant("2026-03-08 02:30", { sourceZone: NY });
  assert.equal(gap.status, "gap", "the hour New York skips is still a gap");

  const replay = instant.parseInstant("2026-11-01 01:30", { sourceZone: NY });
  assert.equal(replay.status, "ambiguous", "the hour New York replays still offers two");
  assert.deepEqual(replay.isos, ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]);

  const notAStamp = instant.parseInstant("not-a-date", { sourceZone: NY });
  assert.equal(notAStamp.status, "invalid");
  assert.equal(notAStamp.reason, "stamp");
});
