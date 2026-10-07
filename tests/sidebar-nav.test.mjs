import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The Tradebook menu: destinations, no commentary. A hover card on a nav row
// restates the label in numbers ("This week · Net +$0 · 0 trades") and is noise
// on the way to the page, so primary navigation carries no tooltip. The tooltip
// system itself (lib/tip.ts) is untouched and still used by everything else.
//
// The view is DOM, so it is pinned here against the source and rendered for real
// in the harness (smoke.js, "sidebar").

const sidebar = readFileSync(new URL("../src/views/sidebarView.ts", import.meta.url), "utf8");

// ---- no informational hover card on navigation --------------------------

test("navigation entries carry no tooltip", () => {
  // E. The metadata is gone, not just the hover handler: an entry has nowhere
  // left to carry a title, a value or a sub-line.
  assert.doesNotMatch(sidebar, /tip\?:/, "no tip field on the nav entry");
  assert.doesNotMatch(sidebar, /entry\.tip|tip:\s*\{/, "no entry carries a tooltip");
  assert.doesNotMatch(sidebar, /attachTip/, "the sidebar attaches no hover card");
  assert.doesNotMatch(sidebar, /TipParts/, "the sidebar no longer imports the tip type");
  assert.doesNotMatch(sidebar, /tj-tip-anchor|tj-sr-only/, "no tip anchor and no screen-reader stand-in for it");
  assert.doesNotMatch(sidebar, /This week|needs review|· today · Net/, "the removed tooltip copy");
});

test("the row keeps its accessible name", () => {
  // Removing the tooltip must not remove the label for a screen reader: the
  // button still says where it goes.
  assert.match(sidebar, /attr: \{ type: "button", "aria-label": entry\.label \}/);
});

// ---- the same six destinations, opened the same way ----------------------

test("navigation still opens the same destinations", () => {
  // F. Removing the tooltip is all that happened to the menu: same rows, same
  // icons, same groups, same run.
  const rows = [...sidebar.matchAll(/id: "(\w[\w:]*)",\s*\n\s*label: "([^"]+)",\s*\n\s*icon: "([^"]+)",\s*\n\s*group: "(\w+)"/g)];
  assert.deepEqual(
    rows.map(([, id, label, icon, group]) => ({ id, label, icon, group })),
    [
      { id: "home", label: "Home", icon: "home", group: "OVERVIEW" },
      { id: "tradelog", label: "Trade Log", icon: "notebook-text", group: "OVERVIEW" },
      { id: "setups", label: "Strategies", icon: "target", group: "OVERVIEW" },
      { id: "accounts", label: "Accounts", icon: "wallet", group: "OVERVIEW" },
      { id: "addtrade", label: "Manual Trade", icon: "plus-circle", group: "TOOLS" },
      { id: "import", label: "Import CSV", icon: "upload", group: "TOOLS" },
    ]
  );
  for (const [id, open] of [
    ["home", "openHome"],
    ["tradelog", "openTradeLog"],
    ["setups", "openSetups"],
    ["accounts", "openAccounts"],
    ["addtrade", "openAddPanel"],
    ["import", "openImport"],
  ]) {
    const entry = sidebar.slice(sidebar.indexOf(`id: "${id}"`));
    assert.match(entry.slice(0, 200), new RegExp(`run: \\(\\) => (?:void )?this\\.plugin\\.${open}\\(\\)`), `${id} → ${open}`);
  }
  // The click is still what opens the row, and Customize still takes it over.
  assert.match(sidebar, /btn\.addEventListener\("click", \(\) => \{\s*\n\s*entry\.run\(\);\s*\n\s*this\.setActive\(entry\.id\);/);
});