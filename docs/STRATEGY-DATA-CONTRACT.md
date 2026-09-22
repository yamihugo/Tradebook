---
title: Strategy Data Contract
date: 2026-09-17
tags: [architecture, data-contract, strategy, obsidian, plugin]
aliases: [Strategy Contract, Setup Contract, Strategy Data Contract]
---

# Strategy Data Contract

> [!note] TL;DR
> The Strategy Data Contract defines the architectural rules for how strategy and setup names are stored, managed, and processed in the Tradebook plugin. It guarantees that future features (backtesting, comparison, analytics) can scale seamlessly without ever breaking existing user notes or requiring messy data migrations.

---

## The 6-Point Data Contract

1. **`setup` stays a plain string in the note**
   - The frontmatter field `setup` is always a human-readable string (e.g., `"Reversal"`, `"Breakout"`).
   - **Never** an ID, link, object, or array.
   - This ensures notes remain completely self-contained and fully legible even if the Obsidian plugin is disabled or uninstalled.

2. **Truth is notes, not registry**
   - The `settings.strategies` array in `data.json` acts purely as a convenience index/cache
     (records `{ id, name, createdAt }`; the legacy `settings.setups` string array is kept
     for compatibility and still read).
   - If the registry gets deleted or corrupted, trade notes remain the absolute source of truth.
   - The plugin dynamically rebuilds the active setup registry by scanning all trade notes via `knownSetups()`.

3. **Comparison is always case-insensitive + trimmed**
   - Variations like `"reversal"`, `"Reversal"`, and `" reversal "` all resolve to the exact same strategy.
   - All filtering, deduplication, and lookup operations normalize names using `name.toLowerCase().trim()`.

4. **Rename is first-class**
   - `plugin.renameSetup(oldName, newName)` performs a global update by rewriting ALL notes whose `setup` matches (case-insensitively).
   - Uses `loadTradesExpanded()` combined with `updateTradeFields()` and returns the exact count of modified notes.

5. **New fields are additive with safe defaults**
   - Future strategy features (such as rules, parameters, risk profiles) will be introduced as **new optional fields** in settings or frontmatter.
   - Existing notes containing only a plain string `setup` continue to work without retroactive updates or schema breaks.

6. **Nothing is imposed (journal reports, never enforces)**
   - The system tracks and displays metrics but never blocks trades.
   - No validation forces a strategy name to pre-exist in settings.
   - No enforcement mandates that trades must have a strategy. The journal serves as a mirror, not a warden.

---

## Foundation for 2.0 (agreed 2026-09-19)

These are architectural decisions that change **nothing in the 1.0 UI** but make the 2.0
strategies system safe to ship. They are binding.

> [!note] Implemented in 1.0 (AL, 19 Set)
> Points 7–9 are now real: `settings.strategies` holds records, `settingsVersion = 2`
> with the idempotent `migrateStrategies()`, and registering a strategy writes
> `library/strategies/<name>.md`. The form **asks** (Add Trade forces a choice, with an
> explicit *No strategy*; the import offers an optional field) — the **engine never
> imposes**: no trade is blocked, no import is refused, and a missing strategy is a nag,
> never a wall (contract point 6).

7. **Stable identity for strategies**
   - The registry becomes records: `{ id, name, createdAt }` (not bare strings).
   - The **note keeps the human-readable name**; the **id** is what rules/docs/readiness
     attach to. Renaming updates the registry; a name found in a note that is not in the
     registry becomes **"untracked"** — it is never lost.
   - Same principle already holds for accounts, copy groups, payouts, deposits and fee
     adjustments (all have ids). `settings.mistakes` and `settings.tags` are still
     name-only: if the psychology module later attaches data to them, they will need ids
     too.

8. **`settingsVersion` + numbered, idempotent migrations**
   - The journal stores a version. On start-up, numbered migrations (`1→2`, `2→3`, …)
     run **only** for journals below the current version; each is idempotent (running it
     twice is the same as once), and the version is written at the end. A journal that is
     already current never re-migrates; an old journal is upgraded once, losing nothing.
   - This does not exist today (`Object.assign({}, DEFAULT_SETTINGS, await loadData())`
     already preserves unknown keys, which is necessary but not sufficient).
   - Journalit does the same, per feature (`tradeReviewMarkdownMigrationVersion`,
     `graphLinkMigrationVersion`, `tradingDayCutoffEndOfDayMigrationVersion`, …).

9. **A strategy is a vault note**
   - `Tradebook/library/strategies/<name>.md`. Rules, documentation and readiness live in
     the **note** — portable, searchable and legible without the plugin. `data.json` stays
     an index/cache only.
   - This is what makes 2.0 survivable: a vault-only backup or an uninstall never takes
     the strategy's substance with it.

10. **Reserve `tradeType: regular | missed | backtest`**
    - Test/sandbox trades and missed trades get a home without a schema break.

11. **Preserve unknown `data.json` fields — always.**
    - Never delete what we do not understand.

Folder model and the "discover by `type`, not by path" rule live in
`docs/VAULT-STRUCTURE.md`.

---

## Technical Context & Architecture

### Files Involved
| File Path | Role / Responsibility |
|-----------|----------------------|
| `types.ts` | Defines `Trade.setup: string` as a plain string field. |
| `main.ts` | Houses registry management functions: `knownSetups()`, `addSetup()`, `removeSetup()`, and `renameSetup()`. |
| `storage.ts` | Handles Markdown serialization/deserialization: `parseTradeFromMarkdown()` reads `setup` from frontmatter; `tradeToMarkdown()` writes it. |
| `lib/copy.ts` | Ensures copied legs inherit `setup` from the base trade via `buildLeg()`. |
| `views/tradeDetailView.ts` | Renders the setup card using `mountDropdown()` populated with `setupOptions` from `knownSetups()`. |
| `views/setupsView.ts` | The Strategies page listing all known setups with aggregated trade counts, P&L, and rename/remove capabilities. |
| `views/tradeLogView.ts` | Provides the strategy filter chip using `knownSetups()` for available options. |
| `lib/review.ts` | Print check utility that also accounts for the `screenshots` array. |

### Data Flow
1. **Input**: User assigns a strategy name in the Add Trade modal or Trade Detail view.
2. **Persistence**: Saved as a plain string in the trade note's YAML frontmatter.
3. **Index Aggregation**: `knownSetups()` scans all vault trade notes and merges them with the `settings.setups` registry, case-insensitively deduplicating entries.
4. **Dashboard & Filtering**: The Strategies page (`[[setupsView]]`) and Trade Log filter (`[[tradeLogView]]`) consume this aggregated list.
5. **Mutation**: Renaming updates all matching note frontmatters across the vault as well as the local registry entry.

---

## ⚠️ Warning: `data.json` vs Vault Storage

> [!warning] Vault-Only Backups
> The `settings.setups` array resides in `data.json` (plugin settings), **not** inside the markdown vault. 
> 
> A vault-only backup will **not** include the cached setup registry. However, because `knownSetups()` dynamically rebuilds the list by scanning trade notes on startup, **no strategy data is lost**—only custom registry ordering or UI metadata.

---

## Related Notes
- [[Architecture Overview]]
- [[Trade Frontmatter Specification]]
- [[Settings Management]]
- [[Data Flow & Storage]]
- [[Strategies View]]
