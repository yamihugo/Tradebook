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
| 2026-09-18 | **Conformidade com as regras oficiais do Obsidian**: auditoria às developer docs; workflow CI com *build provenance attestation* e release em *draft*; `innerHTML`/`outerHTML` eliminados do `src/`; regras de plataforma (deferred views, lifecycle, sentence case) em `DEV-REFERENCE.md` §1.2; submissão via `community.obsidian.md` + ESLint oficial em `RELEASE-AND-DISTRIBUTION.md` §8–9. |
| 2026-09-18 | **Logos das firms embutidos no bundle**: como Obsidian/BRAT só descarregam `main.js`/`manifest.json`/`styles.css`, os 4 PNGs passam a ser *data URIs* (esbuild `loader: dataurl` + `src/globals.d.ts`); `firmLogoUrl()` devolve o data URI. PNGs otimizados (128px, 220KB→28KB). `README.md` ganha tutorial de instalação via BRAT + nota de segurança de dados; criado `KNOWN-LIMITATIONS.md`. |
| 2026-09-18 | **Custos persistem (A)**: `commission` e `fees` passam a ser escritos no frontmatter da nota e lidos no parser (`storage.ts`); antes viviam só nas pernas de fill e desapareciam no primeiro reload (Fees $0,00). Sem migração — re-importar. |
| 2026-09-18 | **Custos órfãos (B)**: linhas de custo que a Cash History cobra por execução mas o Orders agrega numa ordem passam a **colar-se** ao trade quando é óbvio (mesmo contrato + timestamp dentro de entry→exit ±2 min); o que sobra vira um **custo datado da conta** (`FeeAdjustment.kind:"cost"`, oculto do modal *Correct fees* mas no saldo) e o review de import mostra *platform · glued · in account* + comparação ✓/⚠ com o `Amount` final da Cash History. `ImportCosts` perdeu os campos mortos `matched`/`unmatched`/`paired`/`deposits`. |
| 2026-09-18 | **Delete duro (C)**: apagar uma conta passa a remover também registos (payouts, depósitos, correções/custos), mapeamentos, laços de copy **e as notas de trade para o lixo do Obsidian** (`vault.trash`), com dupla confirmação que lista exatamente o que morre. |
| 2026-09-18 | **Arquivo fora de tudo (D)**: contas arquivadas saem das métricas de performance, do saldo da carteira e dos totais (Home e portefólio); os trades mantêm-se acessíveis no Trade Log e Strategies. `activeAccounts()`/`isArchivedTrade()` centralizam a regra. |
| 2026-09-18 | **Ordem do header da conta (E)**: payout (carteira) · Correct fees (recibo) · Account settings (roda) — o gear fica no canto direito. |
| 2026-09-18 | **Guard de conta no import (F)**: o CTA `Import N trades` está desativado enquanto não houver ≥1 alvo (um nome da CSV mapeado para conta **ou** uma conta marcada em *also record these trades in*), com mensagem inline "Select at least one target account to proceed."; trades sem conta **não são escritos** e o review diz quantos ficaram de fora. |
| 2026-09-18 | **Import honesto (G)**: o recibo deixa de reportar o pedido (`trades.length`) e passa a provar o gravado — depois de `storeTrades`, relê a vault e confirma cada nota esperada; se 0 notas ou alguma não confirmada, mostra `Retry` e uma `Notice`, nunca "Done". Corrige o falso-sucesso intermitente. |
| 2026-09-18 | **Foco do saldo no Correct fees (H)**: o campo "What I have" foca ao abrir e ao clicar em qualquer ponto da linha; `:focus` passa a `--interactive-accent` (hover mantém `--text-muted`). |
| 2026-09-18 | **Janela automática do Correct fees (I)**: início = dia a seguir ao `period.to` da última correção (ou `createdAt`); fim = último dia com trade da conta (editável). Os trades são casados por **id** (`mappedAccount`), não por nome. |
| 2026-09-18 | **Motor de fees proporcional (J)**: `allocateEqually` → `allocateProportional` (por nº de contratos, cêntimos inteiros, maior-resto, soma exata); o Post-Trade Review mostra "Fees corrected" (etiqueta **model**) ao lado das Fees reais da plataforma, via `feeForTrade`/`allocatedKeysFor` — nenhuma nota é reescrita. |
| 2026-09-18 | **Follow-up do Correct fees (K)**: foco do saldo fiável (handler no `.tj-mg-row` inteiro em `mousedown` + reposição após cada render, fundo accent no `:focus`); helper sob "Spread over"; **chave de fatia endurecida** (`tradeFeeKeys` = `fillId` → caminho da nota → composta antiga como fallback, casamento por qualquer variante) com **aviso de fatias órfãs** no modal; a linha "Fees" do Post-Trade Review passa a mostrar `$total · $X corrected` com tooltip *model* (linha separada fundida). |
| 2026-09-18 | **Contas dirigidas pelo utilizador (L)**: o wizard passa a ter 4 passos (Type · Identity · Rules · Review) e as regras são escritas pelo trader — target/max loss ($ ou %), daily loss, tipo de drawdown, posição e dias mínimos; o preset de firm é apenas um ponto de partida opcional (Journalit-style), nunca a espinha. Passo 2 junta nome, saldo inicial (um só campo, que é o `size`) e uma grelha de logos (prop firms + brokers + Own em símbolo CSS + iniciais "Custom"); `PropAccount.branding` guarda `packaged`/`initials`. Novo resolvedor `lib/accountRules.ts` (`resolveAccountView`) serve Home, cartões, conta e Settings — o antigo hard-fail "Unknown firm/program" desapareceu. `lib/firmLogos.ts` centraliza o catálogo e os data URIs (faltam 8 PNGs por colar). "Quick add" saiu das Settings: o wizard é a única porta. Management: banners → tooltips `(i)`, empty state de copy groups com diagrama de nós, badges LEADER/COPIER (adeus 👑), tipos em pills. |
| 2026-09-18 | **Polimento do wizard (M)**: passo 1 com ícones Lucide (adeus emojis) e cartão ativo com borda `--interactive-accent` + glow discreto; passo 2 com o **nome ligado ao saldo/firm** (auto `Topstep · $100K`, editável; `nameTouched` liberta a ligação e "Create & add another" volta a ligá-la), grelha de marcas em 3 secções (Prop firms · Brokers · Practice) com pills de altura fixa e iniciais "Custom"; passo 3 em grelha de 2 colunas com `$`/`%` como afixos estáticos dentro do campo e um toggle `$ | %` inline (adeus `<select>`); passo 4 com tabela chave-valor (rótulos muted, valores à direita a 700) e stepper de lote proeminente. `firmLogos` ganha o grupo `practice` (id `own` mantém-se). |
| 2026-09-18 | **Wizard, passo 2/3 (N)**: passo 2 com **Nome + Saldo numa linha de 2 colunas** (`.tj-wz-row-2`, empilha <560px) para o modal não crescer com a grelha de marcas. Passo 3: dropdown de drawdown endurecido dentro do modal (`.tj-account-wizard .tj-dd-*` com `!important`, porque o Obsidian pinta os botões por cima — parecia um `<select>` nativo); toggle `$ | %` com track (`.tj-wz-untoggle`) e contraste subido. Presets de firm substituídos por **5 tamanhos genéricos Standard** (25/50/100/150/300K) que preenchem só as regras — target/max loss/daily loss a 6%/4%/2% — **nunca o saldo**; o aviso de que as regras das firms mudam fica sempre visível. |
| 2026-09-18 | **Import, conta de destino (O)**: o importador deixa de escrever para o vazio. `guessMapping()` resolve cada nome da CSV por ordem de certeza — conta que já responde ao nome → **a única conta do journal** (depois de um reset não há o que adivinhar) → `settings.lastImportAccountId` → `settings.lastCreatedAccountId` → "Leave unassigned". Um **único tick** em *Also record these trades in* passa a servir de conta-base quando não há mapping (`tickBaseId()`) e é retirado do broadcast de pernas (sem trade escrita duas vezes). O wizard grava a conta criada em `lastCreatedAccountId`; o dropdown do importador grava `lastImportAccountId`. **Tipo do ficheiro lido pelo header** (`csvKind()`: `cash` · `orders` · `fills` · `unknown`), com mensagem explícita para um ficheiro que não é Orders/Fills em vez de um silêncio. |
| 2026-09-18 | **Wizard, passos 2/3 (P)**: o passo 2 passa a ser **só marca** (grelha Prop firms · Brokers · Practice · Custom, sem nome nem saldo) e o passo 3 passa a "Account" — **preset no topo** (`Standard · $50K`), depois **Nome + Saldo inicial** na linha de 2 colunas, depois as regras. Escolher um preset preenche o **saldo** (= `size`), o **nome** (auto `Tradeify · $50K`, via `baseName()` enquanto `nameTouched` for falso) e target/max loss/daily loss (6%/4%/2%). Passos renomeados para Type · Brand · Account · Review e `flow()` = `[0,1,2,3]` para todos — personal/demo fazem o passo 3 só com a identidade. Isto **inverte a decisão anterior** "o preset nunca toca no saldo". |
| 2026-09-19 | **Wizard, passo 3 (Q)**: sai o campo manual *Initial balance* — o tamanho escolhe-se só pelo dropdown (`$25K · $50K · $100K · $150K · $300K · Custom…`, sem a palavra "Standard"), com **Custom…** a revelar um campo `$` cujo valor actualiza o tamanho **e** o nome da conta (`Tradeify · $37K`). As regras continuam a encher-se a 6%/4%/2%. Novo campo **Started on** (obrigatório): sem tamanho e sem data o `Next` fica desactivado, com o helper "Choose a size and a start date to continue." — é esta data que impede o filtro `t.date < acc.createdAt` de esconder histórico importado. |
| 2026-09-19 | **Wizard, passo 3 (R)**: o **Account size** passa a nascer **vazio** e é obrigatório — já não vem `$50K` por omissão, para que o trader declare sempre o tamanho. O `Started on` nasce também **vazio** (não a data de hoje). O `Next` só desbloqueia com **tamanho > 0 E data** escolhidos, e o helper diz só o que falta: "Choose a size and a start date to continue." · "Choose a size to continue." · "Choose a start date to continue.". O nome mostra só a marca enquanto não há tamanho (`Tradeify`) e passa a `Tradeify · $50K` quando ele é escolhido (via `baseName()`, enquanto `nameTouched` for falso); as regras continuam a encher-se a 6%/4%/2% no momento em que o tamanho é escolhido ou o tipo muda com tamanho já definido. "Create & add another" volta a limpar tamanho, data e regras. |
| 2026-09-19 | **Nome com tipo + calendário próprio (S)**: o nome da conta passa a `marca tipo $tamanho` (`Tradeify Eval $50K`, `Tradovate Personal $50K`), usando as labels configuráveis (`typeLabel`), e continua ligado ao tamanho/marca até o trader escrever o seu. O calendário nativo do sistema (`input[type=date]` + `showPicker`) sai: `mountDateField` abre agora o **calendário da casa** (`lib/calendar.ts` — grelha do mês à segunda, "hoje" com contorno, dia escolhido com acento `--interactive-accent`, "Today", setas/Enter/PageUp-Down, popup `fixed` preso ao campo). A API mantém-se, por isso os 23 sítios com datas ganham o mesmo calendário; escrever a data à mão continua a funcionar. |
| 2026-09-19 | **Management: presets de cartão, cor de grupo e tipos (T)**: o separador **Cards** deixa de ter 9 dropdowns por tipo e passa a **3 presets nomeados** por tipo — *Firm layout* (o default assinado de cada tipo, pré-seleccionado), *Results* e *Consistency* — guardados em `accountCardPreset: Record<tipo,id>` (`lib/cardSlots.ts` ganha `CARD_PRESETS`/`presetFor`/`CardLayout`; `accountCardBars`/`accountCardMini` saem, sem migração). A **cor do grupo de copy** passa a ter consequência: `copyGroupColor` tinge a secção do grupo e as tags Leader/Copier na página de Contas (`groupTint()`). O "Account types shown" sai do **Display** e passa para **Types** como pills de olho (`.tj-mg-vis`, `eye`/`eye-off`); o Display fica só com Layout + What appears. A relação líder→copiers ganha uma **árvore** (`.tj-mg-tree`, conectores CSS) e o "Remove" deixa o `title` nativo e passa a `attachTip`. O contraste do bloco Management sai do token do tema `--text-muted` para `--tj-fg-2`/`--tj-fg-3`. |
| 2026-09-19 | **Cards só por preset + empty state dos copy groups (U)**: o separador **Cards** do Management **sai** — deixou de haver edição por utilizador. O cartão de cada tipo de conta passa a ter um **layout fixo assinado** em `lib/cardSlots.ts` (`layoutFor(type)` → `{bars, mini}`; `CARD_PRESETS`/`presetFor`/`accountCardPreset` removidos, sem migração): eval `target·drawdown` / `toTarget·win·profitFactor·last`; funded `dailyRoom·drawdown` / `trades·win·paid out·last`; live `dailyRoom·drawdown` / `trades·win·**day win**·avg R` (novo mini `dayWin`, `m.dayWinRate`); personal/demo/unknown `greenDays·ddFromPeak` com as quatro métricas de sempre. O Management fica com **3 separadores** (Copy groups · Display · Types) e o `previewFor`/`CardSlotOverride` da lista caem. O **empty state dos copy groups** perde o diagrama de nós: passa a um título calado ("No trading groups yet") + uma frase + o botão "+ Create Copy Group", e a nota `ⓘ` "Linking never rewrites trades already recorded…" só aparece **quando já há grupos**. |
| 2026-09-19 | **Management: compositor guiado e Types dentro do Display (V)**: o "New trading group" passa a ser um **compositor em três passos numerados** — **1 Leader** (grelha de cartões de conta `.tj-mg-leadcard`, o escolhido com borda `--interactive-accent` + glow; já **não** há dropdown nem líder pré-selecionado), **2 Copiers** (bloqueado com "Pick the leader first." até haver líder; depois mostra o chip `.tj-mg-lockedlead` e uma linha por conta com a caixa à esquerda e o sub "copies <líder>") e **3 Copy from** (também bloqueado até haver líder, com a nota explicativa sempre visível). O botão **Create group** só liga com líder escolhido. As notas das opções de "Copy from" passam a linguagem de trader. O separador **Types** desaparece: as suas linhas (nome, check, cor, setas, olho, Reset) passam para dentro do **Display** como terceira secção (`renderTypeRows`), ficando **2 separadores** (Copy groups · Display). |
| 2026-09-19 | **Management: portal do dropdown, estado do copy e disband (W)**: o dropdown da casa (`lib/dropdown.ts`) passa a **portal** — a lista sai para `<body>` presa ao botão com `position: fixed`, `z-index: 1100`, flip para cima quando não há espaço, reposiciona em `scroll`/`resize` e fecha em clique-fora/Escape; um `MutationObserver` fecha o menu se o anfitrião sair do DOM. Acaba o corte da lista pelo `.tj-manage-body` (o scroll do painel deixa de a apanhar) nos 19 sítios que o usam. **Compositor compactado** (`.tj-manage-body` 70vh, paddings menores, lista de copiadores a 120px) para caber sem barra. **Estado do copy**: novo `unlinkCopier()` em `lib/copy.ts` (fecha o período, limpa `copyRole`/`copyBaseId`/`copyMultiplier`/`copySizing` e afins, **guarda** `copyPeriods`/`copyConfigHistory` — é o registo do que correu) usado pelo Remove, pelo Move group e pelo novo "Take out"; o rácio passa a escrever via `startCopying` (a config datada é o que o motor lê); o pick morto do "Add to group" passou a `Notice` em vez de clique silencioso e o reset inválido `"today"` voltou a `"start"`. **Nunca há beco sem saída**: o botão `+ New trading group` fica sempre vivo e, sem contas livres, o passo 1 lista as contas ocupadas com um "Take out" de um clique. **Disband** por um quadrado de lixo (24×24) no cabeçalho do grupo, com confirmação em dois toques inline (nada de notas é tocado) e `Notice` ao criar/rebentar/ligar/desligar. |
| 2026-09-19 | **O símbolo é do motor, não do trader (X)**: sai o dropdown manual **"Same symbol / Mini ↔ micro"** do copiador — era um no-op comprovado (o `startCopying` grava sempre uma entrada em `copyConfigHistory` e o `copyCrossOrder` só era lido na ramificação legacy, por isso mudar o toggle nunca tinha efeito) e o campo `PropAccount.copyCrossOrder` desaparece. **A regra passa a ser aritmética**: cada ligação grava `crossOrder: true` + `crossMode: "exposure"` e o motor decide por trade em `buildLeg` — espelha em **micros só quando `baseQty × ratio < 1`** e o símbolo tem micro (1 mini = 10 micros; exposição preservada, NQ $20/pt = 10 × MNQ $2/pt). Fora desse caso fica o símbolo do líder (`1 NQ × 1` → `1 NQ`; `2 NQ × 0.5` → `1 NQ`); um símbolo sem micro (`M2K`) continua a arredondar para baixo. As **pernas já escritas ficam congeladas** (só as futuras mudam), os fills importados ganham sempre, o `copySymbolMap` (`NQ → MNQ`) continua a documentar a travessia na nota e a tooltip do rácio explica a travessia automática. |
| 2026-09-19 | **Sem bolha nativa, ritmo uniforme (Y)**: novo `lib/numeric.ts` (`freeNumeric`) — todos os `input[type=number]` do plugin (18 sítios em 8 ficheiros: Manage rácio, wizard afixos/amount/size, regras e multiplier/amount da conta, payout, fee-adjust, os 6 do Add Trade, a factory de linhas editáveis do Trade Detail e o editor de regras das Settings) deixam de ter `min`/`max`/`step` no markup e ganham `step="any"` + `invalid` cancelado + `novalidate` no form; os limites continuam a ser impostos nos handlers (a bolha *"Please enter a valid value"* era do Chromium e não se estiliza). Campos mortos das opts de `editableRow` (`suffix`/`min`/`max`/`step`) removidos. **Ritmo das secções do Management**: `.tj-manage-sect` passa a `--tj-sp-5`, o `.tj-manage-secthead` ganha `--tj-sp-2` até ao conteúdo (era 0 — colava o título `Types` à lista), o tracking do título desce a `.12em`, notas/empty e cartões de grupo fecham com `--tj-sp-4`; o helper morto `private section()` sai. |
| 2026-09-19 | **Tooltips: uma só, e a certa (Z)**: os `(i)` do Management mostravam sempre a mesma tooltip genérica *"More information"*. Duas causas somadas: (1) o `attachTip` **não** punha a classe `tj-tip-anchor` no elemento, e o guard (`guardTips`, `mousemove` em captura) matava a nossa tooltip no movimento seguinte — corrigido no próprio `attachTip`, o que conserta os **113** sítios de uma vez; (2) o `aria-label: "More information"` fazia o Obsidian desenhar a tooltip dele, e era a única que sobrava. O `(i)` passa a ter o glifo `aria-hidden` e um `span.tj-sr-only` com o nome acessível `About <título>`; os três textos (Layout · What appears · Types) ficam curtos e distintos. Nova classe `.tj-sr-only`. Regra permanente: **nunca `aria-label` num âncora de `attachTip`**. |
| 2026-09-19 | **Duas superfícies, um só glifo, e a faixa honesta (AA)**: o Management deixa de ter separadores — `openCopyGroups` e `openAccountsDisplay` abrem a mesma modal em dois modos (Copy groups · Display), e o header das Contas passa a ter **três quadrados** (`users` Copy groups · `sliders-horizontal` Display · `plus` Add account, este último `.is-primary`); o quadrado das copy groups fica desactivado com tip quando há menos de duas contas. O `(i)` deixa de ser a letra dentro de um aro nosso: passa a ser o pictograma de informação do Obsidian (`setIcon(el,"info")`, 14px, `--tj-fg-3`) nos 6 sítios — `.tj-info-dot` perde borda/raio/font-size, `.tj-manage-infoico` ganha o mesmo `svg`. A tooltip do gráfico da carteira deixa o `title` nativo (≈250 caracteres, proibido pela UX-GUIDELINES §5) e passa a `attachTip`; os cinco textos da faixa encurtam. **Os payouts passam a seguir a janela do gráfico** (como o Net P&L, o Growth e os Trades); só o *In accounts* fica all-time, e di-lo no sub. Catálogo de logos: **14 marcas** com PNG embutido a 128×128 (prop: Topstep · Tradeify · Apex Trader Funding · Take Profit Trader · MyFundedFutures · Lucid Trading · Alpha Futures · FTMO Futures · FundedNext · TopOne Futures; brokers: Tradovate · NinjaTrader · Interactive Brokers · AMP Futures; `own` prática em símbolo CSS); **`alphacapital` sai** — o PNG que existia era a **Alpha Futures**, não a Alpha Capital Group. |
| 2026-09-19 | **Import: a conta primeiro, e nunca adivinhada (AB)**: o importador deixa de pré-selecionar. `guessMapping()`/`resolveFallback()` saem e os settings mortos `lastImportAccountId`/`lastCreatedAccountId` desaparecem (interface, `DEFAULT_SETTINGS`, a escrita no dropdown e no wizard) — um nome da CSV que coincide com uma conta é coincidência de texto, não uma instrução, e adivinhar era como os trades caíam na conta errada com o ecrã a dizer que correu bem. O bloco de escolha (`.tj-import-pick`, "Where these trades go") passa a ser o **primeiro** da página, acima do fuso e dos custos, com estado `is-empty`/`is-set` (`N of M chosen`), a contagem e o intervalo de dias de cada nome do ficheiro (`3 trades · 19 Aug → 14 Sep 2026`) e uma hint honesta. **Só depois de haver conta** é que o *This Trading Group* e o *Also record these trades in* são desenhados; `tickBaseId()` desaparece e a regra passa a ser uma só — a conta escolhida no dropdown é onde os trades são escritos (`baseIds()`). O dropdown da casa (`lib/dropdown.ts`) ganha **cabeçalhos e chips** (`heading`, `tag`, `tagTone`): a lista lê **Leaders** · **Copiers** · **Standalone**, com chip âmbar Leader, chip acento `Copier ×N` (também no botão, depois de escolhido) e a nota *Leads N accounts* / *Copies \<líder\>*. `assets/firm-logos/`: FundedNext reduzido a 128×128 e **FTMO invertido para branco** mantendo o alfa (a marca é monocrómica e a preto desaparecia no tema escuro). |
| 2026-09-19 | **Import: o id nunca ao ecrã, e a escolha sobrevive (AC)**: a linha do *Where these trades go* mostrava o **número de conta do broker** que vem no Orders CSV (ex. `LFE0509`) — proibido desde o início. Passa a ser uma linha só de factos (`3 trades · 19 Aug → 14 Sep 2026`) quando o ficheiro traz **um** nome (o caso normal) e `Account 1` / `Account 2` (ordem do ficheiro) quando traz vários; o id fica a ser apenas a **chave interna** do `mapping`. E a escolha da conta deixou de morrer a meio: a limpeza do `mapping`/`groupSeeded` saiu do `parseTrades()` e passou para o `handleFiles()`, no momento em que um **ficheiro de trades novo** é lido — trocar o timezone, mexer no toggle dos custos, "Choose another" ou largar o Cash History re-lêem o mesmo ficheiro e **mantêm a conta escolhida e os ticks** (antes apagavam-nos, porque sem `baseIds` o review também limpava o `includeIds`); depois de cada parse só caem as chaves cujo nome já não consta de `accountsSeen`. |
