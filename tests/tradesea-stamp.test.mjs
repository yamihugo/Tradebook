import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

/**
 * The TradeSea stamp reader.
 *
 * Synthetic TradeSea-shaped stamps use invented values. They cover the
 * month-first slash-date form found in local samples, explicit EDT/GMT offsets,
 * unknown-token refusal, and existing timestamp forms without including any
 * real export rows or values.
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
// These invented values are newest first. The offset and expected instants are
// chosen independently so the test checks both chronological ordering and zone math.

const SYNTHETIC_STAMPS = [
  ["4/8/2026, 10:10:00 AM EDT", "2026-04-08T14:10:00.000Z"],
  ["4/8/2026, 10:05:00 AM EDT", "2026-04-08T14:05:00.000Z"],
  ["4/8/2026, 10:00:00 AM EDT", "2026-04-08T14:00:00.000Z"],
];

test("synthetic TradeSea stamps parse, in order, to the right instants", () => {
  SYNTHETIC_STAMPS.forEach(([stamp, iso], i) => {
    const r = instant.parseInstant(stamp);
    assert.equal(r.status, "ok", `${stamp}: expected one instant`);
    assert.equal(r.iso, iso, `${stamp}: expected ${iso}`);
    assert.equal(r.source, "offset", `${stamp}: EDT is a fixed offset`);
    assert.equal(r.zone, "", `${stamp}: do not claim an IANA region`);
    if (i > 0) {
      assert.ok(
        r.instant.getTime() <= instant.parseInstant(SYNTHETIC_STAMPS[i - 1][0]).instant.getTime(),
        `${stamp}: the file is written newest first and must stay in order`
      );
    }
  });
});

// ---------------------------------------------------------- the two dialects

test("the observed EDT abbreviation is applied as a literal fixed offset", () => {
  const r = instant.parseInstant("07/15/2026, 09:30:00 AM EDT", { sourceZone: "Europe/Lisbon" });
  assert.equal(r.status, "ok");
  assert.equal(r.iso, "2026-07-15T13:30:00.000Z", "EDT fixes the offset even when another source zone is selected");
  assert.equal(r.source, "offset");
  assert.equal(r.zone, "");
});

test("unobserved dot-date TradeSea stamps are refused rather than day-order guessed", () => {
  const r = instant.parseInstant("8.4.2026, 04:10:05 PM EDT");
  assert.equal(r.status, "invalid");
  assert.equal(r.reason, "stamp");
});

test("unobserved abbreviations are refused rather than assigned guessed offsets", () => {
  for (const abbr of ["EST", "CST", "CDT", "MST", "MDT", "PST", "PDT", "CET", "CEST", "MEZ", "MESZ", "WET", "WEST", "UTC", "GMT"]) {
    const r = instant.parseInstant(`4/8/2026, 10:10:05 AM ${abbr}`);
    assert.equal(r.status, "need-zone", abbr);
    assert.equal(r.reason, "unknown-abbreviation", abbr);
    assert.equal(r.iso, undefined, abbr);
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

test("TradeSea timestamps preserve millisecond fractions and reject finer precision", () => {
  for (const [fraction, expected] of [
    ["1", "2026-07-15T13:30:00.100Z"],
    ["12", "2026-07-15T13:30:00.120Z"],
    ["123", "2026-07-15T13:30:00.123Z"],
  ]) {
    const r = instant.parseInstant(`07/15/2026, 09:30:00.${fraction} EDT`);
    assert.equal(r.status, "ok", fraction);
    assert.equal(r.iso, expected, fraction);
  }

  for (const fraction of ["1234", "123456789"]) {
    const r = instant.parseInstant(`07/15/2026, 09:30:00.${fraction} EDT`);
    assert.equal(r.status, "invalid", `${fraction}: finer-than-millisecond data must not be truncated`);
    assert.equal(r.iso, undefined, fraction);
  }
});

test("12-hour TradeSea stamps reject hours outside one through twelve", () => {
  assert.equal(instant.parseInstant("07/15/2026, 13:30 PM EDT").status, "invalid");
  assert.equal(instant.parseInstant("07/15/2026, 00:30 AM EDT").status, "invalid");
  assert.equal(instant.parseInstant("07/15/2026, 12:30 AM EDT").status, "ok");
});
