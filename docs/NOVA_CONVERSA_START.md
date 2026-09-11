# 🚀 Prompt para Nova Conversa — Trading Journal

> **Instrução:** Copia TUDO abaixo desta linha e cola como primeira mensagem numa nova conversa do opencode. A IA terá todo o contexto para continuar o trabalho sem erros.

---

## Contexto do Projeto

Sou o **Hugo** (YamiHugo no GitHub / buymeacoffee). Estou a desenvolver um plugin para **Obsidian** chamado **Trading Journal** — um trading journal para futuros Tradovate (NQ, ES, MNQ, MES) com dashboard visual, gestão de contas prop, importação de CSV, review de trades, calendário, payout tracker e muito mais.

O projeto está em **desenvolvimento ativo**. O plugin já funciona e está deployado na vault de testes.

## Equipa (Agentes)

Trabalho com uma equipa de agentes IA organizada:

- **Patrick Planner** — Coach/treinador, organiza tarefas e todo lists, coordena a equipa
- **Cody Codes** — Code prodigy, implementa tudo
- **Inspetor Max** — Security Manager, revisão de código e segurança
- **Nathan Notes** — Documentation genius, documentação clara

Fala comigo em **português**. A UI do plugin fica em **inglês**.

## Regras Importantes

1. **NÃO mexer na vault pessoal do Hugo** (`/home/hugo/Obsidian/Hugo/`) — desenvolvimento é só na vault `Trading Journal`
2. Deploy **APENAS** para: `/home/hugo/Obsidian/Trading Journal/.obsidian/plugins/trading-journal/`
3. Prefixo CSS: **`tj-`** (nada de `hj-` ou outros)
4. Nome da classe: `TradingJournalPlugin`, interface: `TradingJournalSettings`
5. Plugin id: `trading-journal`, autor: `YamiHugo`
6. Isolamento de trades por conta: match **estrito** por nome/mapeamento, NUNCA por `accountType === scope`
7. `.addClass()` no Obsidian aceita **uma** classe por chamada
8. O harness (testes automáticos) está em `/tmp/hj-smoke/rep-chart3.js` e usa fixtures em `test-fixtures/trades/`

## Caminhos Exatos

| Recurso | Caminho |
|---|---|
| **Código fonte** | `/home/hugo/Obsidian/Hugo/Hugo Journal/plugin-source/` |
| **Source (src/)** | `/home/hugo/Obsidian/Hugo/Hugo Journal/plugin-source/src/` |
| **Deploy (vault dev)** | `/home/hugo/Obsidian/Trading Journal/.obsidian/plugins/trading-journal/` |
| **Vault de testes** | `/home/hugo/Obsidian/Trading Journal/` |
| **Fixtures de teste** | `/home/hugo/Obsidian/Hugo/Hugo Journal/plugin-source/test-fixtures/trades/` |
| **Harness (testes)** | `/tmp/hj-smoke/rep-chart3.js` |
| **Manifest** | `/home/hugo/Obsidian/Hugo/Hugo Journal/plugin-source/manifest.json` |

## Comandos Essenciais

```bash
# BUILD (tsc + esbuild production)
cd "/home/hugo/Obsidian/Hugo/Hugo Journal/plugin-source" && npm run build

# TESTAR (harness 81/81 asserts)
cd /tmp/hj-smoke && NODE_PATH=/tmp/hj-smoke/node_modules node rep-chart3.js

# DEPLOY (só vault dev)
cp -v main.js styles.css manifest.json "/home/hugo/Obsidian/Trading Journal/.obsidian/plugins/trading-journal/"
```

## Estado Atual (2026-09-11)

- **Versão:** `0.1.1`
- **Build:** limpo, tsc sem erros
- **Testes:** 81/81 PASS ✅
- **Deploy:** feito na vault Trading Journal, md5 verificado
- **Vault pessoal:** NÃO foi tocada neste round
- **Fixtures:** 40 trades reais em `test-fixtures/trades/` (o harness não lê a vault pessoal)
- **Git:** NÃO iniciado ainda — é o próximo passo

## Estrutura do Código

| Ficheiro | Responsabilidade |
|---|---|
| `main.ts` | Classe `TradingJournalPlugin`, registo de vistas, load/save settings, `loadTrades()`, `mappedAccount()`, `openAddPanel()` |
| `ui.ts` | `renderAppShell` — header (brand TJ, tabs centrados, + Add Trade), sidebar off-canvas, helpers, constantes |
| `settings.ts` | `TradingJournalSettingsTab` — abas Storage/Timezone/Accounts/Account Rules/Mapping/Support |
| `types.ts` | Modelos de dados (Trade, TradeNote, PropAccount, Payout, etc.) |
| `storage.ts` | Frontmatter parse/write das notas de trade |
| `csv.ts` | Parsing de CSVs Tradeovate |
| `futures.ts` | Tick values (NQ 20, ES 50, MNQ 2, MES 5) e conversões |
| `props.ts` | Base de dados de firms/programas/regras (TopStep, Tradeify, Apex, etc.) |
| `addTradeModal.ts` | Modal de nova trade |
| `views/dashboard.ts` | Dashboard principal com KPIs, gráfico equity, daily blocks, etc. |
| `views/calendar.ts` | Calendário com heatmap e clique por dia |
| `views/accountDashboard.ts` | Dashboard por conta individual |
| `views/accountsListView.ts` | Lista de contas com cards agrupados por firm |
| `views/addTradeView.ts` + `addTradePanel.ts` | Vista de Add Trade (split CSV/Manual) |
| `views/importView.ts` | Importação de CSV |
| `views/tradeLogView.ts` | Log de trades com filtros |
| `views/tradeDetailView.ts` | Detalhe de trade com prints inline e review |

## Funcionalidades Implementadas

- Header uniforme em todas as vistas: brand "TJ" (menu), tabs centrados (Dashboard/Calendar/Accounts), "+ Add Trade" à direita
- Dashboard: KPIs, equity chart (area+line), daily P&L blocks, hourly, symbol breakdown, needs review, recent trades
- Add Trade: modal com 2 colunas (CSV dropzone + Manual)
- TradeDetail: prints inline (1+), Commissions & Fees unificado, Contracts card, Gross P&L separado, back button, campos setup/review/mistake
- Accounts: cards sem sobreposição (createDiv), grid 240px+, KPIs compact flex
- Isolamento estrito de trades por conta (match por nome/mapeamento)
- Calendário: heatmap, clique por dia → Trade Log
- Trade Log: filtros (símbolo, pesquisa, período), back/forward, clear all
- Payout Tracker para contas funded/live
- Eval → Funded celebration modal
- Settings: Storage, Timezone, Account Configuration, Account Rules, Mapping, Support (Buy me a coffee)
- CSV import: Tradeovate format, round-trip pairing FIFO
- Timezone handling (Europe/Lisbon default)
- Mobile-ready (isDesktopOnly: false)

## Roadmap — Próximos Passos (por ordem de prioridade)

### 1. Git + GitHub (IMEDIATO)
- `git init` no `plugin-source/`
- Criar `.gitignore` (excluir `node_modules/`, `test-fixtures/` da vault pessoal)
- Commit inicial
- Criar repositório no GitHub (privado primeiro)
- Push + tag v0.1.1

### 2. Rework de Settings/Accounts
- Esconder "account type classification" numa secção "Do not touch" (backend)
- Live como account type com full customization
- Remover/simplificar "scope" (confuso para o usuário)
- Naming automático de contas (TDFYG-1/2/3 com reconhecimento de firm)
- Perguntar a que conta pertence uma trade reconhecida
- Agrupar/selecionar contas nas settings e no Add Trade

### 3. README Profissional
- Rewriting completo para público
- Screenshots/descrição das features
- Instruções de instalação (manual + BRAT)

### 4. BRAT + Community Plugins
- Criar release no GitHub
- Configurar BRAT manifest
- Publicar para community plugins do Obsidian

### 5. Backlog
- Sistema de teste de estratégias/backtest
- Mais funcionalidades conforme feedback do Hugo

## Notas Abertas

- Nome final do projeto: **"Trading Journal" é provisório** — futuramente pode mudar
- Quando o plugin estiver estável, Hugo instala do zero na vault pessoal e testa com as trades reais
- Dados pessoais foram removidos do código (author: YamiHugo, fundingUrl: buymeacoffee, sem referências a "Hugo Journal")
- **IMPORTANTE:** ao editares ficheiros, verificar sempre se o `npm run build` passa antes de dar por terminado

## Primeiro Passo Nesta Conversa

Começar pelo **Git + GitHub**:
1. Verificar estado atual do código (`npm run build` + harness 81/81)
2. Criar `.gitignore` adequado
3. `git init` + primeiro commit
4. Criar repositório GitHub
5. Push + tag v0.1.1
6. Depois avançar para o rework de Settings/Accounts
