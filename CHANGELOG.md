# Changelog

I keep the changes for each Tradebook release here.

To update, open Obsidian's Settings → Community plugins, check for updates and update Tradebook. Back up your vault before updating.

## [1.1.0] - 2026-11-06

This update focuses on collecting screenshots, recording trades and reviewing them afterwards.

### Added

- Print Queue: collect chart screenshots in saved groups, then attach them to the matching trade in Trade Detail. You can capture charts during the session even if you haven't added or imported the trade yet.
- Per Trade Review: review each trade with reflection fields, strategy selection and a self-rating. Review status can follow the review checklist, or you can mark a trade as reviewed manually.
- Multiple exits for manual trades: record each partial exit with its own contract quantity, price and time. Tradebook calculates the weighted totals from the recorded fills and labels exits as TP, SL or BE automatically.

### Improved

- Trade Log: filter by strategy and review status, search reflection text and select trades from the current view.
- Deletion preview: see which generated copies will be removed when deleting a base trade. Separately imported actual fills are not removed with those copies.
- Getting started: updated the README with clearer instructions and a link to the walkthrough video.

### Fixed

- Invalid execution numbers are rejected instead of being converted into misleading prices, quantities or results.
- TradeSea imports recognise supported headers regardless of capitalisation.
- Import checks retain the existing symbol, P&L and timestamp protections. TradeSea imports remain limited to one export per batch, and unsupported date or timezone formats are rejected rather than guessed.
- Order text containing quotes or backslashes is saved correctly in trade notes.
- Valid zero entry and exit prices display as `0` instead of appearing missing.
- Execution summaries stay based on actual fills. Imported execution details remain read-only.
- Strategy selection saves and clears consistently. Existing trades with multiple strategy assignments keep those assignments visible until you choose one.
- Home's missing-information checks and automatic review status use consistent strategy and self-rating validation.
- Recorded fees and net P&L refresh after saving. Aggregate costs stay separate from account balance corrections.
- Review text, typing focus and scroll position are preserved during refresh.
- Dropdown positioning now uses Obsidian's supported styling helper.
