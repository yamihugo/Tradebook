# Tradebook

A local trading journal for [Obsidian](https://obsidian.md), built for **futures traders** (NQ, ES, MNQ, MES) with automatic demo / eval / funded / live account organization.

> **Status:** active development — current beta line `0.5.x`. Everything stays inside your vault: no cloud, no account, no subscription. See `docs/` for the roadmap.

## Install the beta

The repository documents **[BRAT](https://tfthacker.com/BRAT)** as the beta installation path. The repository currently has the beta version line `0.5.x`; this README does not assert that a particular GitHub beta release is published or available to install.

1. Install [Obsidian](https://obsidian.md) **1.4.0 or newer** and open the vault for your journal.
2. In *Settings → Community plugins → Browse*, install and enable **BRAT**.
3. In *Settings → BRAT → Add beta plugin*, enter the repository URL `https://github.com/yamihugo/Tradebook` and add Tradebook.
4. Enable **Tradebook** in *Settings → Community plugins*.
5. Open **Home** from the Tradebook ribbon icon or the command palette.

For a specific beta tag, use BRAT's documented frozen/pinned-version option when that control is available in your installed BRAT version. The tag must have a published release. Manual installation and update steps are in the [Beta installation and update guide](docs/BETA-TESTING.md).

The plugin ID is `tradebook`. Manual installs use `.obsidian/plugins/tradebook/` and need `main.js`, `manifest.json` and `styles.css` from the same release; never replace `data.json` when updating.

## First steps

1. **Confirm the journal root.** The default root is `Tradebook`; trades are stored under `<root>/<year>/<month>/trades/` and screenshots under `<root>/<year>/attachments/`. See the important warning below before changing it.
2. **Create accounts** on the **Accounts** page using **Add account**. The first-run tour opens automatically for a new journal and can be reopened from *Settings → Advanced* or the command palette.
3. **Optionally name strategies.** Strategies are optional during setup; a trade can be recorded without one.
4. **Add or import a trade.** Use **Add Trade** to enter one manually, or import a supported Tradovate Orders/Fills CSV and explicitly choose its destination account.
5. **Complete Review.** Open a trade from a row in **Trade Log** (or from a trade list on an account page) to open **Trade Detail**. Review fields can be edited there; Home also has a queue for trades needing attention.

> [!warning] Journal root — changing it does not move notes
> Changing the configured journal root **does not move or delete existing notes**. If you already have a journal, select its actual current root. If the configured root points somewhere else, Tradebook may appear empty even though your notes remain in the vault. Do not choose a different root as a way to reorganize an existing journal.

## Requirements

- Obsidian **1.4.0+** (desktop or mobile; `isDesktopOnly: false`).
- No other plugins, no accounts, no internet access required.

## Data safety

- Updating the plugin **never touches `data.json`** — your settings and accounts survive every update.
- **Disabling** the plugin keeps `data.json`; re-enabling restores everything.
- **Uninstalling** deletes the plugin folder, including `data.json`. Back it up first using the plugin's **Export**.
- Your trades are plain Markdown notes in your vault — a plugin update never puts them at risk.

Before beta update testing, use *Settings → Advanced → Backup → Export everything* and keep a private copy of the vault as well if screenshots must be included. The Tradebook backup includes settings and trade notes; screenshots are separate files in the vault.

### Resetting preferences

The command named **Reset all settings** resets a defined subset of preferences: layouts, Trade Log view preferences, privacy mode, startup/tab behavior, date/time display preferences, and default symbol/quantity. It **does not delete trade notes or accounts**, and it does not reset every stored setting. It is not a factory reset.

Tradebook is fully local: it makes **no network requests** and sends **no telemetry**. Your trades, accounts and settings live only in your Obsidian vault.

## Features

- **Import Tradovate CSVs** — drop a file exported from Reports → *Executions/Fills* or *Orders* into the import view, or paste CSV directly in the *Add Trade* modal.
- **Automatic round-trip pairing** — fills are matched with FIFO inventory per account/symbol; realized P&L (in dollars) is computed on exit.
- **Account classification** — accounts are automatically split into **funded → eval → demo** using configurable keywords (Topstep/TDF/Apex etc.), editable in Settings.
- **Visual dashboard** — KPI cards, a cumulative P&L line chart, daily & hourly win/loss blocks, daily P&L calendar heatmap, symbol breakdown, and recent trades (click to open the note). Cards can be re-ordered, resized, and shown/hidden in edit mode.
- **Accounts** — create accounts from the Accounts page; each account has its own dashboard and user-configured rules.
- **Review** — the Home queue and Trade Log report decisions that still need attention; open a row to edit its Review fields in Trade Detail.
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
For beta installation, updates, backups and a safe bug-report template, see [`docs/BETA-TESTING.md`](docs/BETA-TESTING.md).

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
