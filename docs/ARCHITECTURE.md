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

## Regras centralizadas (`main.ts`)

| Helper | Regra |
|---|---|
| `activeAccounts()` | a carteira/performance só vê contas ativas (`settings.propAccounts`); arquivadas ficam de fora |
| `isArchivedTrade(t)` | um trade de conta arquivada não entra nas métricas da Home |
| `accountTrades(id)` / `accountDeletionSummary(id)` | o que morre com uma conta (notas, payouts, depósitos, correções, laços de copy) |
| `purgeAccountData(id)` | delete duro: registos + notas para o lixo (`vault.trash`) + mapeamentos + copy |
| `registerAccountCost(id,date,amount)` | custo sem trade (`FeeAdjustment.kind:"cost"`), fora do modal *Correct fees* mas no saldo |
| `allocatedKeysFor(id)` | as chaves de trade que já levam uma fatia de correção; a próxima correção só toca nas que faltam. `tradeFeeKeys` casa o trade por `fillId`, depois pelo caminho da nota, com a chave composta antiga como *fallback* |

## Lib — motores e helpers partilhados (evita drift)

| Ficheiro | Papel |
|---|---|
| `lib/cardSlots.ts` | fonte única dos slots do account-card: `BAR_CATALOG`, `MINI_CATALOG` (inclui `dayWin`), `BAR_SLOTS`/`MINI_SLOTS`, labels/hints; `layoutFor(type)` → `CardLayout {bars, mini}` (um layout fixo assinado por tipo — sem edição por utilizador, sem settings) |
| `lib/accountMetrics.ts` | motor puro de métricas de conta + `computeDrawdownEpisodes` |
| `lib/fees.ts` | fees reais vs alocadas (`tradeFeeKeys`/`tradeFeeKey`, `allocatedKeys`, `feeForTrade`) + `allocateProportional` (por contratos, cêntimos inteiros) |
| `lib/accountTypes.ts` | nomes/cores/ordem dos tipos de conta (`DEFAULT_LABELS/COLORS`, `typeKey/Label/Color/Order/Rank`) |
| `lib/firmLogos.ts` | catálogo de firms/brokers (`FIRM_CATALOG` — 10 prop, 4 broker: Topstep · Tradeify · Apex Trader Funding · Take Profit Trader · MyFundedFutures · Lucid Trading · Alpha Futures · FTMO Futures · FundedNext · TopOne Futures / Tradovate · NinjaTrader · Interactive Brokers · AMP Futures; `own` prática em símbolo CSS), `firmLabel` e os data URIs embutidos (`firmLogoUrl`); os PNGs vivem em `assets/firm-logos/<id>.png` a 128×128 e entram no bundle via `loader: {".png":"dataurl"}`; um id sem ficheiro cai nas iniciais |
| `lib/accountRules.ts` | resolvedor de regras de conta (`resolveAccountView` → `{firm, program, firmDefault, rules}`, `mergeRules`, `isPropType`): overrides do utilizador por cima do preset opcional; `target/maxLoss/dailyLoss/consistency` resolvem para 0 quando não há regra |

### Import CSV — onde aterram os trades (`views/importUi.ts`)

`guessMapping()` resolve cada nome da CSV por ordem de certeza: conta que já responde
ao nome → **a única conta do journal** → `settings.lastImportAccountId` →
`settings.lastCreatedAccountId` → "Leave unassigned". Um **único tick** em *Also record
these trades in* serve de conta-base quando não há mapping (`tickBaseId()`), e é retirado
do broadcast de pernas para não escrever a mesma trade duas vezes. O tipo do ficheiro é
lido pelo **header**, nunca pelo nome: `csvKind()` (`csv.ts`) devolve `cash` · `orders` ·
`fills` · `unknown`; um ficheiro que não é Orders/Fills diz-se, não se ignora.
| `lib/copy.ts` | motor de copy trading (`buildLeg`, `generateLegs`, `deleteLegs`, períodos, `legBaseKey`, `unlinkCopier` — desliga uma conta do grupo sem apagar o histórico: fecha o período e limpa a config, guarda `copyPeriods`/`copyConfigHistory`). O **símbolo é decidido aqui**: `buildLeg` só espelha em micros quando `baseQty × ratio < 1` e o símbolo tem micro (exposição preservada); fora disso fica o símbolo do líder |
| `lib/scope.ts` | `analyticsTrades` — dinheiro vs trade única |
| `lib/fills.ts` | parciais (`fillSet`, `fillIndex`, `fillLabel`, `toneClass`, `applyFillsToTrade`) |
| `lib/review.ts` | completude da review (`reviewStatus`, `reviewScore`, `isReviewed`) |
| `lib/trends.ts` | "estou a melhorar?" metade vs metade |
| `lib/sessions.ts` | classificação de sessão (NY/London/Asia) |
| `lib/maturity.ts` | maturidade/fases da conta (`computeMaturity`) |
| `lib/metrics.ts` | definições das métricas do dashboard (`METRICS`, `METRIC_TITLES`) |
| `lib/lineChart.ts` | SVG line/area chart partilhado + hover card `tj-eq-card` |
| `lib/grid.ts` | grid do dashboard com drag/resize/compact (sem dependências) |
| `lib/dropdown.ts` | dropdown flat custom — abre em **portal** (`<body>`, `position: fixed`, `z-index: 1100`, flip, reposiciona em scroll/resize, fecha se o anfitrião sair do DOM); itens aceitam `heading` (cabeçalho de secção, não clicável), `tag`/`tagTone` (chip de papel: âmbar Leader, acento Copier ×N) |
| `lib/dates.ts` | formato/parse de datas + `mountDateField` |
| `lib/calendar.ts` | calendário temático partilhado (`openCalendar`/`closeCalendar`): grelha do mês à segunda, hoje/acento, teclado, popup fixo preso ao campo |
| `lib/tip.ts` | sistema de tooltips hover-card (`attachTip`, `showTip`, `killTip`, `guardTips`) |
| `lib/numeric.ts` | `freeNumeric(input)` — tira a validação nativa dos `input[type=number]` (`step="any"`, sem `min`/`max` no markup, `invalid` cancelado, `novalidate` no form mais próximo): os limites vivem nos handlers que lêem o valor, nunca numa bolha do browser que o tema não consegue pintar |
| `lib/backup.ts` | formato + build/apply de backup |
| `lib/diagnostics.ts` | snapshot de bug report em texto |
| `lib/tradeTable.ts` | tabela-ledger partilhada (Trade Log + widgets de conta) |

## Data attributes como contrato

`data-wid` (widgets) · `data-account` (account tiles) · `data-idx` (add-trade cards) ·
`data-tour="…"` (onboarding: wizard, wizard-back/next/type, wizard-review, add-account) ·
`data-pq-id` (print queue).
