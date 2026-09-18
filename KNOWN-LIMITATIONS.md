# Known limitations

Tradebook is a **journal, not a prop firm**: it reports, it never enforces. Some of its
numbers are modelled rather than measured. This file lists what to know before filing a
bug — so a model is never mistaken for a mistake, and a rule we refuse to impose is never
mistaken for a missing feature.

## Modelled, not measured

- **Copy-trading legs are a model.** When an account copies another, each leg's size and
  P&L are derived from the base trade and the copy configuration (ratio, cross-order,
  rounding, time-stamped history). The broker platform is the source of truth; the
  journal is the record of it. Where the two disagree, the platform wins.
- **Commissions are simulated.** Contract commissions are estimated from the configured
  per-side rates rather than imported from the broker, so the resulting net P&L is an
  estimate.
- **Imports are a convenience.** CSV parsing targets Tradovate execution/order exports.
  Other formats are not supported, and malformed rows are skipped rather than guessed.

## Reporting, never enforcing

- The journal never blocks, refuses, limits or locks anything — no order blocking, no
  trade limits, no lockouts, no symbol blocks.
- Where a prop-firm limit is breached, the number reads as **breached**. Limiting is the
  platform's job; reporting is ours.

## Platform

- Everything stays local in your vault. The plugin makes no network requests and sends no
  telemetry.
- Tested on desktop and mobile (`isDesktopOnly: false`).
