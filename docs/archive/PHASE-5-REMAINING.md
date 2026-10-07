# Phase 5 — remaining work

> **Archived 2026-10-07 — nothing below is outstanding.**
> Every step described here has been done and committed. Final state:
> `npm run build` exits 0 · `npm test` 412 pass / 0 fail · `npm run lint`
> 0 errors, 1 warning (`setWarning` needs Obsidian 1.13.0; the plugin still
> supports 1.7.2). The Step 4 decision was recorded in commit `4d98884`:
> keep `display()`, add a `getSettingDefinitions()` stub. The table under
> "Where we are" is the snapshot taken when this was written — historical,
> not current.

The state of the Obsidian review-warning cleanup, and the exact order to finish it.
Read this before touching `src/`.

## Where we are

| Check | HEAD (`93137d9`, branch `dev`) | Working tree (uncommitted) |
| --- | --- | --- |
| `npm run lint` | 182 warnings, 0 errors | 46 warnings, 0 errors |
| `npm run build` | exits 0 | **fails — 4 `tsc` errors** |
| `npm test` | 412 pass, 0 fail | 412 pass, 0 fail |

The uncommitted work cleared 136 warnings and broke the build. `npm run build` must
exit 0 before anything else is done.

## Step 0 — split the working tree

The working tree holds two unrelated changes. Separate them before committing:

- **Lint and type fixes** — 21 modified files under `src/`.
- **A `printQueue` → `printInbox` split** — new `src/lib/printInbox.ts` and
  `src/views/printInboxView.ts`; `src/views/printQueueView.ts` is now a one-line
  re-export shim. This is not part of the lint work and has not been reviewed.

Commit them separately, with messages that say which is which.

## Step 1 — fix the 4 build errors

All four come from the Phase 5 edits: each replaced a working `any` with a wrong type.

| File | Line | Error |
| --- | --- | --- |
| `src/views/accountDashboard.ts` | 786 | `string` not assignable to `AccountType` |
| `src/views/accountDashboard.ts` | 911 | `ResolvedRules` passed where `number` expected |
| `src/views/dashboard.ts` | 1245 | object not assignable to `GridItem` (`i: string \| undefined`) |
| `src/views/dashboard.ts` | 1246 | `string \| undefined` not assignable to `string` |

- `openEditAccountModal` (line 161) was retyped to
  `(acc: PropAccount, size: number, net: number)`. Its only caller, line 911, passes
  `size` as `ResolvedRules`. Decide which is right before changing either.
- `dashboard.ts` line 1234 builds `conv` from `layout.map((it) => ({ i: it.id, ... }))`.
  `it.id` is optional, so `i` widens to `string | undefined`. Narrow `it.id` or fall
  back to a generated id.

## Step 2 — the remaining `no-explicit-any` warnings

| Where | Count | What it is |
| --- | --- | --- |
| `src/lib/*.ts` (~20 files) | ~22 | `(window as any).__tjX = { ... }` test hooks at end of file |
| `src/ui.ts` | 5 | `plugin: any`, `app: any`, `pool: any[]`, `(t: any)` — the file imports nothing from `obsidian` |
| `src/views/tradeDetailView.ts` | 4 | `(t as any).sessionOverride`, `saveField("order_type" as any, id)` |
| `src/lib/copy.ts` | 3 | `(t as any).copyVirtual` |
| `src/lib/grid.ts` | 2 | `(it as any).static`, plus the test hook |
| `src/views/tradeModal.ts` | 1 | `(trade as any)[key] = val` |
| `src/csv.ts`, `src/storage.ts`, `src/lib/backup.ts`, `src/widgets/performanceCalendarWidget.ts` | 4 | test hooks |
| `src/lib/accountMetrics.ts` | 1 | test hook — see Step 3 for its two other warnings |

Two rules the last pass broke:

1. **`as any` is not a fix.** Rewriting `const s: any = x` as `const s = x as any`
   changes nothing. The warning has to disappear from `npm run lint`.
2. **A fix must not break the build.** Run `npm run build` after each file, not once
   at the end.

The ~22 test hooks are the cheap win: one shared declaration instead of 22 casts.
Before writing 22 contortions, note that `eslint.config.mjs` already documents
`no-explicit-any` as a deliberate downgrade, because the harness is `any`-bound at
the edges. An override for the hook lines is a legitimate answer — pick one approach
and apply it everywhere.

## Step 3 — the three non-`any` warnings

- `src/lib/accountMetrics.ts` — `peakDate` (line 349) and `ddTroughDate` (line 354)
  are assigned and never read. `ddTroughDate = date` at line 387 sits inside a
  branch, so this is not simple dead code: the value was probably meant to be used.
  Read the function before deleting anything.
- `src/settings.ts` — 7 warnings. See Step 4.

## Step 4 — the `settings.ts` decision

Do not start this without deciding first. `src/settings.ts` is 1064 lines with 7
`display()` overrides (lines 51, 86, 142, 409, 448, 663, 1058). Obsidian 1.13.0
deprecates `display()` in favour of `getSettingDefinitions()`.

**It cannot ship as-is.** `manifest.json` has `minAppVersion: 1.7.2`. Adopting the
declarative settings API forces a bump to 1.13.0, which drops every user on
1.7.2–1.12.x.

Pick one and write the reason in the commit:

1. **Leave it.** Warnings do not block a listing (`docs/RELEASE-AND-DISTRIBUTION.md` §8).
   Cheapest, honest, no user impact.
2. **Adopt `getSettingDefinitions()` and bump `minAppVersion` to 1.13.0.** Only if the
   user base justifies it.
3. **Dual-path.** Implement `getSettingDefinitions()` and keep `display()`. Most work,
   no user impact, clears the warning.

## Done means

- `npm run build` exits 0.
- `npm test` → 412 pass, 0 fail.
- `npm run lint` → 0 errors, and warnings at or below 7 (the `settings.ts` decision).
- The warning count is confirmed by re-running `npm run lint`, never by reading a diff.
