# UX & Typography Guidelines

Every rule below carries its source. If a rule has no source, it is a house
preference and is marked **(house)** — those we may trade away when it helps.

The point of this file is that decisions survive us: a new screen is judged
against the checklist at the bottom, not against anyone's memory.

---

## 0. The line we never cross: a journal, not a prop firm

**The journal reports; the prop firm imposes.** Recorded at the trader's request
(16 Sep 2026) and binding on every screen we build.

- We show the rule, the room left, today's usage and the direction of travel. We
  never enforce it: no blocking an order, no refusing a trade, no holding payouts,
  no trade limits, no lockouts, no symbol blocks.
- Numbers stay honest even when they are bad — a breached limit reads as breached,
  never hidden and never softened.
- Where our model is only a model (copy legs, simulated commissions), say so: the
  platform is the source of truth, we are the record of it.
- If a feature only makes sense to a firm's back office, it does not belong here.

Sources: product principle agreed with the trader (primary); NN/g "match between the
system and the real world" — the journal mirrors the account, it does not become it;
WCAG 2.2 SC 3.3.1 for honest reporting of limits and errors.

---

## 1. Type

### 1.1 One scale, seven steps

Published design systems converge on a small, closed scale. Material 3 uses
~7 sizes in practice, Apple HIG 4–5, Carbon 5, USWDS 7. **None of them use
28 sizes.** (Material Design 3 type scale; Apple HIG "Typography"; IBM Carbon
type set; USWDS type scale.)

| Token | Size | Used for |
|---|---|---|
| `--tj-fs-label` | 9.5px | uppercase micro-labels (section titles, strip keys) |
| `--tj-fs-small` | 11px | hints, sub-lines, meta |
| `--tj-fs-body` | 12.5px | default text and rows |
| `--tj-fs-strong` | 13.5px | account names, key values |
| `--tj-fs-big` | 15px | card balances, numbers inside cards |
| `--tj-fs-head` | 19px | the headline value (chart, hero) |
| `--tj-fs-display` | 24px | page and modal titles |
| `--tj-fs-hero` | 28px | the one figure inside a ring or gauge |

All type sizes in `styles.css` go through these tokens — the audit reports any
literal `px` left behind (today: one, a decorative emoji that carries no text).

Ratio between neighbouring steps is ~1.1–1.2 — a **modular scale**, so the
hierarchy reads as a hierarchy instead of as noise. (Tim Brown, *More
Meaningful Typography*, A List Apart, 2011; Bringhurst, *The Elements of
Typographic Style*.)

**Rule:** a size outside this list is a bug. Fractional steps (10.5, 11.5,
12.5±) are what make two labels side by side look "off by half a pixel".

**Absolute minimum:** Material's smallest text style is 12sp; Apple HIG's
smallest is 11pt. We allow 9.5px **only** for uppercase labels that are
redundant with nearby text, and **only** at AA contrast (§2.1).

### 1.2 Three weights

`--tj-w-regular: 400`, `--tj-w-medium: 600`, `--tj-w-bold: 700`.

Weight is the cheapest hierarchy tool and the easiest to overuse; every system
above ships 3–4. Half-weights (650) render identically to 700 on most UI fonts,
which is a lie in the source rather than a difference on screen. 500 was
normalised to 600 (it read as "slightly emphasised") and 800 to 700.
(Material 3 "Emphasis"; Carbon "Type weight".)

### 1.3 Numerals

Money, quantities, dates in tables and any number that sits above another
number use `font-variant-numeric: tabular-nums` — equal-width digits keep
columns aligned when values change length. (OpenType `tnum`; Nielsen Norman
Group, "Data Tables".)

### 1.4 Text spacing

WCAG 2.2 **SC 1.4.12** requires that content stays readable when the user
overrides spacing: line-height ≥ 1.5×, paragraph spacing ≥ 2×, letter spacing
≥ 0.12em, word spacing ≥ 0.16em. Practically: body copy at 12.5px needs
~19px of line. Tight 1.25 lines are only acceptable for one-line labels.

### 1.5 Uppercase labels

All-caps loses the ascenders/descenders that carry word shape, so it needs
tracking: 0.06–0.12em (`letter-spacing`). Below that, an uppercase 9.5px
label is a grey smear. (Bringhurst; Material 3 "Label" styles.)

### 1.6 No `em` for UI text

`em` inherits from the parent, so the same declaration renders 8px inside a
card and 11px inside a section header — the same rule, two sizes. UI text uses
`px` tokens; `em` survives only for icons and rules that must scale with a
deliberate parent. **(house)**

---

## 2. Colour

### 2.1 Text must pass WCAG AA

WCAG 2.2 **SC 1.4.3 (Contrast, Minimum)** — normal text needs **4.5:1**; only
"large text" (≥24px, or ≥18.66px bold) may sit at 3:1. Our micro-labels are
9.5px, so they are normal text: they need 4.5:1, no exceptions.

Measured on our dark surfaces (`#1e1f22` page, `#222326` card):

| Token | Value | Page | Card | Verdict |
|---|---|---|---|---|
| `--tj-fg-1` | `#dcddde` | 12.12:1 | 11.55:1 | AA ✓ |
| `--tj-fg-2` | `#a8aeb4` | 7.36:1 | 7.02:1 | AA ✓ |
| `--tj-fg-3` | `#8a9099` | 5.12:1 | 4.89:1 | AA ✓ |
| `--text-faint` (Obsidian) | `#6b7075` | 3.30:1 | 3.14:1 | **fails AA — no longer used** |
| green / amber / blue / teal | | 8.28 / 7.33 / 6.54 / 10.73:1 | | AA ✓ |
| red / violet | | 5.42 / 5.73:1 | | AA ✓ |

`--text-faint` is the theme's own token and we do not control it; wherever we
would use it, we use `--tj-fg-3` instead. Re-run the audit after any colour
change — never eyeball it.

### 2.2 Never colour alone

WCAG 2.2 **SC 1.4.1 (Use of Color)**: colour must not be the only carrier of
meaning. Profit/loss always shows a sign (`+$120` / `-$80`); status chips carry
text ("Paused", "Running"), not just a hue.

### 2.3 Categorical palettes

Categorical colour tops out around 8 distinguishable hues and must survive the
common colour-vision deficiencies. Our six account types use an Okabe–Ito-derived
set (Okabe & Ito, *Color Universal Design*, 2008); the wider 16-swatch picker is
a user preference and is exempt — it is not conveying data. (Cynthia Brewer,
ColorBrewer.)

### 2.4 Non-text contrast

WCAG 2.2 **SC 1.4.11**: anything that must be *perceived* (input borders, chart
lines, toggle tracks) needs 3:1 against its background. Decorative fills are
exempt.

---

## 3. Space and rhythm

- 4px base unit; spacing from `4 / 8 / 12 / 16 / 24 / 32`. **(house)**
- Related things sit closer than unrelated things — **Gestalt, proximity**
  (Wertheimer, 1923). Sections are separated by more than rows inside them.
- Don't mix a gap of 10px with one of 11px; if the difference is invisible it
  is noise, and if it is visible it is unintentional.

---

## 4. Order and hierarchy

- **Inverted pyramid**: the most important number first, detail after.
  (Journalism; adopted by NN/g for dashboards.)
- **F-pattern**: the eye starts top-left and sweeps down the left edge — the
  identity of the page and its headline figure belong there. (NN/g eye-tracking,
  *F-Shaped Pattern for Reading Web Content*, 2006; updated 2017.)
- **≤4 chunks per group**: working memory holds about 4±1 items (Cowan, 2001).
  Four mini-stats on a card is at the limit, not under it.
- **Progressive disclosure**: show the common case, hide the rest behind a
  control (NN/g). Tabs in Manage, the copy block in the wizard.
- **No substitutes.** When a bar, cell or metric has nothing to read yet, it says
  exactly that — "No target set", "0 of 5 days", "—". It is never swapped for a
  different bar, and never hidden to tidy the layout: a card that quietly shows
  something else makes the user distrust *every* number on it. A brand-new
  account must be complete and reading zero, because that is what "ready for my
  first trade" looks like.
  (Nielsen, *Usability Heuristics* #1 — visibility of system status; WCAG 2.2
  SC 3.3.1 Error Identification; and the honest-reporting principle in Few,
  *Information Dashboard Design*, 2006.)
- **Jakob's Law**: users expect our app to behave like the other trading
  journals they know. Where we differ, it must be an improvement we can name.
- **Fewer choices, faster decisions**: Hick's law (Hick 1952, Hyman 1953).

---

## 5. Interaction

- **Feedback under 400ms** — the Doherty threshold (Doherty & Kelso, 1982). Anything that
  acknowledges a click must respond within it; decorative animations may run longer.
- **Targets ≥24×24 CSS px** — WCAG 2.2 **SC 2.5.8**.
- **Dragging needs a non-drag alternative** — **SC 2.5.7**. A reorder must also offer
  buttons or keyboard steps.
- **Focus is always visible** — SC 2.4.7 / 2.4.11.
- **Never trap content on hover** — SC 1.4.13. Every tip's information must be reachable
  without hovering.
- **One primary action per screen, one shared button recipe.** Top-right of every page:
  a ghost secondary + a single "primary". **House preference: maximum ghost** — no boxes
  or fills in a header; words are the button, primary marked by brighter ink, accent only
  on hover. Same 30px height as icon buttons and the period picker.
- **An icon is a label with no words.** Icon-only controls are allowed but must carry an
  `aria-label` and one of our tips (WCAG 4.1.2).
- **Never use the native `title` attribute for an explanation** — its font/colour/delay
  are not ours and it never shows on keyboard focus. Use `attachTip()` (`lib/tip.ts`);
  `title` only as a redundant label where the word already shows (WCAG 1.4.13).
- **Colour follows the theme, never a guess.** Tints use `var(--interactive-accent)` or
  `color-mix(in srgb, var(--interactive-accent) N%, transparent)` — never a literal violet.

### 5.1 How the audit reads SC 2.5.8

Three kinds of small element exist, only one is a violation:

1. **Indicators** (win-rate dot, status dot, count badge) — not targets; the control
   around them is. Not counted.
2. **Spaced targets** — clickable but covered by the *spacing exception*: a 24px circle
   centred on them never meets another target. Each is listed in `tools/ux-audit.mjs`
   with the gap that makes it true. If the gap shrinks, enlarge the control.
3. **Everything else** — a violation. Fix it or move it into 1 or 2 with a written reason.

The list lives in the script, not a comment, so drift shows up in the next audit.

---

## 6. Showing data

- **Position beats area.** Perception ranks position/length first, then angle, then area,
  then colour (Cleveland & McGill, 1984). Progress **bars** for anything the eye compares;
  rings/donuts are decorative (removed from account cards for that reason).
- **Data-ink ratio**: no glows, no shadows on lines, no background patterns behind a chart
  (Tufte, 1983).
- **One chart, one message** (Few, 2006).
- **Axes follow the data**: y-domain from values plus reference lines, round ticks; x labels
  thinned to avoid collisions. Never label every point.
- **Baselines are explicit**: the zero line and the account's starting balance are drawn.
- **Right-align and tabulate numbers**; units in the header, not per row (NN/g).

---

## 7. Checklist before a release

```bash
cd "<source>"
node tools/ux-audit.mjs
npm run build
cd ~/trading-journal-smoke && cp "<source>/main.js" . && cp "<source>/styles.css" . \
  && node smoke.js /home/hugo/trading-journal-smoke
```

- [ ] `ux-audit` reports no errors (warnings are known debt).
- [ ] No new font size outside §1.1; no new `em` in UI text; no new weight.
- [ ] Any new text colour measured against 4.5:1 (§2.1).
- [ ] Any new control is ≥24×24 and reachable by keyboard.
- [ ] Any new drag has a non-drag path (§5).
- [ ] Colour is never the only signal (§2.2).

---

## 8. Applying the rules

### Adding a new screen

1. Use the tokens — `var(--tj-fs-*)`, `var(--tj-fg-*)`, `var(--tj-w-*)`,
   `var(--tj-sp-*)`. No new literal sizes, no `em` for text.
2. Run `node tools/ux-audit.mjs`. If it complains, fix the screen or add the
   entry to the script **with the reason**.
3. If you add a knob the user can pull (a size, a colour, a target), ask which
   rule above governs it. If none does, that is a gap in this document, not in
   the screen — write the rule first.

> Sources (W3C/WCAG 2.2, ISO, Material, research) are listed in `DEV-REFERENCE.md`
> §Sources. The historical debt ledger (all items **paid**) lives in
> `QA-CHECKLIST.md` — kept because the numbers are the proof the rules were applied.
