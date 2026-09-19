# Tradebook

A local trading journal for [Obsidian](https://obsidian.md), built for **futures traders** (NQ, ES, MNQ, MES) with automatic demo / eval / funded / live account organization.

> **Status:** active development — current beta line `0.5.x`. Everything stays inside your vault: no cloud, no account, no subscription. See `docs/` for the roadmap.

## Install (beta via BRAT)

Tradebook is in beta, so it installs through **[BRAT](https://tfthacker.com/BRAT)** (Beta Reviewers Auto-update Tool). Takes about two minutes.

1. **Install Obsidian** (`1.4.0` or newer) from [obsidian.md](https://obsidian.md) and open the vault you want to keep your journal in.
2. **Install BRAT.** In Obsidian open *Settings → Community plugins → Browse*, search for **BRAT**, install it, then click **Enable**.
3. **Add Tradebook to BRAT.** Open *Settings → BRAT → Add beta plugin*, paste this repository's URL and click **Add plugin**:
   ```
   https://github.com/yamihugo/Tradebook
   ```
4. **Enable Tradebook.** Go to *Settings → Community plugins* and turn **Tradebook** on. If it is not in the list, click the refresh icon next to *Installed plugins*.
5. **Open the journal** from the ribbon (the grip icon) or with the **Tradebook: Open home** command in the command palette (`Ctrl/Cmd+P`).

BRAT keeps it up to date: when a new beta is published, run BRAT's **Check for updates** / **Update all** action.

> Updating the plugin never touches your trades or settings — see [Data safety](#data-safety).

## First steps

1. **Pick where trades are stored** — *Settings → Tradebook → Trades folder* (default `Tradebook/trades`).
2. **Add your accounts** — *Settings → Tradebook → Account configuration*. Each account gets a colour and its own dashboard.
3. **Import or add a trade** — use the ribbon **Import Tradovate CSV** (drop an export from Reports → *Executions/Fills*) or **Add Trade** to paste CSV / type a trade by hand.
4. **Review** — open the **Dashboard**; the *Needs review* list collects every trade still missing a review or a setup screenshot.

## Requirements

- Obsidian **1.4.0+** (desktop or mobile; `isDesktopOnly: false`).
- No other plugins, no accounts, no internet access required.

## Data safety

- Updating the plugin **never touches `data.json`** — your settings and accounts survive every update.
- **Disabling** the plugin keeps `data.json`; re-enabling restores everything.
- **Uninstalling** deletes the plugin folder, including `data.json`. Back it up first using the plugin's **Export**.
- Your trades are plain Markdown notes in your vault — a plugin update never puts them at risk.

Tradebook is fully local: it makes **no network requests** and sends **no telemetry**. Your trades, accounts and settings live only in your Obsidian vault.

## Features

- **Import Tradovate CSVs** — drop a file exported from Reports → *Executions/Fills* or *Orders* into the import view, or paste CSV directly in the *Add Trade* modal.
- **Automatic round-trip pairing** — fills are matched with FIFO inventory per account/symbol; realized P&L (in dollars) is computed on exit.
- **Account classification** — accounts are automatically split into **funded → eval → demo** using configurable keywords (Topstep/TDF/Apex etc.), editable in Settings.
- **Visual dashboard** — KPI cards, a cumulative P&L line chart, daily & hourly win/loss blocks, daily P&L calendar heatmap, symbol breakdown, and recent trades (click to open the note). Cards can be re-ordered, resized, and shown/hidden in edit mode.
- **Prop accounts** — configure each account (firm + program + size) in *Account configuration*; every account gets its own auto-generated dashboard with the real limits (profit target, trailing max loss, daily loss, consistency), and the equity chart is drawn against your starting balance.
- **Needs review list** — every trade missing a review or a setup screenshot is listed. Use the checkboxes + *Select all* and bulk actions (`Mark reviewed`, `Mark print added`).
- **Review notes** — one markdown note per trade with a small table and `## Notes` + `## Screenshots` sections ready for your workflow.
- **Add Trade modal** — manually enter a trade, or paste a Tradovate CSV and attach setup / print / review *before* saving.
- **Mobile-ready** — layouts and tables scroll gracefully on phones.

## Tick values

| Symbol | $ / point |
| ------ | --------- |
| NQ     | $20       |
| ES     | $50       |
| MNQ    | $2        |
| MES    | $5        |

## Account classification

Rules are evaluated in order (first match wins). Keywords are editable in Settings:

- **funded** — `FUNDED, FUND, LIVE, REAL, PAID, PASSED, CERTIFIED`
- **eval** — `EVAL, EVALUATION, COMBINE, FUNDING, CHALLENGE, PROP, TOPSTEP, TDF, AXIO, KWR, T4C, APEX, TAKEPRO`
- **demo** — `DEMO, SIM, SIMULATED, PAPER, TRAINING, PRACTICE` (pure numeric account names default to demo)

Unknown accounts are shown as `other` in the dashboard so nothing gets silently mislabeled.

## Development

```
npm install
npm run build          # tsc --noEmit + esbuild production -> main.js
```

`main.js`, `manifest.json` and `styles.css` are emitted into the project root — copy them into `<vault>/.obsidian/plugins/tradebook/`. Firm logos are embedded in `main.js`, so there is no `assets/` folder to copy.

See `KNOWN-LIMITATIONS.md` for what is deliberately modelled rather than measured.

## Changelog

### 0.1.1 (2026-09-10) — Accounts rework

- **Accounts tab is now a per-account dashboard.** Opening *Accounts* shows the **primary account** immediately (configurable in Settings), with a **dropdown** in the top bar to switch between accounts.
- **Account configuration moved into Settings.** Add Account, the account list (edit scope + remove), and Account Mapping all live under *Settings → Account configuration*.
- **Primary account** setting: pick the account the Accounts tab opens on. Automatically set to the first account you add; cleared safely if that account is removed.
- **Orphan mapping cleanup:** removing an account also removes any account mapping that referenced it.
- Version badge on the dashboard now shows the real manifest version (`v0.1.1`).

### 0.1.0 (2026-09-10) — Dev/beta baseline

- Version line reset to `0.1.x` (dev/beta).
- Cumulative P&L chart restored to the original v1.0 rendering (simple cumsum, area + line, zero grid line).
- Fixed inflated "All" totals caused by trades without entry/exit prices.

## Support

If Tradebook helps your trading, consider supporting the project — [Buy me a coffee](https://www.buymeacoffee.com/yamihugo).

## License

MIT — see [LICENSE](LICENSE).

Prop-firm and broker names and logos belong to their owners and are shown only to identify
the firm an account trades with.
