# Changelog

All notable changes to Tradebook are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

Updates are published as [GitHub Releases](https://github.com/yamihugo/Tradebook/releases);
BRAT picks them up automatically.

## [1.0.1] - 2026-10-04

Review fixes only. No intentional product or data-format change.

### Fixed

- Obsidian review findings: Home metric slots now use `aria-labelledby`, Settings
  headings use `Setting.setHeading`, and static style assignments use `setCssStyles`.
- Stylesheet: redundant `!important` overrides and dead rules removed.
- Type safety: selected plugin boundaries now use explicit Obsidian and domain types,
  with runtime guards where host data can be incomplete.

### Notes

- Minimum Obsidian version unchanged: 1.7.2.
- Remaining lint warnings are tracked as follow-up work; `npm run lint` reports 0 errors.

## [1.0.0] - 2026-10-02

The first stable release. Tradebook 1.0.0 is the baseline everything else builds on: a journal
that records what you traded, reports the numbers honestly, and stays entirely inside your
vault. It is a stable foundation rather than a finished product — the work continues, and so
does the roadmap.

### Added

- **Tradovate import** — Orders, Fills and Cash History. Fills are paired FIFO, the
  broker's stops and targets are read from the export where it carries them, and costs come
  from Cash History. The import runs in three stages — files, review, import — so account
  mapping, time, costs and the trades themselves are all answered before anything is written.
- **Copy Trading** — trading groups you configure explicitly, with a leader, copiers, and a
  per-copier ratio and start date. A generated leg is labelled as the model it is; real
  broker evidence is authoritative. When a follower's own fill exists, you can **reconcile**
  the two yourself: the actual wins and the generated model is kept as history. Nothing is
  ever discovered from a file.
- **Account tracking and historical context** — a tracking boundary with a declared opening
  value, so trades and cash movements from before it stay in your journal and out of your
  calculated figures. An account with no tracked data reads "—", never a misleading zero.
- **Payouts, deposits and account movements** — tracked per account, and always reported
  apart from trading P&L. Money leaving is not a loss.

### Improved

- **Deterministic import identity** — the same export produces the same trades, and one
  import can span several broker accounts. Re-running an import skips what already landed
  instead of duplicating it, and the receipt reports what was detected, assigned, written and
  left out as four separate numbers.
- **Import preselects copiers you already configured** — a starting default from your own
  Trading Group, not a relationship discovered in the CSV. Untick anything, and nothing is
  generated or written until you press Import.
- **Manual Trade correctness** — no assumed contract, no derived stop without a priced
  symbol, and no hidden $/point on an empty one.
- **Briefing and analytics correctness** — Net P&L, trade count, Win Rate, Net Profit Factor,
  Expectancy and the cumulative curve all read the same population of closed trades, and an
  account with no tracked data reads unavailable rather than zero.
- **Trade Log, navigation and Settings** — stable column geometry, a filter drawer that says
  how much is tracked, calmer controls, a dedicated Imports page and clearer account settings.

### Fixed

- **Superseded reconstructed models are excluded from the canonical portfolio financial
  population and from the account-scoped money, balance and curve populations**. When a real
  broker fill supersedes a generated model, reconciliation keeps the model in the ledger as
  history. (Deleting a base trade is different: that removes its generated copier legs with
  it.)
- **Reported history is display-only context.** It never reaches a calculated figure, and a
  field the journal does not have is not shown as zero.
- Copy configuration is temporal: a leg uses the ratio and start that applied on its day.

### Notes

- Local-first: trades are plain Markdown notes in your vault — no account, no cloud, no
  telemetry. Tradebook is a journal, not a prop firm: it reports, it never imposes.
- Known limitations are listed in [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md).