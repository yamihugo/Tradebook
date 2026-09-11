# Trading Journal — Contexto do Projeto (handoff)

> Cola este documento no início de uma nova conversa do opencode para começares com o contexto completo.

## O que é o projeto

Plugin para **Obsidian** (TypeScript) — um *trading journal* para futuros Tradovate (NQ, ES, MNQ, MES) com:
- importação de CSV (Reports → Executions/Fills ou Orders) + entrada manual de trades
- pareamento automático de round-trips (FIFO por conta/símbolo) e P&L realizado em $
- classificação automática de contas (funded → eval → demo → live) por keywords configuráveis
- dashboard visual: KPIs, gráfico de P&L acumulado, heatmap diário/hora, breakdown por símbolo, "Needs Review"
- contas prop com dashboard por conta e limites reais (profit target, max loss, daily loss, consistency)
- Payout Tracker para contas funded/live
- Trade Log com filtros (símbolo, pesquisa, período), detalhe de trade com screenshots inline e review
- calendário que abre o log por dia
- celebração modal "Eval Passed → Funded"
- menu off-canvas lateral (mesma "app shell" em todas as vistas), header com brand, tabs centradas e "+ Add Trade"

## Estado atual (2026-09-11)

- Renomeado de **Hugo Journal → Trading Journal**: id `trading-journal`, classe `TradingJournalPlugin`, prefixo CSS `tj-`, header brand "TJ". Autor: `YamiHugo`, fundingUrl: buymeacoffee.
- Build limpo (`npm run build`, tsc strict), harness **81/81 PASS** (`/tmp/hj-smoke/rep-chart3.js`).
- Deploy atual só na **vault de desenvolvimento**: `/home/hugo/Obsidian/Trading Journal/.obsidian/plugins/trading-journal/`
- **REGRA IMPORTANTE:** não mexer na vault pessoal do Hugo (`/home/hugo/Obsidian/Hugo/`). Desenvolvimento/testes = vault `Trading Journal`. Quando o plugin estiver estável, o Hugo instala do zero na pessoal.
- Harness usa fixtures em `plugin-source/test-fixtures/trades/` (cópia de 40 trades reais) — não lê a vault pessoal.

## Comandos

```bash
# build (tsc noEmit + esbuild production)
cd "/home/hugo/Obsidian/Hugo/Hugo Journal/plugin-source" && npm run build

# testes (mock jsdom; 81 asserts)
cd /tmp/hj-smoke && NODE_PATH=/tmp/hj-smoke/node_modules node rep-chart3.js

# deploy (só para a vault de desenvolvimento Trading Journal)
cp -v main.js styles.css manifest.json "/home/hugo/Obsidian/Trading Journal/.obsidian/plugins/trading-journal/"
```

## Estrutura do código (src/)

| Ficheiro | Responsabilidade |
|---|---|
| `main.ts` | Classe `TradingJournalPlugin`, registo de vistas, load/save settings, `loadTrades()`, `mappedAccount()`, `openAddPanel()` |
| `ui.ts` | `renderAppShell` — header (brand TJ, tabs centradas, + Add Trade), sidebar off-canvas, helpers e constantes (ACCOUNT_FILTERS, SCOPE_OPTIONS, firm props) |
| `settings.ts` | `TradingJournalSettingsTab` — abas Storage/Timezone/Accounts/Account Rules/Mapping/Support |
| `types.ts` | modelos de dados (Trade, TradeNote, PropAccount, Payout, etc.) |
| `storage.ts` | frontmatter parse/write das notas |
| `csv.ts` | parsing de CSVs Tradeovate |
| `futures.ts` | tick values (NQ 20, ES 50, MNQ 2, MES 5) e conversões |
| `props.ts` | base de dados de firms/programas/regras |
| `addTradeModal.ts` | modal de nova trade |
| `views/` | `dashboard.ts`, `calendar.ts`, `accountDashboard.ts`, `accountsListView.ts`, `addTradeView.ts` + `addTradePanel.ts`, `importView.ts`, `tradeLogView.ts`, `tradeDetailView.ts` |

## Convenções importantes

- UI em **inglês**; falar com o Hugo em **português**.
- **CSS prefix `tj-`** em tudo (nada de `hj-`).
- Isolamento de trades por conta: match estrito por nome/mapeamento (`mapped.id === acc.id` OU nome exato) — NUNCA por `accountType === scope`.
- `.addClass()` no Obsidian aceita **uma** classe por chamada (não juntar com espaço).
- Formatos de dates no frontmatter das notas de trade; timezone tratada por `tz.ts`.
- Prints: resolver em `tradesFolder/prints/`, etc.

## Roadmap (pendente)

1. **Settings/Accounts rework**: esconder "account type classification" (secção backend "do not touch"), Live como account type customizável, remover "scope", naming automático de contas (ex. TDFYG-1/2/3), perguntar a que conta pertence uma trade reconhecida.
2. **Git/GitHub**: `git init` em `plugin-source/`, `.gitignore` (node_modules, main.js opcional), repositório privado→público, README profissional, licença MIT (já criada).
3. **BRAT**: release + BRAT manifest para instalar por um clique; depois candidatura a community plugins do Obsidian.
4. **README final profissional** (pensar em conjunto com o Hugo).
5. Backlog: sistema de teste de estratégias/backtest dentro do journal (ideia do Hugo).

## Perguntas/notas abertas

- Nome final do projeto ainda não decidido ("Trading Journal" é provisório).
- Futuro: instalar do zero na vault pessoal e testar com as trades reais.
