# Changelog

All notable changes to Tradebook are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

Updates are published as [GitHub Releases](https://github.com/yamihugo/Tradebook/releases);
BRAT picks them up automatically.

## [Unreleased]

### Added

- **Accounts** — eval, funded and demo, with firm logos, their rules and limits, and copy groups.
- **Trades** — CSV import (Tradovate Orders/Fills) with FIFO fill pairing, and manual entry.
- **Trade Log** and a **Trade Detail** page, closed with a single **Reviewed** verdict.
- **Home** — net P&L curve, calendar heatmap, focus areas and a trading score.
- **Strategies** with per-strategy performance and setups.
- **Payouts and deposits**, tracked per account.
- **Psychology** — revenge-trading window and a tilt meter.
- **Backup** — export and import every journal note, with a pre-import settings snapshot.

### Notes

- Local-first: trades are plain Markdown notes in your vault — no account, no cloud, no telemetry.
- Known limitations are listed in [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md).
