<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/logo-white.png">
    <img alt="Tradebook" src="assets/readme/logo-dark.png" width="240">
  </picture>
  <h3>A local, private futures journal for Obsidian.</h3>
  <p>
    <a href="#what-you-get">What you get</a> &nbsp;·&nbsp;
    <a href="#installation">Installation</a> &nbsp;·&nbsp;
    <a href="#getting-started">Getting started</a> &nbsp;·&nbsp;
    <a href="ROADMAP.md">Roadmap</a>
  </p>
</div>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3fb950?style=flat-square" alt="License: MIT"></a>
</p>

<div align="center">
  <img src="assets/readme/01-home.png" alt="Tradebook Home" width="860">
</div>

**Tradebook** is a local-first futures trading journal for Obsidian. Import trades, track
accounts and payouts, review performance, and understand the decisions behind your results —
with your data kept in your vault. Trades stay as Markdown notes: no Tradebook account, no
cloud service, no telemetry.

## What you get

### Understand your trading

- **Home** brings together Net Trading P&L, an equity curve, a performance calendar,
  breakdowns and a Trading Score.
- Explore results by setup, session, symbol and day, then open the trades behind them.
- Reported commissions and fees are included in Net Trading P&L. Missing cost data is
  identified so you can see when a result is incomplete.

### Keep a trading record

- Browse your **Trade Log** and open any trade to inspect its details.
- Add trades manually or import them from a supported export.
- Keep setups, notes and screenshots alongside each trade, then mark it **Reviewed**.
- Inspect individual fills when they are available in the source.

### Track your accounts

- Manage **eval, funded and demo accounts**, with their firms, rules and limits.
- Choose when tracking begins and set an opening value. Earlier records stay in your
  journal without affecting performance tracked from that point.
- Track deposits, payouts and corrections separately from trading P&L.

### Record Copy Trading

- Define the leader and follower accounts, with a ratio and start date for each follower.
- Generated follower trades are labelled as models of what the follower would have done.
- When you import a follower's actual fills, you can confirm the matching records.
  The actual fills then take precedence, while the generated model stays in the history.

### Import Tradovate

The supported formats are **Tradovate Orders, Fills and Cash History**.

- Import trades across multiple accounts and check the account mapping before saving.
- Include Cash History to bring in reported commissions and fees.
- Read stops and targets where the export provides them.
- Reimport the same export without duplicating trades already imported.
- Review the trades, timestamps and costs in a preview before writing anything to your vault.

Other export formats are not currently supported. See [import limitations](KNOWN-LIMITATIONS.md#import-formats)
and the [import roadmap](ROADMAP.md#imports) for more detail.

## Installation

Tradebook requires **Obsidian 1.7.2 or newer**. If you do not use Obsidian yet, download it
from [obsidian.md](https://obsidian.md) and open a vault — a new, empty vault is fine. If you
already use Obsidian, continue below.

### Install from Community Plugins

1. Open Obsidian Settings.
2. Go to Community plugins and select Browse.
3. Search for Tradebook.
4. Select Install, then Enable.

Tradebook's menu opens in Obsidian's left sidebar. Use it to move between **Home**,
**Accounts** and **Trade Log**, or to add and import trades.

### Install with BRAT

BRAT is an alternative for installing a specific GitHub release or testing versions before
they are available through Community Plugins. It is **not** required for a normal
installation.

1. Install the [BRAT](https://tfthacker.com/BRAT) plugin.
2. Open BRAT settings.
3. Select Add Beta plugin.
4. Enter `yamihugo/Tradebook`.
5. Select the desired release and enable Tradebook.

### Updating

Obsidian checks for Community plugin updates. To update manually, use
*Settings → Community plugins → Check for updates*. If you installed with BRAT, run
**BRAT: Check for updates**.

A manual update replaces only `main.js`, `manifest.json` and `styles.css`; keep your
existing `data.json`.

### Troubleshooting

- **Tradebook is not listed:** check that Restricted mode is off, then Browse and search
  for it again. If you installed with BRAT, add the repository once more.
- **The plugin does not load:** check that Obsidian is at least version 1.7.2, Restricted
  mode is off and Tradebook is enabled.
- **The sidebar is hidden:** expand Obsidian's left sidebar and select the Tradebook tab.

### On mobile

Tradebook can run in Obsidian on mobile, but phone and tablet layouts still need work.
Mobile optimization is on the [roadmap](ROADMAP.md).

## Getting started

1. **Add an account.** Choose **Accounts** in the Tradebook sidebar, then **Add account**.
   Select its type, firm, rules and limits.
2. **Bring in your trades.** Choose **Import CSV** for Tradovate Orders/Fills and, when
   available, Cash History. Check the preview before importing. You can also choose
   **Manual Trade** to add a trade yourself.
3. **Review a trade.** Open it from the **Trade Log**, add your notes and mark it **Reviewed**.
4. **Visit Home.** Review your results and explore the trades behind them.

## Your data and backups

Tradebook works locally and makes no network requests. Your trade notes remain in your
vault when you disable or uninstall the plugin.

Settings and account configuration are stored in the plugin's `data.json`. Disabling
the plugin preserves that file; uninstalling removes the plugin folder, including it.

Before uninstalling, export a settings backup from *Settings → Tradebook → Advanced → Export*.
Use **Import backup** in the same section to restore it. Keep a separate backup of your
vault for the trade notes and attachments.

## Known limitations

Generated copy trades are models, and reported costs cannot always be assigned to an
individual trade with certainty. [Known limitations](KNOWN-LIMITATIONS.md) explains
how these cases, missing data and import formats are handled.

If something is not working as expected, [open an issue](https://github.com/yamihugo/Tradebook/issues)
with what happened and the steps to reproduce it. Please remove personal and account
information from screenshots or sample files.

## License

MIT — see [LICENSE](LICENSE).

Prop-firm and broker names and logos belong to their owners and are used to identify
accounts. Their inclusion does not imply affiliation or endorsement.
