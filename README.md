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

## Requirements

- Obsidian **1.7.2 or newer** (desktop or mobile).
- No other plugins, no account and no internet connection required.

## Install

Tradebook is installed through [BRAT](https://tfthacker.com/BRAT), the community plugin that installs and updates beta plugins. The same steps work on desktop and mobile.

### 1. Install BRAT

Open *Settings → Community plugins*. If Restricted mode is on, turn it **off** first — Obsidian will not load any community plugin until you do. Then:

1. Select **Browse** and search for **BRAT**.
2. Select **Install**, then **Enable**.

### 2. Add Tradebook

Open the command palette (`Ctrl/Cmd+P`) and run **BRAT: Add a beta plugin for testing**. Paste this repository and confirm:

```
yamihugo/Tradebook
```

BRAT downloads the latest release. When it finishes, the plugin is listed in the community plugins.

### 3. Enable Tradebook

Still in *Settings → Community plugins*, find **Tradebook** and turn it on.

### 4. Open it

Run **Tradebook: Open Home** from the command palette. Your settings are stored in the plugin's `data.json`; your trades are written as plain Markdown notes under `_tradebook/` in your vault.

### Updating

- **Through BRAT:** run **BRAT: Check for updates** (or let it update on startup).
- **Manually:** replace only the three build files — `main.js`, `manifest.json`, `styles.css`.
- **Never** replace `data.json`: it holds your settings and accounts. Updating never touches your trades.

### If something goes wrong

- **Nothing loads:** make sure Restricted mode is off in *Settings → Community plugins*, then enable Tradebook.
- **Tradebook is missing from the list:** BRAT did not finish. Run **BRAT: Add a beta plugin for testing** again and check the console for errors.
- **The plugin does not load:** check that Obsidian is **1.7.2 or newer**.
- **Restore settings:** *Settings → Tradebook → Advanced → Import backup*, or **Restore previous settings** after an import.
- **Uninstalling deletes the plugin folder, including `data.json`.** Export a backup first from *Settings → Tradebook → Advanced → Export*.

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
