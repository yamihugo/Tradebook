# Roadmap

**This is direction, not a promise.** Priorities can move as Tradebook is used in the
real world. This is a direction, not a delivery checklist. What has actually shipped lives
in the [CHANGELOG](CHANGELOG.md).

## Near term

- Light mode polish
- Mobile and tablet optimization
- Keyboard and mouse navigation across the core UI
- Fix real-world bugs and UX regressions found after 1.0
- Entry/exit time pickers
- Sort and group accounts by size
- Make scale-in / scale-out easier to inspect
- Saved Trade Log filter views

## Trading & analytics

- Drawdown / underwater curve
- Rolling averages
- Continue improving trade and account analysis where the journal has reliable data

## Strategies & review

- Missing Trades — setups identified but not taken
- Strategy Tabs
- Strategy Lab — isolated strategy exploration and testing
- Strategy-specific review templates
- Psychology and behavioural review improvements

## Workflow & personalization

- Custom keyboard shortcuts
- User-defined external bookmarks / sidebar links — these simply open a site in your
  default browser. Tradebook does not fetch, read or embed those sites.
- Lightweight animation and interaction polish
- Optional visual themes

## Onboarding & help

- First-run guide
- Contextual help mode

## Imports

- Additional broker export adapters beyond Tradovate

Each source is added on its own, and only counts as supported once its real export
format, account identity, timestamps, costs and regression behaviour have been verified
against real data. Tradebook is not a generic CSV importer.

## Longer-term exploration

- Offline voice notes

## Not planned

- **MAE/MFE without excursion data** — needs data the journal deliberately does not
  collect.
- **A separate mobile app** — Obsidian already runs on mobile.
- **Prop-firm enforcement** — this is a journal, not a firm. It reports; it never imposes.