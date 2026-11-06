import assert from "node:assert/strict";
import { build } from "esbuild";
import { test } from "node:test";

const result = await build({
  entryPoints: { futures: new URL("../src/futures.ts", import.meta.url).pathname },
  bundle: true,
  format: "esm",
  platform: "browser",
  outdir: "bundle",
  write: false,
});
const {
  CORE_INSTRUMENTS,
  CORE_SYMBOLS,
  FUTURES_GROUPS,
  contractLabel,
  coreInstrumentOf,
  knownFuturesSpec,
  futuresSpec,
  rootSymbol,
} = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

// ---- the core: six instruments, twelve contracts -------------------------

test("the core is six instruments in two sizes each", () => {
  assert.equal(CORE_INSTRUMENTS.length, 6);
  assert.equal(CORE_SYMBOLS.length, 12);
  assert.deepEqual(
    CORE_INSTRUMENTS.map((i) => i.mini),
    ["NQ", "ES", "GC", "CL", "SI", "RTY"]
  );
  assert.deepEqual(
    CORE_INSTRUMENTS.map((i) => i.micro),
    ["MNQ", "MES", "MGC", "MCL", "SIL", "M2K"]
  );
});

// ---- sizes, not names: the micro is a tenth of the mini -----------------

// The micro of a mini is usually a tenth of it, but not always: silver's
// standard contract is 5,000 oz against the micro's 1,000, a fifth. Anything
// that converts size between sizes has to read the ratio, never assume ten.
const MICRO_RATIO = { NQ: 10, MNQ: 10, ES: 10, MES: 10, GC: 10, MGC: 10, CL: 10, MCL: 10, SI: 5, SIL: 5, RTY: 10, M2K: 10 };

test("each micro is the fraction of its mini the exchange set, with the same tick", () => {
  for (const instrument of CORE_INSTRUMENTS) {
    const mini = futuresSpec(instrument.mini);
    const micro = futuresSpec(instrument.micro);
    assert.equal(mini.micro, instrument.micro, `${instrument.mini} does not name its micro`);
    assert.equal(mini.mini, undefined, `${instrument.mini} should not name a mini of its own`);
    assert.equal(micro.mini, instrument.mini, `${instrument.micro} does not name its mini`);
    assert.equal(micro.micro, undefined, `${instrument.micro} should not name a micro of its own`);
    assert.equal(
      mini.pointValue,
      micro.pointValue * MICRO_RATIO[instrument.mini],
      `${instrument.mini} point value is not ${MICRO_RATIO[instrument.mini]} times ${instrument.micro}`
    );
    assert.equal(mini.tickSize, micro.tickSize, `${instrument.mini} and ${instrument.micro} tick apart`);
    assert.equal(
      mini.tickValue,
      micro.tickValue * MICRO_RATIO[instrument.mini],
      `${instrument.mini} tick value is not ${MICRO_RATIO[instrument.mini]} times ${instrument.micro}`
    );
  }
});

test("silver is the one that is not a tenth", () => {
  assert.equal(futuresSpec("SI").pointValue / futuresSpec("SIL").pointValue, 5);
  assert.equal(futuresSpec("GC").pointValue / futuresSpec("MGC").pointValue, 10);
});

// ---- the exchange's own numbers -----------------------------------------

test("the core prices at the exchange's point and tick values", () => {
  const expected = {
    NQ: [20, 0.25, 5],
    MNQ: [2, 0.25, 0.5],
    ES: [50, 0.25, 12.5],
    MES: [5, 0.25, 1.25],
    GC: [100, 0.1, 10],
    MGC: [10, 0.1, 1],
    CL: [1000, 0.01, 10],
    MCL: [100, 0.01, 1],
    SI: [5000, 0.005, 25],
    SIL: [1000, 0.005, 5],
    RTY: [50, 0.1, 5],
    M2K: [5, 0.1, 0.5],
  };
  for (const [symbol, [pointValue, tickSize, tickValue]] of Object.entries(expected)) {
    const spec = futuresSpec(symbol);
    assert.deepEqual(
      [spec.pointValue, spec.tickSize, spec.tickValue],
      [pointValue, tickSize, tickValue],
      `${symbol} does not match the exchange specification`
    );
    assert.equal(
      spec.tickValue,
      spec.pointValue * spec.tickSize,
      `${symbol} tick value disagrees with point value × tick size`
    );
  }
});

test("risk in dollars differs by size: 10 points on NQ is not 10 points on MNQ", () => {
  const points = 10;
  assert.equal(points * futuresSpec("NQ").pointValue, 200);
  assert.equal(points * futuresSpec("MNQ").pointValue, 20);
});

// ---- mini and micro are one instrument in the picker ---------------------

test("a mini and its micro resolve to the same instrument", () => {
  for (const instrument of CORE_INSTRUMENTS) {
    assert.equal(coreInstrumentOf(instrument.mini)?.id, instrument.id);
    assert.equal(coreInstrumentOf(instrument.micro)?.id, instrument.id);
    // a dated contract root still resolves
    assert.equal(coreInstrumentOf(`${instrument.mini}U6`)?.id, instrument.id);
  }
  assert.equal(coreInstrumentOf("6E"), undefined, "a registry contract outside the core is not a core instrument");
});

test("the label carries the size, since that is what moves the money", () => {
  assert.equal(contractLabel("NQ"), "NQ (mini)");
  assert.equal(contractLabel("MNQ"), "MNQ (micro)");
  assert.equal(contractLabel("mnq"), "MNQ (micro)");
  assert.equal(contractLabel("QM"), "QM", "a contract with no micro keeps its bare root");
});

// ---- the picker is the core; the registry prices more than it suggests ----

test("the picker suggests the core and nothing else", () => {
  // What the journal supports is what the field offers: the twelve core
  // contracts, once each, in instrument order.
  assert.equal(new Set(CORE_SYMBOLS).size, CORE_SYMBOLS.length, "duplicate contract in the picker");
  assert.deepEqual(CORE_SYMBOLS, CORE_INSTRUMENTS.flatMap((i) => [i.mini, i.micro]));
});

test("the registry still prices everything the picker does not suggest", () => {
  // Curating the picker is not the same as forgetting a contract: a typed or
  // imported one still resolves here. What is not offered is not lost.
  const registry = Object.values(FUTURES_GROUPS).flat();
  for (const symbol of CORE_SYMBOLS) {
    assert.ok(registry.includes(symbol), `${symbol} is suggested but not in the registry`);
  }
  assert.ok(registry.length > CORE_SYMBOLS.length, "the registry is bigger than the core, as expected");
  for (const symbol of registry.filter((s) => !CORE_SYMBOLS.includes(s))) {
    assert.notEqual(knownFuturesSpec(symbol), null, `${symbol} is priced even though it is not suggested`);
  }
});

// ---- unknown contracts are reported, not silently priced at $1 ----------

test("an unknown symbol is refused a specification instead of the $1 fallback", () => {
  assert.notEqual(knownFuturesSpec("NQ"), null, "NQ is priced");
  assert.notEqual(knownFuturesSpec("MNQ"), null, "MNQ is priced");
  assert.notEqual(knownFuturesSpec("6E"), null, "a registry contract outside the core is still priced");
  assert.equal(knownFuturesSpec("XYZ"), null);
  assert.equal(knownFuturesSpec(""), null);
});

test("a dated contract root resolves to the instrument it belongs to", () => {
  assert.equal(rootSymbol("NQU6"), "NQ");
  assert.equal(rootSymbol("MNGZ5"), "MNG");
  assert.equal(futuresSpec("MGCZ5").pointValue, 10, "a dated micro gold is a $10/point contract");
});

test("micro beats mini when reading a symbol that starts with both", () => {
  assert.equal(rootSymbol("MESZ5"), "MES");
  assert.equal(futuresSpec("MESZ5").pointValue, 5);
  assert.equal(futuresSpec("ESM6").pointValue, 50);
});
