# ARCHITECTURE.md — mapa do código (referência)

> **Referência, não lei.** Lido quando se mexe na estrutura do código ou se procura
> onde vive algo. As regras estão nos docs normativos; a bíblia é o `PROJECT-SPEC.md`.

## Camadas (`src/`)

```text
src/
├─ main.ts          plugin, settings shape, orquestração, rename, manutenção
├─ types.ts         domínio (Trade, PropAccount, AccountGroup, Payout, CopyGroup, TradeFill)
├─ props.ts         catálogo de prop firms/programas/sizes
├─ futures.ts       specs de futuros, custos, regras por omissão, classifyAccount
├─ storage.ts       ler/escrever a nota markdown da trade
├─ csv.ts           parser do CSV Tradovate (round-trips, FIFO)
├─ settings.ts      SettingsTab (todo o UI de settings)
├─ themes.ts        presets de tema (16)
├─ ui.ts            primitivas (kpiCard, renderAppShell, SVG, attachTooltip)
├─ tz.ts            timezone + formatação de dinheiro/preço
├─ lib/             motores puros e helpers partilhados (ver abaixo)
├─ views/           cada ecrã / modal / painel
└─ widgets/         PerformanceCalendarWidget
```

## Lib — motores e helpers partilhados (evita drift)

| Ficheiro | Papel |
|---|---|
| `lib/cardSlots.ts` | fonte única dos slots do account-card: `BAR_CATALOG`, `MINI_CATALOG`, defaults, labels/hints |
| `lib/accountMetrics.ts` | motor puro de métricas de conta + `computeDrawdownEpisodes` |
| `lib/accountTypes.ts` | nomes/cores/ordem dos tipos de conta (`DEFAULT_LABELS/COLORS`, `typeKey/Label/Color/Order/Rank`) |
| `lib/copy.ts` | motor de copy trading (`buildLeg`, `generateLegs`, `deleteLegs`, períodos, `legBaseKey`) |
| `lib/scope.ts` | `analyticsTrades` — dinheiro vs trade única |
| `lib/fills.ts` | parciais (`fillSet`, `fillIndex`, `fillLabel`, `toneClass`, `applyFillsToTrade`) |
| `lib/review.ts` | completude da review (`reviewStatus`, `reviewScore`, `isReviewed`) |
| `lib/trends.ts` | "estou a melhorar?" metade vs metade |
| `lib/sessions.ts` | classificação de sessão (NY/London/Asia) |
| `lib/maturity.ts` | maturidade/fases da conta (`computeMaturity`) |
| `lib/metrics.ts` | definições das métricas do dashboard (`METRICS`, `METRIC_TITLES`) |
| `lib/lineChart.ts` | SVG line/area chart partilhado + hover card `tj-eq-card` |
| `lib/grid.ts` | grid do dashboard com drag/resize/compact (sem dependências) |
| `lib/dropdown.ts` | dropdown flat custom |
| `lib/dates.ts` | formato/parse de datas + `mountDateField` |
| `lib/tip.ts` | sistema de tooltips hover-card (`attachTip`, `showTip`, `killTip`, `guardTips`) |
| `lib/backup.ts` | formato + build/apply de backup |
| `lib/diagnostics.ts` | snapshot de bug report em texto |
| `lib/tradeTable.ts` | tabela-ledger partilhada (Trade Log + widgets de conta) |

## Data attributes como contrato

`data-wid` (widgets) · `data-account` (account tiles) · `data-idx` (add-trade cards) ·
`data-tour="…"` (onboarding: wizard, wizard-back/next/type, wizard-review, add-account) ·
`data-pq-id` (print queue).
