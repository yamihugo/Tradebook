import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

// Release correctness pass — account truth.
//
// The scenario the audit found broken, written down once and pinned here:
//   size 50,000 (the RULE anchor) · trackingStart 2026-09-01 ·
//   openingBalance 52,543 (the VALUE anchor) · zero tracked trades.
//
// Required: value 52,543 · trading result 0 · the curve ends where the balance
// headline says it does. Never "+$2,543 profit" and never a curve sitting
// 2,543 below the number above it.
const result = await build({
  entryPoints: {
    money: new URL("../src/lib/money.ts", import.meta.url).pathname,
    scope: new URL("../src/lib/scope.ts", import.meta.url).pathname,
    fees: new URL("../src/lib/fees.ts", import.meta.url).pathname,
    instant: new URL("../src/lib/instant.ts", import.meta.url).pathname,
    accountMetrics: new URL("../src/lib/accountMetrics.ts", import.meta.url).pathname,
    accountCashflows: new URL("../src/lib/accountCashflows.ts", import.meta.url).pathname,
    tracking: new URL("../src/lib/tracking.ts", import.meta.url).pathname,
    score: new URL("../src/lib/score.ts", import.meta.url).pathname,
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
  },
  outdir: "bundle",
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents:
            "export const App = class {};" +
            "export const TFile = class {};" +
            "export const normalizePath = (p) => p;" +
            "export const setIcon = () => {};",
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
const [money, scope, fees, instant, accountMetrics, accountCashflows, tracking, score, copy] = await Promise.all([
  loadBundle("money"),
  loadBundle("scope"),
  loadBundle("fees"),
  loadBundle("instant"),
  loadBundle("accountMetrics"),
  loadBundle("accountCashflows"),
  loadBundle("tracking"),
  loadBundle("score"),
  loadBundle("copy"),
]);

// The audit's account, verbatim.
const SIZE = 50000;
const OPENING = 52543;
const START = "2026-09-01";

const account = (over = {}) => ({
  id: "a1",
  name: "Leader",
  firmId: "topstep",
  programId: "funded",
  size: SIZE,
  type: "funded",
  createdAt: "2026-08-01",
  trackingStart: START,
  openingBalance: OPENING,
  historicalContext: { previousTradeCount: 34, previousWinRate: 73 },
  rules: { maxLoss: 2000, ddLockOffset: 0, maxLossType: "eod-trailing", target: 3000, dailyLoss: 1250, consistency: 35, minDays: 3 },
  ...over,
});

const trade = (over = {}) => ({
  id: `t${over.date ?? ""}-${over.pnl ?? 0}-${over.id ?? ""}`,
  date: "2026-09-10",
  entryTime: "10:00",
  exitTime: "10:05",
  symbol: "NQ",
  account: "Leader",
  accountType: "funded",
  direction: "long",
  quantity: 1,
  entryPrice: 20000,
  exitPrice: 20010,
  commission: 0,
  fees: 0,
  pnl: 100,
  reviewed: true,
  stopLoss: 19950,
  setup: "Breakout",
  rating: 4,
  ...over,
});

// The journal day, the one clock the whole app buckets on.
const dayKey = (t) => instant.tradeDayInZone(t, "America/New_York");

const rulesOf = (acc) => acc.rules ?? {};
const metricsFor = (acc, trades, over = {}) =>
  accountMetrics.computeAccountMetrics({
    trades,
    size: acc.size,
    capital: tracking.openingCapital(acc),
    trackingStart: tracking.trackingStartOf(acc),
    openingPeak: tracking.openingPeakOf(acc) ?? undefined,
    target: rulesOf(acc).target,
    maxLoss: rulesOf(acc).maxLoss,
    ddLockOffset: rulesOf(acc).ddLockOffset,
    ddNoLock: rulesOf(acc).maxLossType === "eod-trailing-open",
    ddStatic: rulesOf(acc).maxLossType === "static",
    ddRuleKnown: !!rulesOf(acc).maxLossType,
    ddIntraday: rulesOf(acc).maxLossType === "intraday-trailing",
    dailyLoss: rulesOf(acc).dailyLoss,
    consistency: rulesOf(acc).consistency,
    dayKey,
    todayKey: "2026-09-11",
    cashflows: accountCashflows.accountCashflows([], [], []),
    ...over,
  });

const movementFor = (acc, trades, cashflows = []) =>
  accountMetrics.computeRecordedAccountMovement({
    trades,
    size: tracking.openingCapital(acc),
    dayKey,
    trackingStart: tracking.trackingStartOf(acc),
    cashflows,
  });

// ---------------------------------------------------------------------------
// 1 + 2 + 4 — the account curve: openingBalance != size
// ---------------------------------------------------------------------------
test("account curve starts at the opening value and ends at the headline balance", () => {
  const acc = account();
  const rows = [trade({ id: "after", date: "2026-09-10", pnl: 300 })];
  const m = metricsFor(acc, rows);
  const movement = movementFor(acc, rows);

  // The headline.
  assert.equal(m.net, 300, "tracked result");
  assert.equal(m.balance, OPENING + 300, "recorded account value is measured from the opening value");

  // The curve, built by the one helper both views use.
  const curve = accountMetrics.accountValueSeries(movement.days, tracking.openingCapital(acc));
  assert.equal(curve[0], OPENING, "the curve starts at the declared opening value, not the 50,000 size");
  assert.equal(curve.at(-1), m.balance, "the last point IS the balance the headline prints");
  assert.equal(curve.at(-1), 52843);
  assert.notEqual(curve.at(-1), SIZE + 300, "never the old size-anchored figure");

  // The old bug, stated as a regression: nothing on the page may report the
  // difference between the two anchors as a result.
  assert.equal(m.balance - SIZE, 2843, "the gap exists…");
  assert.notEqual(m.net, m.balance - SIZE, "…and it is not the trading result");
  assert.equal(m.balance - m.net, OPENING, "what is left after the tracked result is the opening value");
});

test("the same series helper serves the Home accounts widget", () => {
  // Home holds its own snapshot shape ({ date, cumulative }); the helper takes
  // the days, so both views cannot build different curves from one movement.
  const acc = account();
  const movement = movementFor(acc, [trade({ id: "after", pnl: 300 })]);
  const homeShape = movement.days.map((d) => ({ date: d.date, change: d.change, cumulative: d.cumulative }));
  const page = accountMetrics.accountValueSeries(movement.days, tracking.openingCapital(acc));
  const home = accountMetrics.accountValueSeries(homeShape, tracking.openingCapital(acc));
  assert.deepEqual(home, page, "one helper, one curve");
  assert.equal(home.at(-1), 52843);
});

test("balance, curve and tracked result reconcile after movement and a payout", () => {
  const acc = account();
  const rows = [trade({ id: "a", date: "2026-09-10", pnl: 300 }), trade({ id: "b", date: "2026-09-11", pnl: -50 })];
  const cashflows = [{ date: "2026-09-12", amount: -1000 }];
  const m = metricsFor(acc, rows, { cashflows: accountCashflows.accountCashflows([], [], cashflows) });
  const movement = movementFor(acc, rows, cashflows);

  assert.equal(m.net, 250, "trading result ignores cash");
  assert.equal(m.balance, OPENING + 250 - 1000, "value: opening + trading − payout");
  const curve = accountMetrics.accountValueSeries(movement.days, tracking.openingCapital(acc));
  assert.equal(curve.at(-1), m.balance);
  assert.equal(curve.at(-1), 51793);
  assert.equal(curve.reduce((a, b) => a + (b - a), curve[0]), movement.change + curve[0]);
});

// ---------------------------------------------------------------------------
// 3 — the Accounts overview: opening state is not profit
// ---------------------------------------------------------------------------
test("an untracked account's recorded result is zero, whatever the size/anchor gap", () => {
  const acc = account();
  const m = metricsFor(acc, []);
  // What the overview's `result` field is: the balance measured from the value
  // anchor. Zero trades → zero result, never openingBalance − size.
  const result = m.balance - tracking.openingCapital(acc);
  assert.equal(m.balance, OPENING, "the value is the opening balance");
  assert.equal(result, 0, "and nothing has been made yet");
  assert.notEqual(result, 2543);
});

test("the tracked result is exactly the tracked movement", () => {
  const acc = account();
  const zero = metricsFor(acc, []);
  const after = metricsFor(acc, [trade({ id: "a", pnl: 300 })]);
  assert.equal(zero.balance - tracking.openingCapital(acc), 0);
  assert.equal(after.balance - tracking.openingCapital(acc), 300);
});

test("a legacy account (no boundary) keeps its old figures exactly", () => {
  const legacy = { ...account(), trackingStart: undefined, openingBalance: undefined };
  const rows = [trade({ id: "a", date: "2026-08-05", pnl: 300 })];
  const m = metricsFor(legacy, rows);
  assert.equal(tracking.openingCapital(legacy), SIZE, "the anchor is the configured size");
  assert.equal(m.balance, SIZE + 300);
  assert.equal(m.balance - SIZE, 300, "result measured from size = the pre-existing number");
});

// ---------------------------------------------------------------------------
// 5 — one boundary clock: journal day, entry instant, timezone
// ---------------------------------------------------------------------------
test("the boundary is judged on the journal day, not the raw note date", () => {
  const acc = account();
  // Recorded 31 Aug, but the entry instant reads 1 Sep in America/New_York.
  const straddle = trade({
    id: "straddle",
    date: "2026-08-31",
    pnl: 400,
    entryInstant: "2026-09-01T02:30:00Z", // 22:30 on 31 Aug in NY → journal day 31 Aug
    sourceZone: "America/New_York",
  });
  assert.equal(dayKey(straddle), "2026-08-31", "the journal day of this note is 31 Aug");
  assert.ok(straddle.date < START, "its raw stored date is before the boundary");

  const m = metricsFor(acc, [straddle]);
  const movement = movementFor(acc, [straddle]);
  assert.equal(m.net, 0, "excluded from the population, on the journal day");
  assert.equal(m.balance, OPENING, "and from the balance");
  assert.equal(movement.balance, m.balance, "one clock: population and movement agree");
  assert.equal(m.tradeCount, 0);

  // The mirror case: a raw date on/after the boundary whose journal day is
  // before it. Same clock, so it is out of both — never in one and not the other.
  const mirror = trade({
    id: "mirror",
    date: "2026-09-01",
    pnl: 400,
    entryInstant: "2026-09-01T03:30:00Z", // 23:30 on 31 Aug in NY
    sourceZone: "America/New_York",
  });
  assert.equal(dayKey(mirror), "2026-08-31");
  const m2 = metricsFor(acc, [mirror]);
  const mv2 = movementFor(acc, [mirror]);
  assert.equal(m2.net, 0);
  assert.equal(mv2.balance, m2.balance, "no trade can count toward Net without its money reaching the balance");

  // And one that genuinely lands on the boundary day is counted by both.
  const onDay = trade({ id: "onday", date: "2026-09-01", pnl: 400 });
  const m3 = metricsFor(acc, [onDay]);
  assert.equal(m3.net, 400);
  assert.equal(m3.balance, OPENING + 400);
  assert.equal(movementFor(acc, [onDay]).balance, m3.balance);
});

test("a boundary of a different shape is ignored, as before", () => {
  const acc = account({ trackingStart: "01/09/2026" });
  assert.equal(tracking.trackingStartOf(acc), "", "only an ISO date is a boundary");
  // No boundary → the whole journal is tracked, and the declared value is still
  // the value anchor (the two fields are independent).
  const m = metricsFor(acc, [trade({ date: "2026-08-05" })]);
  assert.equal(m.tradeCount, 1);
  assert.equal(m.balance, OPENING + 100, "the pre-boundary trade counts, and the value anchor is still the declared one");
});

// ---------------------------------------------------------------------------
// 6 — trackingStart cannot silently guess an opening balance
// ---------------------------------------------------------------------------
test("a boundary without a declared opening value is a setup that cannot be saved", () => {
  const bare = { trackingStart: START, openingBalance: undefined };
  assert.equal(tracking.missingOpeningBalance(bare), true, "the setup is incomplete");
  assert.equal(tracking.hasOpeningBalance(bare), false);

  // Explicit: the trader says which value. Both are recorded, so the stored
  // account is self-describing and the engine never decides.
  const typed = { trackingStart: START, openingBalance: 52543 };
  const choseSize = { trackingStart: START, openingBalance: 50000 };
  for (const acc of [typed, choseSize]) {
    assert.equal(tracking.missingOpeningBalance(acc), false);
    assert.equal(tracking.openingCapital(acc), acc.openingBalance);
  }

  // A legacy account is never blocked, and never changes.
  const legacy = { trackingStart: undefined, openingBalance: undefined, size: 50000 };
  assert.equal(tracking.missingOpeningBalance(legacy), false);
  assert.equal(tracking.openingCapital(legacy), 50000, "the size fallback still applies with no boundary");

  assert.match(tracking.OPENING_BALANCE_REQUIRED_NOTE, /will not guess|Enter the account balance/i);
});

test("NaN or zero is not an opening balance", () => {
  assert.equal(tracking.hasOpeningBalance({ openingBalance: NaN }), false);
  assert.equal(tracking.hasOpeningBalance({ openingBalance: Infinity }), false);
  assert.equal(tracking.hasOpeningBalance({ openingBalance: 0 }), true, "0 is a value; it is what the trader typed");
});

// ---------------------------------------------------------------------------
// 7 — pre-boundary cash movements are inside the opening snapshot, once
// ---------------------------------------------------------------------------
test("pre-boundary cash never moves the balance twice", () => {
  const acc = account();
  const rows = [trade({ id: "a", pnl: 300 })];
  const movement = movementFor(acc, rows, [
    { date: "2026-08-15", amount: -3000 }, // before tracking: inside the opening snapshot
    { date: "2026-09-20", amount: -1000 }, // after: a real movement now
  ]);
  assert.equal(movement.balance, OPENING + 300 - 1000);
  assert.equal(movement.days.some((d) => d.date === "2026-08-15"), false, "and it is not on the timeline");

  // A pre-boundary balance correction is the same kind of movement: dropped by
  // the money engine (the modal refuses to offer that date in the first place).
  const withCorrection = movementFor(acc, rows, [
    { date: "2026-08-20", amount: -75 },
    { date: "2026-09-21", amount: -25 },
  ]);
  assert.equal(withCorrection.balance, OPENING + 300 - 25);

  // Without a boundary, both apply, exactly as before.
  const legacy = { ...account(), trackingStart: undefined, openingBalance: undefined };
  assert.equal(movementFor(legacy, rows, [{ date: "2026-08-15", amount: -3000 }]).balance, SIZE + 300 - 3000);
});

// ---------------------------------------------------------------------------
// Blocker 4 — the drawdown floor: never guessed from a peak we do not have
// ---------------------------------------------------------------------------
test("a static floor is exact without any history", () => {
  const acc = account({ rules: { ...account().rules, maxLossType: "static", maxLoss: 2000 } });
  const m = metricsFor(acc, []);
  assert.equal(m.drawdownFloor, SIZE - 2000, "the rule is the rule");
  assert.equal(m.drawdownRoom, OPENING - (SIZE - 2000));
});

test("a locked trailing floor is exact while the lock dominates", () => {
  // The audit's account: capital − maxLoss (50,543) ≥ lock point (50,000).
  // Whatever the unrecorded peak was, the floor is the lock — no state needed.
  const acc = account();
  const m = metricsFor(acc, []);
  assert.equal(m.drawdownFloor, SIZE, "the lock dominates");
  assert.equal(m.drawdownRoom, OPENING - SIZE);
  assert.equal(m.drawdownUsed, 0);

  // The same account after a drawdown: still the lock, so still exact.
  const after = metricsFor(acc, [trade({ pnl: -2000 })]);
  assert.equal(after.drawdownFloor, SIZE);
  assert.equal(after.drawdownRoom, 543);
});

test("a trailing floor that has not locked needs the unrecorded peak — and is withheld without it", () => {
  const close = account({ openingBalance: 50900 });
  // The lock can no longer dominate (50,900 − 2,000 = 48,900 < 50,000), so the
  // peak decides. Tradebook does not have it: it says so instead of guessing.
  const unknown = metricsFor(close, []);
  assert.equal(unknown.drawdownFloor, null, "no guessed floor");
  assert.equal(unknown.drawdownRoom, null);
  assert.equal(unknown.drawdownUsed, null);

  // Declared, it is exact — and it is a different, less comfortable answer than
  // the guess would have been (which claimed $2,000 of room and 0% used).
  const declared = metricsFor(account({ openingBalance: 50900, openingPeak: 60000 }), []);
  assert.equal(declared.drawdownFloor, SIZE, "min(lock 50,000, peak − limit 58,000)");
  assert.equal(declared.drawdownRoom, 900);
  assert.equal(declared.drawdownUsed, 1100, "not the 0% a guessed peak would have reported");
});

test("an open trailing rule always needs the peak, and can reveal a floor that is already breached", () => {
  const rules = { ...account().rules, maxLossType: "eod-trailing-open" };
  assert.equal(metricsFor(account({ rules }), []).drawdownFloor, null);
  assert.equal(metricsFor(account({ rules }), [], { openingPeak: OPENING }).drawdownFloor, OPENING - rules.maxLoss);

  // The case that must never be invented: the account's real peak was far above
  // where it stands today, so its floor sits above its own value.
  const blown = metricsFor(account({ rules, openingPeak: 60000 }), []);
  assert.equal(blown.drawdownFloor, 58000);
  assert.equal(blown.drawdownRoom, 0, "no room left");
  assert.equal(blown.drawdownUsed, rules.maxLoss, "the allowance is spent");
  // Without the declared peak the same account reads "unavailable", never "safe".
  assert.equal(metricsFor(account({ rules }), []).drawdownRoom, null);

  // Intraday trailing is unknowable in either case — as before.
  const intraday = account({ rules: { ...rules, maxLossType: "intraday-trailing" } });
  assert.equal(metricsFor(intraday, []).drawdownFloor, null);
  assert.equal(metricsFor(intraday, [], { openingPeak: 60000 }).drawdownFloor, null);
});

test("no boundary means the journal knows the peak: unchanged behaviour", () => {
  const legacy = { ...account(), trackingStart: undefined, openingBalance: undefined };
  const rows = [trade({ date: "2026-08-05", pnl: 5000 }), trade({ date: "2026-08-06", pnl: -1000 })];
  const m = metricsFor(legacy, rows);
  // The recorded high (size + 5,000) drives the floor; nothing is withheld.
  assert.equal(m.drawdownFloor, Math.min(SIZE, SIZE + 5000 - 2000));
  assert.notEqual(m.drawdownFloor, null);
});

test("the accounts page cannot report usage from an unknown floor", () => {
  const close = account({ openingBalance: 50900 });
  const m = metricsFor(close, []);
  assert.equal(accountMetrics.drawdownUsage(m, 2000), null, "no pct, no room, no verdict");
});

// ---------------------------------------------------------------------------
// 8 — zero tracked sample: performance is unavailable, rules stay visible
// ---------------------------------------------------------------------------
test("with no tracked trades the performance figures are unavailable, not zero", () => {
  const acc = account();
  const history = [trade({ id: "before", date: "2026-08-20", pnl: 900 })];
  const m = metricsFor(acc, history);
  assert.equal(m.tradeCount, 0);
  assert.equal(tracking.historyAvailability(acc, 0), "not-tracked");
  for (const value of ["$0.00", "0.00", "0%", "0", "—"]) {
    assert.equal(tracking.trackedReading(acc, 0, value), "—", `"${value}" is not reported`);
  }
  assert.match(tracking.trackedNote(acc, 0, "own"), /No tracked trades yet/);
  // …while the account's own rules are still facts, and still calculated.
  assert.equal(rulesOf(acc).maxLoss, 2000, "the rule is still on the account");
  assert.equal(m.drawdownFloor, SIZE, "the configured floor is known without trades");
  assert.equal(m.drawdownRoom, OPENING - SIZE, "and so is the room left");
  assert.equal(m.dailyLossRemaining, 1250, "the daily allowance is a rule, not a performance");
  assert.equal(m.balance, OPENING, "the value is a fact, not a performance reading");
});

// ---------------------------------------------------------------------------
// 9 — reported history is inert
// ---------------------------------------------------------------------------
test("historicalContext changes no number on any surface", () => {
  const plain = account();
  const reported = account({
    historicalContext: { previousTradeCount: 34, previousWinRate: 73, previousWins: 25, previousLosses: 9, previousPnl: 42000 },
  });
  const rows = [
    trade({ id: "w", date: "2026-09-02", pnl: 300 }),
    trade({ id: "l", date: "2026-09-03", pnl: -100 }),
    trade({ id: "b", date: "2026-09-04", pnl: 0, exitPrice: 20000 }),
  ];
  const read = (acc) => {
    const m = metricsFor(acc, rows);
    const sc = score.computeScore(rows, dayKey);
    const summary = money.summarizeFinancials(rows, {
      scope: {
        kind: "all-included-accounts",
        accountIdOf: (t) => t.account,
        includedAccountIds: new Set(rows.map((t) => t.account)),
        isTracked: (t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc)),
      },
      dayKey,
    });
    return {
      net: m.net, winRate: m.winRate, expectancy: m.expectancy, pf: m.profitFactor,
      balance: m.balance, floor: m.drawdownFloor, room: m.drawdownRoom,
      decisions: summary.decisionCount, total: summary.net.total, rate: summary.net.winRate,
      score: sc.score, axes: sc.availableAxes,
    };
  };
  assert.deepEqual(read(reported), read(plain), "identical on every surface");
  assert.equal(read(plain).decisions, 3, "only journal trades are counted");
  // It cannot even stand in for a tracked population that does not exist.
  const empty = account({ historicalContext: { previousTradeCount: 34, previousWinRate: 73 } });
  assert.equal(tracking.historyAvailability(empty, 0), "not-tracked");
});

// ---------------------------------------------------------------------------
// 10 + 11 — copy trading and import identity are untouched by any of this
// ---------------------------------------------------------------------------
test("copy configuration and leg semantics do not read the value anchor", () => {
  const copier = {
    id: "c1",
    name: "Copier",
    firmId: "topstep",
    programId: "funded",
    size: SIZE,
    type: "funded",
    copyRole: "copier",
    copyBaseId: "leader",
    createdAt: "2026-01-01",
    trackingStart: START,
    openingBalance: 61000,
    openingPeak: 64000,
    copyConfigHistory: [{ from: "2026-01-01", ratio: 1 }, { from: "2026-06-01", ratio: 2 }],
    copyPeriods: [{ start: "2026-01-01", baseId: "leader", multiplier: 1 }],
  };
  // The value anchor changes nothing about who copies whom, from when, or how.
  assert.equal(copy.effectiveCopyConfig(copier, "2026-03-01").ratio, 1);
  assert.equal(copy.effectiveCopyConfig(copier, "2026-07-01").ratio, 2);
  assert.equal(copy.isActiveCopier(copier, "leader", "2026-07-01"), true);

  // The copier's own tracking boundary does not stop it copying from the leader.
  const leg = copy.buildLeg(
    { id: "b1", date: "2026-09-10", symbol: "NQ", direction: "long", quantity: 1, entryPrice: 100, exitPrice: 110, pnl: 1000, commission: 0, fees: 0, account: "Leader" },
    copier,
    { ratio: 1 }
  );
  assert.equal(leg.account, "Copier");
  assert.equal(leg.pnl, 1000, "the leg is built from the leader's trade and the ratio");
});

test("trade identity ignores tracking state, so a re-import cannot duplicate history", () => {
  const acc = account();
  const rows = [trade({ id: "before", date: "2026-08-20", pnl: 900 }), trade({ id: "after", date: "2026-09-10", pnl: 300 })];
  // The journal keeps both; the tracked gate only decides what analytics sees.
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc))).length, 1);
  // Identity is a property of the note, not of the account's tracking state: the
  // same two notes summarise identically whatever the boundary says.
  const scope = {
    kind: "all-included-accounts",
    accountIdOf: (t) => t.account,
    includedAccountIds: new Set(rows.map((t) => t.account)),
  };
  const without = money.summarizeFinancials(rows, { scope, dayKey });
  const withGate = money.summarizeFinancials(rows, {
    scope: { ...scope, isTracked: (t) => tracking.isTrackedTrade(t, tracking.trackingStartOf(acc)) },
    dayKey,
  });
  assert.equal(without.decisionCount, 2, "both notes are in the journal population");
  assert.equal(withGate.decisionCount, 1, "and only the tracked one is in the analytics population");
  assert.equal(withGate.net.total, 300);
  assert.ok(without.decisionCount >= withGate.decisionCount, "no note was destroyed");
});

// Silence is a real answer: nothing here may fabricate a number.
test("no figure invents history that was never recorded", () => {
  const acc = account({ openingBalance: 60900 });
  const m = metricsFor(acc, []);
  // Room is a known fact under the lock; the peak is not claimed anywhere.
  assert.equal(m.peak, 0, "the trading peak of an empty tracked population is zero, not the account's history");
  assert.equal(m.maxDrawdown, 0);
  assert.equal(m.balance, 60900);
  assert.equal(tracking.openingCapital(acc), 60900);
});