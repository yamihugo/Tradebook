---
title: Strategies 2.0
date: 2026-09-19
tags: [strategies, roadmap, vision, plan, 2.0]
aliases: [Strategies 2.0, Estratégias 2.0, Plano das Estratégias]
---

# Strategies 2.0 — visão e plano

> [!note] TL;DR
> No **1.0** uma estratégia é **só um nome** — serve para marcar setups. O **2.0**
> (≈um mês de desenvolvimento) transforma isso num sistema completo: estratégias
> registadas com documentação própria, um **sandbox** para testar ideias sem sujar as
> estatísticas, um **readiness score** que diz quando é sensato passar uma estratégia a
> real, e uma ligação à **psicologia/disciplina**. A regra que manda em tudo: o 2.0
> **não pode** partir journals existentes, perder informação, nem obrigar ninguém a
> começar de novo.

> [!important] A linha que nunca cruzamos (§0)
> Isto é um journal, não uma prop firm. O sistema **mostra** regras, compliance e
> prontidão — **não impõe** nada. Nenhuma estratégia é bloqueada, nenhum trade é
> recusado, nenhum limite é forçado.

---

## 1. O que já existe (1.0)

- `setup` é uma **string simples** no frontmatter da nota (nunca um id, objeto ou array).
- A verdade são as **notas**; `settings.setups` é apenas um índice/cache e
  `knownSetups()` reconstrói a lista varrendo as notas.
- Comparação **case-insensitive + trim**; **rename** atualiza todas as notas.
- Campos novos são **aditivos** com defaults seguros.
- A página **Strategies** lista os nomes com contagem e P&L; adicionar/renomear/remover.

Isto **fica como está**. Não se toca no comportamento do 1.0 antes do beta.

---

## 2. A visão (2.0)

1. **Estratégias registadas.** As tuas próprias estratégias, com nome e identidade.
2. **Documentação dentro de cada estratégia.** Ferramentas para o trader ser tão
   detalhado quanto quiser (regras, condições, playbook, exemplos, notas ligadas).
3. **Sandbox de testes.** Uma área para estratégias em que ainda não confias, onde os
   trades de teste **não contaminam** as estatísticas do journal real.
4. **Readiness score.** Regras por omissão (ou definidas pelo trader) para uma
   estratégia "cumprir"; um **% de compliance** que **cresce com o tempo** e com o
   número de trades — exigindo X trades, X meses, X dias distintos, X win-rate —
   produzindo um **score de prontidão** que diz quando é mais aconselhável passar a
   estratégia a real.
5. **Psicologia / disciplina.** Provavelmente uma página própria, mas **ligada** ao
   resto (a estratégia, o setup, o trade). Tudo interligado.

---

## 3. Fundação (o que se prepara AGORA, sem construir o 2.0)

Estas decisões não se vêem no ecrã, mas são o que garante que o 2.0 não parte nada.

> [!note] Já implementado na 1.0 (AL, 19 Set)
> As três primeiras decisões já são reais: `settings.strategies` guarda registos, o
> `settingsVersion` subiu a **2** com a migração idempotente `migrateStrategies()`, e
> registar uma estratégia escreve `library/strategies/<nome>.md`. O formulário **pede**
> (Add Trade força uma escolha, com *No strategy* explícito; o import tem campo opcional)
> mas o motor **não impõe** — nada é bloqueado (§0).

- **ID estável para estratégias.** O registo passa a `{id, name, createdAt}`. A nota
  guarda o **nome** legível; o **id** é que manda. Renomear atualiza o registo; um nome
  que aparece numa nota e não consta do registo fica **"untracked"** — nunca é perdido.
- **`settingsVersion` + migrações numeradas e idempotentes.** Antes de mudar formatos,
  o journal sabe em que versão está e transforma uma vez, sem repetir. (O Journalit faz
  isto por-feature; ver §6.)
- **Estratégia = uma nota na vault.** `Tradebook/library/strategies/<nome>.md`. As
  regras, a documentação e a prontidão vivem na **nota** — portável, pesquisável e
  legível mesmo sem o plugin. `data.json` fica só como índice.
- **Reservar `tradeType: regular | missed | backtest`.** Para que os trades de teste
  (sandbox) e os "missed trades" tenham casa sem quebrar dados.
- **Preservar campos desconhecidos do `data.json`.** Regra fixa: nunca apagar o que não
  conhecemos.

Ver `docs/STRATEGY-DATA-CONTRACT.md` (contrato) e `docs/VAULT-STRUCTURE.md` (pastas).

---

## 4. Split 1.0 ↔ 2.0

| Tema | 1.0 (agora) | 2.0 (≈1 mês) |
|---|---|---|
| Estratégias | Nomes + página simples | Notas com identidade + documentação |
| Stop/target/size | Manual no Add Trade | Auto-preenchidos pela estratégia |
| Testes | — | Sandbox isolado (`tradeType: backtest`) |
| Prontidão | — | Compliance % + readiness score |
| Psicologia | — | Página ligada (mindset) |
| Missed trades | — | `tradeType: missed` |
| Hold zones / Order type | Removidos do flip card | Voltam dentro de estratégias/playbooks |

---

## 5. Perguntas em aberto

1. **Onde vive o teste?** Os trades de sandbox ficam na mesma nota de trade (com
   `tradeType: backtest`) ou numa pasta própria dentro do ano?
2. **O que conta para a compliance?** Que métricas (nº de trades, meses, dias distintos,
   win-rate) e que limiares por omissão? Configuráveis por estratégia?
3. **Readiness é por estratégia ou por conta?** Uma estratégia pode estar pronta numa
   conta e não noutra?
4. **A página de psicologia** é separada mas partilha o registo de estratégias — ou é um
   domínio à parte que só linka?
5. **Migração dos nomes existentes:** os nomes já escritos nas notas ganham id
   automaticamente no primeiro arranque do 2.0 (criar registo a partir das notas).

---

## 6. Referências — o que o Journalit faz (investigação local)

Lido do bundle e da vault (`/home/hugo/Obsidian/Trading 1/!Journalit`):

- **Setup = nota** com `journalit-setup: true` no frontmatter e `tags`; corpo com
  `## Details` (Status, Direction, Color, Preferred Timeframes, Preferred Tickers),
  `## Rules` (Best Conditions · Entry Criteria · Invalidation · Risk/Management ·
  Avoid When · Common Mistakes), `## Playbook`, `## Common Mistakes`, `## Linked Notes`.
- **Notas ligadas = notas normais da vault** (md ou excalidraw), ligadas por caminho —
  não são privadas do plugin.
- **Tipo de trade:** `regular | missed | backtest` (`isBacktestTrade`, `isMissedTrade`,
  `missedReason`). O conceito de sandbox existe ao nível do trade.
- **Sem readiness/score** — não têm o sistema de prontidão.
- **Migrações por-feature:** chaves tipo `tradeReviewMarkdownMigrationVersion`,
  `graphLinkMigrationVersion`, `tradingDayCutoffEndOfDayMigrationVersion`.
- **Backup:** cópia JSON do `data.json` na pasta do plugin (`data.backup.json`,
  `data.pre-reset-backup.json`); qualquer caminho com `-backup-` é ignorado nas
  varreduras. **Não têm export para zip.**

---

## 7. Coisas a evitar

- **Não** pôr regras/documentação só no `data.json` — perder-se-iam num backup
  só-vault ou numa desinstalação.
- **Não** tornar a estratégia obrigatória nem validar/recusar trades (§0).
- **Não** mudar o formato de `setup` na nota sem migração — os journals existentes têm
  de continuar a ler.
- **Não** construir o 2.0 antes de o 1.0/beta estar estável e as decisões de fundação
  estarem escritas.
- **Não** reservar pastas/features especulativas (ex.: o "board" foi descartado — não
  era um pedido).

---

## Related Notes
- [[STRATEGY-DATA-CONTRACT]]
- [[VAULT-STRUCTURE]]
- [[ROADMAP]]
- [[BACKLOG-AND-HISTORY]]
- [[PROJECT-SPEC]]
