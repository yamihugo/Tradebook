<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/readme/logo-white.png">
    <img alt="Tradebook" src="assets/readme/logo-dark.png" width="240">
  </picture>
  <h3>A local, private futures journal for Obsidian.</h3>
  <p>
    <a href="#features">Features</a> &nbsp;·&nbsp;
    <a href="#install">Install</a> &nbsp;·&nbsp;
    <a href="#support">Support</a>
  </p>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/Obsidian-1.7.2%2B-8b6cff?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian 1.7.2+">
  <a href="https://tfthacker.com/BRAT"><img src="https://img.shields.io/badge/install%20with-BRAT-ff7a59?style=flat-square" alt="Install with BRAT"></a>
  <img src="https://img.shields.io/github/downloads/yamihugo/Tradebook/total?style=flat-square" alt="Downloads">
  <img src="https://img.shields.io/badge/license-MIT-3fb950?style=flat-square" alt="License: MIT">
</p>

<div align="center">
  <img src="assets/readme/01-home.png" alt="Tradebook Home" width="860">
</div>

**Tradebook** records what you actually did. Your trades are plain Markdown notes in your vault — no account, no cloud, no telemetry. It reports the numbers; it never blocks a trade, imposes a rule or holds anything back.

## Features

- **Import your broker's CSV** — Tradovate Orders/Fills; fills are paired FIFO and the broker's stops and targets are read from the export.
- **Accounts that mean something** — eval · funded · demo, with firm logos, their real rules and limits, and copy groups.
- **A ledger you can review** — the Trade Log and a Trade Detail page; one word closes a decision (**Reviewed**).
- **A Home that reads your trading** — net P&L curve, calendar heatmap, focus areas and a trading score.
- **Local and private** — Markdown in your vault; nothing leaves your computer, no internet connection required.

<div align="center">
  <img src="assets/readme/02-trade-log.png" alt="Trade Log" width="780">
</div>

## Install

### Via BRAT

1. Install the [BRAT](https://tfthacker.com/BRAT) community plugin.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Paste the repository: `yamihugo/Tradebook`.
4. Enable **Tradebook** in *Settings → Community plugins*.

> On update, replace the three files (`main.js`, `manifest.json`, `styles.css`). **Never replace `data.json`** — it holds your settings and accounts.

<div align="center">
  <img src="assets/readme/03-account-cards.png" alt="Accounts" width="780">
</div>

## Requirements

- Obsidian **1.7.2 or newer** (desktop or mobile).
- No other plugins, no account and no internet connection required.

## Data and privacy

- Your trades are plain Markdown notes in your vault. Updating the plugin never touches them, and never touches `data.json`.
- Disabling the plugin keeps `data.json`; re-enabling restores everything.
- Uninstalling deletes the plugin folder, including `data.json` — export a backup first.

## Known limitations

Some numbers are modelled rather than measured (copy-trading legs; costs the broker never reported). See [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md).

## Support

If Tradebook helps your trading, you're welcome to support it.

<p align="center">
  <a href="https://www.buymeacoffee.com/yamihugo"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="40"></a>
  <a href="https://ko-fi.com/yamihugo"><img src="https://storage.ko-fi.com/cdn/kofi3.png?v=3" alt="Ko-fi" height="40"></a>
</p>

## License

MIT — see [LICENSE](LICENSE).

Prop-firm and broker names and logos belong to their owners and are shown only to identify the firm an account trades with.
