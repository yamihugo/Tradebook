# Tradebook — Roadmap / Ideas

Ideas registered for later. Nothing here is built unless marked ✅.

---

## 🧪 Setups → Strategies (agreed vision)
- **Setup** = mechanical label (works now, free; powers a simple Setup Performance).
- **Strategy** = full rule set: instruments, **fixed stop** (e.g. NQ 10pts, ES 4pts),
  target, size. Selecting a strategy in **Add Trade auto-fills** stop/target/size.
- A dedicated **Strategies tab**: register your strategies + a **strategy tester
  (sandbox)** where backtest trades are isolated and don't affect dashboard stats.
- "Nobody trades at random" — selecting setup + strategy on every trade is the norm.

## 🏢 Accounts (agreed — hybrid templates)
- Phase-1 firms: **Apex · Topstep · Tradeify · MyFundedFutures**.
- **Hybrid model:** ship our templates per firm (prefill the create form), but the
  account's rules are **copied into the user's data** — firm changes never touch
  existing accounts. Presets are a convenience seed, not the source of truth.
- **Every value must be user-editable** (avoids unnecessary template updates).
- Users can also create fully manual accounts and save their own templates.
- **No billing field** in v1 (privacy) — keep it reserved in the model.
- Distinguish **live (personal money)** vs **live (prop firm)**; `ownership`.
- Account groups: leader + followers + multiplier (also serves portfolio view).

## 💡 Help / Tooltip Mode (NEW — registered 2026-09-13)

**Idea:** a tiny **lightbulb** button in the header (top-right, above Filters / Edit).
When enabled ("help mode"), every widget that needs it shows a **small lightbulb**.
Clicking it opens a **mini popover** explaining what that widget/metric means.

**Only for non-obvious things** — e.g.:

- ✅ Sharpe Ratio — "return per unit of risk; how consistent your results are"
- ✅ Cumulative P&L — "your equity curve over the selected period"
- ✅ Best Hour / Worst Hour — "your most (least) profitable hour in the timeframe"
- ✅ Avg RR (Payoff) — "average win ÷ average loss"
- ✅ Profit Factor — "gross profit ÷ gross loss"
- ✅ Expectancy — "average expected result per trade"
- ❌ Win Rate / Total Trades / Largest Win — too obvious, no tooltip

**Design (proposed):**
- `helpMode` flag on the view (persisted in settings so it survives reloads).
- Header button toggles it; each **explainable widget** renders a small lightbulb
  (top-left corner of the widget) when `helpMode` is on.
- Clicking a lightbulb → small popover with title + 1–2 sentence explanation.
- Copy lives in a single `HELP` map (id → text) so it's easy to translate/edit.
- Non-explainable widgets simply don't get a lightbulb.

**Status:** registered, not built. Low risk, self-contained, good candidate for a
quick win once the widget set is settled.

---

## 🧩 Dashboard Templates (registered 2026-09-13)
- A small **dropdown of templates** in the dashboard.
- Users can build a layout, save it as a template (name it), and reload it later.
- We ship a few **built-in templates** (e.g. "Minimal", "Full", "Prop Focus").
- **Do this AFTER the widgets are settled** and reviewed.

## 📈 Drawdown widget (agreed)
- **One** underwater-curve widget (not long/short split). Useful for eval/funded.

## 🔁 Rolling average (agreed, phase 2)
- One "Rolling" widget with a window selector (10 / 20 / 30 / 50 trades):
  rolling win rate and/or rolling avg win/loss.

## 🧪 Setup / Strategy performance (agreed — after Setups + Strategies)
- A "Setup Performance" widget ranking setups by P&L / win rate / expectancy.
- Depends on finishing the **Setups → Strategies** work (with backtest sandbox).

## 🗂️ Trade Review widget (foundation already built)
- Visual widget on top of the existing `reviewStatus` engine:
  "X trade(s) need review · Y this week", with a queue.

## 🎯 Trading Score (game-like)
- Composite score (risk discipline, plan adherence, review completion, consistency).
- Builds on the Review System + rating + (future) stop-loss field.

## 🎬 Animations (partially done)
- Metric count-up/down: **done** (1.2s, easeOutCubic, respects reduced-motion).
- Cumulative P&L morph on data change: **done** (700ms).
- Global setting **Settings → Appearance → Animations** (on/off): **done**.
- **TODO (registered):** separate the animation engine into its own module and add
  **per-animation toggles** (count-up, chart morph, header fade, calendar) so users
  can disable individual animations — not just all-or-nothing.

## 💰 Accounts + Payouts (separate workstream)
- Accounts page (eval → funded), balance / % / CAGR, profit-target widget.
- Payouts page (with a calendar), linked to accounts.

## 🔢 R-multiples / Risk-based RR
- Needs a **Stop Loss** field per trade (or supplied automatically by a Strategy).

## 🎨 Visual identity — "minimal / calm · premium / sophisticated" (NEW direction)
Goal: stop mirroring Journalit's layout order. Add **our own graphical elements**
(TradeZella-inspired but calmer) and a distinctive **order/structure**.

### Differentiators to build (TradeZella-inspired)
- **Hero row (3 wide cards)**: big Total Net P&L + micro sparkline · Profit Factor ·
  Avg Winning vs Avg Losing Trade (compact diverging bar). — replaces the flat 8×3 metric strip as the top.
- **Donut rings**: "Winning % by Trades" and "Winning % by Days" (ring + legend with
  winners/losers counts). Premium look, not a number.
- **Half-arc gauges**: Winrate (%) and Avg Win/Avg Loss ratio (blue/red arcs) — like the
  reference image with 55.88% + 0.92.
- **Winstreak widget**: current streak with **Days** and **Trades** columns + best/worst
  badges (e.g. 4W / 3L).
- **Duration summary table** (⏱ **keep the idea**): buckets (Under 1m, 1:00–1:59,
  2:00–4:59, 5:00–9:59, 10–29m, 30–59m, 1h+) × columns Net Profits · Winning % (diverging
  bar) · Total Profits. → also useful **per strategy** to see how performance depends on
  **trade duration**.
- **Hourly table**: P&L / win% by hour (dense, premium).
- **Cumulative chart toggle**: `Cumulative P&L | Net Daily P&L` (two views).
- **Bar-based metric variety**: some KPIs rendered as ratio bars/dots instead of plain text.

### Structure change (differentiate from Journalit)
- Greeting + subtitle left; period control right (keep).
- Hero row → then a **mixed bento**: rings/gauges next to the calendar, chart wide below,
  breakdowns in a compact two-column block (no more "everything same order as Journalit").
- Introduce a **section label system** (small caps + accent tick) to give rhythm.

## 🧠 Psychology & Discipline module (V2) — specification

Future vision (not built). Covers pre-session
readiness check-in, tilt-continuum detection (trade cadence / revenge loop), cognitive
bias metrics (hold-time ratio, break-even trap), process scoring (Execution Score, plan
adherence), and three panels (Ghost equity curve, Error cost breakdown, Discipline note).
The doc also maps the proposal onto the real `Trade` model and lists the open questions.
