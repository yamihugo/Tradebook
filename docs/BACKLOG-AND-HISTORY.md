# BACKLOG-AND-HISTORY.md — Ideias, história e estado

> Consolida **todas** as ideias dispersas (notas perdidas na vault, `TradeBook/ideas/`,
> `ROADMAP.md`, planos antigos) e cruza-as com o **estado real do plugin** (código em
> `source/src/`). Objetivo: nada se perde e sabe-se sempre o que está feito, o que
> falta e o que foi deliberadamente posto de fora.
>
> **Legenda:** ✅ Feito · 🟡 Parcial · ⬜ Por fazer · ⛔ Fora de âmbito / rejeitado
>
> **Fontes originais consolidados aqui:** notas soltas da vault, `TradeBook/ideas/IDEAS.md`,
> `docs/ROADMAP.md`. Revisto 2026-09-17.

---

## 1. Regras mais importantes (as que nunca se quebram)

1. **A linha:** journal ≠ prop firm. Reportar, nunca impor. (§0 da bíblia.)
2. **Números honestos**, mesmo maus; model-only diz "model".
3. **UI em inglês; respostas em PT-PT.**
4. **Local-first, privado** — dados são markdown na vault; sem cloud.
5. **Contas são dados do utilizador** — templates de firm são semente, nunca fonte de verdade.
6. **Sem código morto nem CSS morto.**
7. **Build 0, smoke 126 PASS, audit limpo, deploy verificado por md5** (ver `AGENTS.md`).
8. **Nunca copiar `data.json` no deploy.**

---

## 2. Plano mestre (PRoject.md) — Fases 1–8

| Fase | Tema | Estado | Nota |
|---|---|---|---|
| 1 | Workspace dedicado, sanitização, GitHub/BRAT prep | 🟡 | `source/` existe e é repo git; falta confirmar sanitização total e preparar release BRAT. |
| 2 | Bug fixes: Add Trade loop, Back/Clear All, pickers de data/hora | ✅ | Add Trade reutiliza instância; há Back/Clear; `mountDateField`. Picker de **hora** a confirmar. |
| 3 | TradeSyncer — Account Groups & Linker | ✅ | `AccountGroup`, grupos/copy, account picker no Add Trade e no import CSV; fim do `scope unknown`. |
| 4 | Menu de navegação lateral dedicado | ✅ | `SidebarView` (`tj-nav-sidebar`). |
| 5 | Eval Passed (modal escuro) + link bidirecional eval→funded | 🟡 | Celebração `.tj-acc-passed-banner/-band` existe. Falta o modal escuro em frente a tudo e o **arquivar/desarquivar** limpo sem criar funded a mais. |
| 6 | Main dashboard + períodos/filtros; agrupar por firm/size; dropdowns compactos | 🟡 | Period bar, filtros e dropdowns existem; agrupamento por firm/size por confirmar. |
| 7 | Trade Log dedicado + Payout Tracker | ✅ | `TradeLogView` + `payoutModal` / payouts widget. |
| 8 | Testes finais, polimento, lançamento BRAT | ⬜ | Depende do lançamento (ver `RELEASE-AND-DISTRIBUTION.md`). |

---

## 3. Plano v0.4.0 (trading jounral.md)

| Item | Estado | Nota |
|---|---|---|
| Remover `.tj-app-nav` flutuante e repor branding | ✅ | Nav passou a sidebar view dedicada. |
| Calendário: cor de **break-even** | ✅ | Dias a $0 têm tratamento próprio. |
| Calendário: **click → pop-up do dia** | ✅ | `openDayLogModal()` com resumo + tabela + filtros. |
| Trade **rating** (estrelas) | ✅ | `tj-add-stars` + rating no detalhe. |
| Campos **MAE/MFE** | ⛔ | Exigem dados de excursão que não recolhemos de propósito (a investigação original foi arquivada). |
| Scatter MAE/MFE | ⛔ | Depende do anterior. |
| **Radar / Score** (Zella style) | ✅ | `renderScoreRadar()` com anel + radar. |
| Cumulative P&L com **gradiente** | ✅ | `renderAreaChart` verde acima / vermelho abaixo. |
| **Voz local / speech-to-text** | ⬜ | Registado para o futuro (Web Speech API, 100% offline). |
| Harness/build/deploy/release | ✅→ | Substituído: hoje smoke 126 asserts, dev v0.5. |

---

## 4. Ideas from IDEIAS.md (voice notes)

| Ideia | Estado | Nota |
|---|---|---|
| Contas: celebration ao passar a eval + upgrade para funded + arquivar/apagar | 🟡 | Banner existe; upgrade/arquivo a afinar. |
| Eval→funded bidirecional, arquivar/desarquivar sem duplicar | 🟡 | Requer decisão de modelo (ver §5). |
| Celebration em frente a tudo, fundo escuro | ⬜ | Ideia registada. |
| Calendário → trade log do dia com filtros | ✅ | Feito. |
| Trade Log bem pensado, filtros por ticker/dia | ✅ | Feito. |
| Espaço para **estratégias / testar estratégias** (sandbox) | 🟡 | View Strategies existe; sandbox de backtest não. |
| Main dash: seleção de contas, agrupar por firm/size, dropdowns, período | 🟡 | Maioria feita; agrupamento a confirmar. |
| Workspace dedicado, limpar código/personal info | 🟡 | `source/` feito; sanitização a confirmar. |
| Backup GitHub + lançamento público (BRAT) | 🟡 | Repo existe; release a preparar. |
| **Mobile app** | ⛔ | Ruled out ("too hard"). |
| Pesquisar outras plataformas para ideias | ✅ | (investigação arquivada). |
| Bug: Add Trade abre infinitamente | ✅ | Corrigido. |
| Bug: copy accounts → `scope unknown` | ✅ | Resolvido com account groups. |
| Linkar contas tipo Tradesyncer; grupos usados no Add Trade | ✅ | Feito. |
| Manual trade: default demo + contas escolhidas em cima | ✅ | Account picker no topo. |
| Data/hora por pickers; igual no CSV import | 🟡 | Data feito; hora a confirmar. |
| Back button + Clear all | ✅ | Feito. |
| Menu próprio tipo Obsidian | ✅ | Sidebar view. |
| Tab de Payouts: total retirado, eval fees gastas, net após payouts, consistência | 🟡 | Payouts + depósitos feitos; **eval fees** e consistência a confirmar. |
| Live accounts (Tradovate/brokers) + payouts | 🟡 | Tipo `live` existe; integração de broker fora de âmbito. |
| Track your payouts | ✅ | Feito. |
| **Keyboard mapping** | ⬜ | Registado. |

## 5. Ideias do Ideas.md (fixes e QOL)

| Ideia | Estado | Nota |
|---|---|---|
| Remover trades | ✅ | Bulk actions. |
| Tirar o 2.º Add Trade da Home | ✅ | Home é grid de widgets. |
| Refazer account settings; reorganizar opções; developer options; mais cores | 🟡 | Settings revistos; developer options por fazer. |
| Bug: trades demo apareciam na conta Tradeify | ✅ | Corrigido por scope. |
| Bug: settings dentro das contas não funcionava | ✅ | Corrigido. |
| Scroll das account settings volta ao topo | ✅ | Corrigido. |
| Menu fecha com click fora (sem botão close) | ✅ | Feito. |
| Refazer dashboard depois de mais funcionalidades | 🟡 | Iterativo. |
| Tirar "recent trades" da Home | ✅ | Já não renderiza. |
| Renomear "Dashboard" → "Home" e nomes mais óbvios | ✅ | `HomeView`. |
| Cor para **break-even day** | ✅ | Feito. |
| Trade sozinha com print em pop-up | ✅ | `openTradeModal()`. |
| Ideias TradeZella: playbooks | ⬜ | Não decidido (provável fora). |
| Microfone privado (voz) | ⬜ | Ver voz local. |
| Planned vs Realized | ⬜ | Por decidir. |

---

## 6. TradeBook/ideas/IDEAS.md

| Ideia | Estado | Nota |
|---|---|---|
| **Print Queue System** | ✅ | `PrintQueueView` (right sidebar, Ctrl+V → drag para cards). |
| **Add Trade Redesign** (card-based) | ✅ | `addTradePanel.ts`. |
| Per-Trade Review refinements (animações/hover) | 🟡 | Base feita; polish contínuo. |
| Strategy-specific review templates | ⬜ | Depende das estratégias. |
| **Psychology / mental state** (mood tag, checklist, tilt detection) | ⬜ | Registo; investigar Edgewonk tiltmeter / MindTradr. Visão futura (não construída). |

---

## 7. ROADMAP.md — visão acordada

| Item | Estado | Nota |
|---|---|---|
| Setups → **Strategies** (regras: instrumentos, stop fixo, target, size; auto-fill no Add Trade) | 🟡 | View Strategies existe; contrato completo + auto-fill por confirmar. |
| Strategies **sandbox / tester** (backtest isolado) | ⬜ | Registado. |
| Contas híbridas (templates por firm, valores copiados e editáveis) | ✅ | `props.ts`; Apex/Topstep/Tradeify/MyFundedFutures fase-1. |
| Sem campo de billing no v1 (privacidade) | ✅ | Confirmado. |
| Live personal vs live prop (`ownership`) | 🟡 | Modelo existe; por confirmar. |
| **Help / Tooltip Mode** (lightbulb) | ⬜ | Registado 2026-09-13; copy num `HELP` map. |
| Dashboard Templates | ⬜ | Depois de estabilizar widgets. |
| Drawdown widget (underwater curve) | ⬜ | Métrica Max DD existe; widget dedicado por fazer. |
| Rolling average widget (10/20/30/50) | ⬜ | Fase 2. |
| Setup/Strategy Performance widget | ⬜ | Depende das estratégias. |
| Trade Review widget | ✅ | "Needs Review". |
| Trading Score | ✅ | v1 com cinco eixos honestos e nullable; sem unlock/gameificação; Home usa as últimas 30 decisões as-of, Analytics usa o período seleccionado. |
| Animations: count-up + morph + toggle global | ✅ | Feito. |
| Animations: toggles por-animação | ⬜ | Registado. |
| R-multiples / risk-based RR | ⬜ | Precisa de campo Stop Loss por trade. |
| Identidade visual: hero row, donuts, gauges, winstreak, duration table, hourly table, toggle cumulativo | 🟡 | Donuts/radar/best-hours feitos; resto por fazer. |
| **Missed trades** (setups não tomados) | ⬜ | Pedido 2026-09-18. **Só no Add Manual Trade**: uma trade não executada não existe no CSV do broker, portanto nunca entra pelo import (confere com o TradesViz/Journalit — também só por registo manual). Motivo (hesitação, falta de confluência, emocional) + tags, a alimentar o motor de disciplina/mindset (§5, Psychology). Fica dentro do módulo de estratégias/psicologia. |
| **Tilt & psychology — limiares configuráveis** | ⬜ | Os limiares do flip card (revenge 15 min, <1 min, ≥2 losses seguidas, etc.) são heurísticas fixas. Quando abrirmos o módulo de estratégias/playbooks/mindset, pesquisar limiares reais e torná-los configuráveis por conta/tipo. Investigação desgastante — fazê-la só nessa altura. O mesmo módulo recebe as análises de **Hold zones** e **Order type** (saíram do flip card a 19 Set; ficam fixas lá). Registado 2026-09-19. |
| **Trade Log — Galeria** | ⬜ | Vista de cartões com o print grande (Journalit/TradeZella têm). Ficou fora da reconstrução do Trade Log (19 Set, §2.79) por decisão do trader — "depois, noutra passagem". Registado 2026-09-19. |
| **Trade Log — vistas guardadas (presets de filtros)** | ⬜ | Edgewonk deixa nomear um conjunto de filtros. A gaveta de filtros e as colunas já existem (19 Set); falta nomear/guardar e reabrir. Registado 2026-09-19. |
| **Trade Log — teclado (j/k e afins)** | ⬜ | A reconstrução trouxe Shift-clique e Cmd/Ctrl+A; navegação por teclado (j/k entre linhas, Enter abre, x selecciona) fica para a passagem seguinte. Registado 2026-09-19. |
| **Receita canónica — alinhar as outras superfícies** | ⬜ | A receita canónica é a **linguagem da página Accounts** (variante A, decidida a 19 Set; `UX-GUIDELINES` §6.1; `UI-CATALOG` §6.0): faixa de números num só cartão segmentado, listas em cartão translúcido raio 14, cabeçalhos `.tj-acct-h1`, chips/`.tj-attn-chip`. O **Trade Log já a adotou** (§2.81). Falta adotá-la em **Home** (os `.tj-card.tj-gridcard` com sombra) e na **página da conta** (`.tj-acc-*`) — a pedido do trader, a decisão aqui é a definição para tudo. Registado 2026-09-19. |
| **Trade Log — mecanismos da passagem seguinte** | ⬜ | Adiados por decisão do trader na passagem A (19 Set, §2.81): vistas guardadas/presets de filtros nomeados, edição inline na linha (estratégia/rating/tags), **group-by** (dia/semana/conta) com agregados no cabeçalho do grupo, densidade + estado de colunas persistido, badges por linha (mistake/tags/print) e clicar-uma-tag-para-filtrar, e teclado **j/k + Enter**. Registado 2026-09-19. |

---

## 8. Comparação de plataformas — decisões (investigação arquivada)

| Recomendação | Estado |
|---|---|
| Tier 1: sort por clique (persistido) | ⬜ |
| Tier 1: search box (symbol/setup/thesis) | ⬜ |
| Tier 1: Export CSV do filtrado | ⬜ |
| Tier 1: colunas opcionais Fees e Gross P&L | ⬜ |
| Tier 1: bulk Export | ⬜ |
| Tier 2: scale in/out visível (expandir fills, `closed/total`, split/merge) | 🟡 | `lib/fills.ts` existe; expor/corrigir por fazer. |
| Tier 3: "load more"/virtualização acima de ~500 linhas | 🟡 | Lista atual limita; virtualização por fazer. |
| ⛔ Explicitamente fora: formula columns, pivot/charts no log, trade replay, saved views, resize handles, MAE/MFE, query languages, enforcement de prop firm | ⛔ |

---

## 9. Payouts — follow-up

Do `PAYOUTS.md` e das ideias: falta decidir/confirmar **eval fees gastas**, **net profit
após payouts** e **métricas de consistência de levantamento**. Regra que manda: métricas
de performance **nunca** incluem cash-flows.

---

## 10. Bugs / dívida técnica conhecida

- `--tj-muted` usado com fallback mas nunca definido.
- CSS morto residual em `styles.css` (ex.: `.tj-review-card`, `.tj-small-card`,
  `.tj-manual-card`, `.tj-td-kpi-card`, `.tj-td-setup-card`, `.tj-acc-bcard`,
  `.tj-acc-perfcard`, `.tj-acc-tradescard`, `.tj-td-review-card`, `.tj-td-card-header`).
- `DEFAULT_TILES` ainda refere o tile `recent` (filtrado, mas é lixo de dados).
- Picker de **hora** nos formulários a confirmar (data já resolvida).
- Confirmar agrupamento por firm/size na Main dashboard.

---

## 11. Home revamp — fase 1 feita; consumidores por migrar

**Feito (fase 1 — fundação comum).** Uma única população
(`accountScope` + `journalDayKey` → `summarizeFinancials`) alimenta Net P&L, Closed trades,
Win Rate, Net Profit Factor, Avg Net Result per Trade e a curva cumulativa da Home.
Win/loss/breakeven sem qualificador = **sinal do Net da decisão agregada em scope**; o filtro
de período e os buckets de dia partilham a mesma chave. Ver `ARCHITECTURE.md` §"Uma população
financeira partilhada", `UX-GUIDELINES.md` §6.2 e `tests/selection.test.mjs`.

**Na mesma população, mas com base própria declarada (não é dívida):** Gross Profit Factor;
`remainingAccountPnl` (Remaining Account P&L, cabeçalho da Analytics) e `homeAccountMovement`
(Recorded Account Value / Accounts) — movimento registado, contrato do Accounts.

**Ainda na sua própria população ou classificação Gross — a migrar na fase seguinte:**

| Onde | O que |
|---|---|
| `lib/accountMetrics.ts` | `winRate`/`winCount`/`lossCount` e as vitórias do dia leem `t.pnl > 0` (Gross); o `profitFactor` devolvido é `grossProfitFactor` |
| `views/accountDashboard.ts:1101` | donut **"Win rate"** sem qualificador, com a base Gross |
| `views/accountsListView.ts` `statsFor()` | chip **"Win"** e win rate do cartão, contagem Gross (comentário explícito no código) |
| `lib/process.ts` | `streakStats` / `revengeStats` classificam pelo sinal Gross de `t.pnl` (dito no cabeçalho e no tooltip de `m.winstreak`/`m.lossstreak`) |
| `lib/metrics.ts` | `m.winhold` / `m.losshold` — "Avg Win/Loss Hold Time" parte de `t.pnl > 0` / `t.pnl < 0` |
| `lib/breakdown.ts` | `winSub()` — "% Gross-sign win rate" por bucket (lê `summary.gross.*`) |
| `lib/trends.ts` | linha "Gross-sign win rate" (lê `decision.gross`) |
| `lib/score.ts` | gate "no decided results" conta `t.pnl !== 0` (Gross); o PF que mostra é Net |
| `views/tradeLogView.ts:471` | filtro **Result** win/loss por sinal de `t.pnl` |
| `widgets/performanceCalendarWidget.ts` | scope próprio (todas as contas da lista, sem a regra de demos/arquivadas) apesar de usar o mesmo `summarizeFinancials` |

**Regra para decidir a migração:** o contrato só exige Net onde a palavra for *win/loss/
breakeven* sem qualificador **e** o número for um resultado. Onde já diz "Gross-sign" ou
"Gross profit factor", está correcto; migrar é mudança de produto, não correcção.

---

## 12. Fundação temporal — fases 1 + 1.1 feitas; consumidores e restantes decisões por fechar

**Feito (fase 1 + 1.1).** `lib/instant.ts` separa valor civil de instante e lê qualquer
timestamp por uma só regra (`Z`/offset → zona de origem → `need-zone`, com `gap`/`ambiguous`
reportados, nunca o relógio do SO). Imports novos, entradas manuais e pernas de copy gravam
`entry_instant`, `exit_instant`, `source_zone`, `instant_source` e `fills[].instant`. A **1.1**
corrigiu os dois blockers da auditoria: fracções sub-segundo em stamps naive (`tzOffsetMs`
truncava a segundos — `.123` saía `.246` e `.500`/`.900` eram falsos `gap` com perda de linhas) e
a provenance de **This computer** (`instant_source: system-zone` distingue a zona do computador
de uma zona declarada pelo ficheiro). Ver `QA-CHECKLIST.md` §2.107/§2.108 e `ARCHITECTURE.md`
(linha `lib/instant.ts`).

**Por fechar / por decidir:**

| Onde | O que |
|---|---|
| `views/*` (Calendar, Trade Log, Accounts, Home, Trade Detail) | leem `entryTime`/`exitTime` na **zona do journal**; devem passar a `entryInstant`/`exitInstant` quando existirem, e civil-for-visualização |
| `tz.ts` `toZone()`/`localToUtc()` | deixam de ser o caminho de leitura quando os consumidores migrarem; **nunca** parchear `toZone()` só por si |
| `csv.ts` `normStamp` | chaves de custo perdem a fracção e o offset em formato US (`.500`/`+05:30`); corrigir **antes de reimportar/casar Cash History** (caminhos distintos) |
| `importZone` (`""` → `detectSystemZone()`) | as notas dizem `system-zone`. Decidir se, a longo prazo, "This computer" passa a `need-zone` puro |
| `csv.ts:588` + `lib/fills.ts:117` | fills ordenados só pela hora civil — um trade que atravessa a meia-noite é **gravado** fora de ordem; há `fill.instant` para ordenar |
| `lib/fills.ts` `inferred()` | fills sintéticos não herdam `instant` do trade |
| `trade.timezone` | escrito e nunca lido; nos importados vale a zona do journal (≠ `source_zone`) — nunca escrever `source_zone` a partir dele |
| `addTradePanel.ts` | manual não escreve `timezone` (só `source_zone` + `instant_source`) — confirmar se passa a escrever `timezone` = journal zone |
| Payouts / depósits / ajustes | **eventos de data civil**: não ganham instante UTC à meia-noite (decisão de arquitectura, mantida) |

---

## Annex — naming shortlist (historical, 17 Sep 2026)

Parked record from `RELEASE-AND-DISTRIBUTION.md` §7.1. The decision was **Tradebook**
(18 Sep 2026; `id` migrated to `tradebook` before the first beta).

**Criterion:** must read as a *journal*; must hold upcoming modules (strategies,
psychology, reviews, copy groups, payouts); universal; free in the store.

**Finalists** (in `previews/naming-previews.html`): Tradebook · Touchstone · Tradekeeper ·
Bookkeeper · Anvil · Chartroom · Rulebook · Openbook.

**Also raised:** Deskbook, Desklog, Tickbook, Ticklog, Tapebook, Tapelog, Flowbook,
Flowlog, Riskbook, Risklog, Edgebook, Edgelog, Scorebook, Scorelog, Replog, Prooflog,
Sessionbook, Daybook, Daylog, Fillbook, Markbook, Planbook, Methodbook, Ledgerbook,
Chronicle, Tradediary, Notebook, Tradesheet, Deskpad, Tradefolio, Edgefolio, Marketcraft,
Edgecraft, Tradesmith, Mindlog, Trademind, Playbook, Reviewlog, Marketlog, Edgekeeper,
Ledgerkeeper, Chartbook, Benchbook, Foundry, Ephemeris, Seamark, Fieldnotes, Atlas,
Compass, Meridian, Keystone, Cornerstone, Tradestone, Ledgerline, Tradeprint.

**Store check:** `trading-journal` free; published journals are Journalit and Trader
Journal (`trader-journal`); taken: folio, almanac, forge, cadence, tradecraft, logbook,
propmove.
