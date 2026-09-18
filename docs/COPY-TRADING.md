# Copy Trading — Integration Contract

> Goal: copy-trading must never produce wrong numbers, and every part of the
> plugin must know how to read a copy-traded trade. This file lists **every
> touch point** so nothing is missed.

## 1. Entities & fields

### Account (`PropAccount`)
| Field | Meaning |
|---|---|
| `copyRole?: "base" \| "copier"` | role in a copy group |
| `copyMultiplier?: number` | ratio applied to the base P&L/qty |
| `copyBaseId?: string` | (copier) the account it follows |
| `copyPeriods?: {start?, end?}[]` | when it was copying (history stays correct) |
| `copyConfigHistory?: {from, ratio, crossOrder, sizing, fixedQty, round, minQty}[]` | **time-stamped copy config** — a ratio/scale change only applies **from its date**, never retroactively |
| `copyCrossOrder?: boolean` | map E-mini ↔ Micro (NQ→MNQ, ES→MES, YM→MYM) |
| `copySizing?: "ratio" \| "fixed" \| "mirror"` | how size is derived |
| `copyFixedQty?: number` | for `fixed` sizing |
| `copyRound?: "down" \| "nearest" \| "up"` | contract rounding |
| `copyMinQty?: number` | floor (e.g. never below 1) |

### Copy group (`settings.copyGroups[]`)
```
CopyGroup { id, name, baseAccountId, createdAt,
            members: [{ accountId, ratio, crossOrder, sizing, fixedQty, round, minQty,
                        active, periods[], ratioHistory[] }] }
```

### Trade (frontmatter)
| Field | Meaning |
|---|---|
| `isCopiedTrade?: boolean` | this note is a copy (a "leg") |
| `copiedFromAccount?: string` | base account name |
| `copyBaseKey?: string` | identity of the base trade (groups siblings) |
| `copyBaseFile?: string` | wikilink/path of the base note |
| `copyMultiplier?: number` | ratio used for THIS leg |
| `copySymbolMap?: string` | e.g. `"NQ → MNQ"` |
| `copyOrigin?: "generated" \| "imported"` | generated or real (import override) |
| `copyPnlAdjustment?: number` | rounding adjustment |
| `symbol` / `quantity` | **the real instrument/qty of this account** (e.g. MNQ, 5) |

## 2. Data flow
```
Add Trade / Import (BASE account)
        │  user picks accounts that took the trade (default: active members)
        ▼
   saveTrade(base note)
        │
        ▼
  Copy engine ── config = member config effective ON THE TRADE DATE
        │        leg qty = round(baseQty × ratio) | fixed
        │        leg symbol = crossOrder ? micro : base symbol
        │        leg pnl   = points × pointValue(symbol) × qty
        ▼
   saveTrade(leg notes, copyOrigin:"generated", copyBaseKey=…)
        │
        ▼
  All consumers read trades (per account = legs sum; group = dedupe by copyBaseKey)
```

## 3. Consumer matrix (every place that must be copy-aware)
| Module | Must do |
|---|---|
| `storage.ts` | read/write copy fields; filename uses the leg's **own symbol**; `tradeKey` stays identity |
| `main.ts` | `loadTrades` includes copy fields; `openTradeDetail`; group helpers; `generateCopies()`; `deleteCopies()` |
| `csv.ts` / `importUi.ts` | base import → offer to generate legs; copier import → set `copyOrigin:"imported"` (override) |
| `addTradePanel.ts` | **member checklist** when the chosen account is a base; on save call the copy engine |
| `lib/metrics.ts` | add a `uniqueOnly` mode: metrics computed **per unique trade** (dedupe `copyBaseKey`) |
| `lib/review.ts` | review completeness per note (legs count too, no double counting) |
| `views/dashboard.ts` | Home widgets: money = all legs; **count/win-rate use unique trades** when in "group" scope |
| `views/accountDashboard.ts` | per account → **only its own legs**; show copy badge; prop rules unaffected |
| `views/accountsListView.ts` | per-account stats = legs; portfolio chart = sum; show `Base`/`Copier` chips |
| `views/tradeLogView.ts` | list shows legs; a **"collapse copies"** toggle; bulk actions must not break links |
| `views/tradeDetailView.ts` | badge `Copier of X · NQ → MNQ (5×)`; links to base + siblings |
| `views/calendar.ts` + `widgets/performanceCalendarWidget.ts` | day totals = money (legs); day **trade count** = unique when grouped |
| `views/setupsView.ts` | setup stats: money per leg; counts unique when grouped |
| `views/sidebarView.ts` | search groups by `copyBaseKey` (done); totals respect the same rules |
| `settings.ts` | names unique (`uniqueName`), account rename validation, copy group management |
| `ui.ts` | nothing trade-related (labels only) |

## 4. Metric rules (the "no wrong numbers" contract)
| Scope | P&L / money | Trades · win rate · counts |
|---|---|---|
| **Account** | sum of that account's legs | that account's own legs |
| **Group / portfolio** | sum of legs (real money) | **dedupe by `copyBaseKey`** (1 trade) |
| **Home (all trades)** | sum of legs | **dedupe** (a base trade counted once) |
| **Symbol breakdown** | per leg symbol (MNQ counts as MNQ) | unique |

## 5. Lifecycle rules
| Action | Behaviour |
|---|---|
| Save base trade | generate/update legs for the **selected members** only |
| Edit base (pnl/qty/time) | regenerate legs **unless** `copyOrigin:"imported"` |
| Delete base | ask: delete legs too (default yes) |
| Delete a leg | base untouched |
| Pause member | close its `period.end`; past legs untouched |
| Resume member | new `period.start` |
| **Scale account / ratio change** | append to `copyConfigHistory` with `from` = today; **existing legs are frozen** and never recalculated |
| Regenerate a leg (base edited) | uses the config **effective on that trade's date**, not today's |
| Rename account | names are not keys; validate uniqueness (auto `#2` + notice) |
| Import copier CSV | leg → `imported`; engine never overwrites it |
| Rebuild index | clear caches; reparse copy fields |

## 5b. Scaling rules (a 0.5× today may be 1× after scaling)
1. **Legs are frozen at creation** — `symbol`, `quantity`, `pnl`, `copyMultiplier` are written once. Changing a member's ratio **never** touches existing legs.
2. **Config is time-stamped** — `copyConfigHistory` (first entry = "from the beginning"). Effective config for a date = last entry with `from <= date`.
3. **Regeneration uses the historical config** — re-generating a trade re-applies the ratio of *that* date.
4. **Scaling an account** = append a new config entry (`from: today`) + optionally update `size`. Past trades keep their values.
5. **Micro/mini toggle** is part of the same history (so turning cross-order on later doesn't rewrite old legs).

## 6. Edge cases
- **Fractional contracts** (`1 mini × 0.5`): `round:"down"` → 0 = skip; with `crossOrder` → 5 MNQ.
- **Micro/mini mix**: leg stores its own `symbol` + `quantity`; P&L uses the right point value.
- **No chains**: a copier cannot be the base of another group.
- **Same-day duplicates** (two members, same symbol/time): filename `#2`/`_2`, account in frontmatter.
- **Group P&L ≠ N × base** is expected (money is real); counts are deduped.
- **Paused day**: no leg created; the account's stats simply have no trade that day.
