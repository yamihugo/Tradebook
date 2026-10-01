# Tradebook

A local trading journal for [Obsidian](https://obsidian.md), built for **futures
traders** (NQ, ES, MNQ, MES) with automatic demo / eval / funded / live account
organisation.

> **Status:** active development. Everything stays inside your vault: no cloud, no
> account, no subscription, no telemetry.

## Install the beta

[BRAT](https://tfthacker.com/BRAT) is the beta installation path.

1. Install [Obsidian](https://obsidian.md) **1.7.2 or newer** and open the vault for your
   journal.
2. In *Settings → Community plugins → Browse*, install and enable **BRAT**.
3. In *Settings → BRAT → Add beta plugin*, enter `https://github.com/yamihugo/Tradebook`
   and add Tradebook.
4. Enable **Tradebook** in *Settings → Community plugins*.
5. Open **Home** from the Tradebook ribbon icon or the command palette.

For a specific beta tag, use BRAT's frozen/pinned-version option.

### Manual installation

Download the release assets (`main.js`, `manifest.json`, `styles.css`) and copy them into
`<vault>/.obsidian/plugins/tradebook/`. The plugin folder name must be `tradebook` — the
plugin id. Then enable it in *Settings → Community plugins*. To update, replace the three
files from the newer release, and **never replace `data.json`**.

## First steps

1. **Confirm the journal root.** The default root is `Tradebook`; trades are stored under
   `<root>/<year>/<month>/trades/` and screenshots under `<root>/<year>/attachments/` (see
   the warning below before changing it).
2. **Create accounts** on the **Accounts** page with **Add account**.
3. **Optionally name strategies.** Strategies are optional; a trade can be recorded without
   one.
4. **Add or import a trade.** Use **Add Trade** to enter one manually, or import a supported
   Tradovate Orders/Fills CSV and choose its destination account.
5. **Complete Review.** Open a trade from a row in **Trade Log** (or an account's trade
   list) to open **Trade Detail**. Review fields are edited there; the Home has a queue for
   trades needing attention.

> [!warning] Changing the journal root does not move notes
> Changing the configured journal root **does not move or delete existing notes**. If you
> already have a journal, select its actual current root. If the root points elsewhere,
> Tradebook may look empty even though your notes are still in the vault. Do not change the
> root to reorganise an existing journal.

## Requirements

- Obsidian **1.7.2+** (desktop or mobile; `isDesktopOnly: false`).
- No other plugins, no account and no internet connection required.

## Data safety

- Updating the plugin **never touches `data.json`** — settings and accounts survive every
  update.
- **Disabling** the plugin keeps `data.json`; re-enabling restores everything.
- **Uninstalling** deletes the plugin folder, including `data.json`. Back it up first with
  the plugin's **Export**.
- Your trades are plain Markdown notes in your vault — a plugin update never puts them at
  risk.

Before testing an update, use *Settings → Advanced → Backup → Export everything*, and keep a
private copy of the vault too if screenshots must be included (the backup holds settings and
trade notes; prints are separate files in the vault).

### Resetting preferences

**Reset view & appearance** (Settings → Appearance → Reset) restores a defined subset:
layouts, Trade Log view preferences, privacy mode, startup/tab behaviour, date/time display,
and the default symbol and risk. It **does not delete trade notes or accounts**, and it is
not a factory reset.

## Report a bug

1. Note **what you did**, **what you expected**, and **what happened**.
2. Run the command **Copy diagnostics** (from the command palette) and paste the result
   alongside.
3. Open an issue on the repository, or post it in the beta channel.

## Features

- **Import Tradovate CSVs** — drop a file from Reports → *Orders* (or *Fills*) into the
  import view, or paste CSV directly in *Add Trade*.
- **Round-trip pairing** — fills are matched FIFO per account/symbol; realised P&L is
  computed on exit, and the broker's stops and targets are read from the export.
- **Account classification** — accounts are split into **funded → eval → demo** using
  configurable keywords, editable in Settings.
- **Visual dashboard** — KPI cards, a cumulative P&L chart, a P&L calendar heatmap, a
  symbol/strategy breakdown, a Trading Score and a review queue. Cards can be reordered,
  resized and shown/hidden in edit mode.
- **Accounts** — create accounts from the Accounts page; each has its own dashboard and
  rules.
- **Review** — one word closes a decision (**Reviewed**). The Home queue and Trade Log
  report what still needs attention.
- **One Markdown note per trade** with a small table and `## Notes` / `## Screenshots`
  sections ready for your workflow.
- **Mobile-ready** — layouts and tables scroll gracefully on phones.

## Tick values

| Symbol | $ / point |
| ------ | --------- |
| NQ     | $20       |
| ES     | $50       |
| MNQ    | $2        |
| MES    | $5        |

The importer knows a curated set of six instruments (Nasdaq, S&P 500, Gold, Crude Oil,
Silver, Russell), each with its mini and micro contract.

## Account classification

Rules are evaluated in order (first match wins); keywords are editable in Settings:

- **funded** — `FUNDED, FUND, LIVE, REAL, PAID, PASSED, CERTIFIED`
- **eval** — `EVAL, EVALUATION, COMBINE, FUNDING, CHALLENGE, PROP, TOPSTEP, TDF, T4X, APEX,
  TAKEPRO`
- **demo** — `DEMO, SIM, SIMULATED, PAPER, TRAINING, PRACTICE` (pure numeric account names
  default to demo)

Unknown accounts show as `other` so nothing is silently mislabelled.

## Development

```
npm install
npm run build          # tsc --noEmit + esbuild production -> main.js
```

`main.js`, `manifest.json` and `styles.css` are emitted into the project root — copy them
into `<vault>/.obsidian/plugins/tradebook/`. Firm logos are embedded in `main.js`, so there
is no `assets/` folder to copy.

See `KNOWN-LIMITATIONS.md` for what is deliberately modelled rather than measured.

## Support

If Tradebook helps your trading, you're welcome to support it —
[Buy me a coffee](https://www.buymeacoffee.com/yamihugo) ·
[Ko-fi](https://ko-fi.com/yamihugo). Donations open in your browser; the plugin itself
needs no internet connection and sends nothing.

## License

MIT — see [LICENSE](LICENSE).

Prop-firm and broker names and logos belong to their owners and are shown only to identify
the firm an account trades with.
