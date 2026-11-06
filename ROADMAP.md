# Roadmap

My first priority is making Tradebook reliable and comfortable to use every day. I want to keep improving the parts people already use, while leaving room to adjust as issues and feedback come in.

This page explains the direction. The [changelog](CHANGELOG.md) records the changes for each version.

## What I'm focusing on

- Fixing bugs and UI issues found during everyday use.
- Making keyboard and mouse navigation easier across the main screens.
- Improving light mode.
- Adding a first-run guide and help where it's needed.
- Tidying up interactions and lightweight animations.
- Making layouts and navigation more comfortable on phones and tablets.
- Improving trade and account analysis where the available data supports it.

Some of these changes are small; others need more development and testing. I haven't set delivery dates or a fixed release order.

## Further strategy and review work

Once the core workflow is more settled, I want to spend more time on the strategy and review side of Tradebook. The plans include:

- **Strategy Tabs:** dedicated spaces for reviewing individual strategies.
- **Strategy Lab:** a space for exploring and testing strategies.
- **Missing Trades:** a way to record setups you identified but didn't take.
- Review templates tailored to each strategy.
- Improvements to psychology and behavioural review.

These are plans for later work, not features I'm claiming are ready now.

## Ideas I'm considering

I may explore these too, but they aren't committed features. Some may never become part of Tradebook.

- Custom keyboard shortcuts.
- Optional visual themes.
- External bookmarks or sidebar links that open in your browser.
- Offline voice notes.

## Imports

Tradebook currently supports **Tradovate Orders, Fills and Cash History**, and the **TradeSea orders export**. The [import limitations](KNOWN-LIMITATIONS.md#import-formats) explain what those imports cover.

I'll use reported issues and anonymized export samples to guide further import work. Before listing another format as supported, its account information, timestamps, trades and costs need to be checked against real exports. Documentation alone isn't enough to confirm that it works.

If you'd like another format supported, [open an issue](https://github.com/yamihugo/Tradebook/issues) with the platform and export type. Please remove personal and account identifiers before sharing a sample.
