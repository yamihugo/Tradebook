# PROJECT-SPEC.md — A Bíblia do Projeto

> **Estatuto:** este documento é a **bíblia do projeto** — o mapa autoritário. Qualquer
> chat novo (**Cody, Max, Nathan**, ou um agente qualquer) carrega-o no arranque e
> **não inventa nem contradiz** o que aqui está.
>
> **Bíblia, não lei.** As *regras* vivem nos docs normativos (`UX-GUIDELINES.md`,
> `STRATEGY-DATA-CONTRACT.md`, `COPY-TRADING.md`, `BACKUP-AND-EXPORT.md`,
> `RELEASE-AND-DISTRIBUTION.md`, `PAYOUTS.md`) e no `AGENTS.md`. Esta bíblia **liga**
> para eles e dá o essencial. O **catálogo** de UI (tokens/cards/states) vive em
> `UI-CATALOG.md`; a **estrutura do código** em `ARCHITECTURE.md`.
>
> **Estado:** revisto 2026-09-18. Canónico em `source/docs/`; `TradeBook/docs/` é symlink.

---

## 0. A linha que nunca cruzamos (ler primeiro)

**Isto é um journal, não uma prop firm. O journal reporta; a prop firm impõe.**
(product rule, 16 Sep 2026 — permanent.)

- Mostramos a regra, o espaço que resta, o uso e a direção. **Nunca** impomos: sem
  bloquear ordens, sem recusar trades, sem reter payouts, sem limites de trades, sem
  lockouts, sem bloqueio de símbolos.
- **Os números ficam honestos mesmo quando são maus** — um limite rebentado lê-se como rebentado.
- **Onde o nosso modelo é só um modelo** (pernas de copy, comissões simuladas) **dizemo-lo**:
  a plataforma é a fonte da verdade; nós somos o registo dela.
- O que só faz sentido para o back-office de uma firma **não pertence aqui**.

Declaração completa com fontes: `UX-GUIDELINES.md` §0. Cada ecrã novo é julgado pela
checklist no fim desse ficheiro.

---

## 1. Identidade & Arquitetura

### 1.1 Identidade

- **Plugin id:** `tradebook` — **permanente, nunca muda** (ver `RELEASE-AND-DISTRIBUTION.md`).
- **Nome visível:** Tradebook · **Autor:** YamiHugo · **Versão de manifesto:** 0.4.9 (dev 0.5).
- **Domínio:** journal de trading para futuros Tradovate (NQ/ES/MNQ/MES).
- **Princípio base:** 100% local — os dados são ficheiros markdown na vault, sem cloud nem subscrição.
- **Relógio do journal:** o journal mostra e guarda sempre o **wall-clock da zona do journal**
  (`settings.timeZone`, por omissão **`America/New_York` / ET** — a convenção de mercado dos
  futuros). Na importação, o CSV do broker é convertido da **zona de origem**
  (`settings.importZone`, ou auto-detectada / perguntada uma vez por broker) para a zona do
  journal; cada trade guarda o seu `timezone` congelado. As horas manuais aparecem etiquetadas
  com a zona (`ET`, `CT`, …). Nada é imposto: tudo é editável inline.

### 1.2 Entry point & registo

- **Classe:** `TradebookPlugin` em `src/main.ts`.
- **Vistas** (`main.ts`): Home `tradebook-home-view` · Dashboard `tradebook-dashboard-view` ·
  Strategies `tradebook-setups-view` · Print Queue `tradebook-print-queue` (right sidebar) ·
  Account dashboard `tradebook-account-dash-view` · Add Trade `tradebook-add-trade` ·
  Trade Log `tradebook-trade-log-view` · Accounts `tradebook-accounts-list-view` ·
  Trade Detail `tradebook-trade-detail-view` · Sidebar `tradebook-sidebar-view`.
- **Ribbon:** `grip` → Home · `wallet` → Accounts · `list` → Trade Log · `plus` → Add Trade.
- **Camadas, lib, data attributes:** ver `ARCHITECTURE.md`.

---

## 2. Design & Convenções

Tudo o que é catálogo (tokens `--tj-fs-*`/`--tj-fg-*`/`--tj-sp-*`, temas, cards por
view, states, tooltips, gráficos, convenções CSS/JS) vive em **`UI-CATALOG.md`**.

Regras que **não** se negociam (detalhe em `UX-GUIDELINES.md`):
- Escala de tipo única; contraste WCAG AA; **nunca** cor sozinha para transmitir estado.
- Alvos de toque ≥ 24×24; reordenar oferece setas além de drag.
- `styles.css` é prettier multi-line; prefixo `tj-`; **sem código nem CSS morto**.

---

## 3. Copy (textos) — princípios

- **UI em inglês.** Respostas dos agentes em **PT-PT**. *(Sem i18n.)*
- **Tom:** direto, calmo, premium; sem gamificação nem exclamações a mais.
- **Honestidade:** números maus leem-se como maus; modelo-only diz "model".
- **Nunca impor:** verbo de report, não de enforcement (§0).
- **Todo o texto de UI está inline nos views** (não há ficheiro de strings). Ao adicionar
  copy, seguir o tom acima; se for título reutilizável, centralizar na tabela certa
  (`CARD_TITLES`, `METRIC_TITLES`, `BAR_CATALOG`/`MINI_CATALOG`, `DEFAULT_LABELS`).
- **Navegação (labels fixos):** Home · Trade Log · Strategies · Accounts · Add Trade.
  Secções: Overview · Tools. Busca: placeholder "Search anything — date, symbol, P&L, strategy…".

---

## 4. Contratos de dados

- **Estratégias:** `STRATEGY-DATA-CONTRACT.md` — Setup = string simples; a verdade são as
  notas; comparação case-insensitive + trim; rename first-class; campos novos são aditivos.
- **Copy trading:** `COPY-TRADING.md` — entidade/campo, consumidores, "no wrong numbers"
  (conta = pernas próprias, dedupe por `copyBaseKey`, lifecycle, pernas congeladas).
- **Contas:** os templates de prop firm são **semente**; as regras são **copiadas para os
  dados do utilizador** — mudanças de firm nunca tocam em contas existentes.
- **Backup/export:** `BACKUP-AND-EXPORT.md` — Caso A: um ficheiro JSON re-importável
  `tradebook-backup-<YYYY-MM-DD>.json` em `backups/`. Caso B (CSV): depois do lançamento.
- **Payouts:** `PAYOUTS.md` — o journal não é prop firm; métricas de performance nunca
  incluem cash-flows.
- **Futuros/custos:** `futures.ts` é a fonte (NQ $20/pt, ES $50/pt, MNQ $2/pt, MES $5/pt).

---

## 5. Build · Test · Deploy

> Comandos completos e harness: **`AGENTS.md`** (não duplicar). Resumo:
> `npm run build` → 0; smoke em `~/trading-journal-smoke` → **142 PASS / 0 FAIL**;
> `node tools/ux-audit.mjs` → sem violações; deploy para
> `<vault>/.obsidian/plugins/tradebook/` (nunca `data.json`, verificar md5, pedir Ctrl+R).
> Artefactos em `/home/hugo/tj-out/`.

---

## 6. Mapa dos documentos

| Documento | É… | Carregado sempre? |
|---|---|---|
| `AGENTS.md` | regras de trabalho do repo; a lei | ✅ |
| `PROJECT-SPEC.md` | **esta bíblia**; o mapa | ✅ |
| `DEV-REFERENCE.md` | plataforma (Obsidian), BRAT, linguagens e links | ✅ |
| `UX-GUIDELINES.md` | regras de UX/design + §0 | ✅ |
| `STRATEGY-DATA-CONTRACT.md` | contrato de dados de estratégias | ✅ |
| `COPY-TRADING.md` | sistema de copy trading | ✅ |
| `RELEASE-AND-DISTRIBUTION.md` | versionamento/BRAT | ✅ |
| `PAYOUTS.md` | payouts + regra de cash-flows | ✅ |
| `UI-CATALOG.md` | tokens, cards, states, CSS convenções | referência |
| `ARCHITECTURE.md` | camadas + lib + data attributes | referência |
| `BACKUP-AND-EXPORT.md` | decisão de backup/export | referência |
| `ROADMAP.md` / `BACKLOG-AND-HISTORY.md` | ideias e estado (feito/por fazer) | referência |
| `QA-CHECKLIST.md` | registo vivo de QA (manter atual) | referência |

**Canónico vs espelho:** o canónico é `source/docs/`. `TradeBook/docs/` é um **symlink**
para o canónico — editar num sítio é editar no outro.

---

## 7. Registo de alterações

| Data | Alteração |
|---|---|
| 2026-09-17 | Criação da bíblia (v1): inventário completo de views, cards, tokens, states, copy, comportamentos e convenções. |
| 2026-09-17 | `TradeBook/docs` passou a symlink para o canónico; criado `DEV-REFERENCE.md`. |
| 2026-09-18 | **Renomeado para Tradebook**: plugin `id` → `tradebook`, classe `TradebookPlugin`, view types `tradebook-*`, deploy `.obsidian/plugins/tradebook/`, backup `tradebook-backup-<data>.json`, pasta por omissão `Tradebook/trades`. |
| 2026-09-18 | **Modelo de timezone**: relógio único (`settings.timeZone`, default ET); import converte da **zona de origem** para ET; cada trade guarda `timezone`; horas manuais etiquetadas com a zona; entry/exit time e preços editáveis inline. |
| 2026-09-18 | **Limpeza do repositório**: docs pessoais removidos; catálogo de UI movido para `UI-CATALOG.md` e arquitetura para `ARCHITECTURE.md`; a bíblia ficou só com lei + mapa (menos tokens por sessão). |
