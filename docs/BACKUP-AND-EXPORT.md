# Backup and export — what we ship, and what the others do

Written 17 Sep 2026. Two different things were being mixed under "export"; they are
separated here, together with what every serious journal does, so the decision is made
once and with the evidence in front of us.

---

## 1. The two cases

### Case A — Backup: our system → our system
Everything the plugin owns, in one dated file, restorable into the same plugin:

- settings (all of them), accounts (active and archived), `accountMappings` and aliases,
  copy groups and copy periods, payouts and deposits, dashboard/account layouts, the
  Manage preferences (type order, labels, colours, card slots, chart period), rules and
  overrides, and **every trade with its fills and review**.
- Purpose: format the PC, change computer, restore after an experiment, or keep a
  snapshot before a big change.
- The acceptance test: **restoring reproduces the journal exactly** — same accounts,
  same groups, same trades, same reviews.

### Case B — Export for analysis: our system → another tool
A table of trades and executions (CSV) to open in Excel, study, or archive. A snapshot,
not a backup: it does not restore anything by itself.

---

## 2. What the others do (verified against their docs)

| Product | Full backup (A) | Export (B) | Import its own export | Where the data lives |
|---|---|---|---|---|
| **Journalit** | **Partial**: settings only (`journalit-settings-<date>.json`, secrets stripped) | **No** (CSV is import-only; only column-mapping templates can be shared) | Settings: **yes** (merge + migrate) | Vault markdown + `data.json` + `ui-state.json` + `indexes/`; premium cloud for broker sync |
| **TradeZella** | **No** — docs say there is no full export, and the CSV cannot be re-uploaded | Yes (bulk CSV, chosen columns) | **No** (explicit) | Server account |
| **TradesViz** | **Closest thing**: CSV with Executions/Native + *preserve grouping*, re-importable | Yes (CSV/Excel/PDF) | **Yes** | Server account |
| **TraderSync** | No documented full backup | Yes (trades + executions CSV) | Unverified | Server account |
| **Edgewonk** | Excel export, **lossy** (no screenshots/notes), re-importable via generic importer | Yes | Partial | Server (v3); local file in v2 |
| **Tradervue** | No; API is the portability story | Yes (CSV, paid tiers) | No | Server account |
| **TradeNote** | Database-level (`mongodump` script) | No in-app export documented | n/a | Self-hosted MongoDB |

**Journalit's safety nets worth copying:** it writes `data.backup.json` on **every**
settings save, recovers from it automatically if `data.json` is corrupt, and keeps
`data.pre-reset-backup.json` before a reset. Its settings export removes secrets
recursively — we have no secrets in settings, but the same discipline applies.

### What is normal, and what is rare
- CSV export of trades/executions is **near-universal**.
- Re-importing your own export is **rare** (TradesViz yes; TradeZella explicitly no).
- **"One file that restores everything" is essentially non-existent** among cloud
  journals — they solve "new computer" with a login.
- Local-first tools (Journalit, Edgewonk 2, self-hosted TradeNote) lean on the vault or
  the database and document little.

**Our position:** being local, we can do better than the cloud products here. Case A is a
real differentiator, not a nice-to-have.

---

## 3. The decision

1. **Ship Case A** as **Export / Import** in the global settings (Settings → Advanced → Backup):
   - one file, `tradebook-backup-<YYYY-MM-DD>.json`, written to a `backups/` folder
     beside the journal (so the user's own git/backup covers it);
   - **re-importable** (this is the part almost nobody has) with a **summary before
     anything is applied** — what will change, how many accounts, how many trades;
   - includes the trades' content and fills, not only the metadata (product call: one file
     that restores everything).
2. **Pre-import snapshot instead of a per-save backup.** Before a restore the current
   settings are written to `data.pre-import-<timestamp>.json` in the plugin folder, so a
   restore is always undoable. A `data.backup.json` on *every* save was considered and
   rejected: `saveSettings()` runs on every filter change, and doubling that write buys
   nothing the export does not already give.
3. **Ship Case B later, and smaller**: an export of the current selection (a filtered
   view or the whole journal) as CSV of trades and executions, next to the bulk actions.
   Not part of the beta-critical path.
4. **Write the "switch computer" instructions** in the docs and the tutorial: where the
   vault is, where `data.json` is, and how the two together rebuild the journal.

## 4. What shipped (v0.5 dev, 17 Sep)

| Piece | Where |
|---|---|
| Format + validation (`buildBackup`, `summariseBackup`, `backupFilename`) | `src/lib/backup.ts`, hook `window.__tjBackup` |
| Read the vault, write the file, restore it | `plugin.getBackupFolder()`, `collectTradeNotes()`, `exportEverything()`, `applyBackup()` in `src/main.ts` |
| The confirmation card (contents + "also restore missing notes") | `src/views/backupRestore.ts` |
| Buttons | Settings → Advanced → **Backup** (Export everything / Import a backup) |
| Test | `~/trading-journal-smoke/backup-check.js` → **BACKUP OK** |

Decisions taken while building, and why:

- **Trades travel as their raw markdown**, not as parsed objects. A parsed object loses the
  body sections a person wrote; markdown is a byte-for-byte copy, and a missing note can be
  recreated exactly. The file is bigger and that is fine — a real journal of 126 notes is
  ~87 KB.
- **The import replaces settings** (`{...DEFAULT_SETTINGS, ...backup.settings}`) rather than
  merging: "restore" means "this is what my journal was", and a merge would leave half of
  two journals behind with no way to tell which number is real.
- **Notes already on disk are never overwritten** — a restore fills gaps only. That is what
  makes it safe to run on a machine that already has some of the journal.
- **Prints stay in the vault.** They are images, not data we own; the UI says so and the
  tutorial tells people to copy the vault folder for those. Honest scope beats a 200 MB JSON.
- **Foreign files are refused with a sentence**, not a stack trace; a backup from a *newer*
  plugin version says "update first" instead of guessing.

Still open:

- **Case B** (CSV of the selection) — after launch.
- **Merge mode** for the import (bring another journal's accounts in without touching
  trades) — only worth building if someone actually asks.
- **Include prints as base64** in the file, behind a toggle, for the user who wants one
  artefact instead of two steps.
