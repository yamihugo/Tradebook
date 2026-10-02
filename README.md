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
    <a href="ROADMAP.md">Roadmap</a> &nbsp;·&nbsp;
    <a href="#support">Support</a>
  </p>
</div>

<p align="center">
  <a href="https://github.com/yamihugo/Tradebook"><img src="https://img.shields.io/github/stars/yamihugo/Tradebook?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3fb950?style=flat-square" alt="License: MIT"></a>
</p>

<div align="center">
  <img src="assets/readme/01-home.png" alt="Tradebook Home" width="860">
</div>

**Tradebook** records what you actually did. Your trades are plain Markdown notes in your
vault — there is no Tradebook account, no cloud service and no telemetry. It reports your
numbers; it never blocks a trade, imposes a rule or holds anything back.

## What you get

### Understand your trading

- A **Briefing** (Home) that opens on the state of your trading rather than a wall of
  widgets: Net Trading P&L, the equity curve, a performance calendar, breakdowns by day,
  setup, session and symbol, and a Trading Score built from your review.
- **Net Trading P&L** is the headline. Costs the broker reported are already inside it;
  anything the journal could not measure says so instead of reading as zero.

### Keep a real trading record

- A **Trade Log** for the whole ledger, and a **Trade Detail** page per trade.
- **Manual Trade** for anything you did not import, with the same fields and the same rules
  as an imported trade.
- **Setups, notes and review** live on the trade itself, so the record and the thinking stay
  together. One word marks a trade **Reviewed**.
- **Fills** are kept where the source records them, so a scaled entry can be inspected.

### Track accounts properly

- **Eval, funded and demo accounts** with firm logos, and their real rules and limits.
- A **tracking boundary** with a declared opening value: trades and cash movements from
  before it stay in your journal, and stay out of tracked performance calculations. An account with no
  tracked data reads "—", never a misleading zero.
- **Deposits, payouts and corrections are tracked per account and always reported apart
  from trading P&L.** Money leaving is not a loss.

### Copy Trading

- Copy groups are **explicit configuration**: you declare the leader and the copiers, each
  with its own ratio and start date. Nothing is ever inferred from a file.
- A generated leg is a **model** of what the follower would have done, and is labelled as
  one. Real broker evidence is authoritative.
- **Reconciliation is on demand**: when a follower's own fill exists, you confirm the link
  yourself, the actual wins, and the generated model is kept as history.

### Import Tradovate

Tradovate is the broker this release supports.

- **Orders** and **Fills** exports are read, and **Fills are paired FIFO**.
- **Cash History** supplies the real commission and fees the broker charged.
- **Broker stops and targets** are read from the export where it carries them.
- **Deterministic identity** — the same export produces the same trades, so re-running an
  import skips what already landed instead of duplicating it.
- **Multi-account handling**: one import can span several broker accounts, and each row
  belongs to the account it came from.
- **A preview before Import.** Account mapping, time, costs and the trades themselves are
  all answered before anything is written to your vault.

### Local by design

- Your trades are Markdown in your vault. The plugin makes no network requests and sends no
  telemetry; it needs no account and no internet connection.

## Install

Tradebook is a plugin for [Obsidian](https://obsidian.md), installed and kept up to date
through [BRAT](https://tfthacker.com/BRAT). It is not desktop-only, needs no account, and
works offline.

If you don't use Obsidian yet, start at step 1. If you already do, skip to step 2.

### 1. Install Obsidian

Download Obsidian **1.7.2 or newer** from [obsidian.md](https://obsidian.md) and open a vault — a new, empty vault is fine.

### 2. Install BRAT

Open *Settings → Community plugins*. If **Restricted mode** is on, turn it off first; Obsidian loads no community plugin until you do. Then select **Browse**, search for **BRAT**, and choose **Install**, then **Enable**.

### 3. Add Tradebook

Open the command palette (`Ctrl/Cmd+P`) and run **BRAT: Add a beta plugin for testing**. Paste this repository and confirm:

```
yamihugo/Tradebook
```

BRAT downloads the latest release and lists the plugin for you.

### 4. Enable and open

Back in *Settings → Community plugins*, turn on **Tradebook**. Open it from the ribbon icons or the command palette:

| Command | What it opens |
| --- | --- |
| `Tradebook: Open Home` | Your briefing — P&L curve, calendar, score |
| `Tradebook: Open Accounts` | Account cards and dashboards |
| `Tradebook: Open Trade Log` | The full trade ledger |
| `Tradebook: Manual Trade` | Log a trade by hand |
| `Tradebook: Import trades from CSV` | Import a Tradovate export |

### Updating

- **Through BRAT:** run **BRAT: Check for updates**, or let BRAT update on startup.
- **Manually:** replace only `main.js`, `manifest.json` and `styles.css`.
- **Never** replace `data.json`. It holds your settings and accounts, and updating never touches your trades.

### Troubleshooting

- **Nothing loads:** confirm **Restricted mode** is off, then enable Tradebook.
- **Tradebook is not listed:** BRAT didn't finish. Run **BRAT: Add a beta plugin for testing** again and check the developer console.
- **The plugin doesn't load:** check Obsidian is **1.7.2 or newer**.
- **Restore your settings:** *Settings → Tradebook → Advanced → Import backup*, or **Restore previous settings** after an import.
- **Uninstalling deletes the plugin folder, including `data.json`.** Export a backup first from *Settings → Tradebook → Advanced → Export*.

## Getting started

1. **Add an account.** Open **Tradebook: Open Accounts** and choose **Add account**. Pick the
   type (eval, funded or demo), the firm, and its rules and limits.
2. **Bring in your trades.** Run **Tradebook: Import trades from CSV** with your Tradovate
   Orders/Fills (and Cash History, if you want the real costs), or run **Tradebook: Manual
   Trade** and log one by hand. Read the preview, then import — each trade becomes a Markdown
   note under `<year>/<month>/trades/`.
3. **Review what you did.** Open the **Trade Log**, open a trade and mark it **Reviewed**.
4. **Read Home.** The Briefing shows where your trading stands, and what is worth your
   attention next.

## Data and privacy

- Your trades are plain Markdown notes in your vault. Updating the plugin never touches them, and never touches `data.json`.
- Disabling the plugin keeps `data.json`; re-enabling restores everything.
- Uninstalling deletes the plugin folder, including `data.json` — export a backup first.

## Known limitations

Some numbers are modelled rather than measured (copy-trading legs; costs the broker never
reported), and some costs cannot be tied to one trade with certainty. Read
[KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) before you file a bug — it exists so a model is
never mistaken for a mistake.

## Support

If Tradebook helps your trading, you're welcome to support it.

<p align="center">
  <a href="https://www.buymeacoffee.com/yamihugo"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="40"></a>
  <a href="https://ko-fi.com/yamihugo"><img src="https://storage.ko-fi.com/cdn/kofi3.png?v=3" alt="Ko-fi" height="40"></a>
</p>

<div align="center">
  <a href="https://star-history.com/#yamihugo/Tradebook&Date">
    <img src="https://api.star-history.com/svg?repos=yamihugo/Tradebook&type=Date" alt="Star History Chart" width="600">
  </a>
</div>

## License

MIT — see [LICENSE](LICENSE).

Prop-firm and broker names and logos belong to their owners and are shown only to identify the firm an account trades with.
