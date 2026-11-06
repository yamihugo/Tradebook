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

### Currently supported

- **Tradovate Orders, Fills and Cash History** — the standard Tradovate exports.
  - **Orders**: `orderId`, `Account`, `B/S`, `Contract`, `Product`, `Status`, `Quantity`, `Type`, `Limit Price`, `Stop Price`, `Filled Qty`, `Avg Fill Price`, `Fill Time`, `Timestamp`
  - **Fills**: `Fill ID`, `Account`, `Symbol`, `Side`, `Quantity`, `Price`, `Commission`, `Fees`, `Fill Time`, `Order ID`
  - **Cash History**: platform's own line items with timestamps, amounts and descriptions

- **TradeSea orders export** — the checked orders export file
  - Must have the complete observed header: `Time, Symbol, Qty, Side, Order Type, Limit Price, Stop Price, Avg Price, Commission, Status`
  - No account column (the importer assigns "TradeSea" as the account label)
  - One TradeSea export per import batch
  - Commission is not applied; P&L is before costs
  - `EDT` is fixed UTC−04:00; numeric GMT/UTC offsets applied literally
  - Other alphabetic zone tokens and unconfirmed date layouts are refused

### How to export from supported platforms

**Tradovate** (web or desktop):
1. Open Tradovate → Reports → Orders / Fills / Cash History
2. Set the date range you want
3. Click **Export CSV** for each report type
4. In Tradebook, use **Import CSV** and select the files (Orders + Fills together, Cash History separately if available)

**TradeSea** (web):
1. Open TradeSea → Reports → Orders Export
2. Download the CSV
2. In Tradebook, use **Import CSV** and select the TradeSea file (one at a time)

### Not currently supported

- **Tradovate Performance Report** — it's a screen, not a ledger
- **Rithmic / NinjaTrader exports** — format not yet verified
- **Interactive Brokers Flex Queries / Activity Statements** — not yet implemented
- **Topstep / Earn2Trade / Gauntlet Mini / TFT / FTMO / Apex** — export formats not yet verified
- **Generic/arbitrary CSV** — no generic importer; each format must be verified

### Adding new formats

I'm actively researching additional prop firm and platform exports. Before listing a format as supported, I need:

1. Verified export format (orders, fills, cash history or equivalent)
2. Account information, timestamps, trades and costs structure
3. Real export samples tested against the importer

If you use a platform not listed above and can share an **anonymized export sample**, [open an issue](https://github.com/yamihugo/Tradebook/issues). That helps me understand the format and build proper support. Please remove personal and account identifiers before sharing any sample.

## Copy Trading

- **Reconciliation is yours to confirm.** It is on demand, never automatic: nothing is linked
  on your behalf, and a proposed link is re-validated before it is written.
- **Until a follower fill is linked, both records exist.** If you import the leader's
  generated copy history and the follower's actual fills before reconciling them, the
  journal temporarily holds — and counts — both, because it has no evidence that they are
  the same trade. Reconcile them and the generated model becomes history.
- **Deleting a base trade deletes the generated copier legs** it created. An actual broker
  fill is never removed.

## Manual executions and review

- Imported execution facts remain authoritative. Manual actual exits must close the full
  position; summaries are calculated from their fill records. Trade Detail adds no separate
  execution-correction form.
- Choose one strategy per trade. Older multiple assignments remain visible and unchanged
  until you resolve them; automatic Strategy completion waits for that single choice.
  An explicit reviewed or reopened marker retains its separate meaning.
- TP, SL and BE labels describe the executed result automatically, before costs: profitable,
  losing or flat. They do not claim an order type or a reason for closing. No manual exit-type
  classification is required. TP numbering skips BE and losing closes.
- A recorded trade-cost total may have no recorded split across fills. The execution
  total shows aggregate costs without allocating them. Account Correct fees adjustments
  reconcile account balance and remain separate from broker-recorded per-trade net.

## Print Queue

- Queue groups are organizational capture containers, not trades. A timestamp does not
  identify or attach a group to a trade; attach the group to the correct Trade Detail
  explicitly after the trade record exists. The queue does not interpret chart images.

## Times and timezones

- An imported timestamp with its own offset (`Z`, `±HH:MM`, a numeric TradeSea GMT/UTC
  offset, or the observed `EDT` token) is an **absolute instant**. TradeSea `EDT` is fixed
  UTC−04:00; numeric offsets are used as written. Other abbreviations are refused, not
  guessed. The source zone does not override an explicit offset; the instant is stored in UTC.
- TradeSea timestamps with more than three fractional-second digits are refused because the
  stored representation preserves milliseconds only; extra precision is never truncated.
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

- Trade notes and image attachments are stored in your vault. Settings and account
  configuration are stored in the plugin's `data.json`. Obsidian handles Community
  plugin update checks separately.
- Tradebook is **not desktop-only** (`isDesktopOnly: false`): it runs in Obsidian on mobile.
  Making it genuinely comfortable on a phone and a tablet — layout, targets, navigation — is
  roadmap work, not a claim of this release.

## Brand logos

- Prop-firm and broker names and logos belong to their owners. They are embedded here only
  to identify the firm an account trades with — no affiliation or endorsement is implied.
  If a logo is yours and you would rather it not appear, open an issue and it is removed.
