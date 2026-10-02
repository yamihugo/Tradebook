# Known limitations

Tradebook is a **journal, not a prop firm**: it reports, it never enforces. Some of its
numbers are modelled rather than measured. This file lists what to know before filing a
bug — so a model is never mistaken for a mistake, and a rule we refuse to impose is never
mistaken for a missing feature.

## Modelled, not measured

- **Copy-trading legs are a model.** When an account copies another, each leg's size and
  P&L are derived from the base trade and the copy configuration (ratio, cross-order,
  rounding, time-stamped history). The copy relationships and ratios are configuration you
  set in Tradebook — they are never inferred from a CSV. The broker platform is the source
  of truth; the journal is the record of it. Where the two disagree, the platform wins.
- **Actual broker evidence beats a model.** A reconciled follower fill becomes the authority
  for that leg; the generated model is kept as history and is left out of the canonical
  portfolio population and of the account-scoped money, balance and curve figures.
- **Costs come from the platform, not from us.** Commission and fees are read from Tradovate
  **Cash History** (the platform's own line items). A trade imported without that file has
  **no** cost line, and the journal says so rather than inventing one — so its net P&L
  there is the gross. Copy-trading legs carry no cost of their own: a copy is a different
  account's trade, so its leg is a model (see above).
- **A cost amount is real; its attribution can be an estimate.** The amounts in Cash History
  are the broker's own figures and Tradebook never changes them. What can be ambiguous is
  *which* trade or account a line belongs to, because the cash history does not always carry
  enough identity to say — most commonly when two accounts trade the same root within the
  same second. Where a line cannot be tied to one trade with certainty, the split falls back
  to the existing association behaviour and the figure is an estimate of the split, not of
  the amount. Unmatched lines are associated the same way, and any line that still cannot be
  attributed becomes a dated cost on the account instead of a guess.

## Import formats

- **Tradovate Orders, Fills and Cash History are the supported formats.** There is no
  generic arbitrary-CSV importer, and other brokers' exports are not supported. When a
  file cannot be recognised, Tradebook says so rather than guessing.
- **Tradovate's Performance Report is not supported.** It is a screen, not a ledger.
- **Support is verified against the project's canonical Tradovate export contract.** No
  anonymised real-world Tradovate exports are committed to the repository, so the formats
  are not yet confirmed against live broker files.

## Copy Trading

- **Reconciliation is yours to confirm.** It is on demand, never automatic: nothing is linked
  on your behalf, and a proposed link is re-validated before it is written.
- **Until a follower fill is linked, both records exist.** If you import the leader's
  generated copy history and the follower's actual fills before reconciling them, the
  journal temporarily holds — and counts — both, because it has no evidence that they are
  the same trade. Reconcile them and the generated model becomes history.
- **Deleting a base trade deletes the generated copier legs** it created. An actual broker
  fill is never removed.

## Times and timezones

- An imported timestamp that carries its own offset (`Z` or `±HH:MM`) is an **absolute
  instant**. No source zone is applied on top of it, and it is stored in canonical UTC form.
- A **naive** imported timestamp (no offset) is read only in the **source zone chosen for that
  import**. With no zone chosen, it is not resolved against your computer's clock — it is
  reported as carrying no zone.
- A naive timestamp that falls in a **DST gap** (the clock jumped forward) or in a
  **repeated hour** (the clock went back) has no single instant, so the row is **left out and
  counted in the import receipt** rather than rounded into a plausible time.
- Cost **attribution** is the remaining soft spot: a Cash History line whose timestamp is
  fractional or carries its own offset may not match a fill's stamp exactly. A line that
  cannot be tied to a trade is still logged against the account on its own date, rather than
  dropped or guessed.

## Reporting, never enforcing

- The journal never blocks, refuses, limits or locks anything — no order blocking, no
  trade limits, no lockouts, no symbol blocks.
- Where a prop-firm limit is breached, the number reads as **breached**. Limiting is the
  platform's job; reporting is ours.
- A breached or unknown value reads as breached or unknown. Tradebook never guesses an
  unknown cost, and never guesses an unknown historical drawdown state.

## Platform

- Everything stays local in your vault. The plugin makes no network requests and sends no
  telemetry.
- Tradebook is **not desktop-only** (`isDesktopOnly: false`): it runs in Obsidian on mobile.
  Making it genuinely comfortable on a phone and a tablet — layout, targets, navigation — is
  roadmap work, not a claim of this release.

## Brand logos

- Prop-firm and broker names and logos belong to their owners. They are embedded here only
  to identify the firm an account trades with — no affiliation or endorsement is implied.
  If a logo is yours and you would rather it not appear, open an issue and it is removed.