import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { test } from "node:test";

// Final release pass — presentation/placement remainders. The pure parts are
// built and exercised; the placement rules (which UI ships where) are pinned
// against the source so a future edit cannot quietly move them back.

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const result = await build({
  entryPoints: {
    tradeTable: new URL("../src/lib/tradeTable.ts", import.meta.url).pathname,
    copy: new URL("../src/lib/copy.ts", import.meta.url).pathname,
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  outdir: "bundle",
  plugins: [
    {
      name: "obsidian-test-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
          contents:
            "export const App = class {};" +
            "export const TFile = class {};" +
            "export const Modal = class {};" +
            "export const Notice = class {};" +
            "export const Plugin = class {};" +
            "export const PluginSettingTab = class {};" +
            "export const Setting = class {};" +
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
const [tradeTable, copy] = await Promise.all([loadBundle("tradeTable"), loadBundle("copy")]);

// ---------------------------------------------------------------- imports UI

test("import-specific settings live on the Imports page, not in normal account settings", () => {
  const settings = read("src/settings.ts");
  assert.match(settings, /id:\s*"imports"/, "the Imports settings section exists");
  assert.match(settings, /renderImports\s*\(/, "the Imports page renders");
  assert.match(settings, /renderDefaultRisk/, "Risk by symbol is on the Imports page");

  const manage = read("src/views/accountsManage.ts");
  assert.doesNotMatch(manage, /Account matching & import repair/, "the repair surface left Accounts settings");
  assert.doesNotMatch(manage, /renderMapping/, "the mapping UI left the Accounts modal");

  // Risk by symbol must not sit in Advanced any more: the Advanced renderer
  // starts at Maintenance and never mentions the import assumption.
  const advanced = settings.slice(settings.indexOf("renderAdvanced(containerEl"));
  const advancedBody = advanced.slice(0, advanced.indexOf("\n  private pickBackupFile"));
  assert.doesNotMatch(advancedBody, /Risk by symbol/, "Risk by symbol is out of Advanced");
  assert.match(advancedBody, /Maintenance/, "Advanced still owns maintenance");
});

test("account matching stays available on the Imports page", () => {
  const settings = read("src/settings.ts");
  assert.match(settings, /renderImportClassification/, "classification rules are reachable");
  assert.match(settings, /renderAccountMapping/, "name binding is reachable");
  assert.match(settings, /getAccountRules/, "the live rules are read");
});

test("the Imports page folds both tools and opens one at a time", () => {
  const settings = read("src/settings.ts");
  const page = settings.slice(settings.indexOf("renderImports(containerEl"));
  const body = page.slice(0, page.indexOf("private toolRow("));

  assert.match(body, /const show = \(index: number\)/, "there is one shared open/close switch");
  assert.match(
    body,
    /tool\.panel\.toggleClass\("is-hidden", !open\)/,
    "opening a tool closes whichever tool was open"
  );
  assert.match(body, /risk\.btn\.addEventListener/, "the risk tool opens from its own row");
  assert.match(body, /match\.btn\.addEventListener/, "the matching tool opens from its own row");
  assert.doesNotMatch(
    body,
    /const open = \w+\.panel\.hasClass/,
    "no per-tool toggle state — the two rows cannot both be open"
  );

  // The closed row carries the derived state, so "do I need this?" is answered
  // without opening anything.
  assert.match(body, /of \$\{CORE_SYMBOLS\.length\} set/, "the risk row says how many contracts are set");
  assert.match(body, /"Not set"/, "an empty risk editor says so");
  assert.match(body, /"Automatic"/, "matching says when nothing needs binding");
  assert.match(body, /names"} bound/, "matching says how many names are bound");
});

test("an automatically decided name reads as a fact, not an unfinished field", () => {
  const settings = read("src/settings.ts");
  const page = settings.slice(settings.indexOf("private async renderAccountMapping"));
  const body = page.slice(0, page.indexOf("private renderImportClassification"));

  assert.match(body, /text: "Bound by you"/, "explicit bindings are their own list");
  assert.match(body, /text: "Decided by the rules"/, "automatic names are labelled as facts");
  // Exactly two pickers exist in this renderer: the one on a bound row and the
  // one an explicit "Bind…" opens. A picker per resolved name is what made the
  // closed journal look like a list of unanswered questions.
  const pickers = body.match(/mountDropdown\(/g) || [];
  assert.equal(pickers.length, 2, "no account picker is mounted on every automatic row");
  assert.match(body, /text: "Bind…"/, "the override is a plain text action");
  assert.match(body, /nothing to bind a name to/, "no accounts means an honest hint, not an empty picker");
});

test("the risk editor states a result only when there is one", () => {
  const settings = read("src/settings.ts");
  const page = settings.slice(settings.indexOf("private renderDefaultRisk"));
  const body = page.slice(0, page.indexOf("// ------------------------------------------------------------- Review"));

  assert.doesNotMatch(body, /"no rule"/, "an empty contract carries no standing 'no rule' line");
  assert.match(body, /hint\.toggleClass\("is-hidden"/, "the result line is hidden until there is a rule");
  assert.match(body, /this\.plugin\.settings\.currency/, "the money is the configured currency");
  assert.doesNotMatch(body, /\$\$\{/, "no hardcoded currency sign in the result line");
  assert.match(body, /CORE_SYMBOLS\.filter/, "the tool's state counts the contracts that carry a rule");
  // One grid for the page: the legend and every row share the columns, and the
  // family is a line of words rather than a card.
  assert.match(body, /tj-set-riskgrid is-legend/, "the column legend is drawn once");
  assert.match(body, /cls: "tj-set-riskfam"/, "a family is a quiet subhead, not a block");
  assert.doesNotMatch(body, /tj-set-riskblock/, "the old card-per-instrument grid is gone");
});

test("the CSS the Imports editors replaced is gone, and no consumer was orphaned", () => {
  const css = read("styles.css");
  for (const dead of [".tj-set-riskblock", ".tj-set-risklegend", ".tj-map-row", ".tj-map-acc", ".tj-rule-row", ".tj-rule-input", ".tj-rule-editor", ".tj-acct-chip"]) {
    assert.ok(!css.includes(dead), `${dead} is dead CSS`);
  }
  const src = read("src/settings.ts");
  for (const live of ["tj-set-riskgrid", "tj-set-riskfam", "tj-set-maprow", "tj-set-state", "tj-set-linkbtn", "tj-set-microhead", "tj-set-kwrow"]) {
    assert.match(css, new RegExp(`\\.${live}[\\s:{.]`), `${live} is styled`);
    if (live !== "tj-set-state") assert.ok(src.includes(live), `${live} is rendered`);
  }
});

// ------------------------------------------------------------ trading groups

test("changing a copier's ratio or start never deselects it", () => {
  const account = { id: "c1", name: "Copier", type: "funded", size: 50000, copyRole: "copier", copyBaseId: "lead" };
  copy.startCopying(account, "lead", 2, "2026-01-01", "UTC");
  assert.equal(account.copyRole, "copier");
  assert.equal(account.copyBaseId, "lead");
  // Re-writing the ratio/start (what the ratio field and date field do) keeps
  // the same link — it can never remove the account from the group.
  copy.startCopying(account, "lead", 3, "2026-02-01", "UTC");
  assert.equal(account.copyRole, "copier");
  assert.equal(account.copyBaseId, "lead");
  assert.equal(copy.copierPresentation(account).ratio, 3);
});

test("each copier keeps its own independent start", () => {
  const copier = { id: "c1", name: "Copier", type: "funded", size: 50000, copyRole: "copier", copyBaseId: "lead" };
  copy.startCopying(copier, "lead", 1, "2026-01-01", "UTC");
  const first = copy.copierPresentation(copier).since;
  copy.startCopying(copier, "lead", 1, "2026-03-15", "UTC");
  const second = copy.copierPresentation(copier).since;
  assert.equal(first, "2026-01-01");
  assert.equal(second, "2026-03-15");
});

// ------------------------------------------------------------ trade log grid

test("the width of a column never depends on which other columns are on screen", () => {
  const base = ["date", "symbol", "side", "qty", "entryexit", "points", "pnl", "setup", "stars", "image"];
  const withAccounts = [...base, "accounts"];
  const a = tradeTable.tradeColumnWidths(base);
  const b = tradeTable.tradeColumnWidths(withAccounts);
  for (const id of base) assert.equal(a[id], b[id], `${id} keeps its preferred width`);
  // Adding the column raises the overflow floor, not the weights already set.
  assert.ok(
    tradeTable.tradeTableMinWidth(withAccounts, { rail: true }) >
      tradeTable.tradeTableMinWidth(base, { rail: true })
  );
  // Reordering must not change geometry either.
  assert.deepEqual(tradeTable.tradeColumnWidths([...base].reverse()), a);
});

test("the trade table fills its container proportionally, with no filler column", () => {
  const table = read("src/lib/tradeTable.ts");
  assert.match(table, /tradeColumnWidths/, "preferred widths drive the colgroup");
  // The blank right side came from an auto-width trailing column absorbing all
  // slack. The proportional model removes it: nothing is emitted, nothing is
  // styled, and no empty header cell survives.
  assert.doesNotMatch(table, /tj-tbl-fillercol/, "no filler column is emitted");
  assert.doesNotMatch(read("styles.css"), /tj-tbl-fillercol/, "no filler CSS remains");
  assert.match(read("styles.css"), /\.tj-tbl\.is-fixed\s*\{[^}]*table-layout:\s*fixed/s, "CSS keeps fixed layout");
});

// -------------------------------------------------------- account info tab

test("the Information tab gives visible help and human labels", () => {
  const dash = read("src/views/accountDashboard.ts");
  assert.match(dash, /tj-as-infoico/, "a visible info affordance exists");
  for (const label of ["Tracking from", "Opening balance", "Highest value before"]) {
    assert.ok(dash.includes(label), `${label} stays present`);
  }
  assert.match(dash, /Reported history/, "the reported-history section is named in plain words");
});

// ------------------------------------------------------------- import flow

test("the import flow presents three real stages, not a seven-step wizard", () => {
  const ui = read("src/views/importUi.ts");
  assert.match(ui, /const labels = \["Files", "Review", "Import"\]/);
  assert.doesNotMatch(ui, /\["Files", "Accounts", "Group", "Time", "Costs", "Preview", "Import"\]/);
  assert.match(ui, /Needs your choice/, "the next required decision is named");
  assert.doesNotMatch(ui, /tj-import-stepnum/, "internal blocks are no longer numbered steps");
});

test("import preselects configured copiers but discovers nothing from the CSV", () => {
  const ui = read("src/views/importUi.ts");
  // The default tick is delegated to the Import-specific reducer, which derives
  // it from the mapped leader's own configuration — not from the file.
  assert.match(ui, /effectiveSelection/, "the default comes from the configured group");
  assert.match(ui, /Trading Group settings/, "the tick is attributed to configuration, not the CSV");
  assert.match(ui, /includeIds/);
});

// ------------------------------------------------------------ leader picker

test("leader options are lightweight tiles in a wrapping row, not a full-width list", () => {
  const css = read("styles.css");
  const grid = css.match(/\.tj-mg-leadgrid\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(grid, /display:\s*grid/, "the picker is a grid");
  assert.match(grid, /auto-fit|auto-fill/, "it wraps by available width");
  assert.doesNotMatch(grid, /flex-direction:\s*column/, "not a vertical full-width list");

  const card = css.match(/\.tj-mg-leadcard\s*\{[^}]*\}/s)?.[0] ?? "";
  // Obsidian's bare-button surface wins over a single class: the local reset
  // must force the surface off (the repo's own documented finding).
  assert.match(card, /appearance:\s*none/, "the native button appearance is reset");
  assert.match(card, /background:\s*transparent/, "the grey fill is forced off");
  assert.match(card, /box-shadow:\s*none/, "the native shadow is forced off");
  assert.match(card, /box-sizing:\s*border-box/, "width:100% cannot overflow its grid track");
  assert.match(card, /min-height:\s*0/, "the native min-size is reset");
  assert.match(css, /\.tj-mg-leadcard:focus-visible\s*\{[^}]*outline-offset:\s*-2px/s, "focus is contained, not clipped");
  // Long names stay inside the tile: two lines then an ellipsis, and a stable
  // tile height so a long name (or selection) never resizes it.
  const nm = css.match(/(?:^|\n)\.tj-mg-leadcard-nm\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(nm, /-webkit-line-clamp:\s*2/, "the name clamps to two lines");
  assert.match(nm, /overflow-wrap:\s*anywhere/, "one long token breaks inside the clamp");
  assert.match(css, /\.tj-mg-leadcard\s*\{[^}]*min-height:/s, "the tile has a stable height");
  const txt = css.match(/(?:^|\n)\.tj-mg-leadcard-txt\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(txt, /min-width:\s*0/, "the text column can shrink (no overflow)");
});

test("the step head and the ratio stepper no longer share a class", () => {
  const css = read("styles.css");
  const manage = read("src/views/accountsManage.ts");
  // One class for the step head, a different one for the +/- buttons: the shared
  // `.tj-mg-step` used to give the head the stepper's 24px centred box, which
  // pushed the "1"/"2" marker outside the modal.
  assert.match(manage, /createDiv\(\{\s*cls:\s*"tj-mg-stephead"\s*\}\)/, "the head uses its own class");
  assert.match(manage, /"tj-mg-step"/, "the ratio buttons keep the stepper class");
  assert.match(css, /\.tj-mg-stephead\s*\{/, "the head has its own rule");
  assert.match(css, /\.tj-mg-step\s*\{[^}]*width:\s*24px/s, "the 24px box belongs to the stepper only");
});
