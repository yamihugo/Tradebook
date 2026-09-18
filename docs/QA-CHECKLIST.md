---
title: QA Checklist & Fix Log
project: Tradebook
type: qa
status: living
updated: 2026-09-15
tags:
  - tradebook
  - qa
  - testing
---

# QA Checklist & Fix Log

> [!info] Propósito
> Registar **todos os micro/macro fixes** feitos, para depois corrermos os testes
> em todas as funcionalidades e confirmarmos que o plugin está pronto para
> **qualquer etapa de trader** — do iniciante ao experiente com 5+ prop firms
> e 20–30 contas em scaling.

---

## 1. Perfis de teste (matriz)

Correr a checklist abaixo em cada um destes cenários:

| # | Perfil | Setup | O que testar |
|---|--------|-------|--------------|
| P1 | **Iniciante** | 1 conta demo/eval, ~10 trades | Wizard, add trade, dashboard básico, nomes de ficheiro |
| P2 | **Intermediário** | 1 eval + 1 funded, ~50 trades | Flip card, breakdowns, trade log, evals pass flow |
| P3 | **Avançado** | 5 firms, 20–30 contas, copy trading, payouts | Escalabilidade, listas longas, copy legs, arquivo/restauro |
| P4 | **Edge cases** | 0 trades, contas sem dados, datas antigas, contas arquivadas | Empty states, fallbacks, sem crash |

---

## 2. Registo de fixes (sessão 2026-09-15)

### 2.1 Conta — Gráfico de equity
- [x] Baseline tracejada nos 50K **sempre visível** (removida condição que a escondia)
- [x] Removido o glow/blur branco na baseline (não gostado)
- [x] Labels à direita afastados do gráfico (`padR` 8 → 24)
- [x] Range apertado: fundo = valor mais baixo (DD), topo = target; ~2% padding
- [x] Top tick do eixo Y substituído pelo valor do target (53K em vez de 52K)
- [x] Fade **verde acima / vermelho abaixo da baseline** (Opção F escolhida)
- [x] "Drawdown level" label movido para o **fundo** do gráfico
- [x] **Hover no "Drawdown level"** → tooltip com valor P&L + gap (tooltip global no body, não cortado)
- [x] Dias recentes (dots) no canto direito, na **mesma linha** que o título
- [x] Título do gráfico: `EQUITY — [Firm] [Program] $[size]K [Type]`
- [x] Removido subtitle do header (info integrada no título)
- [x] Equity curve usa `acc.size` como âncora (NÃO startBalance) — regras duras para evals

### 2.2 Conta — Flip card (Key metrics / Discipline)
- [x] Título simplificado para **"Key metrics"** (removido "Risk ↔ Target")
- [x] Removido o net P&L + "% used" do card (fica só no hover)
- [x] Limits reordenado: **Today primeiro**, depois risk room, target progress, etc.
- [x] **Drawdown limit used bar** (safe/warning/critical/breached) com cores do tema
- [x] **Drawdown episodes** (`computeDrawdownEpisodes`) + summary no card
- [x] Donuts de win rate com **3 cores** (verde ≥50% · amarelo 40–49% · vermelho <40%)
- [x] Removido widget "Key metrics" duplicado do fundo
- [x] Removido "Edit widgets" (add/remove/drag não usado)
- [x] Fix **glitch da scrollbar** ao fazer flip (`display:none` → `opacity` + `position`)

### 2.3 Conta — Breakdowns
- [x] Tiles com **P&L + win rate centrados**, cor de fundo pelo P&L
- [x] Removida a sub-line ("9 trades · 22% win") — info só no hover
- [x] Removido o P&L externo no header dos breakdowns

### 2.4 Conta — Trade log
- [x] **Date & Time** na mesma coluna
- [x] Coluna **Hold** adicionada (com segundos quando <1min)
- [x] **Entry ←→ Exit** justificado (entry à esq., exit à dir., seta centrada)
- [x] **P&L e R com cores** (verde/vermelho)
- [x] **By Day removido** (só tabela)
- [x] **Drag-to-reorder colunas** (mousedown-based, funciona no Obsidian)
- [x] Ordem das colunas **global** (guardada em settings → todas as contas)

### 2.5 Segundos / duração
- [x] `minutesOf` / `holdMinutes` fazem parse de `HH:MM:SS`
- [x] Formatação humana: `15s`, `1m 30s`, `1h 5m`
- [x] Aplicado em: Hold W/L (discipline), coluna Hold (trade log)

### 2.6 Depósitos (personal accounts)
- [x] Tipo `Deposit` + `settings.deposits`
- [x] Métodos `depositsFor`, `accountDepositsTotal`, `registerDeposit`, `removeDeposit`
- [x] UI: secção "Deposits" + form inline (só `type: personal`)

### 2.7 Contas — lista / roles
- [x] Badge **"👑 Leader"** (era "Base") + filtro "👑 Leader"
- [x] Gráfico partilhado entre contas (Accounts)

### 2.8 Contas — gestão (Settings modal)
- [x] **Delete account** (remove conta + payouts + deposits; ficheiros ficam)
- [x] **Archive account** (esconde de tudo, dados preservados, restaure nos Archived)
- [x] **Double-warning temático** para delete (não `confirm()` nativo)
- [x] Modal de conta **tabbed**: General · Rules · Copy trading · **Deletion**
- [x] Tab **Deletion sempre vermelha** (com `!important`)
- [x] General: **label à esquerda, valor à direita**, tudo sem fundo/borda (só hover)
- [x] **Account size = seleção do firm** ($25K/$50K/$100K…) em gaveta
- [x] **Auto-name** segue o size; nome custom nunca é sobrescrito
- [x] **Gaveta** mostra só as *outras* opções (o selecionado é a âncora)
- [x] Rules: **toggles de override** por regra (target, maxLoss, dailyLoss, consistency, pos size)
- [x] Copy trading: **seletores grandes** para o role (Standalone/Leader/Copier)
- [x] Copy: **lista vertical scrollable** para escolher o leader (escala a 20–30 contas)
- [x] Botões do modal no estilo calmo do wizard (transparentes, borda, muted)

### 2.9 Firm logos
- [x] Infra: `assets/firm-logos/<firmId>.png` bundled no plugin
- [x] `plugin.firmLogoUrl()` via `vault.adapter.getResourcePath()`
- [x] Usado no avatar do modal de settings + chips do wizard
- [x] Fallback automático para iniciais (TF/TS) se o logo não existir
- [ ] **Substituir placeholders pelos logos oficiais** (já lá estão alguns)

### 2.10 Eval passada (banner)
- [x] Banner no **topo** da página (empurra o resto)
- [x] Design V3: **anel gradiente cónico + check** + breathing glow
- [x] Removido o shine sweep (não gostado)
- [x] Botões redesenhados (outline, calmos)
- [x] Full width, botões à **direita** (não fica espaço vazio)
- [x] Upgrade / Archive / Delete (double-warning temático no delete)

### 2.11 Contas — datas & isolamento (BUG FIX)
- [x] Campo **`createdAt`** ("Started on") adicionado ao `PropAccount` e gravado em `makeAccount`
- [x] **"Started on"** editável na tab General do modal (date input)
- [x] **"Started on"** no **wizard de criação** (step Details) + review
- [x] **"Started on"** no form "Quick add" das Settings
- [x] **Nomes de conta sempre únicos** — `uniqueAccountName()` no wizard, Settings quick-add e ao renomear
- [x] **Trades anteriores à criação da conta não contam** nessa conta (filtro por `createdAt`)
- [x] **Rename de conta faz RE-INDEX** — `renameAccount()` reescreve o campo `account` em todas as notas + grava mapping antigo→id
- [x] Corrigido o bug das contas novas que "herdavam" os trades da conta de 50K (colisão de nomes)

### 2.12 Copy trading — arquitectura HÍBRIDA (backend)
> Definido: **legs virtuais por defeito** (sem ficheiros) + **materializar**
> só quando houver dados por conta (print, import real, edição manual).
>
- [x] `synthesizeLegs()` — gera legs em memória (sem gravar) a partir do `buildLeg()`
- [x] `expandVirtualLegs()` — junta legs físicas + virtuais; materializadas ganham
- [x] `isVirtualLeg()` — marca legs sem ficheiro
- [x] `plugin.loadTradesExpanded()` — devolve físico + virtual
- [x] `openTradeDetail` abre a **trade base** quando se clica numa leg virtual
- [x] Página de conta + lista de contas usam `loadTradesExpanded()`
- [x] `materializeLeg()` — cria nota real quando a leg precisar de dados próprios
- [x] **`copyBaseKey` estável** — a base ganha chave própria (`ck_…`) persistida; legs nunca órfãs após editar a base
- [x] Toggle global **`includeCopiesInPortfolioAnalytics`** (settings) + UI em "Copy trading"
- [x] `uniqueTrades()` (dedupe por `copyBaseKey`) disponível em `lib/copy.ts`
- [ ] **Ligar o dedupe às contagens** no Home / calendário / setups / tradelog (money = legs, counts = dedupe)
- [ ] **"Collapse copies"** toggle em todas as listas
- [ ] **Copy UI**: checklist de membros no Add Trade/Import + timeline de períodos
- [ ] Smoke asserts do §7 do [[COPY-TRADING]]

### 2.13 Outros
- [x] **Period bar removida** da conta (conta é overall; temporal fica no Dashboard)
- [x] **"Mark as passed" removido** (o sistema detecta automaticamente)
- [x] Firm logos no **wizard de criação**
- [x] Limpeza de código morto (`renderAccountChart`, `renderGauges`, etc.)
- [x] Smoke cresceu de **109 → 120** asserts (unique names, createdAt, copy dedupe, leg P&L, hooks)

### 2.14 Smoke — novos asserts (120)
- [x] `newAccountName`: sem clash mantém · com clash `#2` · segundo clash `#3`
- [x] `makeAccount` define `createdAt` (YYYY-MM-DD) e auto-nome com a firm
- [x] `copyUniqueTrades`: base + 2 legs → 2 trades (dedupe por `copyBaseKey`), mantém a base
- [x] `plugin.loadTradesExpanded()` e `plugin.renameAccount()` expostos
- [x] `copyBuildLeg`: leg escala o P&L da base quando não há `pnlPoints`; `copyBaseKey` estável

### 2.19 Trends (onde melhorei / onde piorei) + valores em falta
> Pedido do maintainer: uma conta nova tem de nascer pronta, e o journal tem de dizer onde ele melhorou e onde piorou.

**Trends (`src/lib/trends.ts` + widget na página da conta)**
- [x] Divide o histórico em duas metades (últimos 20 vs os 20 anteriores) e mede 7 métricas: expectancy, avg R, win rate (BE fora), profit factor, mistakes, revenge, hold
- [x] **Sem veredicto sem amostra**: abaixo de `MIN_SAMPLE = 10` por lado mostra os números e recusa afirmar uma direcção ("Not enough history for a trend yet") — 3 trades não são uma tendência
- [x] Setas `↑ ↓ =` além da cor (WCAG 1.4.1: a cor nunca é o único sinal); um empate fica neutro, não verde nem vermelho
- [x] Valores monetários com as mesmas 2 casas nas duas colunas (uma coluna que mistura $34.50 com $196 lê-se como duas grandezas diferentes)
- [x] `coverage` diz **o que falta** quando uma linha nunca enche ("Average R needs a stop loss and an entry price — none of the 46 trades here have it yet")
- [x] Widget ordenado **acima** do trade log (uma tendência que exige rolar 46 linhas não é lida)

**`NaN` na UI — eliminado (bug real encontrado por screenshot)**
- [x] Causa: `parseFloat` de um campo ausente dá `NaN`, e `t.entryPrice ?? "—"` **não** apanha `NaN` (só `null`/`undefined`) → a tabela mostrava `NaN→NaN`
- [x] Novo `fmtPrice()` em `tz.ts` (não-finito ou 0 → "—"); usado na tabela da conta, trade detail, sidebar e modal
- [x] `tradeToMarkdown` deixou de escrever `entry_price: NaN` nos ficheiros do utilizador (as linhas não-finitas são omitidas — não se corrompe a nota)
- [x] Guarda nova: harness **`nan-sweep.js`** renderiza todas as views + todas as contas contra o vault real e falha se aparecer `NaN`, `undefined` ou `[object Object]` → `NAN SWEEP OK`

### 2.22 Regras reais das firms (TopStep + Tradeify verificadas a 16 Set 2026)
> Fonte: páginas oficiais (`help.topstep.com`, `help.tradeify.co`) **e** as imagens da página `topstep.com/topstep-prop` que o maintainer enviou (Standard vs No-Activation-Fee + modal "Plan features").

- [x] **TopStep Combine**: consistency 50% → **55%**; basis = **total profit** (o modal oficial diz "your best trading day cannot exceed the Consistency Target percentage of *total profits*", não o target)
- [x] Preços: 50K `$49/mo · no-act $85` · 100K `$99/mo · no-act $129` · 150K `$199/mo` (nos dois caminhos); reset fee = mensalidade; XFA activation `$149` (grátis no caminho sem activation)
- [x] DLL registado como **soft** e parte do *Responsible Trading Advantage* (pausa a sessão, nunca falha a conta); MLL confirmado **EOD trailing** que trava no saldo inicial
- [x] **XFA**: maxLoss começa em −$2,000 e trava em **$0**; nota com os dois caminhos de payout (Standard 5 dias de $150+ · Consistency 40% em 3 dias)
- [x] **LFA**: `maxLoss = size − $1,000` (a conta fecha abaixo de $1,000), `static`, DLL automático, reserva a desbloquear por marcos de $3K/$6K/$9K
- [x] **Tradeify**: preços reais (Growth $99/$145/$255/$369 com resets $60/$95/$155/$215 · Select 40% $109/$165/$265/$369 e add-on 50% $135/$205/$329/$459 · Lightning $345/$492/$660/$796); Select com **minDays 3** e nota do add-on de 50% (2 dias)
- [x] **Lightning**: `target` = meta do payout 1 ($1,500/$3,000/$6,000/$9,000) e nota da consistency progressiva **20% → 25% → 30%**
- [x] **Elite Live**: drawdown fixo **$1,500 / $2,000 / $3,000 / $4,500** (estava 1,000/2,000/3,000/3,500), `static`, contratos 1/10→2/20 · 2/20→4/40 · 4/40→8/80 · 6/40→12/120
- [x] Campo novo `PropSize.ddLockOffset` (dólares **acima** do saldo inicial) → Tradeify funded trava a **+$100**, TopStep/XFA em $0; usado em `accountMetrics` (floor) e no `ddLevels` do gráfico
- [x] **Tipo → programa**: mudar o tipo de uma conta para *funded* passa a mudar o programa para a fase certa (uma Select eval convertida em funded já não mostra target/consistency de avaliação)
- [x] `~/trading-journal-smoke/rules-check.js`: imprime a base das duas firms e as regras efectivas de cada conta do vault, com asserções sobre 55%, basis profit, $199, lock +$100, Elite 1,500/4,500 e payout-goal da Lightning (`RULES CHECK OK`)

### 2.21 Passar uma eval: celebração uma vez, faixa discreta para sempre
> Pedido do maintainer: decidir entre 2 e 3 opções ao passar, e o caso de desarquivar uma eval que já passou (não pode voltar a fazer "parede").

- [x] **A causa**: o "passou" era derivado do P&L (`net >= target`) sem memória nenhuma — a celebração voltava a aparecer em cada render e outra vez depois de restaurar do arquivo
- [x] **Opção A** (3 opções, opção escolhida): `Upgrade & archive` (primário) · `Upgrade & delete` (dupla confirmação) · `Keep for now`
- [x] Memória: `PropAccount.passedAt` (a data em que o alvo foi **cruzado**, não a data em que arquivou — `passedDateOf()` percorre as trades da conta) e `passKept` no "Keep for now"; `linkedFundedId` já existia
- [x] Dois estados: **celebração** só quando não há memória; depois uma **faixa discreta** (`✓ Passed on <data> · this eval is done — it went on to <funded>`) com `Open funded account` / `Archive` (primário) / `Delete`
- [x] **Restaurar do arquivo nunca celebra**: verificado no harness (o caso que ele levantou). Quem quiser continuar a ver a conta desarquiva-a e vê a faixa
- [x] Todas as opções criam a funded; nunca se apaga a eval sem funded. Nome da funded passa por `uniqueAccountName` (duas evals do mesmo firm/size já não criam duas contas com o mesmo nome)
- [x] Se a funded foi apagada, a faixa oferece `Create the funded account` (a eval não fica presa)
- [x] **Etiqueta `PASSED`** no cartão da conta (`tj-tag-passed`, com tip) — uma eval gasta distingue-se de uma a correr. Aprovado por mim com o maintainer a delegar: só onde acrescenta informação
- [x] **Confirmar antes de arquivar** uma eval em curso: `showArchiveConfirm()` (cartão nosso, um só passo) no botão Archive das settings da conta — "ainda não atingiu o alvo"
- [x] Backfill no arranque (`runAccountMaintenance`): evals upgradeadas antes desta memória ganham `passedAt` da data cruzada (ou do `createdAt` da funded)
- [x] Mini-tooltips (`attachTip`, não o quadrado preto do motor) em todas as opções da celebração e da faixa
- [x] `~/trading-journal-smoke/pass-check.js`: backfill → celebração com 3 opções e tip → `Keep for now` grava `passedAt`/`passKept`/funded → segunda visita é faixa → **arquivar + restaurar continua faixa** → cartão com `PASSED` (`PASS CHECK OK`)
- [x] Screenshot de referência: `/home/hugo/tj-out/pass-band.png` (faixa discreta na TopStep $50K)
- [x] **Nada cria uma funded por engano** (reportado pelo maintainer: com 5 fundeds não se percebia se abria a ligada ou criava outra): a faixa resolve a funded por três casos e **nomeia-a sempre**
  - ligada → botão `Open <nome da funded>` + tip "Nothing is created" e um `Not this one?` (picker `.tj-relink-*`) para apontar a eval a outra funded, ou a nenhuma — nunca apaga contas
  - link perdido mas a funded existe (mesmo firm/programa/size, não reclamada) → `Link to <nome>` (liga e não cria nada) + `Create a new one`
  - sem nada para ligar → `Create the funded account`, **sempre com cartão de confirmação** (`showFundedCreateConfirm`)
- [x] `linkEvalToFunded()` no plugin (liga os dois lados, estampa `passedAt`, não cria) + reparação no arranque: uma funded que lembra a eval mas a eval não lembra a funded volta a ficar ligada
- [x] `pass-check.js` §6: o botão nomeia a conta, o tip diz que não cria nada, ligar mantém a contagem de fundeds, criar pede confirmação e cancelar não cria (`PASS CHECK OK`)
- [x] Screenshots: `/home/hugo/tj-out/pass-linked.png`, `pass-candidate.png`, `pass-create.png`

### 2.20 Wizard: o número certo e criação em lote
> Reportado pelo maintainer: numa review apareceu `Starting balance $100,000` para uma conta de $50K.

- [x] Causa: `values.startingBalance` só era escrito quando estava vazio (`if (!values.startingBalance)`), por isso mudar firm/programa/tamanho deixava o valor **antigo** — Size dizia $50K e Starting balance dizia $100K
- [x] Correcção: um só escritor, `setSize(size)` grava `size` **e** `startingBalance` juntos; chamado em `setProgramDefaults`, ao revalidar o tamanho no passo Account e nos chips de tamanho
- [x] Uma conta prop deixou de mostrar "Starting balance" na review (o size **é** o capital) — a duplicação era o que permitia os dois números discordarem
- [x] **Criação em lote**: stepper `How many accounts` (1–30) na review; nomes numerados `#1 … #N` que saltam os já usados; mesmo firm/size/regras/data para todas; botão passa a `Create N accounts`
- [x] Um **leader** não se cria em lote (um grupo tem um só líder) — o stepper desaparece e explica-se porquê; copiers em lote são permitidos
- [x] `~/trading-journal-smoke/numbers-check.js`: percorre os caminhos (50K → 150K → trocar firm → voltar a 50K) e verifica Size/Details/Review sempre iguais, que não há linha duplicada, e que o lote cria 3 contas únicas com o size certo
- [x] **Numeração continua a família** (reportado pelo maintainer: o lote deu `#1 · #3 · #4`, criando um segundo "um"): a conta sem número **é** a primeira, por isso a contagem começa depois das que já existem — com `base`, `#2`, `#3` presentes, o lote seguinte é `#4 · #5 · #6`. `namesFor(1)` passou a ser a única definição de "o próximo nome" (o `uniqueName` local foi removido)

### 2.18 UX, tipografia e Manage → Cards
> Regras com fonte em `docs/UX-GUIDELINES.md`; verificação automática em `tools/ux-audit.mjs`.

**Base (dívida D1–D7, toda paga)**
- [x] Camada de tokens CSS: escala de 8 tamanhos, 3 pesos, rampa de texto AA, espaçamento 4px
- [x] 394 `font-size` literais → tokens · 142 `--text-faint` → `--tj-fg-3` (3,3:1 → 5,12:1, AA) · 13 tamanhos abaixo do chão → 9,5px · 202 pesos → 400/600/700 · 90 `em`/`rem` → tokens por papel
- [x] `tools/ux-audit.mjs` mede contraste, escala, pesos, tamanhos parent-relative, line-height, alvos e uso de tokens legados; listas de excepção **dentro do script** (com a razão)
- [x] WCAG 2.5.7: reordenar em Types tem **↑↓** (24×24) além do drag
- [x] WCAG 2.5.8: checkbox do trade log 24px; paleta de cores com 25px entre centros
- [x] Auditoria: `no normative violations found` (0 erros, 0 avisos)
- [x] **Botões do header unificados, máxima ghost**: `.tj-actionbtn` (receita partilhada) + variante `.is-icon` (quadrado 30px com hairline). Na página Accounts ficaram **só os ícones** (`sliders-horizontal` = Manage, `plus` = Add account), com `title` + `aria-label` (nome acessível obrigatório — WCAG 4.1.2). Escolhido por preview: `previews/accounts-header-buttons-previews.html` (7 opções A–G; o maintainer escolheu E). Regras `.tj-acct-header*` duplicadas no CSS foram fundidas numa só
- [x] **Cabeçalho da Accounts em outline + tooltip nossa**: os dois botões passaram a `.tj-iconbtn` (o mesmo quadrado com hairline dos headers do resto do app), sem palavras à vista; o `title` nativo (o "quadradão preto") foi trocado por `attachTip()` de `lib/tip.ts` — mostra no hover **e** no focus do teclado — com `aria-label` como nome acessível. Harness: `node tip-check.js` (sem `title`, hover/focus mostram `.tj-tip`, mouseleave/blur removem)
- [x] **Manage → "Management"**: título do modal com ícone e subtítulo de "control room" (hub da página, não um formulário de settings)
- [x] **Tints de accent**: os 2 únicos `rgba(124, 92, 255, …)` hardcoded (`.tj-acct-gbopt.on`, `.tj-acc-copychip.is-copier`) passaram a `color-mix(in srgb, var(--interactive-accent) N%, transparent)` — agora seguem a accent color do Obsidian (os outros 107 usos já usavam o token)
- [ ] **Reformulação de UI aprovada por ordem**: (1) contas [em curso], (2) **Trade Log**, (3) **Home**. O maintainer quer mudar a UI das duas páginas depois de as contas estarem fechadas; lá também usar quadrados e "um bocadinho do A". **Passagem final de cores**: decidir quais cores seguem a accent color do Obsidian (inspirado no D/F do preview dos botões)
- [x] **Varredura de tooltips nativas** (feita de uma vez, não página a página): **zero** `title` nativos em `src/`. Regra aplicada: onde o `title` só repetia o texto à vista (métricas, nomes de cartões, "Back", "Prev", "Next", "Delete") foi **apagado** — a palavra já está lá; onde acrescentava informação passou a `attachTip()` (título + explicação), com `aria-label` como nome acessível nos controlos só de ícone. `lib/dropdown.ts` passou a tratar `opts.title` com `attachTip` (isso cobriu de uma vez os pickers do Manage, do gráfico e do wizard); o marcador de depósito/payout do gráfico largou o `<title>` SVG e usa `attachTip`; `attachTip` alargou a assinatura para `Element` (serve SVG) e ganhou **Escape** a fechar (SC 1.4.13). Caminhos longos do rename levam `.tj-tip.is-wide` (520px, mono). CSS: `.tj-tip` com `max-width: 330px`.
- [x] **Harnesses actualizados à UI ghost**: os botões do header deixaram de ter texto — `manage-check.js`, `cards-check.js`, `manage-shot.js` procuram `aria-label="Manage"`; `wizard-check.js`, `numbers-check.js`, `datefmt-check.js` procuram `aria-label="Add account"`; `accmodal-check.js` procura `aria-label="Edit account settings"`. Todos verdes: smoke 126, tip-check, manage-check, cards-check, accmodal-check, wizard-check, numbers-check, trends-check, datefmt-check, nan-sweep, rename-plan, ux-audit.
- [x] **`tip-shot.js`** (novo em `~/trading-journal-smoke/`): monta a página e faz `mouseenter`/`mousemove` no botão, provando que o card `.tj-tip` (título + sub) aparece no lugar do quadradão preto; escreve `<saida>-tip.html` para screenshot. Screenshot de referência: `/home/hugo/tj-out/hdr-tip.png`.
- [ ] Uniformizar o resto (inventário): `.tj-btn tj-mini` ainda em `tradeModal`, `tradeLogView`, `tradeDetailView`, `dashboard`; `.tj-seg-btn.on` / `.tj-tl-segbtn.on` (segmentos com fill accent); `.tj-addwidget` (Home)

**Manage → Cards**
- [x] Catálogo único em `src/lib/cardSlots.ts` (6 barras, 10 números, defaults por tipo) — o Manage e o cartão real lêem a **mesma** lista
- [x] Aba Cards: tipo (segmento) + 2 pickers de barra + 4 de número; a opção já usada fica visível mas indisponível (com o motivo no hint)
- [x] **Preview é o cartão real** (`AccountsListView.previewFor`) desenhado da conta com mais histórico — não é uma maquete que pode divergir
- [x] Slots indisponíveis caem para alternativas e o cartão nunca fica meio-vazio; `Reset <tipo> to default` por tipo
- [x] **Sem substituições, de todo**: uma barra escolhida aparece sempre, na ordem escolhida. Se ainda não tem regra para ler, di-lo ("No target set", "No loss limit set", "No daily limit", "Not a payout account") em vez de ceder o lugar a outra barra
- [x] `payout` deixou de exigir trades: uma conta funded/live mostra "0 of 5 days" desde o primeiro dia — uma conta nova já nasce com o painel completo a zero
- [x] `previewFor` volta a escolher a conta do tipo com mais histórico (a disponibilidade deixou de decidir o que se mostra, por isso deixou de decidir a amostra)

**Harness**
- [x] `obsidian-mock.js`: faltava `removeClass`/`hasClass` (o `closeAll` do dropdown só corre com uma lista aberta, por isso nunca falhou) — o fecho de dropdowns era intocável em teste
- [x] `manage-check.js`: percorre as 4 abas e prova que o picker muda o preview e grava a setting

### 2.17 Auditoria completa (3 agentes) — CORRIGIDO
> Auditoria a todas as views/metricas: consistência de números, edge cases, e comparação com o Journalit.

**Consistência de números / agregação**
- [x] **Filtro de tipo usava `t.accountType`** (keyword do nome) → agora usa o tipo da conta mapeada em **4 sítios**: Home, Trade Log, Day Log, e na **origem** (`loadTrades` + `resolveAccountType`)
- [x] **Mapeamento de conta case-sensitive** → `mappedAccount` agora é case/whitespace-insensitive (mapping + nome)
- [x] `copy.ts` matchers sem `.trim()` → corrigido
- [x] `accountsListView` "Risk room" e edge do card usavam `-net` em vez do **drawdown de pico** → corrigido (`st.dd` por dias)
- [x] `accountsListView.tradesFor` contava trades **sem data** → agora exige `t.date`
- [x] `performanceCalendarWidget` forçava `Europe/Lisbon` mesmo com "None" → agora `?? ""`

**Win rate / streaks / profit factor (alinhado com o Journalit)**
- [x] **Win rate** exclui break-even do denominador (`wins/(wins+losses)`)
- [x] **streaks**: break-even **pausa** (não reinicia) a série — antes zerava
- [x] **expectancy** exclui break-even
- [x] **profit factor** sem perdas → `∞` (antes: 5 fixo) e display corrigido
- [x] **day win rate** exclui dias flat
- [x] **daily room** agora tem cap no limite diário (antes podia exceder)

**Hold time / overnight**
- [x] `hold()` e `holdFmt()` fazem **wrap da meia-noite** (antes descartavam trades overnight)

**Contas / datas**
- [x] `account()` não cai para a primeira conta quando o `accountId` é inválido (mostra "conta não existe")
- [x] "Started on" pode ser **limpo** (apaga `createdAt`)
- [x] Tab Rules mostra o **default real da firm** (não o valor efectivo já sobreposto)
- [x] Conta funded criada no upgrade ganha `createdAt`
- [x] Restauro de arquivadas passa por `unarchiveAccount` + nome único (sem duplicados)

**UI / forms**
- [x] Widget **Payout** já aparece (layout default = trades + payout; todos os widgets disponíveis são mostrados)
- [x] **Breakdowns >8 grupos** já não desaparecem (o "Other" agrega o resto; header conta tudo)
- [x] Payout/depósito com valor inválido **não grava $1** (return se ≤0/NaN)
- [x] Trade Log: filtro de tipo inclui **Live** e **Personal**
- [x] R-multiple no Trade Log usa `futuresSpec(symbol)` (antes hardcoded ×20 — errado para ES/MNQ…)
- [x] `lineChart`: ignora valores não-finitos (NaN não estraga o gráfico); labels X limitados ao nº de pontos

**Home / período / broadcast**
- [x] Home "vs período anterior" (`previousPeriodTrades`) respeita o filtro de conta/tipo (antes usava todos os trades)
- [x] `baseTrades()` extraído — filtro de conta/tipo partilhado entre período actual e anterior
- [x] `applyBroadcast` marca as cópias com `isCopiedTrade`/`copyBaseKey` (antes não agrupavam → duplicavam)
- [x] Day Log mostra o **tipo mapeado** da conta (antes o keyword cru)
- [x] `unarchiveAccount` garante nome único e não colide com id existente

**Smoke**: 123 → **126** asserts (win rate exclui BE, BE pausa streaks, overnight wrap).

### 2.16 Bugs encontrados pelo maintainer — CORRIGIDOS
- [x] **Filtro "evals" no Home dava número errado** (3754 vs ~8684). Causa: filtrava por
  `t.accountType` (adivinha por keyword do **nome**) em vez do **tipo da conta mapeada**.
  "Tradeify" não tem keyword → trades caíam em "unknown" e eram excluídos.
  Corrigido em 3 sítios: Home, Trade Log, Day Log modal.
- [ ] (opcional) uniformizar o sinal do R (`+6.00R` no trade log vs `+1.5R` na conta)

### 2.15 Bugs encontrados no QA (inspecção de render) — CORRIGIDOS
- [x] **`++$50,400`** — sinal duplicado no growth da equity (o `fmtMoney` já inclui o `+`)
- [x] **`mappedAccount` só lia o mapping** — sem fallback por nome, as legs virtuais não eram geradas (corrigido: mapping → depois nome)
- [x] **`buildLeg` dava P&L ~0** quando a base não tinha `pnlPoints` (ex.: fills importados) — agora escala o P&L da base × ratio
- [x] Legs virtuais validadas: copier recebe física + virtuais; P&L/quantidade corretos

> [!tip] Ferramenta de QA
> `~/trading-journal-smoke/render-check.js` renderiza as views em jsdom e faz dump do
> DOM (classes + texto) — permite "ver" a UI sem abrir o Obsidian.
> `node render-check.js <smoke-dir> account|accounts|dashboard|modal|all`

---

## 3. Pendências / a verificar

> [!warning] A testar
> - [ ] **Escala**: 20–30 contas → listas, filtros, breakdowns, copy legs
> - [ ] **Copy trading**: leader com muitos copiers; períodos de cópia; dedupe de métricas
> - [ ] **Arquivo/restauro** de contas: confirmar que os trades voltam a contar em tudo
> - [ ] **Logos oficiais**: substituir placeholders (topstep, tradeify, tradovate, own)
> - [ ] **Smoke** desactualizado face aos novos asserts (109 actualmente)
> - [ ] `accountBreakdownMetric` no type — UI removida, limpar depois
> - [ ] `migrateFileNames()` só corre no botão "Fix names"

---

## 4. Como correr os testes

```bash
# Build
cd "/home/hugo/TradeBook/source" && npm run build

# Smoke
cd ~/trading-journal-smoke && cp "<source>/main.js" ./main.js && \
  cp "<source>/styles.css" ./styles.css && \
  node smoke.js /home/hugo/trading-journal-smoke
# → esperado: 126/126 PASS

# Deploy (main.js + styles.css + manifest.json + assets/ NUNCA data.json)
PLUGIN="<vault>/.obsidian/plugins/tradebook"
cp main.js styles.css "$PLUGIN/"
mkdir -p "$PLUGIN/assets/firm-logos"
cp assets/firm-logos/*.png "$PLUGIN/assets/firm-logos/"
```

---

## 6. Tooling do OpenCode (para acelerar o desenvolvimento)

Instalados no config global (`~/.config/opencode/opencode.jsonc`):

| Plugin | Para que serve |
|--------|---------------|
| `@tarquinen/opencode-dcp` | **Dynamic Context Pruning** — poda output obsoleto (sessões longas) |
| `@nick-vi/opencode-type-inject` | Injecta **tipos TS** nas leituras → menos erros de tipos |
| `opencode-vibeguard` | **Redige segredos/PII** antes de ir para o LLM (config em `~/.config/opencode/vibeguard.config.json`) |

> Removido: `@morphllm/opencode-morph-plugin` — o free tier (200 req/mês) é demasiado
> pequeno para o nosso ritmo. Sem custos.

- [ ] **Reiniciar o OpenCode** para carregar os plugins

### 6.1 Segurança (auditoria + correcções)
- [x] Google API key **removida** do `opencode.jsonc` (plaintext) → movida para `auth.json` (0600)
- [x] Segredos dos shells centralizados em ficheiros 0600:
  - `~/.config/fish/conf.d/opencode-secrets.fish` (fish, auto-carregado)
  - `~/.config/opencode/secrets.env` (bash/zsh, com `source` no `.zshrc`/`.bashrc`)
- [x] OpenAI key removida do `.zshrc` (plaintext) → agora no ficheiro de segredos
- [x] Backups criados: `opencode.jsonc.bak-*`, `auth.json.bak-*`, `.zshrc.bak-*`
- [x] `opencode-vibeguard` configurado para redigir keys (OpenAI/Anthropic/Google/GitHub/AWS/JWT), emails, UUIDs, IPv4
- [x] Verificado: nenhum segredo em plaintext nos ficheiros de config

> [!warning] Nota
> Se o OpenCode for lançado por um atalho gráfico (sem shell), as env vars não carregam —
> mas a Google key está no `auth.json`, por isso o modelo continua a funcionar.

## 5. Ligação a outros docs

- [[ROADMAP]] — funcionalidades futuras
- [[COPY-TRADING]] — contrato técnico do copy trading

## 2.23 Rotas de payout, contratos e sessões (ronda XFA + TopstepX)

- **Regra de produto**: o journal **reporta**, a prop firm **impõe**. Nada aqui bloqueia uma ordem, um payout ou uma trade — só informa. (Definido: "não somos uma prop firm".)
- **Rotas de payout** (`PropSize.payouts` → `PropAccount.payoutPath`): a XFA tem duas — Standard (5 winning days de $150+, cap $5.000) e Consistency (3 dias + 40%, cap $6.000). O seletor está na aba **Rules** do modal da conta; a página segue a rota escolhida (widget de payout: Route / Qualifying days / Day threshold / Per payout). Caps são informação, nunca controlo. Helpers em `src/props.ts`: `payoutPaths`, `activePayoutPath`, `payoutRules` (aceitam `null`).
- **Drawdown**: novo modo `eod-trailing-open` (segue o pico e **nunca trava**) — para firms que funcionam assim e para o *Trailing PDLL*; `ddNoLock` no motor de métricas e na linha do gráfico. TopStep XFA continua `eod-trailing` com `ddLockOffset: 0` (trava a $0).
- **DLL da XFA** só existe **fora do TopstepX** (`dailyLossNote`), escrito junto às regras da conta.
- **Contratos** (`src/futures.ts`): 45 instrumentos com point value/tick/tick value, `group`, `kind` (mini/micro) e o par `micro`/`mini`; `rootSymbol` procura a raiz mais longa primeiro; `FUTURES_SYMBOLS` com os comuns à frente; `FUTURES_GROUPS` por mercado.
- **Custos**: `COST_PROFILES` (broker → commission mini/micro + NFA) e `roundTurnCost(symbol, profile)`. Default = **TopstepX** (minis $1.00, micros $0.50, NFA $0.02 + exchange por produto). NQ/ES passaram de $5.76/$4.52 para **$3.78** RT; MNQ/MES $1.22. Metais com o aumento de 20 Jul 2026.
- **Sessões** (`src/lib/sessions.ts`): `sessionOf` / `sessionLabel` / `sessionRank` — RTH = 09:30–16:00 ET medido na **entrada**, convertido da zona do trader; sem `entryTime` devolve "No time" (nunca assume meia-noite). Nova aba **Session** nos Breakdowns da conta (Regular hours / Overnight / No time).
- **Harness novos**: `xfa-check.js` (rotas: 0/5 + $150 → troca → 0/3 sem threshold), `session-check.js` (fronteiras 09:29/09:30/15:59/16:00 e o caso sem hora). Verdes: smoke 126, rules-check, xfa-check, session-check, nan-sweep, ux-audit.

- **Trends saiu da página da conta** (16 Set, pedido do maintainer: «isto quero fora... seria algo que acho que gostava mais de ser na main page»): o widget passou para a **Home** (`CARD_TITLES.trends = "Trends"`, `NEW_W.trends = 8`, `NEW_H.trends = 4`, `case "trends": this.renderTrendsWidget(body, counted)`), com a lista **deduplicada** (`counted`) porque uma cópia é uma decisão. `src/lib/trends.ts` mantém-se (ganhou o hook `window.__tjTrends`), o CSS passou de `.tj-acc-trend*` para `.tj-trend*` e o `trends-check.js` verifica agora (a) ausência do widget na conta, (b) a tabela real da Home, (c) a matemática do módulo (win rate melhora, 4 trades não chegam).
- **Princípio de produto registado em `docs/UX-GUIDELINES.md` §0**: *o journal reporta, a prop firm impõe* — nada bloqueia ordens, payouts ou trades.

## 2.24 Trade Log V1 — o ledger (16 Set, decisão do maintainer)

- **Preview antes do código**: `previews/tradelog-previews.html` (3 grupos de opções) e `previews/tradelog-previews-2.html` (V1/V2/V3 + estados de review). Decisão do maintainer: **V1** ("dá mais ar") — ledger por dia com o rail de timeline, chip de review no cabeçalho, e a ordem `Time · Symbol · Side · Qty · Entry → Exit · Hold · R · P&L · Setup · Review`. Fora: os cartões, o modo 2 colunas e a faixa de 5 células.
- **Um só ledger para o plugin** (`src/lib/tradeTable.ts`): `TRADE_COLUMNS` (catálogo `{id,label,groupedLabel?,align,render}`), `renderTradeTable(host, opts)` (dias desc + trades por hora, rail, checkbox de selecção, drag de colunas com `mouseup` no document), `resolveOrder(saved, allowed)`, `holdFmt` (segundos, wrap da meia-noite), `tradeR` (R só com stop, nunca 0) e `shotUrl`. O Trade Log e a tabela dentro de cada conta usam o **mesmo módulo**.
- **Cabeçalho**: `Trade Log` + `+$X · N trades · W% win · +x.xxR` (e `· N legs` quando há cópias — com tip a dizer que uma cópia é uma decisão e tem uma linha por conta); chip âmbar `N to review` (clique filtra) quando há pendentes; barra de período na segunda linha com os chips de filtros (agora sublinhados, não cápsulas); fora o botão das 2 colunas.
- **Review**: a coluna só fala quando falta (`Needs review` âmbar com tip do que falta); uma trade revista não mostra nada. `Rating` e `Account` estão no picker de colunas mas desligados por defeito (não foram pedidos).
- **Preferências**: `tradeLog = { colOrder, filters }` (`twoCol`/`cols` removidos; as antigas são migradas uma vez). A ordem é **partilhada** entre o Trade Log e o ledger das contas (`settings.tradeLogColOrder`).
- **CSS**: bloco `.tj-tbl*` + chrome `.tj-tl-head/title/nums/alert/sub/ledger/pop`; apagados com um parser validado por round-trip os selectores mortos dos cartões (`tj-tl-item/row/rowimg/row1/row2/…`, `tj-acc-table*`, `tj-acc-daygroup`). Backup em `/home/hugo/tj-out/styles-before-ledger.css`.
- **Verificação**: smoke **126 PASS**; `node tools/ux-audit.mjs` sem violações; harness novo `tradelog-check.js` (**TRADELOG OK**) que confirma dias, dots do rail (um por trade), `Entry → Exit` na mesma célula, hold com segundos, coluna de review silenciosa quando revista, checkbox só em modo de selecção, e a mesma tabela na página da conta; `accmodal-check`, `trends-check` e `nan-sweep` continuam verdes. Screenshots: `/home/hugo/tj-out/tl-view.png` e `tl-account.png` (por `tradelog-shot.js`).

## 2.25 Saídas parciais — fills guardados, visíveis e escalados (16 Set)

- **Contexto e decisão**: o maintainer escalava posições (take profits separados) e o journal perdia a história — o import guardava **um** preço de entrada e **um** de saída. Provado em 3 notas reais em `Tradeify · Growth · $50K`, onde o preço de saída gravado não consegue produzir o P&L gravado (`20-08 MES LONG 1506`: saída 7698.50 na nota vs **7700.12** implicada; `24-08 MES LONG 1436`: 7669.25 vs **7670.62**; `28-08 MNQ LONG 1446`: 29698.25 vs **29691.65**). Resposta dele: «precisamos disto a funcionar no nosso sistema super bem para quem dá take profits separados» → opção **B** (guardar e mostrar só a ler). O preview do desenho está em `previews/partial-fills-previews.html`.
- **Dados** (`src/types.ts`): `TradeFill { side, time, qty, price, pnl?, fees? }` e `Trade.fills?`. Uma trade sem `fills` comporta-se exactamente como antes — **nada é migrado**.
- **Motor puro** (`src/lib/fills.ts`): `fillSet(t)` (fills explícitos ou sintetizados; `entries/exits`, `entryQty/exitQty/openQty`, `avgEntry/avgExit` ponderados, `positionSize` = pico de exposição, `isMulti`, `firstEntryTime/lastExitTime`), `fillLabel`/`fillIndex` (`entry 1`, `T1`, `T2`), `applyFillsToTrade` (recalcula os escalares; só mexe no `grossPnl` quando **todos** os exits têm P&L). Hook `window.__tjFills`.
- **Nota** (`src/storage.ts`): bloco YAML `fills:` escrito só quando há escala (indentado, legível e editável à mão) e lido de volta por `parseFills` (tolerante a notas editadas à mão). Hook `window.__tjStorage`.
- **Import** (`src/csv.ts`): corrigido em `pairRoundTrips`. Acumula entry/exit fills e o `maxOpen` de cada round-trip; o preço na nota passa a ser a **média ponderada** dos fills (o `entryPrice: pos.openPrice` do primeiro fill era o bug) e, havendo mais de um fill, as execuções ficam gravadas com o **P&L e as fees do próprio fill** (fees rateadas por quantidade). Hook `window.__tjCsv`.
- **Copy trading** (`src/lib/copy.ts`): novo `legFills(base, symbol, legQty, legCost)` — as legs herdam os fills **escalados** pelo multiplier (o fill maior absorve o arredondamento, para o total bater certo), com o P&L recalculado a partir dos pontos do próprio fill (mini↔micro tratado). Decisão do maintainer: «as copiers vao copiar tudo que a leader faz».
- **Ledger** (`src/lib/tradeTable.ts`): badge `.tj-tbl-fills` («⋔ 3 fills ⌄») na coluna Qty quando a posição tem mais de um fill; clique expande as execuções em sub-linhas (hora, buy/sell, qty, preço, hold da entrada, R do fill, P&L do fill, etiqueta `T1`/`T2`) sem alterar a linha da trade, que continua a mostrar a média. Posição aberta mostra `2/4` com tip («a parte aberta só conta quando fechar») e o P&L leva `*`.
- **Página da trade** (`src/views/tradeDetailView.ts`): secção **Executions** (só quando há escala) com cartões (contratos fechados, média de saída, melhor saída, fees), tabela por execução (Time · Side · Qty · Price · Points · P&L · Fees · etiqueta) e linha de totais que tem de bater com a trade. Nota a explicar que a média ponderada da linha do ledger é o que aqui aparece em detalhe. Read-only — a nota é que é escrita.
- **Fila**: o passo 6 (editar fills à mão + split/merge) fica para o fim, como combinado; o Journalit não mostra fills, o TradeZella/TradesViz/TraderSync/Tradervue mostram — é onde o nosso ledger se distingue.
- **Verificação**: build EXIT 0; smoke **126 PASS**; `node tools/ux-audit.mjs` sem violações (o badge foi dimensionado a 24px para cumprir a SC 2.5.8 sem excepção); harness novo **`fills-check.js`** — prova a lib (médias ponderadas, posição parcial, labels), o round-trip da nota, o badge/expansão/`2/4`/`*` no ledger, a secção da página da trade (e a sua ausência numa trade simples) e o import de um scale-out (1 trade, 3 fills, saída média `21,014` e P&L por fill a somar ao total). `tradelog-check`, `nan-sweep` verdes.

## 2.26 Trade Log: os filtros não funcionavam + Columns para dentro (17 Set)

- **Bug encontrado (a causa real)**: os popovers (Filters e Columns) são criados como filhos do cabeçalho com `position: absolute; top: calc(100% + 2px); right: 0`, mas **nem `.tj-tl-head` nem `.tj-header-actions` tinham `position: relative`** — logo ancoravam ao primeiro antepassado posicionado (o contentor da view) e ficavam fora do sítio, com o backdrop transparente (z-index 3000) a engolir os cliques: abrir os filtros e clicar não fazia nada. Correcção: `position: relative` nos dois contentores (o mesmo defeito afectava os popovers do Dashboard). Um harness não vê isto — foi preciso ler o CSS.
- **Segundo problema encontrado pelo harness**: o mock `obsidian-mock.js` não copiava `opts.value` no `createEl`, logo todos os `<option>` nasciam sem valor e os `<select>` liam `""` — o teste acusava os filtros de não funcionar quando o defeito era do mock. Corrigido (`opts.value` e `opts.title`, como no Obsidian). Backup: `obsidian-mock.js.bak3`.
- **Columns saiu do cabeçalho** (pedido do maintainer: «o columns tem que sair»): o botão desapareceu; mostrar/esconder colunas passou para o fundo do popover dos **Filters** (grelha de 2 colunas de ticks + a nota de que a ordem se arrasta nos cabeçalhos e é partilhada com o ledger das contas). Nada de funcionalidade perdida, um botão a menos.
- **Filtro de Tags implementado**: estava um `<select disabled>` com "Coming soon" — um controlo que mentia. Agora é uma lista real com todas as tags em uso (a vault do maintainer ainda não tem nenhumas) e entra nos chips e no Clear all. **Nenhum controlo do popover é um placeholder morto** (verificado no harness).
- **Harness novo `filters-check.js`**: abre o Trade Log com o vault real e prova cada controlo — Result (46 losses de 126), Wins (77), Type (Eval 106 → Demo 20), Direction (Short 52), search (`NQ` 113), chips, Clear all (volta a 126) e a ausência do botão Columns. `FILTERS OK`.

## 2.27 Trade Log: janelas de tempo + break-even como estado (17 Set)

### Janelas do Trade Log (pedido: «o nosso trade log tem que ter mais que all time, três meses e um mês … tens que poder ver tudo, seja de hoje, seja de ontem, seja da semana passada»)
- A barra de período passou a ter a lista completa, na ordem em que um journal se lê:
  **Today · Yesterday · This Week · Last Week · This Month · Last Month · This Quarter · This Year · All Time · Custom** (`PERIODS` em `src/views/tradeLogView.ts`).
- Semanas de **segunda a domingo**; meses são meses de calendário, para baterem com o calendário que o trader já olha.
- `lastweek` (segunda a domingo anteriores) e `lastmonth` (1.º ao último dia do mês anterior) novos em `periodRange()`.
- **Migração**: o id antigo `1m` (This Month) continua a ser lido, tanto nos filtros gravados como em `settings.tradeLogPeriod`.
- O **chip** passou a mostrar o nome da janela (`Period: Last Week`), não o id (`Period: lastweek`).
- Harness: `tradelog-check.js` ganhou um bloco `[periods]` — exige os 10 botões, a ordem (curtas antes de All Time), o chip com nome, que a janela estreita a lista e que All Time devolve tudo (126 de 126). Nota: as asserções medem `view.filtered().length` com **All Time como baseline**, porque filtros de blocos anteriores do harness podem estar activos.

### Break-even é um estado, não um lado (regra de produto)
- **O trade é classificado pelo resultado total.** TP1 + TP2 tomados e o resto fechou flat = **win** (net positivo). Um trade só é break-even quando o net é **exactamente zero**.
- Nos **fills**, uma saída que fechou ao preço de entrada aparece etiquetada **`T2 · BE`** (a posição que é, mais a decisão que a terminou) com a classe `is-flat`, e o P&L desse fill fica **sem cor** (`tj-flat`, tom muted) — nem verde nem vermelho.
- Um trade que neta zero **não recebe classe de tom nenhuma** no ledger (antes aparecia verde por `>= 0`), e o dinheiro flat escreve-se **`$0`** (novo `toneClass()` em `src/lib/fills.ts`; `fmtMoneyAbs` para não imprimir `+$0`).
- Página da trade: a tabela de executions usa a mesma regra no P&L por fill e no total.
- **Nenhuma fórmula de métricas mudou** — o win rate continua `wins / (wins + losses)`.
- Harness: `fills-check.js` ganhou o bloco `[break-even]` com dois fixtures novos (`runnerTrade()` = TP1 + TP2 + runner flat, `flatTrade()` = tudo flat) e prova: net positivo é win, a etiqueta `T3 · BE` existe, o fill flat não tem cor, o trade flat não tem tom nenhum.

### Documentos novos (pedido: guardar o que vamos precisar)
- **`docs/RELEASE-AND-DISTRIBUTION.md`** — canais (Dev/Test/Beta/Stable), o que a BRAT exige (releases como fonte de verdade, assets `main.js`/`manifest.json`/`styles.css`, tag = versão do manifest sem `v`, pre-releases contam para o "latest", repo privado precisa de token), layout do repo, checklist de release, segurança de dados do tester (update não toca no `data.json`; desinstalar apaga-o), pacote limpo e tutorial, e o que é preciso decidir **antes** da primeira beta: o **`id` do plugin** (renomear depois obriga a migração).
- **`docs/BACKUP-AND-EXPORT.md`** — os dois casos (A backup sistema→sistema, B export para análise), a comparação verificada com Journalit/TradeZella/TradesViz/TraderSync/Edgewonk/Tradervue/TradeNote, e a decisão: **A** (um ficheiro re-importável com tudo, incluindo as trades) como diferenciador — quase nenhum journal o tem — e **B** depois do lançamento, mais pequeno.

### Verificação desta ronda
`npm run build` EXIT 0 · smoke **126 PASS / 0 FAIL** · `node tools/ux-audit.mjs` **no normative violations found** · `fills-check` **FILLS OK** (com os novos asserts de break-even) · `tradelog-check` **TRADELOG OK** (com o bloco de períodos).

## 2.28 Backup: um ficheiro que restaura o journal (17 Set)

Pedido do maintainer (m3426/m3428): «tínhamos que ter um export geral de tudo… um export nas nossas global settings… exportar as settings que estão guardadas, as trades, todo o review. Tínhamos que criar um sistema do nosso sistema para exportares do nosso sistema para o nosso sistema se quisesses trocar de computador ou backup.»

- **Formato** — `src/lib/backup.ts`: `BACKUP_KIND` (`tradebook-backup`), `BACKUP_VERSION`, `buildBackup()`, `backupFilename()`, `summariseBackup()`. Hook de teste `window.__tjBackup`. O ficheiro leva `settings` (tudo o que o plugin guarda: contas, arquivadas, mappings/aliases, grupos de copy, payouts, depósitos, layouts, ordem e cores dos tipos, regras), `notes[]` com **path + markdown cru** de cada nota, `counts` e `exportedAt`.
- **Porquê markdown cru** e não objectos: um objecto perde as secções escritas no corpo da nota; o markdown é cópia fiel e permite recriar uma nota em falta exactamente. 126 notas ≈ 87 KB.
- **Escrita** — `plugin.getBackupFolder()` = `backups/` ao lado da pasta de trades (fica no git/backup do maintainer). `exportEverything()` lê as notas, monta o payload e escreve via `vault.adapter` (mkpath + write).
- **Leitura** — Settings → Advanced → **Backup**: `Export everything` (Notice com caminho, KB e nº de notas) e `Import a backup…` (file picker). Um ficheiro estranho é **recusado com uma frase**: JSON que não é JSON, export só-de-settings, ou backup de uma versão mais nova (`update the plugin first`).
- **Restauro** — `openBackupSummary()` (`src/views/backupRestore.ts`): cartão com data, versão do plugin, contas (com arquivadas), notas, payouts, depósitos; toggle **Also restore trade notes that are missing**; Cancel / Restore backup. `applyBackup()` **substitui** as settings (`{...DEFAULT_SETTINGS, ...backup.settings}` — restaurar é «isto é o que o meu journal era», não fundir), guarda um **snapshot** `data.pre-import-<ts>.json` na pasta do plugin antes de mexer, e **nunca reescreve notas existentes** — só preenche lacunas.
- **Prints ficam no vault** (são imagens, não dados nossos): o texto das settings e o tutorial dizem que é preciso copiar a pasta do vault para os levar.
- **Rejeitado de propósito**: gravar `data.backup.json` em cada `saveSettings()` (corre a cada mudança de filtro; o export já cobre o caso).
- **Teste** — `~/trading-journal-smoke/backup-check.js` (**BACKUP OK**) contra o vault real: escreve, relê (`summariseBackup`), recusa 3 ficheiros maus, apaga as contas em memória + remove uma nota, restaura e prova que as 18 contas voltam, que a nota em falta é recriada (1/125 intocadas), que o snapshot existe e que com o toggle desligado nada é escrito.
- **Docs**: `docs/BACKUP-AND-EXPORT.md` §3/§4 actualizados com o que foi entregue e as decisões tomadas a construir.

### Verificação
`npm run build` EXIT 0 · smoke **126 PASS / 0 FAIL** · `ux-audit` **no normative violations found** · `backup-check` **BACKUP OK**.

## 2.29 Trade Log: filtros que faltavam + acções em lote (17 Set)

Pedido do maintainer (m3426, voz): o trade log tem de responder a «hoje, ontem, a semana passada»; o break-even tem de ser cuidadoso («podes bater TP1, TP2 e depois breakeven… mas é uma win na mesma»); e a selecção tem de servir para alguma coisa.

### Filtros novos (`src/views/tradeLogView.ts`)

- **Multi-valor** em Account, Setup, Mistake e Tag: um filtro guarda uma lista e casa por *qualquer um* dos valores. UI: `multi()` no popover, chips `.tj-tl-pick` (pill, `.on` quando activo), `.tj-pop-field-wide` a ocupar as duas colunas, lista com `max-height: 96px` e scroll. Estado: `accountFilters`, `setupFilters`, `mistakeFilters`, `tagFilters` (arrays).
- **Break-even no Result**: `pnl === 0` exacto. É um **estado**, não um lado: um trade que tomou TP1/TP2 com o runner flat é **win** (net positivo) e este filtro deixa-o lá. Nenhuma fórmula mudou (o win rate continua `wins/(wins+losses)`).
- **Session**: Regular hours / Overnight / No time, via `sessionOf()` de `src/lib/sessions.ts` (zona da setting, nunca assume meia-noite).
- **Duration**: Scalp (≤5m) / Intraday / Held past a day / No times, via `holdMinutes()` novo em `src/lib/tradeTable.ts` (segundos parseados uma vez; `null` quando falta uma hora — uma trade sem horas é «no time», nunca um scalp).
- **Missing**: No print / No setup / No stop / No rating — o filtro que ajuda a acabar o journal.
- Migração: as chaves antigas (`filters.account`, `.setup`, `.mistake`, `.tag`, cada uma um único valor) são lidas uma vez em `onOpen()` e convertidas em lista; `persistFilters()` escreve só as novas.

### Acções em lote

- **Mark Unreviewed** (novo), **Add Tags** (era um botão morto com «Tags coming soon» — agora soma a união das tags existentes, sem as apagar), **Set rating…** e **Change account…** como *pickers* (`mountDropdown`), não prompts de texto: uma escolha de um conjunto conhecido não se escreve à mão.
- `bulkField()` passou a aceitar `string | number | boolean`; `bulkTags()` lê a nota, faz a união (case-insensitive) e escreve o array; `bulkAccount()` usa `setTradeAccount()` e diz para onde moveu.
- O export CSV da selecção ficou **de fora** nesta ronda: o maintainer duvidou do valor («nós vamos trazer o CSV para aqui») e o Caso A (backup completo) cobre sistema→sistema. Ver `docs/BACKUP-AND-EXPORT.md`.

### Verificação

- Harness `filters-check.js` (actualizado): 8 selects + 4 listas de chips, Result 46/77, multi-conta (dois picks somam), Session 40 RTH / 85 sem hora, Duration 31 scalp / 3 intraday, Missing «No print» 122 de 126, Break-even alcançável (3) e os wins continuam wins (77), barra de selecção com Mark Unreviewed / Add Tags / 2 pickers (5 estrelas e 18 contas) — os pickers **não** são clicados, porque o harness corre contra o vault real.
- `npm run build` EXIT 0 · smoke **126 PASS / 0 FAIL** · `node tools/ux-audit.mjs` **no normative violations found** · `tradelog-check` **TRADELOG OK** · `nan-sweep` **NAN SWEEP OK** · `fills-check` **FILLS OK**.
- Screenshot do popover aberto (com 2 contas e session/duration activos) em `tj-out/tl-filters.png`; `tradelog-shot.js` ganhou a variante `filters`.

## 2.30 Primeira utilização: tour dentro do plugin + diagnostics (17 Set)

Preparação de beta: o tester tem de ter a **mesma experiência que o utilizador final**, por isso o onboarding vive no plugin e não só no README do repositório.

- **`src/views/gettingStarted.ts` (novo)** — modal com 5 passos (Welcome · Folder · Accounts · First trade · Done): dots de progresso, `Skip for now`, `Back`/`Next` e um primário por passo. Passo 2 grava a pasta de trades; passo 3 mostra a contagem de contas (ou abre o wizard, com o lote explicado na nota); passo 4 abre Add Trade ou o import CSV; passo 5 aponta onde vive tudo. Fechar a meio **grava `onboardingStep`** e reabrir **retoma**; terminar (ou saltar) grava `onboardingDone`.
- **`src/lib/diagnostics.ts` (novo)** — snapshot em texto: versão do plugin e do Obsidian, pasta, fuso, formato de data, moeda, privacidade, contagens (contas activas/arquivadas, notas, expandidas com legs, payouts, depósitos), as settings que mexem nos números, a lista de contas (firm/programa/tamanho/tipo/role/passed) e o **último erro da sessão**. Nunca leva conteúdo de notas nem segredos. Hook de teste `window.__tjDiagnostics`.
- **`src/main.ts`** — settings `onboardingDone` / `onboardingStep`; captura do último erro (`window` error + unhandledrejection via `registerDomEvent`); `showGettingStarted()`, `lastError()`, `writeDiagnostics()`; comando **Show the getting started tour**; e no `onLayoutReady`, a tour abre **uma vez** quando não está marcada como vista e o journal ainda não tem contas (por isso um vault novo a vê e um harness não).
- **`src/settings.ts`** — Advanced reorganizado: as duas secções «Maintenance» duplicadas passaram a uma (Fix file names + Rebuild trade index), e nascem **Getting started** (Open tour · Restart) e **Diagnostics** (Copy · Save to vault). O `Rebuild` mudou de sítio, sem perder nada.
- **`~/trading-journal-smoke/obsidian-mock.js`** — o mock não tinha `registerDomEvent`, `registerEvent`, `registerInterval`, `register` (o `onload` rebentava em qualquer harness). Acrescentados como stubs fiéis ao original.
- **`~/trading-journal-smoke/onboarding-check.js` (novo)** — percorre os 5 passos, prova que a pasta é gravada, que o passo das contas reporta as 18 existentes, que retoma no passo 3, que saltar marca visto, e que o diagnostics sai com nome datado, versão, contagem real de contas, pasta, secção de último erro e **sem segredos**. Resultado **ONBOARDING OK**.

### Verificação

- `npm run build` EXIT 0 · smoke **126 PASS / 0 FAIL** · `node tools/ux-audit.mjs` **no normative violations found** · `onboarding-check` **ONBOARDING OK** · `nan-sweep` **NAN SWEEP OK** · `manage-check` **MANAGE OK** · `backup-check` **BACKUP OK**.
- Deploy: `main.js 58f3d8963e84e45226ee670a51877a60`, `styles.css 8ff4ad5f343036a0042ba336265a1b44` (md5 iguais nos dois lados).


## 2.31 Payouts com ciclo + alertas nos cartões (17 Set)

Decisões do maintainer: **sem profit splits** («isso é entre as props e o dinheiro pessoal da pessoa»), sem perguntas extra sobre reiniciar o floor («o trabalho das firms é o trabalho das firms»), e um sítio por conta que mostra **o dinheiro real que ainda está lá**.

- **Ciclo de payout** (`src/lib/accountMetrics.ts`): `lastPayoutDate` (último payout **pago**) parte o histórico em ciclos; novos campos `cycleNet`, `cycleQualifyingDays`, `cycleDays`, `cycleConsistencyPct`; e **`profitSinceLastPayout` passou a ser o lucro do ciclo** (era o P&L de sempre — a meia-verdade).
- **Balance real**: `AccStats.value = size + net − payouts pagos + depósitos`; o cartão mostra-a em `.tj-acct-bal-v`; a strip trocou a célula **Capital** por **In accounts** (soma das balances reais, com `on $X capital` na sub-linha). O gráfico da carteira já fazia isto.
- **Alertas** (`alertFor` em `accountsListView.ts`): no máximo **um chip por cartão**, prioridade `PAYOUT READY` > `NEAR LIMIT` > nada. `PAYOUT READY` exige conta `funded|live` **com rota de payout**, ciclo com dias suficientes, lucro do ciclo > 0 e consistência do ciclo dentro do limite. `NEAR LIMIT` acende aos 80% do drawdown usado. Os dois textos dizem que o journal reporta e a firm decide.
- **Rotas de payout nas fundeds Tradeify** (`src/props.ts`, 20 `payouts:` no total): `growth-funded` (35% consistency + minimum balance), `select-flex`, `select-daily`, `lightning` (20%), `elite-live` (daily). Sem isto o alerta nunca acendia fora da XFA.
- **`src/main.ts`**: `lastPaidPayoutDate(accountId)` (só `status === "paid"`).
- **Widget de payout da conta**: Route, Qualifying days (ciclo/exigidos), Day threshold, Per payout (**sem split**), **Profit this cycle**, **Best day of cycle**, **In the account**, Withdrawn e **Eligibility** com 4 estados, mais a nota «Your side of the count. The firm is the one that approves a payout.»
- **`.tj-acct-tile` ganhou `data-account`** (id da conta no DOM): apoio ao suporte e aos harnesses, que deixam de casar por nome.
- **`cards-check.js` alargado**: verifica a balance real das 18 contas contra `size + net − payouts + depósitos` (ao cêntimo), que não há chip onde a rota não está satisfeita, e — com duas contas sintéticas em memória — que o chip âmbar acende aos 95% do limite, que o verde acende com 5/5 dias e 20% de consistência, que um payout **pago** abre ciclo novo (cycleNet 0) e que um **requested** não mexe em nada.

### Verificação

- `npm run build` EXIT 0 · smoke **126 PASS / 0 FAIL** · `node tools/ux-audit.mjs` **no normative violations found** · `cards-check` **CARDS OK** · `rules-check`, `xfa-check`, `pass-check`, `accmodal-check`, `trends-check`, `nan-sweep`, `manage-check`, `onboarding-check`, `backup-check` todos verdes.
- Deploy: `main.js ccc08e785c0171eb74d0cae50e7587f7`, `styles.css 4dcb8a8b30fc78ecbac6bb309c2cc9dd` (md5 iguais nos dois lados).

## 2.32 Cenário simulado para experimentar payouts (17 Set)

O maintainer pediu para simular uma funded para experimentar as features. Escolha: **`TopStep · Express Funded (XFA) · $50K`** (`pa_mu3u452ikd0m`), a única com rota de payout real e limite de $2.000.

- **Onde vive:** 6 notas em `source/test-fixtures/trades/sim/` (pasta nova, tudo lá dentro). Geradas por `/home/hugo/tj-out/simulate-funded.py` (re-executável com outros números); frontmatter em **snake_case** porque é o que `parseTradeFromMarkdown` lê (`entry_price`, `exit_time`, `pnl`, …).
- **O cenário:** 11–15 Set, cinco dias de +$420/+$380/+$448/+$400/+$352 (todos ≥ $150, logo dias de qualificação), e 16 Set um dia mau de −$1.700. São dias de calendário consecutivos; o que conta para a qualificação é o net de cada dia. MNQ, 2 contratos, preços coerentes com `pnl = pontos × $2 × qty` (o gerador lê o P&L de volta dos preços, para a nota não se contradizer).
- **Os três passos que ele pode fazer:** (1) como está hoje (Started on = 16 Set) só o dia mau conta → chip âmbar `85% of limit used` e a balance em `$48.300`; (2) mudar `Started on` para **2026-09-11** no modal da conta → `5/5` dias de qualificação, ciclo `+$300` → chip verde `Payout ready` e balance `$50.300`; (3) registar um payout **pago** (ex.: 17 Set) → o ciclo reinicia (0/5, sem chip de payout) e volta o âmbar, com a balance a descer pelo valor do payout enquanto o net P&L **não mexe**.
- **Remover:** apagar a pasta `sim/` — ou, dentro do Trade Log, filtrar por **Setup → SIM · TMM** (são 6), entrar em modo de selecção e usar **Delete**. Cópia de segurança do vault antes: `/home/hugo/tj-out/trades-backup-20260916-184213`.
- **Harness `~/trading-journal-smoke/sim-check.js` (novo)** — corre o loader real sobre o vault, imprime as 6 notas e, para o XFA, o `value`, o ciclo, o dd usado e o chip nos três casos acima (como está, com `Started on` movido, e sem `Started on`). **Não escreve nada.** Resultado: âmbar 85% → verde `Payout ready` (5/5, ciclo +300) → verde também sem `Started on`.
- **Nota de manutenção:** as expectativas de alguns harnesses estão ligadas ao vault real; com a pasta `sim/` presente correram todos verdes (`cards-check`, `filters-check`, `tradelog-check`, `nan-sweep`, `onboarding-check`), mas se ele apagar/adicionar trades de outra forma convém re-correr antes de desconfiar do código.

## 2.33 Payouts sem estados + drawdown sobre a balance real (17 Set)

Duas decisões do maintainer nesta ronda: **acabar com o `requested`/`paid`** («quando ela recebesse na conta, vinha aqui e marcava o dia que foi» — manter dois estados era dar trabalho a quem regista) e **os payouts aproximam a conta do limite** («se tu tirares um payout, na prop firm ficas mais próximo do drawdown porque já não tens tanto dinheiro lá»).

- **`src/main.ts`** — `accountPayoutsTotal` soma **todos** os payouts; `lastPaidPayoutDate` → **`lastPayoutDate`** (não há estados); `registerPayout(accountId, date, amount, note?)` perdeu o parâmetro `status` (grava `status: "paid"` só por compatibilidade de dados).
- **`src/views/accountDashboard.ts`** — o formulário de payout é Date · Amount · Note; a tabela é Date | Amount | Note, o total soma tudo, e o empty-state diz «Log one on the day the money reaches you, and the account value below follows.»
- **`src/lib/accountMetrics.ts`** — input `cashflows?: Array<{date, amount}>` (payouts negativos, depósitos positivos); a série de **balance** passa a juntar os dias de cash-flow (`flowByDay`, `allDays`, `balanceSeries`); o **floor** vem do **pico da balance** (`peakBalance − maxLoss`, com `ddLockOffset`/`ddNoLock` a continuarem a mandar); outputs novos: **`balance`**, **`balancePeak`**, **`ddToLimit`**. `peak`/`ddCurrent`/`maxDrawdown` continuam **só de trades**.
- **`src/views/accountsListView.ts`** — `statsFor` constrói `flowByDay` (payouts negativos + depósitos), `stats.dd` = `max(0, peakBalance − balance)`, `stats.value = m.balance` e passa `cashflows` ao motor. Logo: o chip `NEAR LIMIT`, a cor do edge e a barra *Drawdown level* reagem a um payout.
- **`src/views/accountDashboard.ts`** — a série do gráfico inclui dias de cash-flow (ponto neutro, delta 0), `runningTrades` e `runningBalance` em paralelo, `net` = trades, `balance` = `size + runningBalance`, `peak`/`floor`/`buffer` sobre a balance, novo `ddToLimit`, e o número grande do hero mostra a **balance**.
- **Harnesses** — `cards-check.js`: «any recorded payout opens a fresh cycle» (substituiu a asserção do requested/paid). `sim-check.js`: bloco **[a payout moves the limit closer]** — balance 50.300 → 49.600, 1.700 → 2.400 até ao limite, net P&L parado em +300.

### Verificação

- `npm run build` EXIT 0 · smoke **126 PASS / 0 FAIL** · `node tools/ux-audit.mjs` **no normative violations found** · `cards-check` **CARDS OK** · `sim-check` **SIM OK** · `filters-check` **FILTERS OK** · `tradelog-check` **TRADELOG OK** · `nan-sweep` **NAN SWEEP OK** · `accmodal-check` **ACCMODAL OK**.
- Deploy: **main.js `0e36feede7ce33112357a0f59d93b3e0`** (md5 iguais nos dois lados); `data.json` nunca tocado.
- Em aberto: haverá **página de payouts**? e mantemos o **modelo de qualifying days** por firm (a opção que dá mais trabalho e mais risco de erro)?

## 2.34 Payouts: fim do veredicto «ready to payout» (17 Set)

Decisão do maintainer: «vamos tirar isso ready to payout de tudo e assim, vamos pelo simples... somos acima de tudo
informação estratégica das contas, só marcamos os payouts para o valor seguir certo e termos valores
corretos de drawdown e assim para as nossas estatísticas». Os widgets de payouts vão para a **Home**, mais tarde.

- **`src/views/accountsListView.ts`** — `alertFor()` perdeu o ramo do payout por completo: sobrou **um** sinal,
  o `NEAR LIMIT` (dd ≥ 80% do limite). Nada de veredicto sobre se já se pode pedir payout.
- **`src/views/accountDashboard.ts`** — o widget passou de «Payout readiness» a **«Payouts»** e perdeu a linha
  `Eligibility` (e os estados «Ready to request / N days to go / needs profit / best day is over the limit»).
  Ficam só factos: Route · Qualifying days · Day threshold · Per payout · Profit this cycle · Best day of cycle ·
  In the account (`M.balance`) · Withdrawn, com a nota «Counted from your last payout. Marking it is what keeps
  the account value and the distance to the limit honest.» O `In the account` deixou de ser somado à mão e passa
  a ler `M.balance` (fonte única).
- **Barra do cartão** — `payout` mudou de rótulo: **«Payout readiness» → «Since last payout»** (no
  `slotsFor` e no catálogo `src/lib/cardSlots.ts`, incluindo o hint). O id ficou igual, por isso o layout
  gravado de quem já a escolheu continua a funcionar.
- **`styles.css`** — removida a regra morta `.tj-alert-payout` (o chip verde deixou de existir); fica só
  `.tj-alert-limit`, com comentário a dizer onde o widget de payouts vai viver.
- **Harnesses** — `cards-check`: as asserções antigas do chip verde foram substituídas por «a completed payout
  cycle raises no chip at all», «the cycle numbers are still computed» e «the words Payout ready appear nowhere
  on the card»; o resto (payout abre ciclo novo, com ou sem status) continua. `sim-check`: asserção nova
  «only the limit chip exists — no payout verdict». Renomeada a opção procurada no picker do Manage → Cards.
- **Verificação** — build EXIT 0 · smoke **126 PASS / 0 FAIL** · `ux-audit` **no normative violations** ·
  `cards-check` **CARDS OK** · `sim-check` **SIM OK** · `filters-check` **FILTERS OK** · `tradelog-check`
  **TRADELOG OK** · `nan-sweep` **NAN SWEEP OK** · `onboarding-check` **ONBOARDING OK** · `manage-check` **MANAGE OK**.
- **Deploy** — main.js `822626fc84376377cfa95102e86f0f36`, styles.css `b440b813093252c49e76f36a2c063b46`
  (md5 iguais nos dois lados); `data.json` nunca tocado.

## 2.35 Fim do modelo de regras de payout (17 Set)

Pedido do maintainer, com screenshot da conta XFA: «na página da conta ainda tem os route qualifying days e
assim, não quero nada disto — eu disse para removeres tudo sobre isto do nosso sistema». O journal não
é uma prop firm: as regras de payout saem por completo; fica só o registo que mantém o **valor** certo.

### Removido

- **`src/props.ts`** — a interface `PayoutPath`, `PropSize.payouts`, a const `TOPSTEP_XFA_PAYOUTS`, os
  **20** arrays `payouts: [...]` (XFA + as 5 fundeds/live da Tradeify que os ganharam na ronda anterior) e
  os helpers `payoutPaths` / `activePayoutPath` / `payoutRules`. Ficaram os `note`/`tagline` em prosa
  (informação da firm, não maquinaria) — **por confirmar se também saem**.
- **`src/types.ts`** — `PropAccount.payoutPath`.
- **`src/lib/cardSlots.ts`** — o slot de barra `payout` («Since last payout») e a sua entrada no
  catálogo; `DEFAULT_BARS` de `funded`/`live` passou a `["dailyRoom", "drawdown"]` (ids desconhecidos
  gravados em layouts são filtrados por `ALL_SLOT_IDS`).
- **`src/lib/accountMetrics.ts`** — inputs `qualifyingDayProfit`, `payoutDaysRequired`,
  `lastPayoutDate`; o bloco de ciclo inteiro (`cycle*`); e da interface `AccountMetrics` saíram
  `qualifyingDays`, `qualifyingDayProfit`, `payoutDaysRequired`, `profitSinceLastPayout`,
  `payoutCapRemaining` e os quatro campos do ciclo. A secção ficou reduzida a `withdrawn`
  («Money taken out of the account so far. Cash, not performance.»).
- **`src/views/accountDashboard.ts`** — o widget `payout` inteiro (Route · Qualifying days · Day
  threshold · Per payout · Profit this cycle · Best day of cycle · In the account · Withdrawn · nota),
  o bloco «Payout route» do modal (segmento, `paintRoute`, gravação de `acc.payoutPath`) e os inputs de
  métricas. `ORDER` passou a `["trades"]`.
- **`src/views/accountsListView.ts`** — o slot `payout` do catálogo de barras, o uso de `payoutRules` e
  os inputs de ciclo. Mantém-se `flowByDay` (payouts/depósitos), `dd` sobre a balance, `value = m.balance`,
  a célula **In accounts** e o **único** alerta `NEAR LIMIT`.
- **`src/main.ts`** — o método `lastPayoutDate` (ficam `payoutsFor`, `accountPayoutsTotal`,
  `registerPayout`, `removePayout`, `depositsFor`, `accountDepositsTotal`).
- **`styles.css`** — `.tj-acc-perfnote` (morreu com o widget); comentários de `.tj-alert` /
  `.tj-alert-limit` reescritos a dizer que as regras de payout não são modeladas.

### Verificação

- `npm run build` **EXIT 0**; `rg` de controlo em `src/` sem vestígios de `lastPayoutDate`,
  `profitSinceLastPayout`, `payoutCapRemaining`, `qualifyingDayProfit`, `qualifyingDays`, `payoutPath`,
  `payoutRules`, `activePayoutPath`, `PayoutPath`; bundle deployado **limpo** (`bundle clean`).
- Harnesses ajustados: **`xfa-check.js` apagado** (testava as rotas da XFA; saiu do `AGENTS.md`);
  `smoke.js` — a asserção `qualifying days` substituída por `balance = money in the account`
  (`50350/0`); `cards-check.js` — o bloco do picker prova que **nenhuma barra de payout é oferecida**,
  cada chip de cartão tem de ser o de limite (`near-limit=1`), a conta sem trades não levanta chip, e a
  sonda `pa_probe_payout` prova que dias verdes não acendem nada, que um payout de `$500` desce a balance
  (`51000 → 50500`) com o `net` parado em `1000` e o **dd a subir 0 → 500** (payout datado de um dia sem
  trades, para o efeito ser exactamente o valor levantado), e que registar um payout **não é um veredicto**;
  `sim-check.js` — deixou de imprimir o ciclo, mantém `only the limit chip exists` e o bloco
  `[a payout moves the limit closer]` (`50.300 · 1.700` → `49.600 · 2.400`, `net` 300).
- **Verificação** — smoke **126 PASS / 0 FAIL** · `ux-audit` **no normative violations** ·
  `cards-check` **CARDS OK** · `sim-check` **SIM OK**.
- **Deploy** — main.js `9db0b21595f015a53abaefa90fe3235a`, styles.css `21e8c60055043514c1957a3b16a9d1cd`
  (md5 iguais nos dois lados); `data.json` nunca tocado.

## 2.36 Um só termo (Payout) + payout page na conta + widget na Home (17 Set)

Pesquisa pedida pelo maintainer («temos que ligar isto aos payouts. Ou renomeamos um ou renomeamos outro…
tens que pesquisar na net qual é o termo mais usado»): as prop firms dizem **payout** (Topstep:
«5 winning days to request your first payout», «Minimum payout is $125»; Tradeify: «payout rules»,
«minimum payout request», «funds are deducted from the simulated account»; Apex/MyFundedFutures/FTMO:
«Minimum Payout», «Payout Frequency»). *Withdrawal* aparece só como mecânica. Nos journals, TradeZella
(PropFirm Sync) e Tradesyncer usam Payout como categoria própria; TradesViz/TraderSync/Edgewonk dizem
deposits/withdrawals porque modelam a balança, não o evento de prop. **Decisão: um só termo, `Payout`.**
`rg -n "Withdraw" src/` → zero após as edições.

- **Renomeações**: célula da strip `Withdrawals` → **`Payouts`** (tooltip novo: o dinheiro que te pagaram,
  sempre all-time porque um payout baixa o valor e aproxima o limite); mini-stat `Withdrawn` → **`Paid out`**
  (id do slot `withdrawn` mantido, para os layouts gravados continuarem a valer); `cardSlots.ts` com o
  mesmo rótulo/hint.
- **`src/views/payoutModal.ts` (novo)** — `openPayoutsModal(plugin, accountId, onChange?)`; uma única
  ecrã, **sem tabs e sem flip**: `Total paid out` (`.tj-pay-v`), contagem de payouts, data do último,
  nota («lowers the account value and brings your loss limit closer. It never touches your P&L, win rate
  or trade count.»), formulário **sempre visível** (Date via `mountDateField`, Amount `type=number`,
  Note) com `Save payout` → `registerPayout`, e a tabela `Date | Amount | Note | ✕` com
  `removePayout`. Empty-state a apontar o dia em que o dinheiro chega.
- **Página da conta** — botão quadrado `.tj-iconbtn` com ícone **`banknote`** (`aria-label="Payouts"`)
  no cabeçalho das contas **funded/live/personal**; abre o modal. O **gear** passou de `tj-btn tj-mini`
  com `⚙` para `.tj-iconbtn` + `sliders-horizontal` (mesmo `aria-label`, por isso o `accmodal-check`
  continua válido). Método novo **`renderPayoutLine`** substituiu `renderPayoutTracker` + `showPayoutForm`:
  linha `Paid out $X · N payouts` sob o título, clicável. O `renderDepositTracker` (personal) não foi tocado.
- **Home** — widget **Payouts** (opt-in em *Add widget*): total levantado, contagem, contas, ano, 6 meses
  em barras e a última linha com data/conta/valor; exclui a demo (`excludeDemosFromPortfolio !== false`).
- **Dois bugs reais corrigidos** (o primeiro só aparecia com um payout num dia **sem trades**): em
  `accountDashboard.ts` as estatísticas de dia (`grossProfit`/`bestDay`) e os *streak dots* indexavam
  `byDay.get(d)!` sobre a lista `days`, que passou a incluir os dias de cash-flow → **TypeError e página
  da conta em branco**. Agora saem de `[...byDay.values()]` e `[...byDay.keys()].sort().slice(-20)`.
- **Lacuna do mock corrigida**: `obsidian-mock.js` `createEl` só copiava `cls/text/value/title/attr`;
  faltavam **`type`, `placeholder`, `min`, `max`, `step`** (sem `type`, um `input[type=number]` não era
  number e o harness falhava — era o mock, não o produto).
- **Harness** `~/trading-journal-smoke/payouts-check.js`: widget da Home (empty, números reais, demo fora,
  barras, último) + **`[payout page]`** (botão, linha `Paid out`, modal com total do **desta** conta,
  guardar 250 → `400 → 650` e a página a descer de `49.600` para `49.350`, remover, e **uma eval não tem
  botão**). Para abrir uma página de conta em harness: `_makeLeaf` + `await setViewState({type, active, state})`
  + `await view.setState({accountId})` + `await render()`.
- **Verificação**: build EXIT 0 · smoke **126 PASS / 0 FAIL** · audit **no normative violations** ·
  `payouts-check` **PAYOUTS OK** · `cards-check` **CARDS OK** · `nan-sweep` **NAN SWEEP OK**.
- **Deploy** — main.js `bcfccb2122d4fb24600827232db8e407`, styles.css `5c0c27fd0b5180a2780ee23b0ef2f19f`
  (md5 iguais nos dois lados); `data.json` nunca tocado.


## 2.37 Payout modal: falha silenciosa corrigida + desenho da casa (17 Set)

O maintainer registou um payout, foi à página da conta e viu `Total paid out +$0`, `Payouts 0`, `Last —` e «No payouts yet». O `data.json` confirmou: `payouts: []`, zero ids `pay_` — **nada chegou ao disco**.

- **Causa**: o handler de guardar era `if (!Number.isFinite(parsed) || parsed <= 0) return;`. No print, o `1000` do campo Amount era **placeholder** (campo vazio) — clicar `Save payout` não fazia nada e não dizia nada. Uma falha silenciosa é indistinguível de um bug de persistência.
- **Guardar com resposta**: valor inválido → `Enter an amount first — for example 1,000.` inline (`.tj-payout-error`) + foco no campo; valor válido → grava `registerPayout` e confirma com `Notice` (`Logged $X paid out of <conta>.`).
- **Desenho da casa**: o modal foi refeito com a receita do modal Management (`row()` → `.tj-mg-row` com label à esquerda e controlo ghost à direita), largura `min(520px, 92vw)`, inputs ghost `.tj-payout-input` (hairline em baixo, texto à direita) e a data com `.tj-datefield` alinhado à direita (o ícone deixou de ficar sobreposto). O botão passou a `.tj-actionbtn.is-primary` (`Log payout`) — já não é o roxo do Obsidian.
- **A tabela deixou de ser tabela**: lista `.tj-payout-lrow` (grid `104px 96px 1fr 28px`) com `Date | Amount | Note` e remover por linha.
- **O empty-state rebentava o modal**: era `.tj-empty` (19px, `padding: 40px 0`) dentro de um `<td>`, a transbordar para fora da caixa. Agora `.tj-payout-empty` com `Nothing logged yet.`
- **Notas de ensino fora** (pedido dele: «a mensagem não faz sentido estar, as pessoas sabem disso»): a nota do modal (`.tj-payout-note`) foi apagada e as tooltips ficaram só com o essencial («Paid out of this account.», «Paid out to you from your funded and live accounts. Always all-time, whatever the chart is showing.», «Money that left your accounts.»).
- **Harness** `payouts-check.js` actualizado (botão `Log payout`, lista `.tj-payout-lrow:not(.is-head)`, asserção a exigir que **não** haja nota de ensino).
- **Verificação**: build 0 · `PAYOUTS OK` (`400 -> 650`, `650`, página `49600 -> 49350`, eval sem botão) · smoke 126/0 · audit limpo. Deploy `main.js c57be11f0add70edaee09da2a844b655` · `styles.css 05a7a8dd8f1c59b6c07ea21b12c820d6`.

## 2.38 Um só quadrado no header + o badge dourado de payouts + a data do modal (17 Set)

Três coisas que ele apanhou ao usar o payout pela primeira vez:

- **Dois quadrados no header → um.** O botão do dinheiro (`banknote`) saiu: o header do single account fica com **um só** quadrado (account settings, `.tj-iconbtn`), e a porta dos payouts passou a ser o **badge dourado** sob o título — onde ele queria ("fique ao lado da nossa coisa de payouts, onde puseste"). Sem payouts, o badge dá lugar a um discreto `Log a payout` (senão o primeiro payout não teria porta nenhuma).
- **Badge dourado** (`.tj-acc-cashbadge`): pílula com gradiente/realce `#d9a441`/`#e8c547`, ícone `banknote`, valor **compacto** e um *shine* lento a atravessar a cada ~5s (`@keyframes tj-shine`). O brilho **desliga-se** com `settings.animations === false` (classe `is-still`) e com `prefers-reduced-motion`. **A contagem não está no badge** — está no hover (`1 payout · last 2026-09-10 · click to open the register.`), porque um badge é um número, não uma frase.
- **Dinheiro compacto**: novo `fmtMoneyCompact` em `tz.ts` (`$950` · `$1.5K` · `$25K` · `$1.2M`, sem sinal de "+" — dinheiro que sai não é um ganho). Usado no badge e nas linhas do registo; o total do modal continua exacto (`+$2,200`), que é o número que se lê uma vez.
- **A data invisível no modal**: a causa era CSS — o wrapper (`.tj-payout-modal .tj-datefield { width: 150px }`) e o input (`.tj-payout-input { width: 150px }`) tinham ambos largura fixa com `justify-content: flex-end`, e o valor ficava espremido fora da vista (o mesmo defeito que já tinha aparecido no modal da conta). Agora a data segue a receita do modal da conta (`width: auto; flex: 1 1 auto` no wrapper; `104px; flex: 0 0 auto; text-align: right` no input, com `-webkit-text-fill-color` explícito). O `className` deixou de ser passado ao campo de data, para não voltar a colidir com as regras dos inputs simples.
- **Como foi verificado**: novo harness `payout-shot.js` (abre a página da conta com 2 payouts injectados em memória, escreve `payout-page.html` + `payout-modal.html` em `/home/hugo/tj-out/` e diz o texto do badge, quantos quadrados tem o header, o valor do campo de data e as linhas da lista) + screenshots Chromium lidos. Resultado: `badge: Paid out $2.2K`, `squares in header: 1`, `date field value: "16/09/2026"`, linhas `2026-08-12 $1.2K First payout` / `2026-09-10 $1K`. O `payouts-check.js` ganhou ainda asserções para: **um só quadrado** no header, o badge dourado com valor curto, a contagem **ausente** do badge, a data com valor, e os montantes **sem "+"**.
- **Verificação**: build 0 · `PAYOUTS OK` (33 asserções) · `CARDS OK` · `SIM OK` · smoke **126/126** · audit **no normative violations** (faint usages 0).

## 2.39 Payouts: dois quadrados no header, badge só informativo, e o modal com vida (17 Set)

Segunda passagem sobre o mesmo ecrã, agora com o maintainer a usá-lo (screenshot do modal):

- **O botão do payout voltou ao header, ao lado do account settings** («quero o botão do payout ao lado do nosso edit account settings. Não quero embaixo do título»). São **dois** quadrados `.tj-iconbtn` (payouts, settings), na mesma fila, com o mesmo tamanho — o `banknote` só aparece em funded/live/personal.
- **O badge dourado passou a ser informação, não porta**: deixou de ser `<button>` (sem `aria-label`, sem cursor, sem clique) e só existe quando há dinheiro fora; o `Log a payout` tracejado (`.tj-acc-cashadd`) foi apagado, porque o quadrado do header é a porta. Assim há **uma só** entrada para o popup («eu só quero um quadrado para o pop-up»).
- **O formulário do modal estava a ser pintado pelo Obsidian**: `.tj-payout-input` (uma classe) perdia para as regras de `input` dentro de `.modal` — daí as caixas cinzentas do print — e o mesmo acontecia ao botão (cinzento em vez de accent). Agora tudo é scoped com `element.class` + `!important` (`.tj-payout-modal input.tj-payout-input`, `.tj-payout-modal button.tj-actionbtn.is-primary`), os spinners do `number` foram escondidos e o placeholder usa `--tj-fg-3` (o audit voltou a **faint usages 0**).
- **Data encostada ao canto**: `.tj-datefield { margin-left: auto }` + input de 104px alinhado à direita — a data lê-se a partir da margem direita, como os outros valores.
- **Vida no ecrã** (pedido: «quero alguns efeitos, umas cores e assim para não ser morto»): moeda dourada ao lado do título (`.tj-payout-headico`), `TOTAL PAID OUT` em cinzento com o valor **em dourado** (`+$2,200`), montantes da lista em dourado, hover das linhas com um véu dourado, botão `Log payout` no accent com ícone de check, erro com ícone `circle-alert`, e o empty-state com uma moeda (`Nothing logged yet.`) em vez de uma frase solta.
- **Harness**: `payouts-check.js` passou a exigir **dois** quadrados (payouts + settings, o segundo ainda com `aria-label="Edit account settings"`), que o badge **não** seja um `BUTTON` («one square for the popup») e mantém a contagem fora do badge; `payout-shot.js` clica o quadrado do header (já não o badge). Screenshots lidos: modal com o total dourado, hairline em vez de caixas, `Log payout` accent e linhas `$1.2K`/`$1K`; página com os dois quadrados alinhados e o badge `PAID OUT $2.2K`.
- **Verificação**: build 0 · `PAYOUTS OK` · `CARDS OK` · `SIM OK` · smoke **126/126** · audit **no normative violations** (faint usages 0).

## 2.40 Payouts: uma só superfície, data à direita, botão ghost, badge no header (17 Set)

Quatro coisas que ele viu no screenshot do modal:

- **«Só quero que o fundo seja só um, não quero dois»** — o formulário do modal trazia a classe `.tj-payout-form`, que é a **moldura legada** do formulário inline do tracker antigo (fundo `--background-secondary`, borda, raio 10, padding 12). Essa classe ainda é usada pelos **depósitos** (`showDepositForm`), por isso não se apaga: o modal passou a usar **`.tj-payout-fields`**, uma superfície só. Regra de casa que fica registada: **um modal é uma superfície**; controlos sobre o fundo, nunca caixas dentro de caixas.
- **A data «fora do sítio»**: o wrapper tinha `flex: 1 1 auto` e por isso esticava — o glifo e o valor ficavam encostados ao rótulo. Agora `flex: 0 0 auto !important; margin-left: auto !important; justify-content: flex-end`, com o input de 150px e `text-align: right`. **Provado por medição** (não a olho): o `payout-shot.js` injecta um `<pre id="diag">` que mede as caixas num motor real — `DIAG {"date":[551,701],"amount":[551,701],"wrapFlex":"0 0 auto","wrapJustify":"flex-end","framed":false}` → a data termina exactamente no mesmo x que o campo Amount e já não há moldura.
- **Botão ghost**: dentro de um modal o Obsidian pinta os `button` com as regras dele e a nossa classe solta perde (era isso que o deixava cinzento). Agora `.tj-payout-modal button.tj-actionbtn` força o ghost (`background/box-shadow` transparentes, `color: var(--text-muted)`, hairline, 30px) com `!important`, e o hover acende a borda. O botão deixou de ser `is-primary`: um registo não é uma chamada à ação.
- **Badge dourado no header**: passou do corpo da página para o header, **à esquerda dos dois quadrados** (payouts + account settings) — «quero ali ao lado em cima do lado direito». `.tj-acc-actions` deixou de fazer wrap (`flex: 0 0 auto`): o badge e os dois quadrados ficam numa linha e é o **nome da conta que cede** (quebra dentro da sua própria caixa). Verificado com um nome longo real (`Tradeify · Select Funded · Flex (5-Day) · $50K` em duas linhas) e o header continua numa só.
- **Harness**: `payouts-check.js` com 37 asserções (badge dentro do header, badge que não é botão, `.tj-payout-fields` presente, `.tj-payout-form` ausente, botão sem `is-primary`); `payout-shot.js` com o diagnóstico de caixas e os HTML para screenshot.
- **Verificação**: build 0 · `PAYOUTS OK` · `CARDS OK` · `SIM OK` · smoke **126/126** · audit **no normative violations** (faint usages 0).

## 2.41 Payouts: o segundo fundo era o `tj-modal`, a data ao canto e o badge em metal (17 Set)

Três coisas que ele apanhou, todas com causa concreta:

- **«Só quero um» fundo (o modal tinha dois).** A causa era a classe **`tj-modal`**, que é a caixa legada do overlay antigo: `background: var(--background-primary); border: 1px solid …; border-radius: 12px; padding: 20px; max-width: 800px; max-height: 85vh; box-shadow: …` (styles.css ~l.1610). Aplicada a um `Modal` real (o `contentEl` já é `.modal-content` dentro de `.modal`), pintava **uma segunda superfície dentro da primeira** — um modal, duas molduras. O modal da conta **nunca** teve essa classe (por isso é que ele sempre pareceu certo, e é a referência que o maintainer deu). Retirada de **todos** os quatro que a tinham (`payoutModal.ts`, `accountsManage.ts`, `gettingStarted.ts`, `backupRestore.ts`) em vez de só do dos payouts. Verificado com screenshot do Management (uma superfície, tabs e cartões intactos).
- **A data ao canto direito.** O `input` de data esticava porque, dentro de um modal, `.modal-content input[type="text"]` do Obsidian tem especificidade superior a `.tj-payout-modal .tj-datefield-input` — o `width`/`text-align` eram simplesmente ignorados. Corrigido com o selector scoped `input.tj-datefield-input` (mesma especificidade) **e** `!important` em `width`/`min-width`/`flex`/`text-align` (o mesmo tratamento nos `.tj-payout-input`). Prova por medição num motor real: `DIAG {"date":[395,545],"amount":[395,545],"wrapFlex":"0 0 auto","wrapJustify":"flex-end","framed":false}` — data e Amount acabam exactamente no mesmo x, e `framed: false` diz que já não há moldura.
- **Badge «mais gold».** Deixou de ser um pill amarelo com tinta dourada e passou a **metal**: gradiente a 135° que escurece nas pontas e clareia no meio (`#6d4d10 → #ac7d22 → #eccf68 → #f7e79b → #c99a2e → #7d5a13`), hairline de luz em cima, aresta escura em baixo, glow dourado suave (`0 1px 7px rgba(217,164,65,.3)`) e a **tinta passou a ser escura** (`#261b04` sobre o ouro — é isso que faz o ouro parecer ouro em vez de parecer mostarda). O brilho a atravessar ficou mais visível (branco a 55% em vez de 22%) e continua a desligar-se com as animações desligadas e com `prefers-reduced-motion`.
- **Verificação**: build 0 · `PAYOUTS OK` · smoke **126/126** · `node tools/ux-audit.mjs` **no normative violations** (faint usages 0) · screenshots do badge (`PAID OUT $2.2K` em metal, alinhado com os dois quadrados) e do modal.

## 2.42 A data do modal: sem glifo e com o `native` domado (17 Set)

Depois de a data ficar com a mesma aresta direita do Amount (provado por medição), ele continuava a vê-la «no meio» — e apontou com o dedo para o `input.tj-datefield-native`, «está a tapar o canto».

- **O glifo era o culpado do "meio".** O campo de data é um wrapper com o valor *e* o glifo do calendário (`.tj-datefield::before`), e o grupo inteiro é que estava encostado à direita — o valor ficava 22px à esquerda da aresta. No modal dos payouts o glifo foi **removido** (`.tj-payout-modal .tj-datefield::before { display: none }`) e a caixa passou a ter exactamente os mesmos 150px do Amount e do Note. O campo inteiro continua a abrir o picker (o clique está ligado ao wrapper).
- **O `native` passou a ser inline.** O `input[type="date"]` invisível é posicionado em CSS (1px, `opacity: 0`, `pointer-events: none`), mas dentro de um modal as regras do Obsidian para `input[type="date"]` podem ganhar a uma classe — e o campo esticava. Agora `mountDateField` escreve essas propriedades **em linha** (`native.style.cssText`), que nenhuma folha de estilos ganha sem `!important`. Isto vale para **todos** os campos de data do plugin (wizard, modal da conta, payout, range do Home), não só este.
- **Prova**: `DIAG {"rowval":[256,545],"wrap":[395,545],"date":[395,545],"native":[395,545],"amount":[395,545],"framed":false}` — o wrapper, a data e o Amount começam e acabam nos mesmos pixels. Screenshot: Date / Amount / Note com as três hairlines a acabar no mesmo x, com o valor `16/09/2026` encostado à direita.
- **Verificação**: build 0 · `PAYOUTS OK` · smoke **126/126** · `node tools/ux-audit.mjs` **no normative violations** (faint usages 0).

## 2.43 O payout no gráfico: ponto dourado e a linha no pop-up (17 Set)

Pedido dele: «temos o pequeno pintarolas a marcar o payout no gráfico… quando tiver estes pontos amarelos, o pop-up mostre o payout amount daquele dia. Atenção que se for feito em mais contas naquele dia tem que somar. E dentro das contas… em vez de ter bolinha vermelha, que fique uma bolinha dourada… Só nos dias em que houve um payout é lá dizer o payout, mas aqui neste caso só daquela conta.»

Duas escalas, de propósito:

- **Página da conta** (uma conta, um dono do dinheiro): `lineChart` ganhou `dayCash?: number[]` — os índices dos dias em que **esta** conta pagou. Esses pontos deixam de ser verdes/vermelhos e passam a **dourados** (`.tj-eq-daydot.is-cash { fill: #e8c547 }`), porque o dinheiro saiu, não foi perdido. O `fill` deixa de ser escrito como atributo nesses dias — a cor é o ponto, e um atributo inline ganharia ao CSS. O pop-up (Trades, Day P&L, Drawdown level, Target) ganha uma linha **Payout** (dourada, `b.tj-cash`) só quando o dia teve payout desta conta.
- **Página Accounts** (o gráfico soma contas): o `hoverLines` novo soma o `flowByDay` daquele dia e mostra **Payout $X** com o total das contas visíveis — 500 + 300 = 800 num só dia, em vez do último valor lido. Os marcadores âmbar/verde já lá estavam; o que faltava era o número no pop-up.

Verificação no harness novo **`cash-check.js`** (sweep do rato por cima do gráfico a recolher todos os pop-ups, com o build e o vault reais):
```
ok the payout day is marked in gold on the account curve — 1 gold dot(s)
ok the hover card says Payout on that day — …Trades0Day P&L+$0Payout+$500Drawdown level+$50,000Target+$53,000
ok and it is this account's own amount — $500
ok the other days still read Trades / Day P&L / Drawdown level
ok the portfolio hover card names the payout — …12 SepPayout+$800
ok and it is the day's total across accounts — $500 + $300 = $800
```

## 2.44 Trade Log: os 11 itens do plano aprovado (17 Set)

Tudo o que o maintainer aprovou, entregue numa ronda:

1. **Ordenar por coluna** — clicar no header alterna desc → asc → sem ordem (`cycleSort`), com seta (↓/↑/↕) e `aria-sort`. Vive no ledger partilhado, por isso a tabela dentro de cada conta ganhou o mesmo. `TradeColumn.sortValue`/`firstDir` por coluna (date asc, qty/pnl/hold/r desc, símbolos/texto asc, review pela completude, print pelo ter/não ter). Os sem valor vão sempre para o fim. Gravado em `settings.tradeLog.sort`.
2. **✓ de review na própria linha** — botão `.tj-tbl-tick` na coluna Review (48 pendentes / 2 feitos no vault real), com `aria-label` e tooltip a dizer o que falta. Uma linha que seja uma cópia virtual avisa em vez de falhar: «This row is a copy held in memory — open the original trade to review it.»
3. **Memória de posição** — ao voltar de uma trade, a linha de onde saíste volta ao centro (`scrollIntoView`, `data-trade` = id).
4. **Print deixou de ser miniatura** — é um **tick** (✓ tem print / — não tem), com tooltip. O print continua a ver-se no detalhe. No vault: 50 linhas, 3 com print (as 33 notas que dizem `screenshot: "added"` contam como sem print, por desenho).
5. **Títulos alinhados** — uma só linha de título em todas as páginas. Medido em Chromium com o harness novo `heads-shot.js`: antes Home 26 · Accounts 24 · Trade Log 43 · Setups 43; **depois 4 / 4 / 4 / 4**. A Home é `sticky` e lê 6px mais alto que a padding box, por isso os outros sobem os mesmos 6px (`margin-top: -6px`) em vez de deixar a diferença sem explicação.
6. **Uma linha por trade lógica** — ver § abaixo.
7. **`Add Tags` fora da barra de lote** — prometia um sistema de tags que não temos; o método `bulkTags()` foi apagado com ele. `Add Setups` fica (a página de Strategies vem aí), o filtro de Tags fica.
8. **Setups → Strategies** — nav, ícone (`target`) e página. A página mostra o empty state da Home com **«Under construction»** e a explicação do que uma strategy vai ser (regra de entrada, stop, alvo, tamanho — e as trades medidas contra ela). O `id` interno continua `setups`, para não quebrar leaves gravadas.
9. **Filtros reestruturados** — a barra passou a ter só: período, **busca** (saiu do painel), **segmento `All / To review / Reviewed`** e dois quadrados: **Filters** (com contador de filtros ativos) e **Columns** (voltou a ser botão próprio). O painel está agrupado por perguntas: `What I traded` (contas, ticker, tipo) · `How it went` (resultado, direção, **R multiple** — novo: `1R or better` / `0 to 1R` / `At or below 0R`) · `When` (sessão, duração) · `Quality` (setups, erros, tags, faltas). Os chips do que está ativo ficam em baixo; `Search`/`Review` deixaram de ter chip porque agora estão à vista.
10. **Barra do dia** — o dia deixou de ser uma linha da tabela: é uma barra própria, `sticky` por baixo do header (`top: 30px`), com o dia em maiúsculas, a contagem numa pill e o **total do dia à direita, alinhado com a coluna do P&L**. Dentro do dia, hairlines leves.
11. **Os «legs» desapareceram do ecrã** — a palavra era nossa e ninguém tem de a aprender.

### 2.44.1 Uma linha por trade (e o bloco das contas no detalhe)

- `tradeRows(trades)` (novo, em `src/lib/tradeTable.ts`) agrupa por **`legBaseKey`**: uma linha por trade lógica, com o registo **não-copia** como representante e o **dinheiro somado** das contas. `TradeColumnCtx.row` leva a linha às células, por isso a coluna P&L mostra o total, não o pedaço de uma conta.
- A coluna **Account** passa a mostrar `N accounts` (com tooltip a listar, por conta, o nome e o valor) quando a trade chegou a mais do que uma.
- As contagens são de **trades** e o dinheiro de **registos** — a barra do dia diz `5 trades`, nunca `5 legs` nem `7 records`; o cabeçalho só mostra o número de trades e explica o resto no hover («N records in all: a trade you also copied shows once, and its row says how many accounts it reached.»).
- No **detalhe da trade**, bloco novo **`N accounts`** com uma linha por conta, o **original marcado**, o valor de cada uma e a nota «Your trading numbers count this trade once; the money is what it made in each account.» (os valores ficam lado a lado de propósito: uma cópia pode ter um P&L diferente por ratio e comissões).
- Verificado: **50 registos → 35 linhas**, 15 linhas com chip de cópias, detalhe da primeira com `2 accounts`, e duas asserções a garantir que a palavra «leg» não aparece em sítio nenhum da página. `LEDGER OK`.

## 2.45 Trade Log, ronda 2: a barra do dia, as setas, os filtros que saíram e o picker de contas (17 Set)

Decisões do maintainer (m4308): barra do dia na opção **A** (pill centrada entre hairlines) com o **+C** (dias alternados) a explorar; **B** rejeitada («fica muito confuso»); setas no lado, com a escolha setas↔letras a ficar para as settings do Trade Log; filtros — **Type sai** (é pergunta de contas), **Tags sai** (não há sistema de tags), **Duration sai** («faço day trading, raramente vou usar isso»), **Missing fica** com `No print` e `No rating` obrigatórios.

**Barra do dia (A + C).** O dia deixou de ser uma linha da tabela: é uma divisória — hairline, pill centrada (`WED 2 SEP · 5 TRADES · +$745`), hairline — presa ao topo (`position: sticky; top: 30px`) e com os dias alternados a **3.4%** de tinta (`is-alt`). A 2.2% não se via no screenshot; 3.4% lê-se sem parecer uma faixa.

**Setas.** A coluna `side` escreve só a forma: `▲` verde / `▼` vermelho com `aria-label="Long"/"Short"`. A palavra escrevia-se em todas as linhas e custava uma coluna de largura; a forma é a mensagem e a cor só concorda. A escolha setas ↔ letras vai viver nas settings do Trade Log.

**Filtros.** Saíram `Type`, `Tags` e `Duration` (do painel, dos chips, do `filtered()`, do `clearFilters()`, do persist/restauro). `Missing` passou de escolha única a **multi com OR** (`qualityFilters: string[]`, helper `missingFlag(t, kind)` no topo do módulo): escolher `No print` **e** `No rating` pede *qualquer uma* — o objectivo é encontrar o que falta acabar. O chip diz os dois: `Missing: no print or no rating`. O valor antigo (string única) é lido e convertido, por isso nada se perde na migração.

**Picker de contas (a pergunta é de contas, não de trades).** As contas deixaram de ser uma lista em scroll: têm campo `Find an account…`, **contagem de trades por conta dentro do período visível**, caixa de selecção, nome e contagem, com as contas sem trades esbatidas (`is-quiet`) e três atalhos — `All`, **`Only with trades here`** (num mês, 18 contas passam a 5) e `None`. A informação de estado escreve-se por extenso: `Every account` / `N of M selected` / `None selected`.

- **Bug real apanhado pelo harness**: com o sentinela `NO_ACCOUNT = "__none__"`, `wanted` ficava vazio e o `if (wanted.length)` **não filtrava nada** — clicar **`None` mostrava o jornal inteiro**, a mentir sobre o filtro. Agora `!wanted.length` devolve lista vazia («The picker's "None" means none»).

**Colunas.** Ordem por omissão nova (`Symbol · Side · Qty · Entry → Exit · R · P&L · Hold · Setup · Print · Rating · Review`, com **Time e Account desligados** — a barra do dia carrega o dia e os nomes das contas chegam a 35 caracteres), mais **três presets** no painel (`Essential` = símbolo/lado/R/P&L; `Everything`; `Review` = data/símbolo/setup/print/rating/review) e **`Reset to default`**. E uma migração em `loadSettings`: se a ordem gravada for **exactamente** a antiga por omissão, é apagada para a nova entrar; quem tiver mexido mantém o layout.

**`legBaseKey` apertado (bug real de identidade).** Era `t.copyBaseKey || tradeKey(t)` — a chave de conteúdo (data, símbolo, direcção, minuto, preço de entrada) era um bom palpite mas uma má identidade: **duas trades abertas no mesmo minuto ao mesmo preço são duas decisões, não uma**. A vault do maintainer tem esse padrão (`28-08 MNQ SHORT 1440` + `1440_2`, 10+10 contratos, 11 segundos de diferença) e as duas apareciam como uma linha. Agora `t.copyBaseKey || t.id || tradeKey(t)`: só um **link de cópia** agrupa dois registos; as legs continuam a colapsar porque `synthesizeLegs`/`buildLeg` escrevem `copyBaseKey: legBaseKey(base)`.

**Página Strategies.** Ícone `target` no nav, título «Under construction» maior, o **martelinho a martelar** (`@keyframes tj-hammer`, desliga com as animações desligadas e com `prefers-reduced-motion`), **sem botão** e uma lista do que vem: a regra (entrada/saída/risco/tamanho), trades medidas contra ela, o que acontece quando não se segue, os números por strategy e a regra «uma trade, uma linha» (copiada para 5 contas = uma decisão).

**Harness.** `filters-check.js` reescrito (sem Type/Duration/Tags; `Missing` multi com `No print` 127/131 e `No print or no rating` 129/131; picker de contas com os três atalhos, 5 de 18 contas com trades, clicar encolhe 46/131 e duas alargam a 85; a única busca do painel é a das contas). `ledger-check.js` e `tradelog-check.js` passaram a fixar `view.period = "all"` — o período gravado é o último clique do maintainer (uma janela custom de um dia), e sem isso os testes mediam a última coisa que ele olhou. `fills-check` ficou verde com o `legBaseKey` novo.

**Verificação**: build 0 · smoke **129 PASS / 0 FAIL** · `FILTERS OK` · `LEDGER OK` · `TRADELOG OK` · `CASH OK` · `BULK OK` · `USER-LEVEL` restantes OK · audit **no normative violations**. Deploy `main.js 4b1c448fc8ad64b81fba7b25960e67ba` · `styles.css d5f6e2d786f3f21847d0a39f980f0bdf`.

## 2.45 A pill do dia não aparecia — CSS morto a vencer (17 Set)

A pill centrada (`THU 10 SEP · 1 TRADE · +$560`) existia no DOM mas não se via na app do maintainer.

- **Causa**: regras mortas de rondas anteriores que ainda viviam em `styles.css` (linhas 6546-6572). A mais nociva era `.tj-tbl-day td:last-child { display: flex; align-items: baseline; gap: 10px }` — fazia do `td` um container flex com um filho único (o `.tj-tbl-daybar`), e os hairlines (`flex: 1`) encolhiam para zero porque o bar não tinha `width: 100%`. A pill existia, mas não havia linhas ao lado — lia-se como uma linha isolada dentro de um `td` invisível.
- **Correccao**: o bloco inteiro das regras mortas (6545-6572: `.tj-tbl-day td`, `.tj-tbl-day td:last-child`, `.tj-tbl-dayname`, `.tj-tbl-daymeta`, `.tj-tbl-daynet`) foi apagado e substituído por um comentário de 2 linhas. A regra intermédia (sticky + background) ficou porque fornece o que a actual não tem. Acrescentado `width: 100%` a `.tj-tbl-daybar` como seguro.
- **Porque é que o smoke não apanhou**: o smoke tem o CSS embebido no HTML (o harness lê `styles.css` e injecta), e as regras novas tinham maior especificidade para `.tj-tbl-daybar`. No smoke a pill aparecia porque não havia `.tj-tbl-day td:last-child` a competir (o harness monta a tabela diferente do Obsidian real).
- **Verificação**: build 0 · smoke **129 PASS / 0 FAIL** · deploy `main.js 4b1c448fc8ad64b81fba7b25960e67ba` / `styles.css e2437172e87ad18abeb17069aa3da4b9`.

## 2.46 Clear All, sort em todas as tabelas, zebra fora, rail fora, scroll preservado (17 Set)

Nove pedidos, todos resolvidos:

- **Clear All fora do painel**: quando há filtros activos, aparece um botão `Clear all` ao lado do quadrado de filtros (ghost sem moldura, vermelho no hover). Um clique limpa tudo — não é preciso abrir o painel.
- **Clear All dentro do painel**: o `Clear all` que estava em baixo dos chips passou para a **mesma linha do «What I traded»**, à direita, ghost. Sempre acessível, sem scroll.
- **Sort em todas as tabelas**: o sort por coluna (desc → asc → sem ordem) funciona agora no **Trade Log** e na **tabela dentro de cada conta**. A conta tem o seu próprio estado de sort no widget; o Trade Log grava a sua preferência. A tabela do detalhe da trade continua read-only (sem sort).
- **Load more preserva posição**: ao carregar mais 50 linhas, a tabela não volta ao topo — guarda o `scrollTop` antes e repõe-o no `requestAnimationFrame` seguinte.
- **Pill do dia com fundo**: a pill centralizada (`THU 10 SEP · 5 TRADES · +$745`) ganhou `padding: 3px 10px` + `border-radius: 999px` + `background: var(--background-modifier-hover)` — separa-se do fundo e não se perde.
- **Zebra fora**: o fundo alternado de 3.4% nas linhas dos dias foi removido — a pill do dia e a barra sticky criam separação suficiente.
- **Rail vertical fora**: a linha que ligava os pontos (o `::before` da coluna do rail) foi removida; ficaram só os **pontos** (verde/vermelho) — mais limpo, a mesma informação.
- **Espaço entre cabeçalho e tabela**: `.tj-tl-ledger` passou de `margin-top: 6px` para `10px`.
- **Separador mais grosso entre colunas e primeiras linhas**: `thead th` ganhou `border-bottom: 2px solid var(--background-modifier-border)` — separa o cabeçalho das colunas do conteúdo.

- **Verificação**: build 0 · smoke **129/129** · audit **no normative violations** (small targets 2, dentro das excepções). Deploy `main.js efe89d876fb4e91016749e3b761f12f3` · `styles.css 900c3ec51c9f1f048aab406fba59a632`.

## 2.47 Executions no fundo, botão de print visível, Setup selector, Strategies a nomear (17 Set)

Quatro pedidos do maintainer, todos resolvidos:

- **Executions para o fundo.** `renderExecutions(body, t)` deixou de ser chamado antes das duas colunas e passou para depois do bloco de contas — é informação detalhada e não editável, por isso fecha a página. A tabela completa (summary + tabela + total) mantém-se para todas as trades.
- **Botão de remover print invisível.** O `.tj-td-shot-remove` estava `opacity: 0` e só aparecia com hover no cartão. Passou a **sempre visível** (0.85, 1 no hover), quadrado 26×26 com hairline, e vermelho da casa (`--color-red`) no hover. O ícone SVG ganhou `stroke-linecap: round`. Ninguém tem de adivinhar onde se apaga uma print.
- **Setup passou a selector.** No detalhe da trade, o input de texto deu lugar ao `mountDropdown` da casa: lista os setups conhecidos (registo + nomes usados nas notas, sem duplicados por caixa) e um item **`＋ New setup…`** que pergunta o nome e o regista. O selector mostra o valor actual mesmo que já não exista na lista. CSS morto: `.tj-td-input` removido dos selectors agrupados (o `.tj-td-textarea` ficou).
- **Página Strategies a nomear setups.** Deixou de ser só o «Under construction»: tem a lista **Your setups** (nome, nº de trades, P&L com `toneClass`), botão **`＋ Add setup`**, e por linha **rename** (lápis) e **remove** (lixo). O aviso de que vem mais continua lá em baixo («More is coming»), agora com o que já existe por cima.

**Backend novo (o que a strategies vai usar):** métodos no plugin — `knownSetups()` (registo ∪ nomes das notas, case-insensitive, primeira grafia ganha), `addSetup(name)`, `removeSetup(name)` e **`renameSetup(old, new)`**. O rename é a peça crítica: escreve no registo **e reescreve todas as notas** cujo `setup` coincide (legs de cópia incluídas, via `loadTradesExpanded()` + `updateTradeFields`), devolve quantas mudaram e limpa a cache. Remover do registo não toca nas notas de propósito — a lista é um índice, não a história.

**Decisão de fundo (a dívida futura):** o `setup` continua a ser uma **string legível na nota** (sobrevive sem plugin, é pesquisável em Dataview). As regras da strategy, quando chegarem, vivem no **registo** (settings), não na nota. Isto obriga a que o rename seja uma acção de primeira classe — está feito. Ver o aviso ao maintainer sobre export/backup: `settings.setups` vive no `data.json`, por isso uma cópia só-do-vault não leva o registo.

**Harness.** `smoke.js` deixou de exigir «Under construction» e passa a exigir «Name the setups you trade» + «More is coming».

**Verificação**: build 0 · smoke **130 PASS / 0 FAIL** · audit **no normative violations** (small targets 2, as excepções conhecidas). Deploy `main.js 7fb96b3e8e0d2bb923b1a3d65517854a` · `styles.css 4f7e69155ef22cab1fd1886a65789972`.

## 2.48 «Setup» → «Strategy» em toda a UI + campo morto removido (17 Set)

O maintainer decidiu que, para o modelo dele, **nome = estratégia** (tem só duas: *Reversal* e *Continuation*). Não há hierarquia «strategy contém setups». O rótulo era «Setup» na trade e «Strategies» na página — passou tudo a falar a mesma língua.

- **Rótulos trocados para «Strategy»**: detalhe da trade (título do cartão, label + placeholder + tooltip do selector, prompt `Name your strategy`, item `＋ New strategy…`), modal da trade, painel de adicionar trade, tabela do Trade Log (coluna), tabela da conta, chips de filtro (`Strategy: …`, `No strategy`), painel de filtros («Strategies»), placeholders de pesquisa (Trade Log e sidebar), checklist do review (`reviewStatus` label), painel da sidebar, diagnóstico (cabeçalho do report), e a página Strategies (intro, «Your strategies», `＋ Add strategy`, notices, confirms).
- **A chave no frontmatter continua `setup`.** Zero migração, zero quebra de notas antigas nem de queries Dataview. É só o rótulo visível que mudou.
- **Campo morto removido.** O detalhe da trade tinha um textarea «Setup Notes» ligado à **mesma chave `setup`** do selector — escrever uma nota lá apagava o nome da estratégia. Não existe no preview v4 aprovado (o painel Review tem só Rating, Thesis, Post-Trade Review, Mistakes). Removido, e a união de tipos do helper `field()` passou a `"thesis" | "review" | "mistake"`. Regra da casa: quando um widget é substituído, o estilo/painel antigo vai com ele.
- **Comentários internos** (`setupOptions`, `setupFilters`, `knownSetups`, `rowSetups`, `SETUPS_VIEW_TYPE`) mantêm o nome — são identificadores, não texto de UI.

**Harness.** `smoke.js` passou a exigir «Name the strategies you trade» em vez de «Name the setups you trade».

**Verificação**: build 0 · smoke **130 PASS / 0 FAIL** · audit **no normative violations** (small targets 2, as excepções conhecidas).

---

## Annex — UX debt ledger (all items **paid**)

Historical record, moved here from `UX-GUIDELINES.md` §9. Kept because the numbers
are the proof the rules were applied.

| # | Item | Rule | Status |
|---|---|---|---|
| D1 | `--text-faint` (3.30:1) used for micro-labels, 142 usages | UX §2.1 | **paid** — `--tj-fg-3`, 5.12:1 |
| D2 | 394 px font sizes across 25 distinct values | UX §1.1 | **paid** — all on scale tokens; 0 literals |
| D3 | 95 `em`/`rem` font sizes | UX §1.6 | **paid** — every one mapped by role |
| D4 | 50 declarations on off-scale weights (500/650/800) | UX §1.2 | **paid** — 500→600, 650/800→700 |
| D5 | Reorder in Manage → Types was drag-only | UX §5 (SC 2.5.7) | **paid** — ↑/↓ steps on every row, 24×24 |
| D6 | 16 controls painted under 24px | UX §5 (SC 2.5.8) | **paid** — see UX §5.1 |
| D7 | Wrapping text below its line-height floor | UX §1.4 | **paid** — 4 fixed |
