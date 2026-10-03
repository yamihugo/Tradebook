<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/logo-white.png">
    <img alt="Tradebook" src="assets/readme/logo-dark.png" width="240">
  </picture>
  <h3>A local, private futures journal for Obsidian.</h3>
  <p>
    <a href="#what-you-get">What you get</a> &nbsp;·&nbsp;
    <a href="#install">Install</a> &nbsp;·&nbsp;
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

**Tradebook** is a free, open-source futures trading journal for Obsidian. Import your
trades, track your accounts and review your decisions. Your trades stay as Markdown notes
in your vault, with no Tradebook account, cloud service or telemetry.

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

## Install

Tradebook currently uses [BRAT](https://tfthacker.com/BRAT) for installation and updates
while its submission to the official Obsidian Community Plugins directory is under review.

### 1. Install Obsidian

Download [Obsidian](https://obsidian.md) **1.7.2 or newer** and open a vault. A new, empty
vault is fine. If you already use Obsidian, continue below.

### 2. Install BRAT

Open *Settings → Community plugins* and turn off **Restricted mode** if needed.
Select **Browse**, search for **BRAT**, then choose **Install** and **Enable**.

### 3. Add Tradebook

Open the command palette (`Ctrl/Cmd+P`) and run **BRAT: Add a beta plugin for testing**.
Paste this repository and confirm:

```
yamihugo/Tradebook
```

BRAT downloads the latest release.

### 4. Enable Tradebook

Turn on **Tradebook** in *Settings → Community plugins*. Its menu opens in Obsidian's
left sidebar. Use it to navigate between **Home**, **Accounts** and **Trade Log**, or to
add and import trades.

### Updating

BRAT can check for updates on startup, or you can run **BRAT: Check for updates**.
For a manual update, replace only `main.js`, `manifest.json` and `styles.css`;
keep your existing `data.json`.

### Troubleshooting

- **Tradebook is not listed:** try adding the repository through BRAT again.
- **The plugin does not load:** check that Obsidian is at least version 1.7.2,
  Restricted mode is off and Tradebook is enabled.
- **The sidebar is hidden:** expand Obsidian's left sidebar and select the Tradebook tab.

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
