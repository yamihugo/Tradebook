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
| `lib/scope.ts` | fundação da selecção: `analyticsTrades` (dinheiro vs trade única), `accountResolver`/`accountScope` (quem entra: conta seleccionada, portfolio, demos, arquivadas) e `journalDayKey` (o que é um dia) |
| `lib/instant.ts` | tempo canónico: **valor civil** (`CivilDate`/`CivilTime`, o que o trader lê) vs **instante** (`InstantIso`, `…Z`, o que a plataforma gravou) — `parseInstant` (`Z`/`offset` vencem a zona de origem, fracção incluída; naive só na zona declarada), `instantFromWall` (offset pedido a um instante de segundos inteiros, fracção somada no candidato, três candidatas ±1 dia com verificação por round-trip → `ok`/`gap`/`ambiguous`), `pinManualInstants` (mesmo contrato para entradas manuais, com wrap de meio-noite) e `isValidZone`; **nunca** o relógio do SO. Gravação: `entry_instant`/`exit_instant`/`source_zone`/`instant_source` (`offset` · `source-zone` · `system-zone` · `journal-zone`) e `fills[].instant` |
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
| `lib/money.ts` | helpers financeiros Gross/Net; `summarizeFinancials` resolve scope antes de agregar, soma elegíveis por perna, agrupa por decisão lógica e expõe médias/PF coerentes, dias e cobertura de custos |
| `lib/periods.ts` | janelas de período (`periodDataBounds`, `previousPeriodBounds`, `dateWithinPeriod`) e a tradução da janela para o dia de mercado (`tradingDayAtJournalDateStart/End`, `periodDayBounds`) — o filtro de período e os buckets partilham o mesmo domínio de dias |
| `lib/process.ts` | sinais de processo transversais (`computeProcessSignals`, `revengeStats`, `streakStats`) — só trades + `dayKey`, sem regras de conta |
| `lib/score.ts` | Trading Score v1 puro (`computeScore`) — cinco eixos iguais e nullable (Performance · Risk · Execution · Process · Consistency), média completa/provisória; `recentScoreWindow` aplica o cutoff as-of, dedupe de decisão e limite de 30 do Home |

### Base monetária (contrato)

**Gross** é o resultado de trading antes de custos registados; **Net** é o resultado depois
de comissão e fees registadas. Net é a base monetária primária de Home/Analytics. Gross
permanece acessível como referência explícita (incluindo Gross Profit Factor).

**Win, loss e breakeven sem qualificador são o sinal do Net da decisão agregada em scope.**
`Win Rate = Net positivas ÷ (Net positivas + Net negativas)`; decisões com Net zero ficam de
fora do denominador e leem `—` quando nada decidiu. A classificação acontece **depois** de
somar as pernas elegíveis da decisão, nunca por perna: a mesma decisão pode ganhar numa conta
e perder no portfolio — é correcto, e as duas leituras ficam visíveis. **Streaks**
(`lib/process.ts`) e as divisões de *hold* continuam a classificar pelo sinal Gross e dizem-no
("Gross-sign"); Profit Factor, médias Net, dias Net e maiores resultados usam o Net. Médias por
decisão mantêm todas as decisões no denominador; cópias somam as pernas elegíveis em scope, mas
uma decisão entra uma vez. O toggle `includeCopiesInPortfolioAnalytics` afeta
contagens/classificações que podem contar pernas, nunca muda uma métrica monetária rotulada por
decisão. Custo desconhecido é **cobertura incompleta assinalada**, nunca um fallback silencioso
para Gross.

### Uma população financeira partilhada (fase 1)

Todos os números-base leem **um** `FinancialSummary` (`lib/money.ts` → `summarizeFinancials`),
alimentado pelas duas entradas que `lib/scope.ts` detém:

- **Quem entra** — `accountScope()`: a conta seleccionada; senão o portfolio (demos de fora,
  salvo selecção explícita ou `excludeDemosFromPortfolio === false`). Contas arquivadas ficam
  de fora de qualquer número financeiro, sempre.
- **O que é um dia** — `journalDayKey()`: data registada + hora de entrada lidas na zona do
  journal e expressas como dia de mercado (New York). **O filtro de período usa a mesma
  chave** (`periodDayBounds`, `lib/periods.ts`), para que um trade nunca caia dentro do
  período e fora do dia em que foi contado.

| Número | Lê |
|---|---|
| Net P&L e a curva cumulativa da Home | `summary.net.total` · `summary.net.byDay` |
| Closed trades | `summary.decisionCount` (decisões elegíveis agregadas) |
| Win Rate | `summary.net.winRate` |
| Net Profit Factor | `summary.net.profitFactor` |
| Avg Net Result per Trade | `summary.net.averagePerDecision` |

O movimento registado da conta (payouts, depósitos, ajustes assinados) **não** entra nesta
população: é o contrato do Accounts (`remainingAccountPnl`, `homeAccountMovement`), não é
trading P&L. `tests/selection.test.mjs` fixa o contrato.

Accounts list e Account Dashboard mantêm Net para trading result, saldo, equity, target e
regras. Gross PF é usado onde o painel declara Gross PF; métricas de consistência, drawdown,
cashflows e ajustes conservam as suas fórmulas de conta. FeeAdjustment e cashflows não
entram no Gross/Net de trades. O valor de conta registado é `size + Net trades − payouts +
deposits + signed FeeAdjustments`; não é um snapshot do broker nem uma afirmação de withdrawable
profit. Trade Log, Trade Detail, Import e Strategies mantêm as suas distinções próprias.

### Shared Gross / Net primitives (Phase 1)

`lib/money.ts` also exports `MoneyBasis`, `tradeMoney()`, and
`summarizeFinancials()`. `summarizeFinancials()` resolves an explicit account scope
before eligibility, deduplicates repeated account legs, aggregates Gross and Net
over the same logical-decision groups, and returns separate per-decision and
per-account-leg averages plus day maps using an injected journal-day key.
Decision identity uses `copy.logicalDecisionKey()` (`copyBaseKey`, then base note
id); an unlinked copy or id-less trade is kept separate rather than grouped by a
collision-prone content guess.
`Trade.costCoverage` is parser-derived runtime metadata (never serialized): a
missing historical commission/fee field is not certified as a zero. Net values
still use the observed amounts, so callers must check the returned coverage before
presenting them as fully known. Account `FeeAdjustment` records and cashflows are
not accepted by these trading-result helpers. Generated copy legs mark costs
unknown: their zero defaults are not platform-confirmed fees. The Markdown writer
omits zero-valued cost fields, so an ordinary saved zero cannot be distinguished
from a missing legacy value; an explicitly present zero can only be known when the
frontmatter contains that key.

Phase 3 migration status: Home/Analytics monetary performance values default to Net;
Gross Profit Factor remains an explicit secondary widget. Accounts foregrounds configured
Account Capital and Remaining Account P&L (recorded account value minus configured capital);
historical Net Trading P&L and Paid Out remain distinct. Individual account balance is computed
from configured size, Net trade results and dated payout/deposit/adjustment events; it is not a
live broker snapshot. Legacy helpers stay only where their account/rule unit has been reviewed.

Phase 1 of the Home/Analytics revamp — the shared financial foundation — is in place: one
`accountScope` + `journalDayKey` feed one `FinancialSummary`, and the metric widgets
(`m.netpnl`, `m.trades`, `m.winrate`, `m.wintrades`, `m.losstrades`, `m.expectancy`,
`m.profitfactor`, `m.avgwin`, `m.avgloss`, `m.avgrr`, `m.bestday`, `m.worstday`) read it
instead of recomputing a population. Surfaces still on their own Gross-sign or per-trade
population are listed in `BACKLOG-AND-HISTORY.md`.

## Data attributes como contrato

`data-wid` (widgets) · `data-account` (account tiles) · `data-idx` (add-trade cards) ·
`data-tour="…"` (onboarding: wizard, wizard-back/next/type, wizard-review, add-account) ·
`data-pq-id` (print queue).
