# Tradebook

A local trading journal for [Obsidian](https://obsidian.md), built for **futures traders** (NQ, ES, MNQ, MES) with automatic demo / eval / funded / live account organization.

> **Status:** active development (`0.5.x`). See the `docs/` folder for the roadmap.

## Features

- **Import Tradovate CSVs** — drop a file exported from Reports → *Executions/Fills* or *Orders* into the import view, or paste CSV directly in the *Add Trade* modal.
- **Automatic round-trip pairing** — fills are matched with FIFO inventory per account/symbol; realized P&L (in dollars) is computed on exit.
- **Account classification** — accounts are automatically split into **funded → eval → demo** using configurable keywords (Topstep/TDF/Apex etc.), editable in Settings.
- **Visual dashboard** — KPI cards, a cumulative P&L line chart, daily & hourly win/loss blocks, daily P&L calendar heatmap, symbol breakdown, and recent trades (click to open the note). Cards can be re-ordered, resized, and shown/hidden in edit mode.
- **Prop accounts** — configure each account (firm + program + size) in *Account Configuration*; every account gets its own auto-generated dashboard with the real limits (profit target, trailing max loss, daily loss, consistency) from the firms' sites, and the equity chart is drawn against your starting balance.
- **Needs Review list** — every trade missing a review or a setup screenshot is listed. Use the checkboxes + *Select all* and bulk actions (`Mark reviewed`, `Mark print added`).
- **Review notes** — one markdown note per trade with a small table and `## Notes` + `## Screenshots` sections ready for your workflow.
- **Add Trade modal** — manually enter a trade, or paste a Tradovate CSV and attach setup / print / review *before* saving.
- **Mobile-ready** — `isDesktopOnly: false`, with layouts and tables that scroll gracefully on phones.

## Install (beta via BRAT)

Tradebook is in beta. Install it with **[BRAT](https://tfthacker.com/BRAT)** (Beta Reviewers Auto-update Tool):

1. Install **[Obsidian](https://obsidian.md)** and open your vault.
2. Install **BRAT** from *Settings → Community plugins → Browse* (search for "BRAT"), then enable it.
3. Open BRAT's settings → **Add beta plugin**, paste this repository's URL
   (`https://github.com/<owner>/Tradebook`) and confirm.
4. Enable **Tradebook** in *Settings → Community plugins*, then open the journal from the ribbon (grip icon) or the command palette.

BRAT tracks new beta releases for you — run its **Update** action after a release is published.

## Usage

1. Open the **Import Tradovate CSV** (ribbon icon or command palette) and drop an export — or use **Add Trade** to paste CSV / enter a trade manually.
3. Trades land as notes in your configured `trades` folder (`Tradebook/trades` by default).
4. Open the **Trading Dashboard** to review. In *Needs Review*, tick the trades you finished, then hit *Mark reviewed* / *Mark print added*.

## Tick values

| Symbol | $ / point |
| ------ | -------- |
| NQ     | $20      |
| ES     | $50      |
| MNQ    | $2       |
| MES    | $5       |

## Account classification

Rules are evaluated in order (first match wins). Keywords are editable in Settings:

- **funded** — `FUNDED, FUND, LIVE, REAL, PAID, PASSED, CERTIFIED`
- **eval** — `EVAL, EVALUATION, COMBINE, FUNDING, CHALLENGE, PROP, TOPSTEP, TDF, AXIO, KWR, T4C, APEX, TAKEPRO`
- **demo** — `DEMO, SIM, SIMULATED, PAPER, TRAINING, PRACTICE` (pure numeric account names default to demo)

Unknown accounts are shown as `other` in the dashboard so nothing gets silently mislabeled.

## Development

```
npm install
npx tsc --noEmit --skipLibCheck
node esbuild.config.mjs production
```

`main.js`, `manifest.json` and `styles.css` are emitted into the project root — copy them into `<vault>/.obsidian/plugins/tradebook/`.

## Changelog

### 0.1.1 (2026-09-10) — Accounts rework

- **Accounts tab is now a per-account dashboard.** Opening *Accounts* shows the **primary account** immediately (configurable in Settings), with a **dropdown** in the top bar to switch between accounts.
- **Account Configuration moved into Settings.** Add Account, the account list (edit scope + remove), and Account Mapping all live under *Settings → Account Configuration*.
- **Primary account** setting: pick the account the Accounts tab opens on. Automatically set to the first account you add; cleared safely if that account is removed.
- **Orphan mapping cleanup:** removing an account also removes any account mapping that referenced it.
- Version badge on the dashboard now shows the real manifest version (`v0.1.1`).

### 0.1.0 (2026-09-10) — Dev/beta baseline

- Version line reset to `0.1.x` (dev/beta).
- Cumulative P&L chart restored to the original v1.0 rendering (simple cumsum, area + line, zero grid line).
- Fixed inflated "All" totals caused by trades without entry/exit prices.

## Data & privacy

- Everything is local. No data ever leaves your vault — the plugin makes no network requests.
- Your trades, accounts, and settings live only in your Obsidian vault.

### Data safety

- Updating the plugin **never touches your settings or trades** — `data.json` is preserved across updates.
- **Disabling** the plugin keeps `data.json`; re-enabling restores everything.
- **Uninstalling** deletes the plugin folder, including `data.json`. Use the plugin's **Export** to back it up first.
- Your trades are plain Markdown notes in your vault — a plugin update never puts them at risk.

## Support

If Tradebook helps your trading, consider supporting the project — [Buy me a coffee](https://www.buymeacoffee.com/yamihugo) ☕

## License

MIT (see LICENSE).
