# Roadmap

My first priority is making Tradebook reliable and comfortable to use every day.
This is the direction I want to take it, with room to adjust as people use it and share
feedback. Released changes are listed in the [changelog](CHANGELOG.md).

## Current priorities

- Fix bugs and UI issues reported through everyday use.
- Improve keyboard and mouse navigation across the core interface.
- Improve light mode.
- Add a first-run guide and contextual help.
- Polish interactions and lightweight animations.
- Optimize layouts and navigation for phones and tablets.
- Continue improving trade and account analysis where the available data supports it.

Smaller improvements may ship first, while larger changes need more development and
testing. The list is not a fixed release order, and there are no delivery dates yet.

## Future development

Once the core workflow is stable and the improvements above are in place, I want to
build out the strategy and review side of Tradebook. This is a larger phase of development
that will take time.

- **Strategy Tabs** — dedicated spaces for reviewing individual strategies.
- **Strategy Lab** — a space for exploring and testing strategies.
- **Missing Trades** — record setups you identified but did not take.
- Review templates tailored to each strategy.
- Improvements to psychology and behavioural review.

## Ideas under consideration

These are possibilities I may explore later. They are not committed features, and some
may never become part of Tradebook.

- Custom keyboard shortcuts.
- Optional visual themes.
- External bookmarks or sidebar links that open in your browser.
- Offline voice notes.

## Imports

Tradebook currently supports **Tradovate Orders, Fills and Cash History**.
See [import limitations](KNOWN-LIMITATIONS.md#import-formats) for the current scope.

Import improvements will be guided by reported issues and anonymized export samples.
Additional formats will only be listed as supported once their account information,
timestamps, trades and costs have been checked against real exports. Documentation alone
is not enough to confirm compatibility.

If you would like another format supported, [open an issue](https://github.com/yamihugo/Tradebook/issues)
with the platform and export type. Remove personal and account identifiers before
sharing any sample files.
