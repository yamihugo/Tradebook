---
title: QA Checklist & Fix Log
project: Tradebook
type: qa
status: living
updated: 2026-09-19
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
- [x] **Drawdown = o número da firm** (`ddToLimit` = pico da balance − balance, já com payouts): a caixa mostra `$X used · limit · remaining` (`balance − floor`), badge por % do limite, e o sub nomeia o tipo (`drawdownLabel`: Static floor · Intraday trailing · EOD trailing, com lock). Saíram `DD from peak` e os três locais mortos `floor`/`buffer`/`ddToLimit` do `render()`.
- [x] **Time in drawdown** (`pctTimeInDD`) juntou-se ao resumo da caixa.
- [x] Saíram da coluna Performance **Winning trades** (o donut de win rate já o diz) e **Revenge trades** (fica só no verso); entraram **Biggest win** / **Biggest loss**; `Trades ≥ 1R` → **Reached 1R**.
- [x] **Renomes:** `Risk room` → **Max-loss buffer**, `Worst day / limit` → **Worst day vs limit**.
- [x] A strip de distribuições (**Hold zones · Order type · Rating**) foi **removida** a pedido do trader — esticava a frente e ficava desproporcional face ao verso; Hold zones e Order type vão para o futuro módulo de estratégias/playbooks (linha no ROADMAP) e o rating fica só no verso.
- [x] **Uma barra, uma mensagem:** o `Risk↔Target` mantém-se e ganha o tick tracejado `.tj-acc-marker-dd` no floor do trailing dd; a caixa *Drawdown used* perde a segunda barra (fica número, tipo e tempo em DD).
- [x] **Gauge `Mistakes` → `Clean trades`** (aro cheio = bom); **Discipline score** passa a incluir `Strategy tagged` (pesos 0.25/0.2/0.15/0.15/0.15/0.1) e diz **model** na tooltip; cores dos gauges por tokens `--tj-tone-good/mid/bad`.
- [x] **Verso:** saiu a linha **Reviewed** duplicada (fica só o gauge) e **Hold W / L** (analysis adiada com as Hold zones).
- [x] `flipBtn` deixa o `aria-label` (regra da casa): ícone `arrow-left-right` + `<span class="tj-sr-only">Flip card</span>` + `attachTip`; `.tj-acc-flipbtn` ganha `padding: 0` e `svg` a 15px (o glifo desaparecia por baixo do padding nativo do Obsidian).
- [x] **Revenge** endurecido: reentrada ≤15 min **no mesmo símbolo**, ou uma trade marcada como `mistake` logo após uma perda (conta mesmo fora da janela).
- [x] **Winning days** (só eval/funded): nova linha **Passing days** / **Payout winning days** = `X of Y days` (Y = `minDays`, X = `M.winDays` = dias que fecharam positivos). É um **modelo** e o sub di-lo — algumas firms pedem um mínimo por dia que o journal não impõe (§0).

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
- [x] Infra: `assets/firm-logos/<firmId>.png` **embedded as data URIs in `main.js`** (esbuild `dataurl`) — ships with BRAT/store installs
- [x] `plugin.firmLogoUrl()` devolve o data URI do bundle (sem ficheiros em runtime)
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

# Deploy (main.js + styles.css + manifest.json — NUNCA data.json)
# Firm logos estão embutidos em main.js; não há pasta assets/ para copiar.
PLUGIN="<vault>/.obsidian/plugins/tradebook"
cp main.js styles.css manifest.json "$PLUGIN/"
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
- **Ledger** (`src/lib/tradeTable.ts`): badge `.tj-tbl-fills` (desde §2.70 é a própria quantidade com chevron — «6 ⌄») na coluna Qty quando a posição tem mais de um fill; clique expande as execuções em sub-linhas (hora, buy/sell, qty, preço, hold da entrada, R do fill, P&L do fill, etiqueta `T1`/`T2`) sem alterar a linha da trade, que continua a mostrar a média. Posição aberta mostra `2/4` com tip («a parte aberta só conta quando fechar») e o P&L leva `*`.
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

## 2.49 Custos que sobrevivem, órfãos que se colam, delete duro, arquivo fora (18 Set)

Batch A–F aprovado pelo maintainer, todo num só build/deploy.

- **A — Fees $0,00 provado.** `storage.ts` nunca escrevia `commission`/`fees` ao nível da trade (só em cada perna de fill), por isso os custos da Cash History viviam só em memória e desapareciam no primeiro reload. Passam a ser escritos no frontmatter (só quando finitos) e lidos no parser (`parseFloat(...) || 0`). Sem migração: re-importar.
- **B — $6,65 de custo órfão.** A Cash History cobra por execução, o Orders agrega numa ordem; três lados MESU6 ficavam sem fill. Regra nova: a linha de custo **cola-se** ao trade quando é óbvio (mesmo contrato e stamp dentro de entry→exit ±2 min, um único candidato); o que sobra vira **custo datado da conta** (`FeeAdjustment.kind:"cost"`), oculto do modal *Correct fees* mas no saldo. O review de import mostra *platform · glued · in account* e compara o saldo do journal com o `Amount` final da própria Cash History (✓ dentro de $0,01, ⚠ fora). Recomendação do ficheiro mantém-se Orders.
- **C — Delete duro.** `purgeAccountData` remove registos (payouts, depósitos, correções/custos), mapeamentos, laços de copy (grupos liderados, seguidores, `copyBaseId` alheio) **e envia as notas de trade para o lixo do Obsidian** (`vault.trash`). A 1.ª confirmação lista exactamente o que morre (N notas, payouts, depósitos, correções, laços) com aviso vermelho de que as notas saem da vault; a 2.ª é final. O upgrade eval→funded usa o mesmo purge quando se apaga o eval.
- **D — Arquivadas fora de tudo.** `activeAccounts()` (só `propAccounts`) e `isArchivedTrade()` centralizam a regra; Home e carteira excluem arquivadas das métricas, do saldo e dos totais. Os trades mantêm-se listados e acessíveis no Trade Log e Strategies; desarquivar restaura.
- **E — Ordem do header da conta.** payout (carteira) → Correct fees (recibo) → Account settings (roda), o gear no canto direito.
- **Limpeza morta.** `ImportCosts` perdeu `matched`/`unmatched`/`paired`/`deposits` (nenhum era lido); `CashCosts` perdeu `paired`/`deposits`; removida a regra CSS `.tj-import-costs-warn`. Novas: `.tj-import-balance`(+`.is-ok`/`.is-warn`) e `.tj-delete-list`/`.tj-delete-fact`.

**Prova (ficheiros reais `/home/hugo/Downloads/Orders.csv` + `Cash History.csv`, Europe/Lisbon→America/New_York):** 22 trades · charged 270,34 · recorded 270,34 · orphans 0 · finalBalance 49263,66 · commission 112,92 + fees 157,42 · net −736,34 = 50000 − 736,34 → saldo bate com a plataforma ao cêntimo (a colagem recuperou os $6,65).

**Verificação**: build 0 · smoke **142 PASS / 0 FAIL** · audit **0** violações novas (dívida conhecida: 3 px off-scale + 5 small targets). Deploy `main.js 7c88df6806db210bd4a2040bd673e910` · `styles.css e0acea85740ee848fffa693b85bc25fd` · `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec` (md5 iguais nos dois lados; `data.json` intacto).

---

## 2.50 Guard de conta no import, import honesto, foco e fees proporcionais (18 Set)

Pedido do maintainer, aprovado; todo num só build/deploy.

- **Guard de conta no import.** `activeTargets()` = nomes da CSV mapeados para conta **ou** contas marcadas em *also record these trades in*. O CTA `Import N trades` fica `disabled` (opacidade 0.45, `cursor:not-allowed`) enquanto não houver alvo, com a linha `.tj-import-helper` "Select at least one target account to proceed."; `commit()` tem a guarda dura e recusa com `Notice` se não houver alvo. Trades sem conta **não são escritos**; o review diz "N trades left out — no account selected". Ticks e mapeamento reavaliam o botão sem repaint.
- **Import honesto (falso-sucesso intermitente).** O recibo usava `trades.length` (pedido), não o gravado. Agora `storeTrades` corre, o importador **relê a vault** (`loadTradesExpanded`) e confirma cada nota esperada (chave por `fillId` ou `account|date|symbol|direction|entryTime`); se 0 notas ou alguma não confirmada → `Notice` "Nothing was written … could not be confirmed on disk" + botão `Retry`, nunca "Done". O recibo passa a usar a contagem confirmada.
- **Foco do saldo no Correct fees.** O campo "What I have" foca ao abrir (uma vez) e a qualquer clique na linha `.tj-mg-rowval`; `:focus` muda a hairline para `--interactive-accent` e o hover mantém `--text-muted`. O erro de validação volta a focar depois do `render()`.
- **Janela automática.** `from` = dia a seguir ao `period.to` da última correção (ou `createdAt`/primeiro trade); `to` = último dia com trade da conta (editável). `windowTrades()` casa por **id** (`mappedAccount`), não por nome, e exclui o que já leva fatia via `allocatedKeysFor`.
- **Motor proporcional.** `allocateEqually` → `allocateProportional` (peso = `quantity`, cêntimos inteiros, maior-resto com desempate pelo índice, soma exata em totais negativos incluídos). O Post-Trade Review mostra "Fees corrected" com etiqueta de **model** ao lado das Fees reais (`feeForTrade`/`allocatedKeysFor`); **nenhuma nota é reescrita** — real e alocado nunca se somam às escondidas. `allocateEqually` foi removido (sem código morto).
- **CSS.** Nova `.tj-import-helper`; `:disabled` dos `tj-actionbtn` passa a `cursor:not-allowed`.

**Prova do motor (`node`):** 5,95 sobre 30:1 → **5,76 + 0,19** (bate com o valor real reportado pelo maintainer); totais negativos e frações somam ao cêntimo (595/595, −1337/−1337, 10001/10001, −3/−3, 1234/1234).

**Verificação**: build 0 · smoke **142 PASS / 0 FAIL** · audit **0** violações novas (dívida conhecida: 3 px off-scale + 5 small targets). Deploy `main.js 6720806e5e70dc21c13cb057e670d78e` · `styles.css 174a181dfa3b400c6bd56e41370694a4` · `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec` (md5 iguais nos dois lados; `data.json` intacto).

---

## 2.51 Follow-up do Correct fees: foco fiável, helper, chave única e fees por trade (18 Set)

Segunda passagem sobre o Correct fees, aprovada pelo maintainer (decisões: fees por trade mostradas como real+alocado com split, sem reescrever notas; janela+fatias automáticas com saldo manual; chave endurecida com aviso de órfãs).

- **Foco fiável do saldo.** O handler passa a estar no `.tj-mg-row` inteiro (label + valor) em `mousedown` com `preventDefault` (exceto no próprio input, para o caret ir onde foi apontado). O `render()` lê `activeElement` antes de `empty()` e volta a focar o input se ele tinha o cursor — sobrevive ao 2.º render assíncrono (`loadTradesExpanded`). A flag `focused` foi removida. `:focus` ganha fundo `color-mix(--interactive-accent 8%)` além da hairline accent.
- **Helper do "Spread over".** Tooltip no label + linha `.tj-fees-windowhint` sob o par de datas: "The difference is split across the trades in this window, in proportion to size — ten contracts take ten times one. Trades already corrected are skipped."
- **Chave das fatias endurecida.** `tradeFeeKeys(t)` devolve todas as chaves do trade — `id:<fillId>` (plataforma), `k:<caminho da nota>` (único para trades manuais) e a chave composta antiga como *fallback*. `tradeFeeKey` = a primeira. `feeForTrade` e o `pending` do modal casam por **qualquer** variante, por isso fatias gravadas antes desta mudança continuam a encontrar o seu trade (sem dupla contagem nem migração).
- **Aviso de fatias órfãs.** Se uma chave guardada não corresponde a nenhum trade da conta (ex.: notas re-importadas com novos ids), o modal mostra `.tj-fees-orphan` — "N saved slice(s) no longer match a trade … They still count towards the balance; remove the correction to clear them." — em vez de esconder o desvio.
- **Fees por trade no Post-Trade Review.** A linha "Fees" (`tradeDetailView.ts`) passa a mostrar `$total · $X corrected` quando o trade leva fatia, com tooltip que separa o número da plataforma do *model*; a edição continua a mexer só nas fees reais. A antiga linha separada "Fees corrected" foi fundida (sem duplicação de linhas).

**Prova do motor (`node`):** `tradeFeeKeys` de dois trades com a mesma data/símbolo/direção/hora dá chaves primárias **distintas** (caminho da nota); alocação 3:1 de 5,95 → **4,46 + 1,49** (595¢ exatos); uma fatia com a chave composta antiga continua a casar com os dois trades (compatibilidade).

**Verificação**: build 0 · smoke **142 PASS / 0 FAIL** · audit **0** violações novas (dívida: 3 px off-scale + 5 small targets). Deploy `main.js 485b22940fd15f31fee31017140f286e` · `styles.css 2c020c99540d3f50f1530cb1dff94d68` · `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec` (md5 iguais nos dois lados; `data.json` intacto).

---

## 2.52 Contas dirigidas pelo utilizador: wizard, resolvedor e Management (18 Set)

Refactor aprovado pelo maintainer: o wizard deixa de ser guiado por presets de firm e passa a ser escrito pelo trader (modelo Journalit-style); o preset é só um atalho opcional.

- **Wizard em 4 passos.** Type · Identity · Rules · Review. Personal/demo saltam Rules (`.tj-wz-step.off`). As regras são target/max loss (**$ ou %** via `.tj-wz-amount`/`.tj-wz-unit`), daily loss, tipo de drawdown (EOD/intraday/never-locks/static), posição e dias mínimos. Passo 2 tem um só campo de saldo inicial (= `size`, sem o bug "$50K mostra $100K") e a grelha de logos.
- **Grelha de logos.** `FIRM_CATALOG` (prop firms: Topstep, Tradeify, Apex, Take Profit Trader, MyFundedFutures, Alpha Capital Group, Lucid Trading; brokers: Tradovate, NinjaTrader, Interactive Brokers, AMP Futures) + `Own` em símbolo CSS + tile "Custom" com iniciais. PNGs embutidos como data URIs (`lib/firmLogos.ts`); id sem ficheiro mostra iniciais — nenhum ecrã rebenta. Faltam por colar 8 PNGs em `assets/firm-logos/`.
- **Resolvedor único.** `lib/accountRules.ts` (`resolveAccountView`/`mergeRules`): overrides do utilizador por cima do preset opcional; `target/maxLoss/dailyLoss/consistency` leem 0 quando não há regra. Home, lista de contas, dashboard da conta e Settings deixam de importar presets diretamente — e o antigo hard-fail "Unknown firm/program — please re-create this account" desapareceu.
- **"Quick add" removido** das Settings; o botão "Open wizard" é a única porta de criação.
- **Management.** Banners de topo → tooltip `(i)` (`.tj-manage-secthead`/`-infoico`); empty state de Copy groups com diagrama de nós `.tj-mg-nodes` (`aria-hidden`); badges `LEADER`/`COPIER` (o 👑 emoji saiu); filas de Types em pill (`.tj-mg-typerow`); "+ Create Copy Group" no empty state. A nota de contrato "Linking never rewrites trades already recorded." ficou.
- **CSS.** Novas classes só com tokens `--tj-*`; removidas `.tj-wz-firmlogo` e `.tj-mg-crown` (mortas); `.tj-as-avatar-img` normalizado para `object-fit: contain`. `tools/ux-audit.mjs` ganhou `.tj-mg-node-dot` na lista de indicadores (com razão escrita) — é decoração dentro de `aria-hidden`, não um alvo.
- **Compatibilidade com o harness.** `plugin.propFirms` e `plugin.buildAccount(firm, program, size)` continuam a existir; `PROP_FIRMS` mantém-se como biblioteca-semente para contas antigas e fixtures.

**Verificação**: build 0 · smoke **142 PASS / 0 FAIL** · audit **0** violações novas (dívida conhecida: 3 px off-scale + 5 small targets). Deploy `main.js 79d5e4c732c98c377812442e3911fe42` · `styles.css 7b9841391de3bdf9a5216e656bfb4240` · `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec` (md5 iguais nos dois lados; `data.json` intacto).

---

## 2.53 Polimento do wizard de conta (18 Set)

Segunda passagem de UI/UX sobre o wizard, pedida pelo maintainer (ícones, nome ligado, afixos, grelha de marcas, tabela de review).

- **Passo 1 — Type.** Emojis substituídos por ícones Lucide via `setIcon` (eval `target`, funded `dollar-sign`, live `shield-check`, personal `wallet`, demo `flask-conical`). O cartão ativo fica com `border-color: var(--interactive-accent)` + `box-shadow` de glow discreto; hover suave com transição; ícone do cartão ativo em accent.
- **Passo 2 — Identity.** O **nome fica ligado** ao saldo inicial + marca enquanto o utilizador não escrever nele (`nameTouched`); escrever liberta-o, apagar volta a ligar; "Create & add another" repõe `nameTouched = false`. A grelha de marcas passa a 3 secções — **Prop firms · Brokers · Practice** (id `own` mantém-se; `FirmLogoEntry.group` ganhou `practice`) — com pills de **altura fixa 40px**, `box-sizing: border-box` e rótulo com ellipsis (nada parte a fila). O tile "Custom" com iniciais continua.
- **Passo 3 — Rules.** Grelha estrita de **2 colunas** (`.tj-wz-rulegrid`, campos `.tj-wz-wide` ocupam a linha toda). `$`/`%`/`days` passam a **afixos estáticos** dentro do campo (`.tj-wz-affix-pre`/`-affix-suf`); o `<select>` antigo (`.tj-wz-amount`/`.tj-wz-unit`) foi removido e substituído por um toggle inline `$ | %` (`.tj-wz-unbtn`, 24×24, estados `aria-pressed`, fundo `color-mix` em accent no ativo). `numberField` foi apagado (ficou sem uso).
- **Passo 4 — Review.** Linhas como **tabela chave-valor**: `.tj-wz-sumrow` com padding e hairline inferior (última sem), rótulo muted, valor à direita a **700** tabular-nums. O stepper de lote mantém-se proeminente. O aviso de rodapé ganhou ícone Lucide `alert-triangle` (`.tj-wz-disclaimer-ico`).

**Verificação**: `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `node tools/ux-audit.mjs` **0** violações novas (dívida conhecida: 3 px off-scale + 5 small targets — os novos `.tj-wz-unbtn` são 24×24 e passam). Deploy `main.js 9259c1f7bad2e60358247f589d7a9a84` · `styles.css 9d3b4c55bd89d8033a46df70386b8fd1` · `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec` (md5 iguais nos dois lados; `data.json` intacto).

---

## 2.54 Wizard, passo 2/3 — layout e presets genéricos (18 Set)

Terceira passagem, pedida pelo maintainer: juntar nome e saldo numa linha, endurecer o dropdown e simplificar os presets.

- **Passo 2 — linha de 2 colunas.** Nome + saldo passam a viver em `.tj-wz-row-2` (`grid-template-columns: 1fr 1fr`, gap 16), com `@media (max-width: 560px)` a empilhar. O campo do nome deixou de ser `.tj-wz-wide`; o modal deixa de crescer à medida que a grelha de marcas cresce.
- **Passo 3 — dropdown de drawdown.** O componente já era o `.tj-dd` da casa (nunca um `<select>`), mas dentro do modal o Obsidian pintava os seus próprios botões por cima de uma classe solta e parecia nativo. Foi endurecido com um bloco `.tj-account-wizard .tj-dd-btn` / `-chev` / `-list` / `-item` / `-item.on` / `-check` a `!important` (fundo `--background-secondary`, radius, sombra, ativo em accent 12%). Comentário no CSS a explicar o porquê.
- **Passo 3 — contraste do toggle.** `.tj-wz-untoggle` ganhou track (padding, radius 8, hairline, `rgba(255,255,255,.04)`); a cor inativa do `.tj-wz-unbtn` subiu `--tj-fg-3` → `--tj-fg-2` e o ativo ficou accent 20% + inset ring; alvos continuam ≥24×24.
- **Passo 3 — presets genéricos.** `presetFor`/`applyPreset` (que puxavam tiers de firm com `getFirm/getProgram/getSize`) foram substituídos por `STANDARD_PRESETS` — cinco tamanhos de mercado: **Standard · $25K / $50K / $100K / $150K / $300K** — cada um preenchendo **target/max loss/daily loss** a 6%/4%/2% (1500/1000/500 · 3000/2000/1000 · 6000/4000/2000 · 9000/6000/3000 · 18000/12000/6000) e limpando `targetPct`/`maxLossPct`. O preset **não toca no saldo** — só nas regras. O import de `../props` ficou reduzido a `uniqueAccountName`. O disclaimer de que as regras das firms mudam continua sempre visível.
- **CSS morto removido** (0 referências em `src/`): família `.tj-wz-chip*`/`.tj-wz-chips`, `.tj-wz-cols`/`.tj-wz-col`(+ `@media 620px`), `.tj-wz-dd-slot`, `.tj-wz-static` (scoped + bare), `.tj-wz-rules`/`.tj-wz-rule*`/`.tj-wz-editrules`, `.tj-wz-chip-wide`. Mantidos `.tj-wz-rulegrid`, `.tj-wz-preset`, `.tj-wz-disclaimer`.

**Verificação**: `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `node tools/ux-audit.mjs` **0** violações novas (dívida conhecida: 3 px off-scale + 5 small targets). Deploy `main.js a55538c8f3da650985708823cba1561a` · `styles.css 785fdb485e96c794bfee115dfc630218` · `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec` (md5 iguais nos dois lados; `data.json` intacto).

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

## 2.55 Import CSV: conta de destino, tick como base e tipo lido pelo header (18 Set)

**Sintoma.** Depois de apagar todas as contas e criar uma de raiz, um Orders/Cash History
importava "0 trades" — o botão `Import N trades` acendia mas nada aterrava na conta nova.

**Causa.** `guessMapping()` só mapeava um nome da CSV quando `mappedAccount(name)` já
devolvia conta; com uma conta nova (nome escolhido pelo trader ≠ id do broker) o mapping
ficava `""`. O guard (`activeTargets()`) contava mapeamentos **e** ticks, mas o `commit()`
construía `assigned` **só** do mapping — UI dizia pronto, o commit recusava em silêncio.

**Correção.**
- Cadeia de fallback por nome: conta que responde → **a única conta do journal** →
  `lastImportAccountId` → `lastCreatedAccountId` → "Leave unassigned". O wizard grava
  `lastCreatedAccountId`; o dropdown do importador grava `lastImportAccountId`.
- **Opção (a):** um único tick em *Also record these trades in* é a conta-base quando não
  há mapping (`tickBaseId()`), importado directamente e retirado do broadcast de pernas
  (não escreve a mesma trade duas vezes). Dois ticks continuam guard.
- `csvKind()` lê o tipo pelo header (`cash`/`orders`/`fills`/`unknown`); um ficheiro que
  não é Orders/Fills mostra mensagem explícita em vez de silêncio.

**Prova (ficheiros reais, `~/Downloads/Orders.csv` + `Cash History.csv`, Europe/Lisbon→America/New_York).**
`csvKind` → `orders`/`cash`/`unknown`; 22 trades; `accountsSeen` = `TDFYG50738567169`;
com uma só conta `Topstep · $50K` o mapping atribui os 22 trades a essa conta; caminho
tick-only atribui 22; broadcast exclui a conta-base. Custos: recorded = charged = 270,34,
orphans 0, finalBalance 49263,66.

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas
(dívida conhecida: 3 px + 5 alvos). Deploy: `main.js 683d967413b41e0f0f741cafac2eadf1`,
`styles.css 785fdb485e96c794bfee115dfc630218`, `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`;
`data.json` intacto.

## 2.56 Wizard, passos 2/3 — marca separada da conta e preset reativo (18 Set)

**Mudança.** O passo 2 (agora **Brand**) fica só com a grelha de marcas; nome e saldo descem
para o passo 3 (agora **Account**), que abre com o preset `Standard · $50K` no topo, seguido
do par Nome + Saldo inicial em 2 colunas e das regras. `STEPS = ["Type","Brand","Account","Review"]`
e `flow()` = `[0,1,2,3]` para todos — personal/demo param depois da identidade (sem preset,
sem regras). `renderIdentity`/`renderRules` deram lugar a `renderBrand`/`renderAccount`.

**Reativo.** `applyStandardPreset(id)` passa a gravar `values.size` e `values.startingBalance`,
carimba `rules.target/maxLoss/dailyLoss` (limpa os `*Pct`) e — enquanto `nameTouched` for falso
— o nome segue `baseName()` (`Tradeify · $50K`). Inverte a decisão anterior "o preset nunca toca
no saldo".

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas
(dívida conhecida: 3 px + 5 alvos). Deploy: `main.js 5dc12ce8f0dc112f6d201b4094517f65`,
`styles.css 785fdb485e96c794bfee115dfc630218`, `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`;
`data.json` intacto.

## 2.57 Wizard, passo 3: tamanho por dropdown, Custom e Started on obrigatório (19 Set)

**Contexto.** Depois de recriar a conta, as 22 notas importadas não apareciam: estavam no vault,
mas o filtro `t.date < acc.createdAt` (`accountDashboard.ts:100`, `accountsListView.ts:141`,
`main.ts:1862`) descartava-as porque a conta nasceu com `createdAt` de hoje e as trades são de
19-08 a 14-09. A solução acordada é a data de início ser **dita pelo trader** no wizard.

**Mudanças.**
- Sai o campo manual *Initial balance*; o tamanho escolhe-se só pelo dropdown
  (`$25K · $50K · $100K · $150K · $300K · Custom…`), sem a palavra "Standard".
- **Custom…** revela um campo `$`; escrever actualiza `values.size`, as regras (6%/4%/2%) e o
  nome da conta (`Tradeify · $37K`) enquanto `!nameTouched`. O botão do dropdown passa a ler
  `Custom · $37K`.
- **Started on** (`mountDateField`, `data-tour="wizard-started"`) é obrigatório: `updateNext()`
  desactiva o `Next` enquanto `values.size <= 0` ou `values.createdAt` vazio, com o helper
  "Choose a size and a start date to continue.". Novo CSS
  `.tj-account-wizard .tj-wz-foot .tj-btn:disabled { opacity:.45; cursor:not-allowed; }`.
- `STANDARD_PRESETS`/`applyStandardPreset` removidos (e `.tj-wz-preset` do CSS, morto);
  `Values.startingBalance` removido — `build()` grava `size: values.size`.
- `dropdown()` ganhou um `placeholder?`; o passo 3 usa "Choose a size".

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas (dívida
conhecida: 3 px + 5 alvos). Deploy: `main.js 20a2ffa6c3958d7e337e9d517526d96e`,
`styles.css 861d0bb4e63d42123f1d97d32c878cd9`, `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`;
`data.json` intacto.

**Nota para o utilizador.** Para a conta já criada, pôr **Account settings → Started on =
2026-08-19** faz as 22 notas aparecerem sem re-importar (ou apagar e recriar com essa data).

---

## 2.58 Wizard, passo 3: tamanho e data vazios e obrigatórios (19 Set)

**Pedido.** O `Account size` também deve nascer **vazio** e ser obrigatório (como a data), para
que o trader declare sempre os dois — e o nome deve mostrar só a marca enquanto não há tamanho.

**Mudanças.**
- `Values.size` default = `0` e `Values.createdAt` default = `""` (antes 50000 e hoje). O passo 3
  abre sem selecção: dropdown com "Choose a size" e date field vazio.
- `sizeDropdownValue()` devolve `""` quando `size <= 0`. As regras só se enchem (6%/4%/2%) quando
  o tamanho é escolhido (`applySize`/`applySizeRules`), inclusive ao trocar de tipo já com tamanho.
- `baseName()` mostra só a marca sem tamanho (`Tradeify`) e `Tradeify · $50K` depois.
- `updateNext()` exige **`size > 0` E `createdAt`**; o helper `.tj-wz-secthint` diz só o que falta:
  "Choose a size and a start date to continue." · "Choose a size to continue." · "Choose a start
  date to continue.".
- "Create & add another" volta a limpar tamanho, data, regras e `customSize`.
- Sem CSS novo.

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas (dívida
conhecida: 3 px + 5 alvos). Deploy: `main.js 79c3ea7a71aa667909844b2c083fcfc7`,
`styles.css 861d0bb4e63d42123f1d97d32c878cd9` (inalterado), `manifest.json
4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` intacto.

---

## 2.59 Nome com tipo de conta + calendário próprio (19 Set)

**Pedido.** O nome deve incluir o tipo (`Tradeify Eval $50K`, sem ponto médio, com cifrão;
marca + tipo + tamanho também em Personal/Demo). O calendário nativo do sistema "está muito
feio" — passa a ser o da casa.

**Mudanças.**
- `accountWizard.ts`: `baseName()` = `${firmLabel(logoId)} ${typeLabel(type)} $<K>K` (usa as
  labels configuráveis); sem tamanho mostra `Tradeify Eval`; continua ligado ao tamanho/marca até
  o trader escrever (`nameTouched`). Import de `typeLabel` de `lib/accountTypes`.
- Novo `src/lib/calendar.ts`: `openCalendar(anchor, {value, onPick})` / `closeCalendar()`.
  Cabeçalho com ‹ › e "Today", grelha do mês à segunda (42 células), estados `is-out`/`is-today`/
  `is-sel`, popup `fixed` `z-index:1100` preso por `getBoundingClientRect`, fecha com clique fora
  / Escape / scroll, teclado setas ±1/±7, PageUp/PageDown, Enter; `stopPropagation` no Escape
  para não fechar o modal por baixo.
- `lib/dates.ts`: `mountDateField` deixa de usar `input[type=date]`/`showPicker` e abre o
  calendário; a API mantém-se (23 sítios inalterados). Escrever à mão continua; Enter confirma,
  ArrowDown abre.
- `styles.css`: novas `.tj-cal*` (só tokens `--tj-*`; dias 30px, nav 28px, Today 26px — todos
  ≥24). Removida a regra morta `.tj-datefield-native`.

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas (dívida
conhecida: 3 px + 5 alvos). Deploy: `main.js fd6e714681b9fc22df34f6616ed8cf2b`,
`styles.css e48052790f67ea28703ff17a20a6eabe`, `manifest.json
4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` intacto.

---

## 2.60 Management: presets de cartão, cor de grupo e tipos (19 Set)

**Pedido.** Auditoria UX/UI ao modal Management (4 separadores) e overhaul: Cards mais simples,
cor do grupo com consequência, tipos no sítio certo, contraste do bloco corrigido.

**Mudanças.**
- `lib/cardSlots.ts`: `barsFor`/`miniFor` saem; entram `CARD_PRESETS` (`firm`/`results`/`consistency`),
  `CardLayout` e `presetFor(type, savedId)` — `firm` = `DEFAULT_BARS`/`DEFAULT_MINI` do tipo;
  `results` = barras `greenDays`/`ddFromPeak` + mini `trades`/`win`/`profitFactor`/`avgR`;
  `consistency` = barras `dailyRoom`/`drawdown` + mini `trades`/`win`/`expectancy`/`hold`.
- `main.ts` + settings: `accountCardBars`/`accountCardMini` → **`accountCardPreset: Record<tipo,id>`**
  (sem migração; o default é `firm`).
- `accountsManage.ts`: `renderCards` passa a **3 pills** (`.tj-mg-preset`, `.on` + `aria-pressed`,
  `attachTip` com o hint) + hint activo (`.tj-mg-cardpick-hint`) e Reset "to the firm layout";
  o antigo `group()` de 9 dropdowns e `.tj-mg-cardline` desaparecem. `renderTypes` ganha a pill
  de visibilidade (`.tj-mg-vis`, `eye`/`eye-off`) e o **Display** perde a secção "Account types
  shown". `renderMember` deixa o `title` nativo e passa a `attachTip`; os copiers ficam numa
  `.tj-mg-tree` com conectores.
- `accountsListView.ts`: tiles e preview lêem `presetFor(...)`; a secção de copy e as tags
  Leader/Copier usam `copyGroupColor` (`groupTint()`) — a cor do grupo deixa de ser um dado morto;
  a tag Leader perde o emoji.
- `styles.css`: `--text-muted` → `--tj-fg-2`/`--tj-fg-3` no bloco Management; novos `.tj-mg-tree`,
  `.tj-mg-presets`/`-preset`(+`.on`), `-cardpick-hint`, `-vis`; removidas `.tj-mg-cardline*` e
  `.tj-mg-mrow{margin-left:2px}`.
- Harness: `manage-check.js` (Cards → 3 `.tj-mg-preset`, preview muda, `accountCardPreset` gravado)
  e `payouts-check.js` (data-safety passa a comparar `accountCardPreset`).

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas violações
(3 px fora de escala + 5 alvos pequenos — dívida conhecida); `.tj-mg-vis` (28px) e `.tj-mg-preset`
passam os 24×24. Deploy: `main.js f752287254c5e33fe17264fe92f4b93f`,
`styles.css 8041f0c14a1b134e278536791087bce9`, `manifest.json
4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` intacto (`de86d7e748a4086a1c4ca6b32c0baedd`).

---

## 2.61 Cards só por preset + empty state dos copy groups (19 Set)

**Pedido.** (1) O empty state dos copy groups estava feio e fora de sítio — as bolas (`×1`/`×0.5`)
não se entendiam; o botão devia vir com a mensagem. (2) Os presets do separador Cards repetiam-se
(a *Firm layout* e a *Results* ficavam iguais na personal). Decisão do Hugo: **apagar o separador
Cards** e deixar um layout fixo por tipo, escolhido a partir do que as plataformas de prop e os
journals realmente mostram; sem edição por utilizador (os valores afinam-se depois pelo review).

**Mudanças.**
- `lib/cardSlots.ts`: `CardPresetDef`/`CARD_PRESETS`/`PRESET_BARS`/`PRESET_MINI`/`presetFor` saem;
  entra **`layoutFor(type): CardLayout`** (`{bars, mini}`) com os defaults assinados — eval
  `target·drawdown`/`toTarget·win·profitFactor·last`; funded `dailyRoom·drawdown`/`trades·win·paid
  out·last`; live `dailyRoom·drawdown`/`trades·win·**day win**·avg R`; personal/demo/unknown
  `greenDays·ddFromPeak`. Novo slot **`dayWin`** no `MINI_CATALOG` (`m.dayWinRate`).
- `main.ts`: `accountCardPreset` sai da interface de settings e dos `DEFAULT_SETTINGS`.
- `accountsManage.ts`: 3 separadores (Copy groups · Display · Types); `renderCards` apagado;
  `CardPreviewSource`/`openAccountsManage(view)` e o `cardType` caem. Empty state dos grupos =
  título "No trading groups yet" + "Pick the account other accounts will copy, then who joins it."
  + o botão "+ Create Copy Group"; a nota `ⓘ` só aparece com grupos.
- `accountsListView.ts`: `CardSlotOverride`/`previewFor` removidos; `slotsFor`/`miniFor` leem
  `layoutFor(acc.type)`; `dayWin` acrescentado ao catálogo de minis.
- `styles.css`: blocos mortos do diagrama de nós e do separador Cards removidos; `.tj-manage-empty`
  passa a coluna com `.tj-manage-emptytitle`.
- `tools/ux-audit.mjs`: `.tj-mg-node-dot` sai da lista de isenções (já não existe).
- Harness: `manage-check.js` deixa de exigir o separador Cards e passa a verificar 3 separadores +
  uma pill de visibilidade por tipo; `payouts-check.js` deixa de comparar `accountCardPreset`.

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas violações
(3 px fora de escala + 5 alvos pequenos — dívida conhecida). Deploy: `main.js
d9846c4499d551b86b51ede635d483ba`, `styles.css 8c7703201f1761237a7f3f1906859fcd`, `manifest.json
4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` não foi tocado.

---

## 2.62 Management: compositor guiado e Types dentro do Display (19 Set)

**Pedido.** Ao criar o primeiro grupo, o Hugo clicou nos copiers a pensar que estava a escolher
o líder. O compositor passa a guiar a ordem, e o separador Types é absorvido pelo Display.

**Mudanças.**
- `accountsManage.ts`: o `renderNewGroup` passa a ser um compositor em **três passos numerados**
  (`stepHead`): **1 Leader** com cartões clicáveis (`.tj-mg-leadcard`, o escolhido com borda
  `--interactive-accent` + glow; `newLeaderId` nasce **vazio**, sem pré-selecção nem dropdown);
  **2 Copiers** bloqueado (`.tj-mg-stepblock.is-locked`, "Pick the leader first.") até haver
  líder, depois mostra o chip `.tj-mg-lockedlead` e uma linha `.tj-mg-copier` por conta (caixa
  `.tj-mg-pick` à esquerda, sub "copies <líder>"); **3 Copy from** igualmente bloqueado até haver
  líder, com a nota (`copyStartNote`) sempre visível. O botão **Create group** só liga com líder.
- `COPY_START_ITEMS` reescrito em linguagem de trader (espelha desde o início da conta / data à
  escolha / todo o histórico do líder).
- Separador **Types** absorvido pelo **Display** (`renderTypeRows`, chamado sob
  `sectionInfo(body, "Types", …)`); `tabDefs` passa a 2 (Copy groups · Display) e o `tab` union
  perde `"types"`.
- `styles.css`: novas `.tj-mg-step*`, `-stepblock(.is-locked)`, `-leadgrid`/`-leadcard`(+`.on`),
  `-lockedlead`, `-copier`(+`.on`)/`-pick`/`-copier-*`; nada do motor de copy nem `.tj-wz-leader*`
  (ainda usado pelo `accountDashboard.ts`) foi tocado.
- Harness `manage-check.js`: espera 2 separadores, o compositor com os passos Leader/Copiers/Copy
  from, a grelha de cartões e o passo bloqueado; a checagem de `.tj-mg-typerow` passa a correr
  dentro do Display.

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas violações
(3 px fora de escala + 5 alvos pequenos — dívida conhecida). Deploy: `main.js
f09c4bb214bced7b19cb2738d671c06e`, `styles.css c63cf9540524137ed9949b09f2f45c2b`, `manifest.json
4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` intacto (`97f8941703c2c9553a52103e5ec54f26`).

## 2.63 Management: portal do dropdown, estado do copy e disband (19 Set)

**Pedido.** O compositor do "New trading group" estava a ser cortado pelo painel (o menu "Copy from"
nascia dentro do scroller e ficava escondido), o `+ New trading group` não respondia quando todas as
contas estavam em grupos, o "Remove" de um copiador deixava estado órfão (config antiga a semear o
link seguinte, pick morto no "Add to group"), faltava um disband e não havia confirmação nenhuma do
que foi gravado.

- `lib/dropdown.ts`: a lista passa a **portal** — sai para `<body>` presa ao botão com `position:
  fixed`, `z-index: 1100`, flip para cima quando não há espaço abaixo, reposiciona em `scroll`/
  `resize`, fecha em clique-fora/Escape e (via `MutationObserver` no `<body>`) quando o anfitrião sai
  do DOM. A API pública não mudou, por isso os **19** `mountDropdown` passam a beneficiar.
- `lib/copy.ts`: novo **`unlinkCopier(account)`** — fecha o período e limpa `copyRole`, `copyBaseId`,
  `copyMultiplier`, `copySizing`, `copyFixedQty`, `copyRound`, `copyMinQty`;
  **guarda** `copyPeriods` e `copyConfigHistory` (é o registo do que correu; as pernas já geradas
  ficam). Usado pelo Remove, pelo Move group e pelo novo "Take out".
  *(O `copyCrossOrder` saiu daqui na §2.64, quando o campo desapareceu.)*
- `views/accountsManage.ts`: `linkedAccounts()` e `detachAccount()`; `detachAccount` larga primeiro
  os seguidores (senão o grupo sobrevivia a um líder que já não lidera); o rácio passa a escrever por
  `startCopying` (a config datada é o que o motor lê; as pernas antigas guardam o rácio delas); o pick
  morto do "Add to group" passou a `Notice("Pick an account first.")`; o reset inválido
  `addCopyFrom = "today"` voltou a `"start"`; o `+ New trading group` fica **sempre vivo** e, sem
  contas livres, o passo 1 lista as ocupadas com "Take out" de um clique; **disband** por um quadrado
  de lixo no `.tj-mg-head` com confirmação em dois toques inline; `Notice` ao criar, ligar, desligar e
  rebentar.
- `styles.css`: `.tj-mg-dd-list.is-portal`; compactação do compositor (`.tj-manage-body` 70vh,
  `.tj-manage-sub` 10px, `.tj-mg-lrow`/`-mrow`/`-add`/`-swap`/`-hint`/`-newtitle`/`-row2`/
  `-stepblock`/`-step`/`-leadcard`/`-copier`/`-lockedlead` mais apertados,
  `.tj-mg-stepblock .tj-wz-leader-list { max-height: 120px }`); `.tj-mg-del` (24×24), `.tj-mg-confirm*`
  e `.tj-mg-act.is-danger`.

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas violações
(3 px fora de escala + 5 alvos pequenos — dívida conhecida; o `.tj-mg-del` 24×24 passa). Deploy:
`main.js ade955375fcf2ec6851abb3d71585912`, `styles.css ea80c0872f03d64ccc67fee20b6cd780`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` intacto
(`ae7c3d9ce878399a92f9dea83e5eb37c`).

## 2.64 O símbolo é do motor, não do trader — cross automático (19 Set)

**Pedido.** Depois de criar o grupo, o copiador ainda mostrava o dropdown manual
**"Same symbol / Mini ↔ micro"**; tinha de sair e ficar só a lógica automática.

**Causa (o no-op provado).** O `startCopying` grava sempre uma entrada em `copyConfigHistory`, e o
`buildLeg` lê a config datada — o campo `PropAccount.copyCrossOrder` só era lido na ramificação
legacy (`effectiveCopyConfig` sem histórico), por isso mudar o toggle **nunca** tinha efeito depois
de a ligação existir; e o handler nem sequer voltava a desenhar o modal.

- `lib/copy.ts`: `buildLeg` decide o contrato por trade. `micro = MICRO_OF[símbolo]`;
  `fractional = sizing ratio && baseQty > 0 && baseQty × ratio < 1`;
  `cross = cfg.crossOrder === true && !!micro && (contractMode || fractional)`. Quando cruza,
  `symbol = micro` e `rawQty = baseQty × MINI_TO_MICRO × ratio` (exposição preservada: 1 NQ $20/pt =
  10 MNQ $2/pt); fora disso fica o símbolo do líder e `rawQty = baseQty × ratio`. `crossMode:
  "contract"` (legacy) continua a cruzar 1:1 com arredondamento.
- `lib/copy.ts`: `startCopying` e a ramificação legacy de `effectiveCopyConfig` passam a gravar
  `crossOrder: true` + `crossMode: "exposure"` (a regra fica **datada** no link: regenerar um trade
  daquele troço usa a mesma regra). `unlinkCopier` deixou de limpar `copyCrossOrder` (o campo
  desapareceu).
- `types.ts`: `PropAccount.copyCrossOrder` **removido**. `CopyConfigEntry.crossOrder`/`crossMode`
  ficam (é onde a regra vive agora).
- `views/accountsManage.ts`: o `mountDropdown` "Same symbol / Mini ↔ micro" **sai** do copiador; a
  tooltip do rácio passa a explicar a travessia automática ("Under one mini — 0.5× of 1 NQ — the copy
  is mirrored in micros instead, so the leg is never lost."). Sem CSS novo.

**Prova do motor** (`npx esbuild src/lib/copy.ts --bundle --format=cjs --alias:obsidian=<stub>`, script
em `/tmp/opencode/test-copy.js`): `1 NQ × 0.5 → MNQ ×5` (pnl 100 = metade dos 200 do líder),
`1 NQ × 1 → NQ ×1`, `1 NQ × 0.9 → MNQ ×9`, `1 NQ × 0.25 → MNQ ×2`, `2 NQ × 0.5 → NQ ×1`,
`3 NQ × 0.5 → NQ ×1`, `1 ES × 0.5 → MES ×5`, `1 CL × 0.4 → MCL ×4`, `3 MNQ × 0.5 → MNQ ×1` (sem
mapeamento, não cruza), `2 NQ × 1.5 → NQ ×3`, `1 NQ × 2 → NQ ×2`; `copySymbolMap` = `NQ → MNQ` só
quando cruza; perna gerada com `commission 0`/`fees 0`; `startCopying` grava
`crossOrder=true/crossMode=exposure`; após `unlinkCopier` o histórico e os períodos ficam. **ALL PASS.**

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas violações.
Deploy: `main.js 4a212260a2ee2704e8ee0413029dde84`, `styles.css ea80c0872f03d64ccc67fee20b6cd780`
(sem alterações), `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` não foi copiado.

## 2.65 Sem bolha nativa, ritmo uniforme (19 Set)

**Pedido.** (1) escrever decimais num campo numérico do Management (o rácio) disparava a tooltip
nativa do browser *"Please enter a valid value…"* — fora do tema escuro; (2) no Display, o título
`TYPES` e a sua lista estavam colados à secção `WHAT APPEARS`. Decisão do Hugo: aplicar a correção a
**todos** os numéricos do plugin, não só ao rácio.

**Causa.** Constraint validation do Chromium: qualquer `input[type=number]` cujo valor quebra o seu
próprio `step` é "inválido" — o rácio tinha `step="0.5"` (logo `0.3` falha) e os campos do wizard não
tinham `step`, e o default é `1` (logo `6.5` falha). A bolha é desenhada pelo browser e não aceita
estilo. No CSS, `.tj-manage-secthead` não tinha `margin-bottom` e `.tj-manage-secthead
.tj-manage-sectitle` forçava `margin-bottom: 0`, deixando **zero** intervalo entre o título e a
primeira linha.

- `lib/numeric.ts` **novo**: `freeNumeric(input)` aplica `step="any"`, remove `min`/`max` do markup,
  cancela `invalid` (`e.preventDefault()`) e põe `novalidate` no `<form>` mais próximo (se existir).
  Os limites continuam a ser impostos nos handlers que lêem o valor — o `min`/`max` nunca bloqueou
  uma tecla, só alimentava a bolha e o spinner.
- 18 sítios passam pelo helper: Manage rácio · wizard `affixField`/`amountField`/Custom size ·
  editor de regras e multiplier/amount da conta · payouts · Correct fees (`haveInput`) · os 6 do Add
  Trade · a factory `editableRow` do Trade Detail (cobre pnl, qty, preços, fees) · o editor de regras
  das Settings. Os `attr: { min, step }` saíram do markup.
- `tradeDetailView.ts`: os campos mortos das opts de `editableRow` (`suffix`/`min`/`max`/`step`)
  saíram (só `numeric` e `tip`); o call site da Quantity passou a `{ numeric: true }`.
- CSS: `.tj-manage-sect` `22px` → `var(--tj-sp-5)` (24); `.tj-manage-secthead` ganha
  `margin-bottom: var(--tj-sp-2)` (8) — o intervalo título→conteúdo passa a ser sempre o mesmo;
  base `.tj-manage-sectitle` perde o `margin-bottom: 6px` e o tracking desce `.13em` → `.12em`
  (banda 0.06–0.12em do UX-GUIDELINES §1.5); `.tj-manage-note, .tj-manage-empty` e `.tj-mg-card`
  fecham com `var(--tj-sp-4)` (16).
- Código morto: `private section()` em `accountsManage.ts` removido (0 usos; só `sectionInfo` é usado).

**Nota honesta.** `step="any"` esconde as setinhas do spinner nos `input[type=number]` do Chromium;
fora isso nada muda (os limites já eram impostos nos handlers).

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas violações
(dívida de base inalterada: 3 px fora de escala + 5 alvos pequenos).
Deploy: `main.js b3f76e352ce891f87b4c05c0488a3596`, `styles.css e69133568c3ddb5640cb45636895f322`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` não foi copiado.

## 2.66 Tooltips: uma só, e a certa (19 Set)

**Pedido (Hugo):** "os tooltips dizem todos a mesma coisa, que dizem todos more information. O
tooltip é para explicar, em poucas palavras, mas de uma maneira que faça sentido, o que é que cada
coisa faz, dependendo de onde está o tooltip".

**Causa — duas falhas somadas.**
1. `attachTip` **não** punha a classe `tj-tip-anchor` no elemento, e `guardTips()` (mousemove em
   fase de captura em `lib/tip.ts`) faz `if (!el.closest(".tj-tip-anchor")) killTip();` — a nossa
   tooltip era morta no mousemove seguinte, em **113** sítios (`grep -c "attachTip("`).
2. O `aria-label: "More information"` do `(i)` fazia o **Obsidian** desenhar a tooltip dele
   (única origem dessa string em `src/`: `accountsManage.ts:161`). Como a nossa morria, sobrava a
   do Obsidian — igual em todas as secções.

**Correcção.**
- `lib/tip.ts`: `attachTip` começa por `el.classList.add("tj-tip-anchor")`. Corrige os 113 sítios
  de uma vez. Única regra visual que usa a classe: `.tj-heat-cell.tj-tip-anchor:hover` (L5540) —
  sem efeitos colaterais.
- `views/accountsManage.ts` (`sectionInfo`): fora o `aria-label`; o glifo `ⓘ` fica `aria-hidden` e
  o nome acessível passa a ser um `span.tj-sr-only` com `About <título>`; mantém-se `tabindex="0"`.
- Textos curtos e distintos: Layout → "How the page groups accounts and orders the cards.";
  What appears → "Which badges the cards draw. None of them changes a number."; Types → "Rename,
  recolour and reorder the account types — and hide the ones you do not use."
- `styles.css`: nova `.tj-sr-only` (clip), depois de `.tj-manage-infoico:focus-visible`.
- Regra permanente registada no UI-CATALOG §8.1: **nunca `aria-label` num âncora de `attachTip`**.

**Verificação.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` 0 novas violações.
Deploy: `main.js 8164274fb23dc8c1a601d8effff99e00`, `styles.css 433d65cafeda75d47b1adb4fe57f28ed`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` não foi copiado.

---

## 2.67 Duas superfícies, um só glifo e a faixa honesta (19 Set)

**Pedido.** (1) A tooltip do gráfico da página de Contas estava errada e longa; (2) os `(i)`
com a letra dentro de um aro nosso não liam como "informação"; (3) fechar o resto que ainda
não tinha sido aplicado: tirar os separadores do Management (Copy groups ganha superfície
própria), e rever as regras da faixa — **os payouts passam a seguir a janela do gráfico**.

**Mudanças.**
- `views/accountsManage.ts`: o campo `tab` dá lugar a `mode`; o construtor passa a
  `constructor(plugin, mode: "groups" | "display")`; o título, o ícone e o sub mudam com o
  modo; **o bloco de separadores desapareceu**. Dois entry points limpos: `openCopyGroups`
  e `openAccountsDisplay` (o antigo `openAccountsManage` saiu).
- `views/accountsListView.ts` (header): três quadrados — `users` Copy groups ·
  `sliders-horizontal` Display · `plus` Add account (`.is-primary`, último). O das copy
  groups fica `disabled` com tip quando há menos de duas contas.
- `styles.css`: mortas `.tj-manage-tabs` e `.tj-manage .tj-wz-seg-opt` (e o comentário que as
  acompanhava).
- **Faixa**: `withdrawn` passa a somar `plugin.payoutsFor(a.id)` filtrando `p.date >= w.from`
  (all-time é a janela que começa no princípio); o sub dos Payouts passa a mostrar a janela.
  *In accounts* mantém-se all-time e di-lo. Textos das cinco células encurtados; a tooltip
  dos Trades passa a "Every decision counts once, however many accounts copied it. Real
  accounts only."
- **Glifo**: `setIcon(el, "info")` (pictograma do Obsidian) em 6 sítios — o helper `cell()`
  da faixa, o `(i)` do gráfico, os dois `dRow`/`mRow` do dashboard da conta, o
  `sectionInfo` do Management e o `.tj-manage-note-ico`. `.tj-info-dot` perde
  `border`/`border-radius`/`font-size` e ganha `svg { width/height: 14px }`; `.tj-manage-infoico`
  ganha o mesmo. `ux-audit` sem alterações (`.tj-info-dot` já estava na lista SPACED).
- **Tooltip do gráfico**: sai o `title` nativo (~250 caracteres, proibido pela UX-GUIDELINES §5)
  e entra `attachTip(i, { title: "Net P&L across accounts", sub: "Real money only — payouts
  leave the account, deposits arrive. Dashed grey: the same window just before this one." })`.
- **Logos**: os 14 PNGs de `assets/firm-logos/` reduzidos a 128×128 com ImageMagick
  (752 KB → 132 KB) e renomeados para o id do catálogo; `lib/firmLogos.ts` passa a ter 14 marcas
  (prop: Topstep · Tradeify · Apex Trader Funding · Take Profit Trader · MyFundedFutures ·
  Lucid Trading · **Alpha Futures** · **FTMO Futures** · **FundedNext** · **TopOne Futures**;
  brokers: Tradovate · NinjaTrader · Interactive Brokers · AMP Futures; `own` em símbolo CSS).
  **`alphacapital` saiu** — o PNG que existia é a Alpha Futures ("A" triangular branco sobre
  verde com teia), não a Alpha Capital Group; contas antigas com esse id caem nas iniciais
  (`firmLabel()` devolve `null` e o consumidor já trata).
- **Harness**: `manage-check.js` reescrito — abre cada superfície pelo quadrado do header,
  confirma que o antigo `.tj-manage-tabs` não existe, valida o compositor guiado e as
  type rows + pills dentro do Display; aceita o quadrado das copy groups desactivado quando
  a vault tem menos de 2 contas (é o estado honesto). Corre: **MANAGE OK**.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, weights 0, tight line-heights 0, small targets 5
(dívida de base), faint 0 → **0 violações novas**. `main.js` ~654 KB (as 14 logos embutidas).

**Deploy.** `main.js 4cce6d61097983758850c22f6b0d949d`,
`styles.css 22ae7796f38e2598057285267895e16b`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**.

---

## §2.68 Import CSV — a conta primeiro, e nunca adivinhada (19 Set)

**Pedido.** "No import, a parte de selecionar a conta tem de ser muito mais chamativa — às vezes
confunde. O *This Trading Group* deve ficar escondido até meter a conta leader. Ao abrir não deve
pré-selecionar nenhuma conta (hoje assume uma sozinho e aparece logo o trading group). No select
deve haver uma divisão clara entre **leader**, **copier** e **standalone**, com a leader mais fácil
de notar, e só depois de selecionar é que aparece o *This Trading Group*. E uma opção de dar tick a
mais alguma conta extra para aquele import em específico." Decisões: **zero pré-seleção**; grupo e
ticks só depois da conta; secções no dropdown; bloco de escolha **acima** do fuso/Cash History;
FTMO invertido para branco.

**Mudanças.**
- **Zero pré-seleção** — saem `guessMapping()` e `resolveFallback()`; `parseTrades()` limpa o mapa e
  a semente do grupo a cada ficheiro novo. Um nome da CSV que coincide com uma conta é coincidência
  de texto, não uma instrução: adivinhar era como os trades caíam na conta errada com o ecrã a dizer
  que correu bem. Desaparecem também os settings mortos `lastImportAccountId`/`lastCreatedAccountId`
  (interface em `main.ts`, escrita no dropdown do importador e no `create()` do wizard).
- **A conta primeiro** — `render()` cria `pickEl` entre o ficheiro e o `setupEl` (fuso + custos). O
  bloco `.tj-import-pick` ("Where these trades go") nasce com borda/fundo de acento enquanto não há
  resposta e acalma com `.is-set` quando já há; estado `N of M chosen` / "Nothing chosen yet"; cada
  linha mostra o nome da CSV e `N trade(s) · 19 Aug → 14 Sep 2026` (novo `spanLabel()` sobre
  `formatDate`); hint honesta ("N trade(s) waiting for an account…" / ".is-warn" quando só parte
  ficou sem conta).
- **Grupo e ticks só depois da conta** — `renderPick()` faz `return` antes de `renderExtraTargets()`
  enquanto `baseIds()` estiver vazio; com nada escolhido o `includeIds` é limpo (um tick é do
  escolhido, não um resto do passado) e o `.tj-import-group` / `.tj-import-accs` **não existem** no
  DOM. `tickBaseId()` foi **removido** e a regra passou a ser uma só: a conta do dropdown é onde os
  trades são escritos (`baseIds()`); `commit()` deixou de ter `|| tickBase`.
- **Dropdown com secções e chips** — `lib/dropdown.ts` ganhou `heading`, `tag`, `tagTone`; o item
  passou a flex com `.tj-mg-dd-txt` (label + note) e o chip à direita. `accountItems()` ordena
  **Leaders** (chip âmbar, nota *Leads N accounts*) · **Copiers** (chip acento `Copier ×N`, nota
  *Copies \<líder\>*) · **Standalone** (sem chip, "On its own"), com *Leave unassigned* no fim; o
  chip viaja no botão depois de escolhido. CSS novo `.tj-mg-dd-head`/`.tj-mg-dd-tag`(+`.is-leader`
  âmbar/`.is-copier` acento); a antiga `.tj-import-map` foi removida.

**Prova (`tj-out/importpick-check.js`, 31 asserções → IMPORT PICK OK).** Nada pré-selecionado · botão
adormecido · `.tj-import-pick` desenhado com estado vazio · a linha conta `3 trades` e cobre
`19 Aug → 14 Sep` · a hint existe · **a escolha vem antes do fuso/custos no DOM** · a antiga caixa
plana não existe · sem grupo nem ticks antes de escolher · secções `Leaders / Copiers / Standalone` ·
chip âmbar no líder e `Copier ×0.5` + "Copies Tradeify…" no copiador · standalone sem chip ·
*Leave unassigned* em último · depois de escolher o líder: `.is-set`, botão acordado, grupo visível,
copiador oferecido **tickado uma vez**, o untick sobrevive ao repaint · ao limpar a conta os ticks
caem e o botão volta a dormir.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, tight line-heights 0 (0 abaixo do próprio chão),
small targets 5 (dívida de base), faint 0, pesos 700 +1 (o novo `.tj-import-picktitle`) →
**0 violações novas**. `fills-check.js` continua com 1 FAIL **pré-existente** (reproduzido com o
`main.js` do deploy anterior, `4cce6d61…`, resultado idêntico) e não faz parte do gate.

**Deploy.** `main.js db0808063310114bf6592b0a8030cff1`,
`styles.css 677b038b4416f34c5f24771c069fcf64`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(`ceb1a893ffe6bca661a78d367847c755`, 5072 B, inalterado antes e depois).

---

## §2.69 Import — o id nunca ao ecrã, e a escolha sobrevive (19 Set)

**Pedido.** "No *Where these trades go* aparece o ID da conta que vem no Orders CSV. Nós tínhamos
dito que nunca era para usar este ID nenhuma vez, portanto tem que ficar escondido. […] no *Time
files are in*, se eu trocar, ele tira uma conta que eu selecionei."

**Mudanças.**
- **O id do broker sai do ecrã** (`renderPick`): a linha mostrava `seen.name` (ex. `LFE0509`). Com
  **um só** nome no ficheiro — o caso normal — a linha fica só com o ponto, `3 trades · 19 Aug →
  14 Sep 2026` e o dropdown, sem rótulo (`.tj-import-mapname.is-plain`, a contagem sobe a
  `--tj-fg-2` por ser a única palavra da linha); com **vários** nomes passa a `Account 1` /
  `Account 2`, na ordem do ficheiro. O id continua a ser a **chave interna** do `mapping`, nunca
  texto. Verificado que era o único sítio do importador que o escrevia (a tabela de review mostra
  Date/Symbol/Side/Qty/Entry→Exit/P&L; o chip mostra o nome do ficheiro).
- **Trocar o timezone deixava de manter a escolha** — era bug, e havia mais casos. Causa: o
  `parseTrades()` limpava sempre `this.mapping` e `this.groupSeeded` no fim. Como a conta se escolhe
  **antes** do fuso e dos custos, largar o Cash History apagava a escolha a seguir de a fazer; e ao
  ficar sem `baseIds` o `renderReview()` também limpava o `includeIds` (daí "tira uma conta que eu
  selecionei"). Correcção: a limpeza passou para o `handleFiles()`, imediatamente antes de
  `this.tradesText = exec.text` — só um **ficheiro de trades novo** é que é uma decisão nova. As
  re-leituras do mesmo ficheiro (fuso, toggle dos custos, *Choose another*, `readCash`) mantêm a
  conta **e** os ticks. Depois de cada parse caem só as chaves do `mapping` cujo nome já não consta
  de `accountsSeen`.

**Prova (`tj-out/importpick-check.js`, 36 asserções → IMPORT PICK OK).** Às 31 anteriores juntaram-se:
o número do broker **não está no texto do modal**; depois de voltar a tickar o copiador, **mudar o
timezone** (o mesmo caminho que o dropdown faz — `importZone` + `parseTrades()`) **mantém a conta
escolhida** e **mantém o tick extra**, e o número continua ausente do ecrã.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, off-scale weights 0, tight line-heights 0,
small targets 5 (dívida de base), faint 0 → **0 violações novas**.

**Deploy.** `main.js b097a67017c60d558169bf69e1e1d15f`,
`styles.css f3ac28f41b8a58a4774804a043471224`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(`ceb1a893ffe6bca661a78d367847c755`, 5072 B, inalterado antes e depois).

---

## §2.70 Página da conta — copy history fora, header quieto, rodapé limpo, fills sem pill (19 Set)

**Pedido.** Quatro coisas na página de conta: (1) o bloco de "copy history" (quanto tempo/quantas
vezes esteve ligada) não interessa — sai; (2) no ledger "Trades in this account" havia "um
rectângulo" a tapar o título; (3) em todas as contas aparecia sempre um texto no fundo, a mais; (4)
o pill dos fills (micros/vários contratos) não encaixa no ledger — a dropdown está bem, o visual não.

**Mudanças.**
- **Copy history sai das duas superfícies.** O bloco `.tj-acc-copyhist` (linhas `who · Nx · from →
  now`) saiu do `renderCopyBar` e a secção "Copy history" (`.tj-as-periods`/`.tj-as-period` + hint)
  saiu do painel Copy-trading do modal. Fica só o chip Leader/Copier com o rácio (a tooltip já nomeia
  o líder). Os `copyPeriods` continuam na **dados** — são eles que impedem que mudar de líder reescreva
  trades antigos —, simplesmente deixam de ser desenhados. CSS morto removido (`.tj-acc-copyhist`,
  `-copyrows`, `-copyrow`, `.tj-as-periods`, `.tj-as-period`, e a metade `.tj-acc-copyhist .tj-acc-k`).
- **O "rectângulo" era o header sticky.** `.tj-tbl thead th` é `position: sticky` para o Trade Log,
  mas na página de conta quem faz scroll é a **página** (a tabela vive num widget), e a barra opaca
  flutuava por cima do título do widget. Novo `TradeTableOpts.stickyHeader?: boolean` (default `true`);
  a página de conta passa `stickyHeader: false`, o `<table>` ganha `.is-static` e `.tj-tbl.is-static
  thead th { position: static; }`. O Trade Log fica como estava.
- **O texto do fundo era a regra da firm.** Saíram as duas linhas do fim da página: o aviso de
  consistência (`tj-account-note tj-account-warn`) e a prosa `size.note` (a regra da firm por
  programa, em `src/props.ts`), mais os locais que só o aviso usava (`dayNets`, `grossProfit`,
  `bestDay`, `consBasis`, `consistency`, `consistencyNeed`). CSS `.tj-account-note` e
  `.tj-account-warn` removido. Nota: o `note` continua no catálogo `props.ts` como semente (informação
  da firm), mas já não é desenhado em lado nenhum.
- **Fills: a quantidade é a porta.** O `.tj-tbl-fills` deixa de ser pill de acento (borda, fundo,
  `border-radius: 999px`, letra bold, ícone `⋔`) e, segunda passagem, deixa de ser texto («N fills
  ⌄»): numa trade escalada é a **própria quantidade com um chevron** («6 ⌄», ou «2/4 ⌄» na posição
  parcial), sem palavra nenhuma. Herda o tipo e a cor do número (`--tj-fs-body`, `color: inherit`),
  `min-height: 24px` mantido (SC 2.5.8); no `hover` e com a linha aberta o chevron acende a
  `--interactive-accent`. Uma só tooltip no botão («N executions · X in · Y out · …»), nome acessível
  via `<span class="tj-sr-only">Show executions</span>` (sem `aria-label`), clique/expansão
  inalterados. CSS morto `.tj-tbl-fills-ico` e o span `.tj-tbl-fills-t` removidos.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, off-scale weights 0, tight line-heights 0,
small targets 5 (dívida de base), faint 0 → **0 violações novas**.

**Deploy.** `main.js 780ec544ce0cdae9fb91d6921ca839b4`,
`styles.css f77eb6d417bde27abc0add05fc54e904`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(`caa65cd950f97fb99d8f574627543d4c`, inalterado antes e depois).
(Nota: o `styles.css` foi depois endurecido — ghost forçado no `.tj-tbl-fills`, ver §2.71.)

## §2.71 Âmbito de conta — review e Trade Log presos à conta de origem (19 Set)

Pedido: «se clicares numa trade dentro do trade log que está dentro de uma conta em específico,
entras no trade log mas apenas com as trades dessa conta». O single trade review abria com o
journal inteiro (contador `3 / 200`, setas a andar por tudo) e o botão *Trade Log* abria o log sem
filtro.

- **A origem viaja no estado.** `openTradeDetail()` passa `state: { tradeId, from }` (a
  `tradeDetailOrigin` já existia mas perdia-se num reload); `TradeDetailView.getState()` devolve
  também o `from`, e `onOpen()`/`setState()` lêem-no.
- **O review caminha só dentro da conta.** Novo `loadScope()` no `TradeDetailView`: com origem em
  conta, `allTrades` filtra-se por `mappedAccount(t.account)?.id === accountId`; se a lista ficar
  vazia (leg virtual/sem conta) cai na completa — nunca abre vazio. Setas, teclas e contador seguem
  este âmbito; o *Reload from note* reaplica o mesmo filtro.
- **Chip de âmbito.** Com origem em conta, o cabeçalho mostra `N / total · <nome da conta>`
  (`.tj-td-scope`, `--tj-fs-small`/`--tj-fg-3`, tooltip «Scoped to this account») — o contador deixa
  de ser anónimo.
- **O Trade Log abre filtrado.** Novo `openTradeLogForAccount(id)` (espelha `openTradeLogForDay`) e
  `filterByAccount(id)` no `TradeLogView` — transitório, como `filterByDay`: não grava em
  `settings.tradeLog`, por isso o ribbon continua a abrir tudo; o chip `Account: X` já mostra e
  limpa o filtro. O *Trade Log* do cabeçalho e o regresso após apagar seguem a conta.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, off-scale weights 0, tight line-heights 0,
small targets 5 (dívida de base), faint 0 → **0 violações novas**.

**Deploy.** `main.js 777857a0393e88adacc97073f26f0d89`,
`styles.css a0ee852322e33c66d3c1ad99faf39859`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(`701a9b4e12d38ffb2080252a55009457`, inalterado antes e depois).
O ghost forçado do `.tj-tbl-fills` (§2.70) entrou neste mesmo deploy de `styles.css`.

---

## §2.72 Flip card v2 — drawdown da firm, medo do tilt nomeado, hold zones por segundos (19 Set)

Pedido: confirmar todos os sistemas de números contra o comum das prop firms (drawdowns, targets,
métricas) e tratar **cada tipo de conta** individualmente (eval ≠ funded ≠ live ≠ personal/demo).
Investigação web (Jun–Jul 2026, 9 firms de futuros) fixou as convenções: três modelos de drawdown
(**static · EOD trailing · intraday trailing**, sendo EOD o default do mercado), locks ao break-even
ou a `start + $100`, **target só na eval** (a funded não tem target, tem payouts), consistency
quase universal mas em **fases diferentes** por firm (eval-only, funded-only, ou ambas, caps 30–50%),
DLL por vezes **soft** (Topstep) e por vezes hard, dias mínimos em dois conceitos (**passar** vs
**receber payout**), live = capital real com drawdown normalmente **static**. Veredicto: o motor
está estruturalmente certo; o que faltava era **nomear** o que ele já calculava.

- **Drawdown = o número da firm, não o nosso.** A caixa passa a mostrar `ddToLimit` (pico da
  balance − balance, já com payouts) como *used*, o limite, e *remaining* = `balance − floor`
  (novo `ddRemaining`). O badge é por % do limite; o sub nomeia o tipo via novo `drawdownLabel()`
  em `lib/accountRules.ts` (`Static floor` · `Intraday trailing` · `EOD trailing` + lock). Saíram
  `DD from peak` e os três locais mortos `floor`/`buffer`/`ddToLimit` do `render()` (usavam uma
  fórmula hardcoded que ignorava `maxLossType`/`ddLockOffset`).
- **Time in drawdown** (`pctTimeInDD`) entrou no resumo da caixa. `computeDrawdownEpisodes` perdeu
  os campos mortos `avgDepth`/`avgDepthPct`/`worstDD`/`longestDD`.
- **Revês do tilt, testado.** `revenge` = reentrada ≤15 min **no mesmo símbolo**, ou uma trade com
  `mistake` explícito logo após uma perda (conta mesmo fora da janela). A linha do verso diz isto.
- **Hold zones por segundos** (5 baldes): `Flash <1m · Scalp 1–5m · Quick 5–30m · Intraday 30m–2h ·
  Long >2h`, com net + win rate por balde (novo `holdZones`). O balde `<1m` usa o mesmo relógio dos
  «Trades < 1 min» do verso (que **fica**: é comportamento a %, não P&L).
- **Frente:** saíram `Winning trades` (o donut diz) e `Revenge trades` (só verso); entraram
  **Biggest win/loss**; `Trades ≥ 1R` → `Reached 1R`. Strip no fundo: **Hold zones · Order type ·
  Rating** (1–5★ + Unrated). Renomes: `Max-loss buffer`, `Worst day vs limit`.
- **Verso:** gauge `Mistakes` → **`Clean trades`** (aro cheio = bom); score inclui **Strategy
  tagged** e diz **model**; saiu a linha `Reviewed` (só gauge) e `Hold W / L`. Gauges por tokens
  `--tj-tone-good/mid/bad` (novos no `:root`).
- **Tipo de conta:** `resolveAccountView` deixa de usar o fallback errado `programs[0]` (o wizard
  guarda o tipo em `programId`): resolve por id → `phase === type` → `undefined`. No wizard,
  `applySizeRules` passa a semear por tipo: **eval** target 6% + `eod-trailing`; **funded** sem
  target + `eod-trailing`; **live** sem target + `static`; personal/demo sem regras. Os rótulos
  dizem a fase (`Payout winning days` na funded) e a hint muda com o tipo.
- **Limpeza:** `getProgram` (morto), `accountBreakdownMetric` (settings morto) e o CSS morto de
  breakdowns/widgets (`.tj-acc-brow*`, `-btrack*`, `-bfill*`, `-bstat`, `-bseg`, `-blegend`,
  `-bitem`, `-bdot`, `-bname2/-bval2/-bsub2`, `-brow2*`, `-btrack3/-bfill3`, `-tile-vals`,
  `-bmetric*`, `-wtools/-wx/-wadd/-seg`, `-breakdowns`, `-bname/-btrack/-bfill/-bval`,
  `-perfcard/-tradescard/-bcard`, `-disc-rating/-stars/-dots/-facts/-dot`) — ficam só
  `.tj-acc-treemap`, `-tile*`, `-btabs/-btab`, `-tchip`, `-tradeshead`, `-bdhead`, `-herobreak`,
  `-wgrid/-widget/-wh`, `-flipcard/-flipbtn`.

**Backlog.** Linha nova no `ROADMAP.md`: *Tilt & psychology — limiares configuráveis* — os limiares
(revenge 15 min, <1 min, ≥2 perdas) são heurísticas fixas; pesquisar e torná-las configuráveis só
quando abrir o módulo de estratégias/playbooks.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, off-scale weights 0, tight line-heights 0,
small targets 5 (dívida de base), faint 0 → **0 violações novas**.

**Deploy.** `main.js 353632e0b26af2a9e02acc5cc94e197e`,
`styles.css c83b697b1a4ba28d093f67c2ca05fa98`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(`44ab9c336799464069312a2c2dd1f883`, inalterado antes e depois).
*(O card foi refinado a seguir — ver §2.73 para o estado e hashes finais.)*

---

## §2.73 Flip card v3 — o card volta ao sítio, uma barra só, hold zones adiadas (19 Set)

Feedback: «não gosto de como ficou o card, ficou muito desconfigurado e super esticado… o ratio
entre a key metrics e a discipline está super desproporcional… o ícone do flip desapareceu».
Três causas, três correções.

- **O card esticava porque a strip media a altura toda.** As três distribuições no fundo da frente
  (**Hold zones · Order type · Rating**) faziam a frente muito mais alta que o verso — e como o
  verso é `position:absolute; inset:0`, herdava essa altura. A strip **saiu** por decisão do
  trader: Hold zones e Order type são análise fixa do futuro módulo de estratégias/playbooks (o
  rating fica só no verso). O `holdZones`/`HoldZone` de `accountMetrics.ts` e o CSS
  `.tj-acc-diststrip`/`-dist*` foram **removidos** (o helper `heldMinutes`/`hold()` ficou). A medida
  do herói mantém-se (**1.5fr / 1fr**).
- **Uma barra, uma mensagem.** O `Risk↔Target` (ao lado dos dials) e a barra *Drawdown used* diziam
  praticamente o mesmo em dois sítios. Ficou **uma** barra: o `Risk↔Target` ganhou o tick tracejado
  `.tj-acc-marker-dd` no floor do trailing dd (posição `floorLevel = balance − ddRemaining` mapeada
  na escala `[−maxLoss, +target]`; só aparece quando cai dentro da barra), e a caixa *Drawdown used*
  perdeu o `ddtrack`/`ddfill` — fica só com o número (`used` · `limit` · `remaining`), o tipo
  (`drawdownLabel`) e o resumo (episódios · recuperação · **time in DD**). CSS `.tj-acc-ddtrack`/
  `-ddfill*` removido.
- **O ícone do flip voltou.** O glifo desaparecia por baixo do `padding` nativo do Obsidian: uma
  `button` de 24px com `padding` default colapsa o conteúdo a zero. `.tj-acc-flipbtn` ganha
  `padding: 0` e `.tj-acc-flipbtn svg { width:15px; height:15px }`, e o ícone passa de `refresh-cw`
  para `arrow-left-right` (lê-se como "virar"). Mantém `attachTip` + `<span class="tj-sr-only">`,
  nunca `aria-label`.

**Backlog.** A linha *Tilt & psychology — limiares configuráveis* passa a registar também que
**Hold zones** e **Order type** voltam no mesmo módulo (saíram do flip card a 19 Set).

**Preview.** `previews/account-hero-v3.html` (mock da barra única com tick do dd e caixa sem
barra).

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, off-scale weights 0, tight line-heights 0,
small targets 5 (dívida de base), faint 0 → **0 violações novas**.

**Deploy.** `main.js 8653e40834952b3e0dc02f6c7e1e530f`,
`styles.css 63920dbe9ea8fd59241648e4f06eb80c`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(`bf965343b846651b9784664f2a5eb197`, inalterado antes e depois).

## §2.74 Conta — nomes, cartões, cor do cash, settings e copy groups (19 Set)

Lote de treze pontos apanhados enquanto se fazia o flip card. Três causas comuns
(nome legado do programa, cartão sem coluna, dropdown que não se repinta) explicavam
metade deles.

- **O programa legado saiu do ecrã (nomes lixados).** O wizard grava
  `programId = values.type`, e a UI mostrava sempre `view.program?.label` — daí
  «Tradeify **Growth** 50K», «Topstep **Express Funded**», «Tradovate **Demo Account**».
  `splitAccountName` (`accountsListView.ts`) passa a montar o subtítulo com
  `[firmLabel, typeLabel, $XK]` e **deduplica por palavra** contra o título (um nome
  «Tradeify Eval $50K» já não repete nada); o título do gráfico passa a `Equity — {acc.name}`;
  `.tj-as-meta` fica `firm · tipo`; `autoName` e o seed `makeAccount`
  (`props.ts`) passam a `firm · tipo · $XK`. Nenhum sítio mostra `program.label`.
- **Cartões alinhados.** `.tj-acct-tile` passa a `display:flex; flex-direction:column` e a
  primeira barra (`.tj-acct-prog.is-first`) ganha `margin-top:auto` — barras e mini-stats
  encostam ao fundo e todos os cartões alinham (era o caso do AMP/Apex). **Coroa:** a tag do
  líder usa `setIcon(..., "crown")` (Lucide, herda a tinta) no cartão e no `.tj-acc-copychip`;
  os emojis 👑/📦/🗑️ saíram e os botões Archive/Delete usam `archive`/`trash-2`.
- **Gráfico de equity — a cor diz o que é o dinheiro.** O `dayCash` deixa de ser um booleano e
  passa a `{index, kind}`: **payout** = dourado, **depósito** = verde, **correção de
  fees/custo** = tom neutro (`--tj-fg-3`). Antes qualquer dia com fluxo negativo (incluindo uma
  correção) pintava o ponto a dourado de payout. As linhas do hover seguem a mesma regra
  (`b.tj-cost` neutro).
- **Account settings rebatidas.** O separador **Copy trading saiu** do modal da conta (a gestão
  vive toda no Manage — `openCopyGroups`); os imports que só ele usava
  (`CopyConfigEntry`/`CopyPeriod`, `openCopyPeriod`/`closeCopyPeriods`/`todayIso`) foram
  removidos, e o CSS morto (`.tj-as-ov*`, `.tj-as-sw`, `.tj-as-copydetail`, `.tj-as-copy-warn`,
  `.tj-as-field`) apagado. O separador **Rules** foi refeito para **espelhar o wizard**:
  Profit target ($/%), Max loss ($/%), Daily loss limit, Consistency %, **Drawdown type**,
  **Locks above balance**, **Position size** e **Minimum trading days / Payout winning days**,
  com os mesmos rótulos por tipo (eval/funded/live) e o disclaimer das firms; o modelo «Firm
  default hint» antigo saiu. O painel reusa as classes `.tj-wz-*` com `tj-account-wizard`.
- **Winning days (ver §2.2).** `AccountMetrics.winDays` (dias > 0) + linha `X of Y days`
  (Y = `minDays`) só em eval/funded, rotulada *Passing days* / *Payout winning days*.
- **Copy groups que pareciam mortos.** Causa: `mountDropdown` (`lib/dropdown.ts`) calculava o
  label/chip uma vez no mount e nunca se repintava — escolher uma conta em *Add to group* ou
  *Change leader* não dava retorno visual. O dropdown passa a manter `chosen`, repinta label,
  chip e o `on` da lista no clique (**corrige os 19 sítios de uma vez**). O `renderGroup`
  (`accountsManage.ts`) foi reorganizado em secções (`.tj-mg-sect`/`.tj-mg-sectitle`) com
  **Change leader ao lado do líder atual** e *Add a copier* em bloco próprio; `.tj-mg-swaplbl`
  morreu.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** · `ux-audit` contrast 0,
literal px 3 (off-scale 3), parent-relative 0, off-scale weights 0, tight line-heights 0,
small targets 5 (dívida de base), faint 0 → **0 violações novas**.

**Deploy.** `main.js 2bb5a1882093c4e02ddd038597e5f1bc`,
`styles.css 83813c305e8161d5a1b229154751002c`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(`361c84f1a8535355d14fd109eb488a15`, inalterado antes e depois).

## §2.75 Conta & Accounts — cartões, General/Rules, header e Types (19 Set)

Segunda passagem sobre a página da conta e a página Accounts, a partir da revisão do trader
ao que saiu em §2.74.

- **Segundo título repetido (AMP).** `splitAccountName` (accountsListView.ts) passa a
  descartar qualquer segmento do subtítulo cujas **palavras** já estejam todas no título.
  "AMP Futures Personal $50K" deixa de repetir "AMP Futures"; nomes de uma só palavra
  continuam como estavam.
- **Equity title.** O gráfico da conta passa a ler só **"Equity"** — o nome e o tamanho já
  estão no cabeçalho da página; o título repetia-os.
- **Rules sem scroll horizontal.** O painel Rules herda as classes do wizard
  (`.tj-account-wizard.tj-as-pane`) mas não a largura de 720px do wizard — nova regra
  `.tj-account-wizard.tj-as-pane { width: auto; }`. Tudo cabe sem scroll lateral.
- **General com os componentes do wizard.** `ACCOUNT_SIZES` e `TYPE_CATALOG`
  (6 tipos, incl. *Other*) passam a viver em `lib/accountTypes.ts` e o wizard importa-os
  (fim da duplicação). O size é um `mountDropdown` com os cinco tamanhos + **Custom…**
  (revela um campo `$`); o tipo é a grelha `.tj-wz-types`/`.tj-wz-type` com o escolhido em
  `--interactive-accent`. Mudar o tamanho só actualiza tamanho + nome (modo auto) — nunca
  re-semeia regras de uma conta existente.
- **Header da Accounts.** O quadrado passa a chamar-se **Settings** (era *Display*) e a
  ordem é **Copy groups · Add account · Settings**, com o Settings no canto direito.
  O modal abre com o título **Settings**; o ícone mantém-se `sliders-horizontal`.
- **Scroll único na modal Manage.** `.modal-container:has(.tj-manage) .modal-content`
  ganha `overflow: hidden` — só o `.tj-manage-body` faz scroll, sem barra inútil nem
  espaço em branco quando o conteúdo já cabe.
- **Types — ordem por omissão.** `typeOrder()` cai em `DEFAULT_ORDER`
  (**personal · live · funded · eval · demo · unknown**) quando nada está guardado, em vez
  da ordem de `TYPE_KEYS`; o *Reset* fica coerente com o que se vê pela primeira vez.

**Prova de gate.** `npm run build` → 0; smoke em `~/trading-journal-smoke` →
**142 PASS / 0 FAIL**; `node tools/ux-audit.mjs` → contraste 0, literais 3 (off-scale 3),
parent-relative 0, pesos off-scale 0, small targets 5 (dívida de base: 6px
`.tj-td-status-dot`, 10px `.tj-td-review-dot`, 7px `.tj-start-dot`, 18px
`.tj-export-checkbox`, 16px `.tj-pq-remove`), faint 0 → **0 violações novas**.

**Deploy.** `main.js 6f99230a1c10cdeec3c22fca3956eb69`,
`styles.css 3c10ba7fe0d8625296d98453ca44d58e`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não foi copiado**
(inalterado pela equipa).

**Segunda passagem (ajuste fino da modal da conta).** As tiles de tipo voltam a
encolher dentro de `.tj-acc-settings` (grid `minmax(146px,1fr)`, `gap:6px`,
`padding:8px 10px`, ícone 15px, nome a `--tj-fs-body`) e o ritmo vertical da modal
é dado por `.tj-acc-settings .tj-wz-field + .tj-wz-field` / `.tj-as-row + .tj-wz-field`
(`margin-top:14px`) — no wizard os campos viviam num `.tj-wz-row` que dava esse ar;
aqui empilham-se directamente, por isso o label do campo seguinte tocava a hairline
do de cima e o "Account type" encostava à linha do `Account size`. O campo
**Custom…** ganha `flex: 0 0 140px` para se poder escrever. Regressão de gate após o
ajuste: build 0 · smoke **142 PASS / 0 FAIL** · audit só a dívida de base.

**Deploy (após o ajuste fino).** `main.js 6f99230a1c10cdeec3c22fca3956eb69`,
`styles.css b1c2a1dc336f0095a3aec439b8d20207`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**.

**Terceira nota.** O nome automático da conta passa a seguir também o **tipo**
escolhido na modal: `autoName(size, type)` usa o `selectedType` (não o `acc.type`
original), por isso trocar a tile (ex. Eval → Funded) reescreve `Firma · Tipo · $XK`
enquanto o nome estiver em modo auto; assim que o trader edita o nome, o hint vira
*Custom name* e nada é reescrito. Gate mantém-se: build 0 · smoke 142/0 · audit só a
dívida de base.

**Deploy (nome auto segue o tipo).** `main.js b120d64bad6a50efb659ad6eb015d03b`,
`styles.css b1c2a1dc336f0095a3aec439b8d20207`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**.

---

## §2.76 Folder structure na 1.0 — notas por ano/mês, `type: trade`, migração automática (19 Set)

A estrutura que o `VAULT-STRUCTURE.md` planeava para o 2.0 passa a valer **já na
beta**: o que os colegas virem no Obsidian é a organização definitiva. O
`tradesFolder` sobe a **raiz** (`Tradebook`), as notas nascem em
`<raiz>/<ano>/<mês>/trades/` (mês numérico, `07`), os screenshots ficam em
`<raiz>/<ano>/attachments/` e o sistema em `<raiz>/_tradebook/backups`. A pasta
`library/` continua **reservada** para as estratégias 2.0 — não é criada agora.

- **Escrever.** `saveTrade` (o único ponto por onde passam import, Add Trade e
  pernas de copy) compõe `<raiz>/<AAAA>/<MM>/trades/` a partir da data da trade e
  cria a cadeia de pastas que faltar; as colisões `_2`/`_3` continuam a resolver-se
  **dentro do mês**. Novo helper `tradeMonthPath(root, date)` em `storage.ts`.
- **Identidade.** Cada nota leva `type: trade` no frontmatter (`Trade.type?` novo;
  reservados `missed` e `backtest`). A descoberta passa a ser **por `type`, não por
  pasta**: `loadTrades`/`collectTradeNotes` varrem a raiz recursivamente e excluem
  `_tradebook/` e `library/`. Notas antigas sem `type` continuam a ser lidas quando
  vivem dentro de `…/trades/` (compatibilidade), por isso nada se perde.
- **Screenshots.** As ~5 listas de candidatos duplicadas (tradeTable, tradeDetailView
  ×2, tradeModal, print queue) foram centralizadas em `plugin.attachmentCandidates()`,
  que resolve do novo `<raiz>/<ano>/attachments/` para trás (incluindo os caminhos
  legados `Tradebook/trades/prints`, `Tradebook/prints`, `Tradebook/`).
- **Backups.** Passam a `<raiz>/_tradebook/backups` (`getBackupFolder`).
- **Migração.** `settingsVersion` + `runMigrations()` (chamado no `onLayoutReady`,
  antes da manutenção de contas): a versão 1 move a pasta plana antiga para
  `<ano>/<mês>/trades/` pela API do Obsidian (`fileManager.renameFile`, a mesma que
  já atualizava links), acrescenta `type: trade` a quem faltar, sobe a raiz a
  `Tradebook`, **nunca sobrepõe** (se o destino existir, deixa e registra) e é
  idempotente — numa journal já migrada não toca em nada. É a última vez que o
  utilizador vê a pasta plana.
- **Textos.** Settings, getting-started e diagnostics deixam de dizer "Trades folder"
  para dizer "Journal folder" (a raiz) e explicam `<ano>/<mês>/trades` +
  `<ano>/attachments`.
- **Harness.** Novo `folder-check.js` (11 asserções, corre contra o `main.js`
  construído): prova que `storeTrades` escreve exatamente
  `Tradebook/2026/09/trades/2026-09-14 NQ LONG 0930.md` com `type: trade`; que a
  migração move uma nota plana, apaga o caminho antigo, acrescenta o `type` e fixa a
  raiz + `settingsVersion === 1`; e que uma journal já migrada fica **byte a byte**
  intacta.

**Prova de gate.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** (artefacto
`/home/hugo/tj-out/smoke-folder.txt`) · `node tools/ux-audit.mjs` com contrast 0,
literal px 3 (off-scale), parent-relative 0, weights 0, line-heights 0, small
targets 5 (só a dívida de base), faint 0 · `node folder-check.js` **OK**.

**Deploy.** `main.js 477760992feb030f8e94c37c5f5de471`,
`styles.css b1c2a1dc336f0095a3aec439b8d20207`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**
(05b7a1e08b24bc1a94d94ee4c4696b17). No primeiro arranque o `runMigrations` move as
notas planas do vault-dev para `Tradebook/2026/09/trades/`.

---

## §2.77 Estratégias 1.0 / Nível 2 — identidade, nota por estratégia e escolha (19 Set)

A fundação escrita em AJ passa a estar implementada; `settingsVersion` sobe a **2** e a
migração é idempotente. Nada é imposto (§0): o formulário **pede**, o motor só regista.

- **Identidade.** `settings.strategies: StrategyRecord[]` = `{ id, name, createdAt }`
  (`types.ts`). `knownSetups()` mantém a **assinatura** (nomes) mas funde, por ordem,
  `settings.strategies` → `setups` legado → nomes das notas (case-insensitive, a primeira
  grafia ganha). `Trade.setup` continua **string simples** (contrato §1).
- **Nota por estratégia.** `library/strategies/<nome>.md` com frontmatter
  `type: strategy`, `id`, `name`, `createdAt` (pasta criada à medida; `sanitizeFilename`
  limpa o nome; `writeStrategyNote` **nunca sobrepõe**). As regras/documentação/readiness
  viverão na nota — o `data.json` é índice.
- **Remover guarda a nota.** `removeStrategy` limpa só o registo (e o `setups` legado); a
  nota e as trades ficam intactas. A UI aconselha **renomear**. `renameSetup` mantém o
  `id`, renomeia a nota pela API e reescreve as notas de trade (conta devolvida).
  `addSetup`/`removeSetup` ficam como alias.
- **Migração v2 idempotente.** `migrateStrategies()` semeia o registo a partir do `setups`
  legado + nomes das notas e escreve a nota de cada uma; correr duas vezes não duplica.
- **Add Trade — escolha obrigatória (manual).** O picker lê `knownSetups()` (já não das
  trades). Uma só estratégia → pré-preenchida; ≥2 → sem default e o *Save* desactivado
  até haver escolha (`needsStrategy()`); nenhuma → hint para `＋ New strategy…`; existe
  sempre a escolha explícita **No strategy**. O rótulo do campo é **Strategy** (a chave de
  dados continua `setup`).
- **Import — campo opcional + link.** Campo **Strategy** aplica-se a TODAS as trades do
  ficheiro (helper "Apply to all — leave empty if they are not all the same"; pré-preenchido
  quando só existe uma). O recibo conta as que ficaram sem estratégia (`N without strategy`)
  e o botão *Assign strategies* abre o **Trade Log filtrado exatamente a essas trades**
  (`openTradeLogForIds` + `filterByTradeIds`), com o bulk **Set strategy** por dropdown.
- **Strategies page.** Criar/renomear **inline** (`window.prompt` fora), nomes fora do
  registo aparecem como **untracked** (chip) com um `+` para os registar, remover pede
  confirmação e di-lo que a nota fica.
- **Tutorial.** Novo passo *The strategies you trade* (Add + Skip): recomenda, não impõe.

**Prova de gate.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** (artefacto
`/home/hugo/tj-out/smoke-strategies.txt`) · `node tools/ux-audit.mjs` com contrast 0,
literal px 3 (off-scale), parent-relative 0, weights 0, line-heights 0, small targets 5
(só a dívida de base), faint 0 · `node folder-check.js` **OK** (asserção de
`settingsVersion` atualizada de 1 → 2, acompanhando a migração v2).

---

## §2.78 Página Strategies — uma coluna, e a nota calada do martelo (19 Set)

- **Uma coluna só.** Intro, `.tj-strat-card` e a nota final passam todas a
  `max-width: 640px` (era 640 / 720 / 520). A página lê como uma coluna.
- **Intro curta:** "Name the strategies you trade so every trade can be filed under
  one. Each name keeps its own note in your vault."
- **O bloco `More is coming` sai.** O título grande e as 4 linhas (*The rule set ·
  Trades measured · Its own numbers · One trade, one row*) deixam de competir com o
  cartão. Entra `.tj-strat-note` — uma nota calada com o martelo Lucide
  (`.tj-strat-note-ico`, animação `tj-hammer` mantida, desligada com
  `settings.animations:false` e em `prefers-reduced-motion`) e o texto
  `In development — Rules, per-strategy numbers and comparison are on the way.
  Everything you name now carries over.`
- **Sem contador global** no cabeçalho: a lista já mostra `N trades` por linha.
- **Limpeza.** CSS morto removido: `.tj-strat-title`, `.tj-strat-hammer`,
  `.tj-strat-list`, `.tj-strat-row`, `.tj-strat-k`, `.tj-strat-v`. Mantidos
  `.tj-strat-empty`/`-empty-sub`.
- **Harness.** A asserção do smoke passa de `/More is coming/` para `/In development/`.

**Prova de gate.** `npm run build` 0 · smoke **142 PASS / 0 FAIL** (artefacto
`/home/hugo/tj-out/smoke-stratpolish.txt`) · `node tools/ux-audit.mjs` contrast 0,
literal px 3 (off-scale), parent-relative 0, weights 0, line-heights 0, small targets 5
(só a dívida de base), faint 0.

**Deploy.** `main.js 3c868aaad9f9c1446fa00d5ab40abbb4`,
`styles.css a27d50d47585ada07d61b4a113bdacfd`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**.

## §2.79 Trade Log — review honesto, escala, receita C+D e bulk completo (19 Set)

**O que estava errado (e ficou corrigido).** O sistema de review tinha três avarias
parqueadas desde §2.74:

- `lib/review.ts` decidia o passo *Review* pelo campo morto `t.review`, que a UI já
  não escrevia: o Trade Log e a conta diziam "falta review" enquanto o detalhe da trade
  mostrava o passo feito. O passo passa a ler o campo vivo —
  `hasText(t.notes) || hasText(t.review)`.
- A flag manual e a auto-detecção anulavam-se: `complete = done === total || reviewed === true`
  fazia com que uma trade completa nunca pudesse voltar a *Not reviewed* (clique morto).
  A regra passa a ser **`reviewed === true || (done === total && reviewed !== false)`** —
  o motor conta os passos, o trader tem a última palavra nos dois sentidos. O toggle em
  `tradeDetailView.ts` e o tick em `tradeTable.ts` (ambos `done = reviewStatus(t).complete`)
  funcionam agora para lá e para cá.
- Os contadores divergiam: `accountMetrics.reviewedPct` lia a flag crua enquanto
  `reviewCompletePct` lia o motor, por isso o gauge "Reviewed" da conta podia dizer 40%
  com o Trade Log a dizer 90%. `reviewedPct` **saiu**; o gauge, o discipline score
  (`0.25·(100−mistakeRate) + 0.35·reviewCompletePct + 0.15·stopDefinedPct +
  0.15·(100−untaggedPct) + 0.1·avgRating`), `main.ts` (maturity) e o dashboard falam
  todos pela mesma função. Rótulo do passo: **Screenshot · Strategy · Review · Rating**
  (`Print` → `Screenshot`); o `aria-label` do dot saiu (só `.tj-sr-only` + `attachTip`).

**Escala — a página deixou de reconstruir-se a cada gesto.** O search re-renderizava o
ecrã inteiro a cada tecla; agora espera **160 ms** e renderiza uma vez. `stats()` é
memoizado por uma chave composta (todos os filtros + `trades.length` + `_dataVersion`,
incrementado em cada releitura). O *Load more* re-renderiza **só o ledger** e repõe o
scroll de `.tj-app-main` num `requestAnimationFrame` (adeus `setTimeout(50)`). O search
passou também a procurar em `notes` e em `tags`, que faltavam no haystack.
Harness novo **`tradelog-perf.js`**: 2 000 trades → página a 50 linhas, strip e fila
desenhados, re-render memoizado na mesma ordem de grandeza e 5 teclas = **1** render
adiado; com limite 200 mostra 200 linhas (`TRADELOG PERF: OK`).

**Receita C+D (o que o trader escolheu no mockup `tradelog-recipe-v1.html`).**

- **Strip de 4 mini-cards** no topo: Net P&L · Win rate · Avg R · Profit factor
  (`.tj-tl-strip`/`.tj-tl-stat`), com o sub honesto dos records quando há cópias.
- **Fila de atenção** (`.tj-tl-attention`): chips `N to review` · `N missing strategy` ·
  `N missing print`, cada um a acender o filtro correspondente; sem nada pendente diz
  "Nothing waiting — every trade is reviewed and filed.".
- **Ledger em card** (`.tj-tl-ledger` + `.tj-tl-ledgerhead` `Trades · N`): o thead
  sticky continua preso à página (`overflow: clip`, não `auto`), as cópias aparecem uma
  vez e o "no strategy" fica âmbar.
- **Gaveta de filtros** (`.tj-tl-drawer`), substitui o popover: secções *What I traded*
  (com **Include/Exclude** de contas), *How it went* (Result · Direction · R),
  *When* (Session) e *Was it done properly* (Strategies · Mistakes · Missing); rodapé
  com "Show N trades" e "Clear all". Em ecrãs estreitos passa para cima da lista.
- **Colunas** mantêm o popover próprio (`.tj-tl-pop`), separado dos filtros.

**Bulk completo, ao nível do Journalit — e zero `window.prompt`.** A barra
(`.tj-tl-bulk`, flutuante e sticky, só com selecção) tem *N selected* · `Select all` ·
`Strategy…` · `Rating…` · `Account…` · `Mark reviewed` · `More…` (unreviewed, mistake,
tag, duplicate, delete) · `Clear`. Os três pickers usam o dropdown da casa com
`＋ New strategy…`, que abre um **input inline** (`inlineInput`). **Tags** entram por
união via novo `updateTradeTags` em `storage.ts` (o `updateTradeFields` transformava o
array numa string). O delete usa um **modal da casa** (`ConfirmModal`,`.tj-btn-del`) em
vez do `window.confirm`, e o `bulkPrompt` foi removido. **Shift-clique** selecciona o
intervalo (`_lastPicked`/`_renderedIds`, só a barra e os checkboxes são repintados, sem
re-render da tabela) e **Cmd/Ctrl+A** selecciona tudo.

**Limpeza.** Saem as regras mortas do editor inline antigo (`.tj-tl-editor` ×2,
`.tj-tl-edfield`, `.tj-tl-edtext` ×2, `.tj-tl-edfoot`, `.tj-tl-edrating`,
`.tj-tl-edcheck`, `.tj-stars-edit`, `.tj-tl-dirbadge*`, `.tj-tl-dir-arrow`,
`.tj-tl-sizeseg`, `.tj-pop-clear`) — e, com elas, um **bloco de comentário malformado**
(`/* Right side: WIN/LOSS + P&L + points{` sem fecho) que engolia silenciosamente o
`.tj-tl-dir-arrow`; nenhuma classe viva era apanhada. Verificado: 0 classes `tj-tl-*`
sem consumidor em `src/`.

**Prova de gate.** `npm run build` 0 · smoke **142 PASS / 0 FAIL**
(`/home/hugo/tj-out/smoke-tradelog.txt`) · `node tools/ux-audit.mjs` contrast 0, literal
px 3 (off-scale), parent-relative 0, weights 0, line-heights 0, small targets 5 (só a
dívida de base), faint 0 · `node folder-check.js` **OK** · `node tradelog-perf.js`
**OK**.

**Deploy.** `main.js fc5ff54a31f1a4ef2e817fd7c243a260`,
`styles.css 532331a477f1c010b6ea0ab96274e709`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**.

## §2.80 Trade Log — a receita canónica de superfície, escrita como lei (19 Set)

O trader: «o que decidimos aqui é o que tem que ficar definido para tudo, que é para ficar
exatamente tudo igual como tínhamos metido nas regras da UX Guidelines». A decisão de
19 Set (variante **C · Híbrido editorial**) passa a ser **normativa**, não um estilo do
Trade Log.

- **Norma escrita.** `docs/UX-GUIDELINES.md` ganha **§6.1 "One surface language, for every
  page"** (números numa linha fina com `(i)`, listas num painel sem cartão, fila em quiet
  chips, hairline perceptível, máximo ghost) + um item novo na checklist §7.
  `docs/UI-CATALOG.md` ganha **§6.0 "Receita canónica de superfície (normativa)"** com a
  tabela peça→classes→regra e a lista do que é proibido (`#d9a441` literal,
  `background-secondary` como fundo de página, `box-shadow` decorativo, cor sem palavra).
- **Implementação no Trade Log** (`src/views/tradeLogView.ts`): o subtítulo passa a
  `p.tj-import-info`; os 4 mini-cards (`.tj-tl-strip`/`.tj-tl-stat*`) dão lugar a uma
  **linha de números** `.tj-statline` → `.tj-statline-cell/-k/-v/-s`, com um **`(i)` por
  figura** (`.tj-info-dot` + `attachTip`: o que conta cada número — payouts/depósitos nunca
  entram no Net P&L, break-even não conta na win rate, o R é por trade, o profit factor é
  ganhos÷perdas); os chips de atenção passam a `.tj-attention` + `.tj-quietchip`
  (texto sublinhado em `--tj-tone-mid`, sem pill; `.is-on` com tinta) e `.tj-quietchip-none`;
  o ledger passa de cartão cinzento (`.tj-tl-ledger*`) para `.tj-panel` →
  `.tj-panel-head/-title/-count/-note` (sem fundo, sem raio, hairline em cima da tabela).
- **Gaveta e bulk** deixam de ser cartões: `.tj-tl-drawer` passa a uma coluna da página
  (hairline à esquerda, sem fundo/raio; <900px hairline em baixo) e a barra de bulk passa a
  tinta de acento translúcida. `.tj-tl-subtitle` (com o fallback falso
  `var(--fg-3, var(--tj-fg-3))`) sai; o `#d9a441` literal sai.
- **Sem CSS morto:** `.tj-tl-subtitle`, `.tj-tl-strip`, `.tj-tl-stat*`, `.tj-tl-attention`,
  `.tj-tl-attn*`, `.tj-tl-ledger*` removidos (0 consumidores em `src/`); a classe sem
  regras `tj-tl-ledgerwrap` saiu do view. Harness `tradelog-perf.js` passa a assertar
  `.tj-statline .tj-statline-cell` e `.tj-attention`.
- **Registado** no `docs/BACKLOG-AND-HISTORY.md` §7: «Receita canónica — alinhar as outras
  superfícies» (Accounts, Home e página da conta adotam a receita na passagem seguinte).

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** ·
`node tools/ux-audit.mjs` só a dívida de base (contrast 0, literal px 3 off-scale, small
targets 5, faint 0) · `node folder-check.js` **OK** · `node tradelog-perf.js` **OK**
(2 000 trades: 1.º render 93 ms, re-render 45 ms, 5 teclas = 1 render).

**Deploy.** `main.js 516171a1ffc15252603fa8698417a241`,
`styles.css 8f886bc81004cdeb612f1b173155bf6f`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**.

---

## §2.81 Trade Log — linguagem A, mecanismos e acessibilidade (19 Set)

O trader preferiu a **variante A** («acho que até prefiro o A… fica mais limpo») e ela passa a
**lei**: «queria tentar aquilo que vemos que de maneira geral todos os Top journals usam e
mudar a UI do nosso e acertar todos os nossos mecanismos para funcionar perfeito». Âmbito
fechado: **visual A + bugs + selects** (os mecanismos novos ficam no BACKLOG).

- **Norma reescrita (reversão do §2.80).** `UX-GUIDELINES.md` §6.1 e `UI-CATALOG.md` §6.0
  passam de C (stat line + plain panel + quiet chips) para a **linguagem da página Accounts**
  (variante A): faixa de números num **só cartão segmentado** com células separadas por
  hairline, listas em **cartão translúcido** (`.022` white, raio 14) com cabeçalho
  `.tj-acct-h1` (ponto + label + contagem + hairline), fila em `.tj-attn-chip`, **gaveta como
  cartão irmão**. `BACKLOG` §7 passa a dizer que **Home e página da conta** alinham depois.
- **Trade Log em A** (`src/views/tradeLogView.ts`): cabeçalho `.tj-acct-header` +
  `.tj-acct-header-actions` (saem `.tj-tl-head`/`-title`/`-actions` e os dois remendos de
  alinhamento em `styles.css`); strip `.tj-acct-strip` → `.tj-acct-strip-cell/-k/-v/-sub`
  (com o `(i)` por figura); atenção `.tj-attention` + `.tj-attn-chip`(+`.is-on`)/
  `.tj-attn-none` (tinta `--tj-tone-mid`, **zero** `#d9a441` literal); ledger `.tj-panel`
  em cartão com cabeçalho `.tj-acct-h1` + `.tj-panel-note`; chips de filtros activos em
  **pill da casa**; busca e gaveta e bulk bar como cartões; **Load more** e **Cancel** do
  confirm passam a ghost (`.tj-actionbtn`). Saem `.tj-statline*` e `.tj-quietchip*`.
- **Selects.** Os 5 `<select class="dropdown">` nativos da gaveta (Ticker · Result ·
  Direction · R · Session) passam a **dropdown da casa** (`mountDropdown`); o parâmetro
  `disabled` morto do `sel()` sai, com ele o estilo de select nativo.
- **Mecanismos (bugs da auditoria).** `filterByDay`/`filterByAccount`/`filterBySetup`/
  `filterByReview` voltam a ser **lentes transitórias** (`_skipPersist` — respeita AE: o
  ribbon abre tudo); a persistência só grava quando a **assinatura muda** (fim do save storm
  a cada render); o `idFilter` do import ganha **chip visível** com clear e **repõe o
  período**; **Cmd/Ctrl+A respeita os filtros** (era `this.trades`, incluía cópias e trades
  escondidas); os scoped opens passam por `scopedTradeLogView()`, que espera pela view
  (resolve o `DeferredView` do Obsidian ≥1.7.2 — antes era um no-op silencioso); o
  `groupFilter` mostra o **nome** do grupo e o sentinela `__none__` mostra "None"; o estado
  **Include/Exclude** das contas e a **selecção** ganham chip; o delete em lote di-lo
  **honestamente** (o Obsidian manda para o trash quando assim está configurado; senão é
  permanente); `Clear all` limpa `idFilter`/`accountExclude`/`accQuery`; a memo key de
  `stats()` inclui `includeCopiesInPortfolioAnalytics` e `timeZone`; `hasCopies` usa
  `isCopiedTrade`; um novo **`onClose()`** limpa `_searchTimer`/`_filterTimer`.
- **Acessibilidade.** O sort do header é operável por **teclado** (`th` focável +
  Enter/Space); a reordenação de colunas ganha **setas** no popover (alternativa ao drag,
  SC 2.5.7/2.1.1); o `aria-label` sai das âncoras de `attachTip` (Trade Log, tabela, painel
  de contas, header das contas) e o nome acessível viaja num `.tj-sr-only`;
  `src/lib/tip.ts` deixa de documentar o contrário da regra.
- **Limpeza.** Fora os campos mortos de `tradeLog.filters` (`type`/`duration`/`tag`/`tags`/
  `limit`), o `savedLedgerY`, as chaves `LEGACY_KEYS` que nunca eram lidas, e o CSS morto
  (`.tj-tbl-shot*`, `.tj-tbl-noshot*`, `.tj-pop-row`, `.tj-filterbtn-clear`,
  `.tj-filterbar-compact`, selectors duplicados); entram `.tj-tl-colmove`/`-colmove-b` e o
  `.tj-tl-activechip-x` passa a 24×24.

**Prova de gate.** `npm run build` **0** · smoke **142 PASS / 0 FAIL** ·
`node tools/ux-audit.mjs` só a dívida de base (contrast 0, literal px 3 off-scale, small
targets 5, faint 0) · `node folder-check.js` **OK** · `node tradelog-perf.js` **OK**
(0 renders síncronos ao escrever; 1 render diferido; limit 200 → 200 linhas em 132 ms).

**Harness.** `smoke.js` e `tradelog-perf.js` actualizados para `.tj-acct-header` /
`.tj-acct-strip`; `rowcheck.js`, `bulk-check.js`, `filters-check.js` e `tradelog-check.js`
retargetados para as classes novas e para o dropdown da casa. Nota honesta: estes quatro são
**probes da vault principal** e esta está sem trades — não fazem parte do gate; a cobertura
de confiança é o `smoke.js` (142) e o `tradelog-perf.js`.

**Deploy.** `main.js 66f3d85e4371a1d49d472122490d8320`,
`styles.css e305c7ccdf069ae1401d81a29577354d`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**
(`cc8a17daf8feb375f4513ca64e13c260`).

---

## §2.82 Tabela de trades em linguagem A + painel na página da conta (19 Set)

O trader: «agora temos de mudar a parte onde as Trades aparecem, ainda tem o look antigo,
não encaixa com isto novo que estamos a criar». O ledger é a última peça do Trade Log que
ainda falava a língua antiga; a tabela partilhada (`lib/tradeTable.ts`, usada pelo Trade Log
e pela página da conta) e o widget de trades da conta foram alinhados à variante A.

**Ledger (CSS `.tj-tbl*`).**
- Células por omissão: `var(--text-muted)` do tema → **`--tj-fg-3`** (token AA da casa) no
  `tbody td`, nas linhas de execução (`.tj-tbl-fill td`), na tag de execução
  (`.tj-tbl-fill-tag`) e no `.tj-flat`.
- Hover da linha: `var(--background-modifier-hover)` → `rgba(255,255,255,.035)` (o translúcido
  da casa, o mesmo das tiles de conta).
- Cabeçalho do dia: fundo opaco `var(--background-primary)` fora; fica transparente, com
  `border-bottom: 1px solid var(--background-modifier-border)`; a pill `.tj-tbl-daymid` passa
  a `rgba(255,255,255,.05)` + hairline; `.tj-tbl-daymeta` a `rgba(255,255,255,.05)`; a régua
  (`.tj-tbl-dayrule`) passa a `var(--background-modifier-border)`.
- Bordas: a assimetria (topo 100% + fundo 55%) morre — sobre uma hairline por cima de cada
  linha, com as regras duplicadas do dia (dois `.tj-tbl-day td`, dois `.tj-tbl-daymeta`)
  unificadas e o `padding` morto da pill removido.
- Header da tabela: sai o `border-radius: 7px` do primeiro/último `th` (era uma barra-pílula
  dentro de um painel quadrado); mantém-se o `box-shadow` que segura o sticky.
- Tokens nos estados: estrelas `#f5b301` → `--tj-tone-mid`; `#d9a441` → `--tj-tone-mid` em
  `.tj-tbl-review` e `.tj-tbl-pnl-partial`; `.tj-tbl-accs` fica em `--tj-fg-3` com o tracejado
  no mesmo tom.

**Página da conta.** A lista de trades deixa de ser uma tabela nua: é o mesmo `.tj-panel` do
Trade Log (cartão translúcido raio 14 + hairline) com o cabeçalho `.tj-acct-h1` — ponto ·
`Trades` · contagem em pill · hairline · o chip do filtro da breakdown à direita. A contagem
acompanha o filtro (é escrita no `paint()`), o título do widget passa a `Trades in this
account` (o número vive no painel, não duas vezes) e o `.tj-acc-tradeshead` morreu no CSS.

**Prova de gate.** `npm run build` exit 0 · smoke **142 PASS / 0 FAIL** ·
`node tools/ux-audit.mjs` só a dívida de base (contrast 0; literal px 3 off-scale;
parent-relative 0; off-scale weights 0; tight line-heights 0; small targets 5 —
`.tj-td-status-dot`, `.tj-td-review-dot`, `.tj-start-dot`, `.tj-export-checkbox`,
`.tj-pq-remove`; faint 0) · `node folder-check.js` **OK** ·
`node tradelog-perf.js /home/hugo/trading-journal-smoke` **OK**.

**Deploy.** `main.js 03e6849c5da6c0e08d74679fd394d91e`,
`styles.css 05c4c547071b1027cfb57182dbf42895`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`; `data.json` **não copiado**
(`5e305272d0665dd24db01a64c75ab274`).

## §2.83 Trade Log — gaveta em pills, bulk só com palavras, cabeçalho do dia (19 Set)

O trader: «ainda não ficou igual ao mockup que foi criado, eu queria dessa maneira para
depois continuar». Referência: `previews/tradelog-revamp-v1.html` (variante A). Repostas
fechadas no mesmo passo: a coluna **Review fica com o tick ✓/○** («ainda não sei como vamos
implementar essas cenas para o automatic review system») e a **gaveta é literalmente como o
mockup** (linhas de pills, não dropdowns). A coluna de rail/dot existe na implementação e
não no mockup — fica.

**Gaveta de filtros — linhas de pills (`src/views/tradeLogView.ts`).** Os helpers `sel()`
(que montava o dropdown da casa) e `multi()` (que criava `.tj-tl-picks`) saem; entram
`section()` (`.tj-tl-dsec` + `.tj-tl-dsec-t`) e `pills()` (`.tj-tl-opts` → `.tj-tl-opt`
com `.on`). As secções mantêm a função de cada filtro — What I traded (account picker +
par **Include/Exclude** em `.tj-tl-incl` + ticker), How it went (Result · Direction · R),
When (Session), Was it done properly (Strategies · Mistakes · Missing) — e o vazio de cada
lista diz-se em `.tj-tl-optnone`. O botão do rodapé passa a **`.tj-tl-drawer-show`**
(`Show N trades`); o `Clear all` mantém-se.

**Bulk bar — só palavras.** O helper `act()` deixa de receber ícone e de desenhar o
`span.tj-btn-icon`; os botões são texto (`.tj-tl-bulkbtn` mais baixo e em `--tj-fs-small`).
Os quatro pickers (Strategy…, Rating…, Account…, More…) ficam, mas com o aspecto `prim` do
mockup (`.tj-tl-bulkpick .tj-mg-dd-btn` com borda hairline e texto normal). O cartão passa a
`rgba(255,255,255,.022)` com borda `color-mix(accent 35%, border)` e raio 10.

**Barra e fila.** `.tj-tl-periodbar` passa a **segmented control** (borda + raio 8, botões
sem borda, activo em `rgba(255,255,255,.06)`); o campo de busca perde a caixa e fica numa
**hairline por baixo**; os chips de filtros activos deixam de ser pílulas e passam a **texto
com `border-bottom`** (o × mantém 24×24, exigência do audit). Os chips de atenção ganham o
**ponto âmbar de 6px** via `::before` de `.tj-attn-chip`, altura 27px e realce âmbar no
`:hover`/`.is-on`.

**Cabeçalho do dia.** As réguas de largura total dão lugar a **hairlines curtas de 26px**
(`.tj-tbl-dayrule { flex: 0 0 26px }`), a pill perde fundo e borda e o rótulo desce a
`--tj-fs-label`; o contador de trades passa a tag (raio 5, `rgba(255,255,255,.07)`).

**Limpeza.** Mortos no CSS: `.tj-tl-picks`, `.tj-tl-pick` (+`:hover`/`.on`),
`.tj-tl-bulkbtn .tj-btn-icon svg`, `.tj-attn-chip .tj-btn-icon svg`. `.tj-tl-picknone`
fica (o account picker ainda o usa). Um erro de `tsc` na chamada `act("Clear", …)` foi
corrigido.

**Prova de gate.** `npm run build` exit 0 · smoke **142 PASS / 0 FAIL** ·
`node tools/ux-audit.mjs` só a dívida de base (contrast 0; literal px 3 off-scale;
parent-relative 0; off-scale weights 0; tight line-heights 0; small targets 5 —
`.tj-td-status-dot`, `.tj-td-review-dot`, `.tj-start-dot`, `.tj-export-checkbox`,
`.tj-pq-remove`; faint 0) · `node folder-check.js` **OK** ·
`node tradelog-perf.js /home/hugo/trading-journal-smoke` **OK**.

## §2.84 Review do Trade — layout em cartões, fiel ao mockup 1.html (19 Set)

O trader reviu o deploy em Obsidian: «a estrutura da UI está completamente errada, não se
parece nada com o mockup». Referência: `previews/1.html`. Repostas fechadas antes do
trabalho: títulos dos cartões em **inglês** (a UI é inglesa) — *Execution & Risk*,
*Critical Review & Psychology*, *Screenshots & Visual Analysis*; o conjunto de psicologia a
semear é o proposto (`Confident · Anxious · Impatient · Revenge · Disciplined`); *Enlarge* é
um **lightbox na própria página**. A reforma é de estrutura e CSS; os dados não mudam.

**Cartões em vez de lista vertical (`src/views/tradeDetailView.ts`).** Novo helper
`panelCard(host, title)` — `.tj-td-panel` / `-head` / `-title` / `-body` — que embrulha
cada grupo. A coluna esquerda (`grid-template-columns: minmax(320px,440px) minmax(0,1fr)`,
quebra a 900px) tem dois cartões: **Execution & Risk** (P&L hero, pontos, R, hold, entry/exit
time, entry/exit, contratos, símbolo, direção, stop, target, R:R, risco $, fees, order type,
sessão, max position) e **Critical Review & Psychology** (Reviewed → Strategy → Rating →
chips de tags → notas, pela ordem do mockup). O velho `front`/flip-card desapareceu; todos os
`editableRow`/`row` passaram a ter `execCard` como anfitrião. A coluna direita é o cartão
**Screenshots & Visual Analysis** (a contagem de prints vive no título).

**Screenshots — quick-tags fora, tile no fim, enlarger.** As quick-tags `1m`/`5m`/`15m`/`HTF`
**saem** (só fica o input livre *Name this print…*). O cabeçalho tem o título à esquerda e
apenas *Annotate* + *Enlarge* à direita; `openPrintLarge(file)` monta um lightbox
`.tj-td-lightbox` (`position:fixed`, `inset:0`, z-index 1200) que fecha com clique ou Escape
(`_lightboxCleanup` remove o listener; o `onClose` também faz o teardown e limpa o paste dos
`.tj-td-dropzone, .tj-td-shot-add`). A imagem principal fica contida num wrapper escuro de
380px (`object-fit:contain`, `overflow:hidden`) e **clicar amplia** (substitui o antigo clique
de anotar). As thumbnails passam a **strip horizontal** (`flex-wrap:nowrap`, `overflow-x:auto`,
`flex:0 0 auto; width:104px`) e o **+ Add Print** deixa de ser a barra full-width
(`.tj-td-dropzone.compact`) e passa a um **tile quadrado tracejado no fim da strip**
(`.tj-td-shot-add` — 104px, `border:1px dashed`, ícone `plus` + label). No estado vazio o
cartão inteiro continua a ser a dropzone. Todo o wiring de ficheiro/clique/drag/Ctrl+V passou
a apontar ao genérico `addTarget`.

**Tags — defaults como sugestões.** `knownTags(key)` passa a semear os defaults antes das
labels já usadas (dedupe case-insensitive, extras ordenadas): mistakes `Hesitation Entry ·
Early Exit · FOMO · Moved Stop · Overleveraged`, psychology `Confident · Anxious · Impatient ·
Revenge · Disciplined`. São **só sugestões** — nunca se escrevem sozinhas — clicáveis para
ligar/desligar, e o input inline continua a aceitar novas. A linha `None yet` saiu (os
defaults garantem sempre sugestões).

**Limpeza de CSS morto** (0 referências em `src/`): `.tj-td-stats/-stat*`,
`.tj-td-dropzone-card/-header/-title`, `.tj-td-dropzone.compact`,
`.tj-td-dropzone-add-label`, `.tj-td-review-card*`, `.tj-td-status-dot`,
`.tj-td-rating-section`, `.tj-td-tagempty`, família flip-card
(`.tj-td-flip-card/-face/-ffront/-fback/-flipbtn`), `.tj-td-shot-lab*`, legado v4/v5
(`.tj-td-kpi-card`, `.tj-td-setup-card`, `.tj-td-ctx-*`), `.tj-td-mic`,
`@keyframes tj-pulse` e o `@keyframes tjFlipIn` do trade detail. As três regras
`.tj-app .tj-td-cols > *` (superfície translúcida/blur) passaram a `.tj-app .tj-td-panel`.
KEPT: `.tj-td-flip-row/-key/-val/-input`, `.tj-td-shot-carousel/-annotate/-remove`,
`.tj-td-stars/-star/-star-glyph` (ainda usados por `tradeModal.ts`).

**Prova de gate.** `npm run build` exit 0 · smoke **142 PASS / 0 FAIL** ·
`node tools/ux-audit.mjs` só a dívida de base (contrast 0; 3 px off-scale —
2 no `.tj-pq-*` + 1 a 20px; parent-relative 0; off-scale weights 0; tight line-heights 0;
small targets 4 — `.tj-td-review-dot`, `.tj-start-dot`, `.tj-export-checkbox`,
`.tj-pq-remove`; faint 0) · deploy vault-dev com md5 verificado dos três ficheiros
(`main.js 1398906f`, `styles.css 4e4f649b`, `manifest.json 4395b22f`); `data.json` não
tocado. Ctrl+R pedido.

## 2.85 Review do Trade — densidade e barra-hero (BE, 21 Set 2026)

A queixa era de densidade, não de estrutura. Corrigido:

- `.tj-td-hero` nova — título (`symbol · side`, `date, entryTime`, chip de estratégia)
  e três métricas à direita (Hold Time · Points · Net P&L); as linhas Net P&L, Points e
  Hold Time saem do cartão *Execution & Risk* (R-Multiple fica).
- Grid: `gap:20px`, `align-items:start`, `.tj-td-right{align-self:start}`, empilhamento
  a `960px` (era 900px).
- Densidade: panel padding 14, panel-head margin 8, flip-row `4px 0`, field margin 10,
  field-label margin 6, textarea `8px 10px`/min-height 64, chips/estrelas mais justos,
  `.tj-td-head` margin 14/padding 12.
- Execuções: stat-cards (`.tj-td-execs-cards`/`.tj-td-execcard*`) removidos do view e do
  CSS; bloco a `margin:14px 0 4px`; tabela full-width sob o grid.

Prova: `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` só dívida de base
(contrast 0; 3 px off-scale — 2 no `.tj-pq-*` + 1 a 20px; parent-relative 0; off-scale
weights 0; tight line-heights 0; small targets 4 — `.tj-td-review-dot`, `.tj-start-dot`,
`.tj-export-checkbox`, `.tj-pq-remove`; faint 0) · deploy vault-dev com md5 verificado
(`main.js b9d16ed1`, `styles.css 698bc82e`, `manifest.json 4395b22f`); `data.json` não
tocado. Ctrl+R pedido.

## 2.86 Review do Trade — cartões v2: hero com badges, tags toggle, execuções (BF, 21 Set 2026)

Fidelidade ao mockup `previews/1.html` e fim do vocabulário "append-only" das tags:

- **Hero**: `.tj-td-hero-sym` passa a ser só o símbolo; entram o badge de direção
  `.tj-td-hero-dir.is-long/.is-short` (verde/vermelho por token) e o badge de estado
  `.tj-td-hero-status` (âmbar *Needs Review* → verde *Reviewed*, clicável, com `attachTip`);
  `.tj-td-hero-title` alinha ao centro com wrap, `.tj-td-hero-metric` alinha ao fim.
- **Reviewed**: a linha `Reviewed` do cartão *Critical Review & Psychology* **sai** — o
  estado vive no badge do hero (o cartão começa na Strategy).
- **Tags**: `tagSection` passa a desenhar **um só chip por label** a partir de
  `normalizeTags([...knownTags(key), ...tags])`, com estado `.is-on` e clique a alternar
  (liga/desliga); as sugestões tracejadas `.tj-td-tagsug` e o botão × `.tj-td-tagx`
  desaparecem do código e do CSS. Os defaults (5 mistakes do mockup + 5 psychology) ficam
  sempre visíveis como sugestões desligadas; o input inline de tags novas mantém-se.
- **Execuções**: `renderExecutions` passa a ser um cartão da casa
  (`.tj-td-panel.tj-td-execs` + `.tj-td-panel-head` + `.tj-td-panel-title`) e os badges de
  fill ganham tinta por lado (`.is-entry` verde / `.is-exit` vermelho; `.is-flat` muted).
- **Grid**: base `minmax(320px,440px) minmax(0,1fr)`, faixa intermédia
  `@media (max-width:1399px) and (min-width:901px)` com `minmax(300px,360px)`, e stack a
  `900px` (o bloco antigo a `960px` sai).
- **Viewer**: `.tj-td-shot-main` passa a `height: clamp(260px, 32vh, 380px)`.

Prova: `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` só dívida de base
(contrast 0; 3 px off-scale — 2 no `.tj-pq-*` + 1 a 20px; parent-relative 0; off-scale
weights 0; tight line-heights 0; small targets 4 — `.tj-td-review-dot`, `.tj-start-dot`,
`.tj-export-checkbox`, `.tj-pq-remove`; faint 0) · deploy vault-dev com md5 verificado
(`main.js d6b827af`, `styles.css cc154c34`, `manifest.json 4395b22f`); `data.json` não
tocado. Ctrl+R pedido.

## 2.87 Review do Trade — harness `tradedetail-check.js` (BG, 21 Set 2026)

Novo harness `~/trading-journal-smoke/tradedetail-check.js` — 27 asserções contra o DOM
real (jsdom) e o `styles.css` real injetado. Corrigiu o que faltava para o mockup:

- **Hero**: badges com as classes do mockup — direção em `.tj-td-hero-badge.is-long/.is-short`
  e estado de review em `.tj-td-hero-badge.is-status.is-needs-review/.is-reviewed` (o antigo
  `.tj-td-hero-status.is-done` saiu); a barra tem exatamente 3 `.tj-td-hero-metric`.
- **Campos movidos**: **Entry Time** e **Exit Time** saem do `.tj-td-panel-body` (o tempo
  vive no hero; `zoneShortLabel` fora do import). **Target** e **Order Type** passam a viver
  num `<details class="tj-td-more">` no fim do cartão (`summary.tj-td-more-sum`,
  `.tj-td-more-body`).
- **Screenshots**: o palco ganha `.tj-td-shot-badge` (etiqueta escura no canto, como o
  `.screenshot-badge-label` do mockup); thumbnails passam de flex a
  `grid repeat(auto-fill, minmax(110px, 1fr))` e o tile `+ Add Print` perde a largura fixa
  e flui na grelha; a thumbnail ativa fica verde (`--color-green-bright, #34d17a`).
- **Grid**: base `.tj-td-cols` a `440px minmax(0, 1fr)`.

Prova: harness **27/27 PASS** · `npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit`
só dívida de base (contrast 0; 3 px off-scale; parent-relative 0; off-scale weights 0; tight
line-heights 0; small targets 4; faint 0) · deploy vault-dev com md5 verificado
(`main.js 0bfeb891`, `styles.css 39c4aa20`, `manifest.json 4395b22f`); `data.json` não
tocado. Ctrl+R pedido.

## 2.88 Trade Detail v2 — layout responsivo (BI, 21 Set 2026)

> Nota de numeração: o pedido dizia §2.86, mas §2.86 (BF) e §2.87 (BG) já existiam;
> esta entrada é a §2.88.

O `TradeDetailView` fecha a passagem ao mockup `previews/1.html` com layout responsivo
a sério e o harness que o prova.

- **Hero**: vive no **corpo** (não no header sticky), como cartão — símbolo, data/hora,
  badge de direção (`.tj-td-hero-badge.is-long/.is-short`), badge de estado de review
  (`.tj-td-hero-badge.is-status.is-needs-review/.is-reviewed`, clicável, `attachTip`) e
  **exatamente 3** `.tj-td-hero-metric` (Hold Time · Points · Net P&L). O header fica só
  com navegação e ações, pelo que não conta altura fixa em ecrãs pequenos.
- **Grid**: `.tj-td-cols` com três breakpoints (abaixo); o rail esquerdo empilha
  *Execution & Risk* → *Critical Review & Psychology*, a coluna direita é
  *Screenshots & Visual Analysis* alinhada ao topo.
- **Ordem em ecrã pequeno**: hero → screenshots → review → execução → fills (prioridade,
  não ordem arbitrária — `UX-GUIDELINES.md` §5.2).
- **Clamp**: `.tj-td-shot-main` a `height: clamp(260px, 32vh, 380px)`; nenhuma regra
  `.tj-td-*` fixa `height: 380px`.
- **Campos movidos**: **Entry Time**/**Exit Time** saem do cartão (vivem no hero);
  **Target** e **Order Type** dobrados em `<details class="tj-td-more">`.
- **Chips de tags**: defaults semeados sempre visíveis e **toggle ligado/desligado**
  (`.tj-td-tagchip` + `.is-on`, mistakes tingidos por `.tj-td-tags--mistakes`), mais
  `＋ Add tag` inline; `.tj-td-tagsug`/`.tj-td-tagx` removidos.
- **Grelha de thumbnails**: `.tj-td-shot-thumbs` em `grid repeat(auto-fill, minmax(110px, 1fr))`,
  thumbnail ativa contornada a verde (`--color-green-bright, #34d17a`), `.tj-td-shot-badge`
  no palco e o tile `+ Add Print` tracejado a fluir na grelha.
- **Execuções**: cartão da casa com badges por lado (ENTRY verde / EXIT vermelho /
  break-even muted).

### Breakpoints

| Largura  | Layout                                        |
|----------|-----------------------------------------------|
| ≥1400px  | 2 colunas: rail 440px + painel elástico        |
| 900–1399 | 2 colunas: rail 360px + painel elástico        |
| <900px   | 1 coluna empilhada por prioridade              |

### Harness

Novo `~/trading-journal-smoke/tradedetail-check.js` (jsdom + `main.js` + `styles.css`
injetado): **31/31 PASS** — hero e badges, os 3 breakpoints, `clamp()`, chips com toggle
(sem escrever na vault), grelha de thumbnails + ativa verde, badges de execução por lado
e os campos movidos.

### Prova

`npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` só dívida de base
(contrast 0; 3 px off-scale; parent-relative 0; off-scale weights 0; tight line-heights 0;
small targets 4; faint 0) · `tradedetail-check.js` **31/31 PASS** · `fills-check.js` OK ·
deploy vault-dev com md5 verificado (`main.js 0bfeb891343beb2d38ded1158457d803`,
`styles.css 39c4aa208e6c1450c6e6cb2d44310853`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não tocado.

### Teste manual pendente (3 tamanhos)

Redimensionar o painel do Obsidian e confirmar a leitura por prioridade:

- **1440px** — duas colunas, rail 440px; hero e 3 métricas numa linha.
- **1280px** — duas colunas, rail 360px; hero ainda numa linha.
- **900px** — uma coluna: hero → screenshots → review → execução → fills; o header não
  ganha altura fixa.

## §2.89 Review engine v2 + Trade Detail v3.3 (22 Set 2026)

> Nota de numeração: o pedido dizia §2.86, mas §2.86 (BF), §2.87 (BG) e §2.88 (BI) já
> existiam; esta entrada é a §2.89.

O motor de review tinha três avarias somadas: campos que se actualizavam sozinhos, campos
ignorados e a flag manual "sticky". Esta passagem fecha as três e reconstrói o Trade Detail
ao mockup `previews/trade-detail-v3.html`.

### Parte A — Review engine v2 (dois níveis)

- **Modelo**: `Trade.psychologyAcknowledged` e `Trade.mistakesAcknowledged` (opcionais,
  `undefined` por omissão). `storage.ts` emite `psychology_acknowledged: true` /
  `mistakes_acknowledged: true` **só quando true** e lê-os de volta; notas antigas sem os
  campos comportam-se exactamente como antes.
- **`lib/review.ts`**: o `ReviewStatus` passa a ter dois níveis. **Required** (decidem
  `complete`): Screenshot · Strategy · Review · Rating. **Optional** (nunca bloqueiam):
  Psychology State · Execution Mistakes — cada um fica `done` com ≥1 tag **ou** com a
  acknowledgement explícita. `complete = requiredDone === 4 && reviewed !== false`, pelo que
  `reviewed === true` deixou de ser override absoluto (limpar um campo required volta a
  pôr a trade incompleta) e `reviewed === false` continua a forçar incompleta. Uma trade
  sem psicologia e sem mistakes, sem acknowledgement, **continua completa** (o journal
  reporta, nunca impõe). `checks` leva as 6 entradas com `required`; `done`/`total` contam
  0..6, `requiredDone`/`requiredTotal` contam 0..4, `label` é `"Complete"` ou `"N/4"` e
  `missing` lista só os required. Novo `optionalSummary(t)` — `"5 psychology · 3 mistakes"`,
  `"no mistakes"`, `"no psychology"` ou `""` (singulariza `1 mistake`).
- **Consumidores**: `tradeDetailView` (4 dots filtrados a required + linha de summary por
  baixo + botões `.tj-td-ack` que persistem via `saveAck`), `tradeLogView` e `dashboard`
  falam todos por `reviewStatus(t).complete` / `reviewSummary` (API mantida). Ligar um chip
  de mistake desliga a acknowledgement sozinho — a trade está a registar um erro, não a
  dizer que não houve.

### Parte B — Trade Detail v3.3

- **Hero numa linha**: `.tj-td-hero-title-group` (título `SYMBOL · Long`, data/hora, badges
  `is-long`/`is-short` e `is-status.is-reviewed`/`.is-needs-review`) + `.tj-td-hero-metrics`
  (`margin-left:auto`) com **3 métricas**: Net P&L · Points · Hold Time. Fallback a 720px
  (métricas em linha própria com hairline). Saem `.tj-td-hero-sym`/`-dir`/`-status`.
- **Grid**: base `400px minmax(0,1fr)` `gap:12px`; `@media (max-width:1399px)` `340px`;
  `@media (max-width:900px)` `1fr`.
- **Execution & Risk**: R-Multiple (`.is-hero`) · Entry → Exit (cada preço editável) ·
  Contracts · Stop / Risk · Session · Fees; `<details class="tj-td-more">` com Target ·
  Planned R:R · Order Type · Max position · Fill count.
- **Strategy + Rating** em `.tj-td-two-col` (`1fr auto`), estrelas soltas (`.tj-td-star`
  sem caixa, hover 1..N, clique na mesma estrela limpa) e chips `.on` (psicologia acento,
  mistakes `.is-mistake` vermelho) com `.tj-td-ack` tracejado que fica verde quando ligado.
- **Screenshots**: viewer `clamp(180px, 28vh, 280px)`, badge no canto, grelha
  `repeat(auto-fill, minmax(110px,1fr))`, thumb activa com `2px solid` verde, tile
  `+ Add Print` tracejado. Execuções mantêm os badges ENTRY verde / EXIT vermelho.
- **CSS**: regras v3.3 em `styles.css`; removidos `.tj-td-tz`, `.tj-td-stars-inline`,
  `.tj-td-flip-row-rating` e o selector `.tj-td-stat-value` do privacy. Verificado por
  `rg`: **0 classes `.tj-td-*` sem consumidor em `src/`**. Sem código morto.

### Harness

Novo `~/trading-journal-smoke/review-check.js` (jsdom + `main.js`, trades sintéticas em
memória, readers do plugin stubados e paths sempre a falhar — **nada é escrito na vault**):
**10 cenários / 32 asserções PASS** — required-only completo com summary vazio; chips
(1 psychology · 1 mistake); acknowledgements ("no psychology" · "no mistakes");
`reviewed=true` com screenshot em falta → incompleto; `reviewed=false` → incompleto;
optional vazio → completo; limpar chips muda o summary e mantém `complete`; clicar um chip
de mistake desliga a acknowledgement (DOM real); `reviewStatus()` é o veredicto único dos
três consumidores (badge do detalhe, summary do dashboard, filtro do Trade Log); e notas
antigas sem os campos novos (`undefined`, comportamento inalterado).

### Prova

`npm run build` 0 · smoke **142 PASS / 0 FAIL** · `ux-audit` só dívida de base
(contrast 0; 3 px off-scale; parent-relative 0; off-scale weights 0; tight line-heights 0;
small targets 4; faint 0) · `review-check.js` **10/10 cenários (32 asserções)** ·
`tradedetail-check.js` **31/31** · deploy vault-dev com md5 verificado
(`main.js 92fb4d8668a5bfb5b581d9acef1f8519`,
`styles.css 20832dc8afa734fe97926632d40ce1ca`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não tocado.

### Notas de harness

- `smoke.js`: duas asserções actualizadas ao contrato novo — `partial.total` 4→6 e o
  fixture de `accountMetrics` (as trades com `reviewed:true` passam a precisar dos 4 campos
  required para fechar). Sem elas o gate ficava 141/1.
- `tradedetail-check.js`: base grid 440→400px e chips `.is-on`→`.on` (renomeado em v3.3).

## §2.90 Print Annotator — seta com pontos livres + edição de pontos (22 Set 2026)

O annotator (`src/views/printAnnotator.ts`) troca o modelo *curve type* da seta por polilinha
de pontos livres à moda do Excalidraw, e ganha edição de pontos.

### Parte 1 — o curve type sai

- **Removidos**: tipo `ArrowType` (`straight`/`curved`/`elbow`), campo `arrowType?` do
  `Shape`, `currentArrowType` e a secção *Arrow type* da sidebar (a sidebar da seta fica
  só em *Arrowheads* — ←, →, ↔ — que continua a escrever `startArrowhead`/`endArrowhead`).
- **`arrowGeometry(pts)`** é a única fonte de verdade: recebe a lista de pontos da forma,
  suaviza-a com Catmull-Rom→Bézier cúbico (2 pontos = segmento reto) e devolve
  `{ path, points (32/segmento), startAngle, endAngle }`. Desenho (`geo.path(c)`),
  hit-test (`hitsPolyline(geo.points)`) e bbox (`arrowGeometry(s.pts)`) leem todos daqui.
- Os ramos `line` e `arrow` do `drawShape` unificam-se numa só condição; a linha é a
  mesma polilinha sem cabeças. `bboxOf`/`hitTest` passam `arrow` **e** `line` pelo
  mesmo caminho (a linha beneficiou do suavizador quando tiver >2 pontos).
- Sidecar/`loadShapes` deixa de ler `arrowType` (notas antigas com o campo são
  silenciosamente ignoradas — sem migração necessária).
- Verificado por `rg`: **0 ocorrências** de `arrowType|ArrowType|currentArrowType|Arrow type`
  em `src/` e `styles.css` (nunca houve CSS dedicado — os botões usavam
  `.tj-anno-sidebar-btn`, ainda vivo noutras secções).

### Parte 2 — edição de pontos (arrow / line / pen)

- **Entrar**: duplo-clique na forma (seleciona-a e abre os handles) ou tecla `E` com a
  forma selecionada; `E`/`Esc` alternam. **Sair**: clique fora da forma, `Esc` (mantém a
  seleção), troca de tool, apagar a forma, undo que a remova, ou Reset — tudo por
  `exitPointEdit()`.
- **Handles em canvas** (`drawPointHandles`, espaço de ecrã, depois de `drawSelection`,
  **sem CSS novo**): pontos 8px branco com bordo de acento; midpoints 6px com fill
  branco translúcido e bordo tracejado de acento. Hit em `8 / view.scale` unidades canvas,
  pontos avaliados antes dos midpoints (`pointHandleAt`).
- **Interacções**: arrastar um ponto move-no (com origem guardada em `dragOrigPt`, sem
  snap); clicar num midpoint insere um ponto que já nasce agarrado ao pointer; duplo-clique
  num ponto intermédio apaga (extremos preservados); com a tool *select*, o clique dentro
  da forma não arrasta a forma inteira (os handles estão vivos) e o pointerdown/pointermove
  de handles é interceptado antes dos ramos de draw/move/resize.
- `dblclick` fora do modo de edição, em forma não editável, não faz nada.

### Prova

`npm run build` 0 · smoke **142 PASS / 0 FAIL** · `review-check.js` **OK** ·
`tradedetail-check.js` **OK** · `node tools/ux-audit.mjs` → **`no normative violations
found`** (contrast 0; os 2 lit. de 9px de `.tj-pq-time`/`.tj-pq-remove` corrigidos para
`var(--tj-fs-label)`; restante só dívida de base: 2 px off-scale 16/20px, 4 small targets)
· deploy vault-dev com md5 verificado (`main.js 4cd8d28b79e96a450534b2d7348ca9c4`,
`styles.css f732f796f4564650335e5a0e072eff36`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não tocado
(`d0836e261052021b7c5e5713ea3f73f2`).

## §2.91 Export Trade Card — linguagem v3.3 (22 Set 2026)

O cartão de exportação (modal + PNG partilhável) herdava a UI de antes do Trade
Detail v3.3. Reconstruído à linguagem nova mantendo a hierarquia de pôster — o código
vive em `src/views/tradeDetailView.ts`: `showExportPanel()` (modal, toggles, preview
viva) e `buildExportCanvas()` (tudo o que é desenhado no canvas 1080px).

### O que mudou no cartão

- **Badge de estado (FIX 1)**: `reviewStatus(t).complete` → `REVIEWED` (verde
  `#34d17a`) / `NEEDS REVIEW` (`--tj-tone-mid` `#d9a441`), pílula preenchida com a
  mesma tipografia/padding da LONG (18px bold, +28 de largura, h38/r19, tinta 12%),
  canto superior direito do hero. "Review Pending"/"Review Complete" saíram.
- **Stop / Risk consolidado (FIX 2)**: os 4 campos (Stop · Target · Risk $ ·
  Contracts) passam a 3 por linha — `Stop / Risk` = `{stop} / ${risk}` com
  `risk = |entry − stop| × pointValue × qty` a `toFixed(0)` (mesmo cálculo do
  detalhe); sem stop ou sem entry → `— / —`. **Hide P&L** continua a esconder o
  risco: `{stop} / —`. Target e Contracts como campos próprios.
- **Estrelas soltas (FIX 3)**: ★ diretas no fundo do canvas — 26px, gap 6px,
  cheias `#f5b301`, vazias `rgba(255,255,255,0.15)`; sem caixas. `drawStarCanvas`
  removido (ficava sem chamadas).
- **Badges no topo (FIX 4)**: ordem no hero = LONG/SHORT (tinta 12% verde/vermelho)
  → estratégia (pílula neutra: hairline + `rgba(255,255,255,0.04)`, texto
  `--tj-fg-3`, só quando `t.setup` não está vazio) → estado ao fundo à direita.
  Data · entry time · sessão descem para a 2ª linha a 16px (o setup saiu da linha
  de meta — agora é badge).
- **Statline sem caixas (FIX 5)**: os 4 KPIs (Net P&L · Points · R-Multiple · Hold
  Time) deixam as caixas `#181818` e passam a colunas separadas por hairlines
  verticais `rgba(255,255,255,0.08)`; label 10px uppercase, número 32px bold;
  Net P&L com verde/vermelho por sinal, os outros `#dcddde`. Hide P&L continua a
  retirar a coluna Net P&L.
- **Psychology & Mistakes (FIX 6)**: toggle novo no grupo *Data* (default off,
  `opts.psychology`); quando ligado e com tags, desenha abaixo do rating e acima
  das notas — label 10px uppercase + chips pílula hairline 12px com gap 4px
  (psychology com o accent `--interactive-accent` resolvido via
  `getComputedStyle`, mistakes com `--color-red-bright`). Sub-secção vazia salta;
  ambas vazias, a secção inteira salta. Altura pré-medida (`chipRowsOf`, wrap em
  `maxTextW`) como as notas — a preview refresca pelo handler genérico dos toggles.
- **Watermark (FIX 7)**: "Tradebook" no canto inferior saiu do canvas e o
  `totalH += 52` correspondente também.
- **Fundo (FIX 8)**: `#0d0d0d` fixo, mantido.

### Intocáveis

Botões PNG/JPG/Copy, largura 1080, encaixe/borda do screenshot, reset para
defaults, e os toggles pré-existentes (incluindo a desc do *Stats*, que não foi
tocada). `styles.css` não mudou — o toggle novo reutiliza `.tj-export-option*`.

### Prova

`npm run build` 0 · smoke **142 PASS / 0 FAIL** · `review-check.js` OK ·
`tradedetail-check.js` OK · `node tools/ux-audit.mjs` → **`no normative violations
found`** · deploy vault-dev com md5 verificado (`main.js 9a8fa24ed9ff9db72a3374ed6657fe85`,
`styles.css f732f796f4564650335e5a0e072eff36`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não tocado
(`d0836e261052021b7c5e5713ea3f73f2`).

## §2.92 Export Trade Card — polish A/B/C (22 Set 2026)

Três passes de alinhamento v3.3 sobre `buildExportCanvas()` em
`src/views/tradeDetailView.ts` (o modal não mudou — `styles.css` intocado).

### A — Hero ao idioma v3.3

- Título único `"MES · Long"` / `"MES · Short"` (42px bold, `ctx.letterSpacing =
  "-0.01em"`, `#f0f1f2`), badge de direção e badge de estratégia logo a seguir
  (mesmas receitas de hoje); o badge de estado (**REVIEWED** / **NEEDS REVIEW**)
  fica **alinhado à direita** na mesma linha do título — segui o bullet *Layout*
  do pedido («right edge of the card»), que é o explícito sobre placement, em
  vez do diagrama ASCII (que o mostrava encostado).
- 2ª linha só data + hora: `formatDate(t.date, settings.dateFormat), entryTime`
  (ex. `2026-08-20, 10:06:02`), 16px `#8a9099`; **a sessão sai do hero**.
- Altura do header: 120 → 100.

### B — Estrelas maiores

- ★ passam a path de 5 pontas com **raio exterior 10px** (20px de diámetro,
  medida determinística — o glifo ★ a 26px de fonte só media ~14px visuais),
  gap 8px, cheias `#f5b301`, vazias `rgba(255,255,255,0.15)`, sem caixas.
- Label `EXECUTION RATING` a 10px uppercase `--tj-fg-3` (estylo das labels de
  Psych/Statline). Bloco: 70 → 54.

### C — Hairlines de secção + Session

- Hairlines 1px `rgba(255,255,255,0.06)` com inset `PAD` em todos os pares:
  hero↔screenshot (1) e screenshot↔stats (2) já existiam; **novo** (3)
  statline↔fields dentro do bloco stats; (4) fields↔rating = separador
  trailing do stats; (5) rating↔psych e (6) psych↔notes mantidos. O separador
  de notes deixa de olhar para `opts.stats` (o stats já termina em hairline —
  acaba a linha dupla que existia entre fields e notes).
- **Fields row** ganha a 4ª coluna **Session**: `sessionLabel(t, zone)` com
  `SESSION_UNKNOWN` (ou vazio) a `—`. Import novo: `sessionLabel`,
  `SESSION_UNKNOWN` (sessions) e `formatDate` (dates); `SESSION_LABELS` saiu
  do import (ficava sem uso no ficheiro — o hero já não o lê; `sessionOf`
  continua vivo no dropdown da linha 584).

### Prova

`npm run build` 0 · smoke **142 PASS / 0 FAIL** · `review-check.js` OK ·
`tradedetail-check.js` OK · `node tools/ux-audit.mjs` → **`no normative
violations found`** · deploy vault-dev com md5 verificado
(`main.js 4e3d77c71b7d233c39b728c3086bc954`,
`styles.css f732f796f4564650335e5a0e072eff36`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não tocado
(`d0836e261052021b7c5e5713ea3f73f2`).

## §2.93 Export Trade Card — Notes v3.3 substitui Thesis/Review/Improvements (22 Set 2026)

O cartão de exportação ainda espelhava os três campos de texto livres antigos.
Na v3.3 do Trade Detail todo o texto vive num só campo *Notes* (e as mistakes em
`mistake_tags`, com fallback ao string legado) — o export passa a dizer o mesmo.
Tudo em `src/views/tradeDetailView.ts` (`showExportPanel` + `buildExportCanvas`);
`styles.css` intocado (o toggle reutiliza `.tj-export-option*`).

### Toggles e conteúdo

- **Saem** *Thesis*, *Review* e *Improvements* da lista de toggles e do canvas:
  chaves `thesis`/`review`/`mistakes` removidas do `opts`, da assinatura de
  `buildExportCanvas` e das branches que desenhavam as três secções
  (`noteItems` eliminado — greps `noteItems`, `opts.thesis|review|mistakes`,
  `toggleThesis|toggleReview|toggleImprovements` a 0 em `src/`).
- **Entra** *Notes* ("What you wrote on the trade"), default OFF, único item do
  grupo *Review Notes*. *Visual*, *Data* e *Privacy* ficam como estavam.
- **Fallback** (primeiro não-vazio): `t.notes` → `t.review` → `t.thesis`. Nada
  não-vazio? A secção não desenha, mesmo com o toggle ligado — sem heading vazio.
- **Formato**: label `NOTES` 10px uppercase `#8a9099`, corpo 14px `#dcddde`
  quebrado pelo `wrapText` já existente (font 14px no `tempCtx` antes de medir).
  `lineH` 24→20; bloco = `24 + linhas×20 + 16` (draw e `totalH` iguais).
- O separador antes das notas continua `showPsych || opts.rating` (stats e
  screenshot já terminam em hairline) — o par psych↔notes (hairline 6) mantém-se.

### Mistakes — fallback legado

`mistake_tags` é a fonte v3.3; se a lista ficar vazia e `t.mistake` (string
legada) não estiver vazia, o string entra como **um único chip** na secção
Psychology & Mistakes. Psicologia continua a ler só `psychology_tags`.

### Prova

`npm run build` 0 · smoke **142 PASS / 0 FAIL** · `review-check.js` OK ·
`tradedetail-check.js` OK · `node tools/ux-audit.mjs` → **`no normative
violations found`** · deploy vault-dev com md5 verificado
(`main.js 7c187afc78dc42ed25c2c06db3b4559f`,
`styles.css f732f796f4564650335e5a0e072eff36`,
`manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não copiado
(mudou entretanto por interação no Obsidian: `93e0c331f8ea80b9de111ed55f7468d6`).

## §2.94 Points = a maior saída real da entrada — qty fora, BE fora, TP1/TP2 (22 Set 2026)

**Regra.** Points de uma trade = a maior distância entre o preço de entrada
(média ponderada) e qualquer preço de saída em que o trader **fechou mesmo**.
Quantidade nunca multiplica; saída break-even não conta; nada de "what could
have been" — só os fills que existem. LONG: `max(saidas não-BE) − entrada`;
SHORT: `entrada − min(saidas não-BE)`; tudo BE (ou sem saídas) → 0; trade sem
fills guardados (entrada+saída únicas) → `|saída − entrada|` com o sinal da
direção, e essa saída **nunca** é BE.

**O bug.** O exemplo do relatório (entrada 7 669, TP1 7 672 ×5, TP2 7 669.25 ×5
= BE) media **+16.25** porque o valor era o P&L em $ partido pelo point value —
`(3.00×5 + 0.25×5)×2 / 2` — ou seja, os pontos já embutiam os contratos. Com a
regra nova: **+3.00** (só o TP1 conta).

### Código

- **`src/lib/fills.ts`** (fonte única):
  - `isBreakEven(f, entry, pointValue)` — não há flag BE no `TradeFill`;
    testa **distância ≤ 0.5 pt à entrada E `|fill.pnl| ≤ max(0.01, 0.5·pv·qty)`**
    (o "very close to 0" em dólares vale a meia ponto daquele contrato).
  - `pointsOf(direction, entry, exits, pv, explicit)` — a fórmula acima;
    `explicit = false` (sem fills guardados) ⇒ a única saída nunca é BE.
  - `tradePoints(t)` — `fillSet` + `futuresSpec(t.symbol)`.
  - `fillLabel(f, i, set, pointValue=0)` — saídas: `TP1/TP2/…` só sobre as
    **não-BE** (em ordem), BE → `"BE"`, saída única → `"exit"`; entradas
    ficam `entry` / `entry N`. `applyFillsToTrade` passou a regenerar
    `t.pnlPoints`. Hook `window.__tjFills` expõe os três.
- **Escritores**:
  - `csv.ts` `pairRoundTrips` — `points = gross / spec.pointValue` **saiu**;
    passou a `pointsOf(pos.dir, avgEntry, exitFills, pv, explícito⇔fills
    guardados)` (mesma condição que decide se a nota guarda os fills).
  - `addTradePanel` (`paint` + `doSave`) — `pts * qty` → `pts`.
  - `copy.ts` `buildLeg` — `grossPnl` e `pnlPoints` da perna usam
    `tradePoints(base)`; o branch `hasPoints` continua a ler o valor guardado
    (o smoke "points missing" continua a cair no path net: `100` ✓).
- **Leitura/display**: `storage` lê `pnl_points` como dantes; recomputa **em
  memória** quando a trade tem fills — `main.loadTrades` (nota única + loop) e
  `TradeDetail.setTrade` — sem escrever a nota (só o edit do utilizador grava).
- **Execuções** (`tradeDetailView.renderExecutions`): label por fill via
  `fillIndex` (antes usava `set.fills.indexOf` → off-by-one `T2` na 1.ª
  saída); BE → tag `BE` + `is-flat`, **Points 0** na linha; linha **Total**
  mostra `trade.pnlPoints` (antes `—`). Ledger (`tradeTable.drawFillRow`)
  usa a mesma `fillLabel` com `pointValue`.

### Prova

- `npm run build` 0.
- smoke **142 PASS / 0 FAIL** · `review-check.js` OK · `tradedetail-check.js` OK.
- **`fills-check.js` OK** — expectativas actualizadas para a regra:
  `entry | TP1 | TP2`; linha de saída `TP1`; runner `BE` sem número TP3;
  trade page tem `TP2`; Total `+18.00`; `tradePoints` = 18 (scaled), 20
  (runner, BE excluído), 0 (tudo BE).
- `node tools/ux-audit.mjs` → **`no normative violations found`**.
- `ledger-check` / `tradelog-check` / `numbers-check` **falham já com o
  `main.js` anterior** (`7c187afc…`) — drift pré-existente, não desta tarefa.
- Deploy vault-dev md5 verificado (`main.js 134dcdc74852b28d6ad3e2c8c8730482`,
  `styles.css f732f796f4564650335e5a0e072eff36`,
  `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não copiado
  (`93e0c331f8ea80b9de111ed55f7468d6`).

## §2.95 Trade Detail — Target em $, cartão sem colapso, Points sem ×qty, P&L por fill (22 Set 2026)

### O que mudou (FIX 1–7)

- **FIX 1 — Stop/Target com os dois formatos** (`tradeDetailView`): helper
  partilhado `parsePriceOrDollars(raw, "stop" | "target")` — número simples é o
  preço; `$X` é a distância em dollars (`dist = $ / pointValue / qty`), com o
  target no lado vencedor da entrada e o stop no perdedor, arredondado a 2
  casas. Input em text (aceita `$`), placeholder `Price or $ target` /
  `Price or $ risk`; o clique é delegado no `execCard` para
  `[data-field='stopLoss'], [data-field='target']` (cancelar já não deixa um
  span morto). Display do Target: `{fmtPrice(target)} / ${|target−entry| ×
  pointValue × qty}` com `$` a 2 casas; sem target → `— / —`. Grava
  `saveFields({ target: String(price) })` — só o preço é persistido, os $ são
  derivados (`storage` lê/escreve `target` como antes, round-trip verificado:
  `num()` escreve, `get()` des-aspóna).
- **FIX 2 — Execution & Risk sem colapso**: o `<details class="tj-td-more">`
  ("More details") e a linha **Planned R:R** saíram; todas as linhas ficam
  abertas, por ordem: Entry → Exit · R-Multiple · Contracts · Stop / Risk ·
  **Target** · Session · Fees · Order Type · Max position · Fill count. CSS
  morto removido (`.tj-td-more`, `-sum`, `-sum::-webkit-details-marker`,
  `-sum::before`, `[open]`, `-sum:hover`, `-body`); `row()` e `editableRow()`
  continuam consumidos.
- **FIX 3 — Points recomputam mesmo sem fills**: as guards
  `(t.fills ?? []).length` saíram de `main.loadTrades` (os dois ramos) e de
  `TradeDetail.setTrade` → `t.pnlPoints = tradePoints(t)` sempre, em memória.
  **Porque o §2.94 "não colou"**: o valor antigo `57.5` (11.5 pts × 5 qty)
  está escrito na nota real
  `vault-dev/Tradebook/2026/08/trades/25-08-2026 MNQ LONG 0944.md:13`
  (`pnl_points: 57.5`), criado pelo escritor antigo (`addTradePanel`
  `pts * qty` / `csv.ts` `gross / pointValue` — ambos removidos na §2.94); a
  guarda em `src/main.ts:1692`, `src/main.ts:1732` e `setTrade`
  (`tradeDetailView.ts`) só recomputeava trades **com** bloco `fills`, e esta
  nota é scalar — por isso o display mantinha o ×qty. A nota só é reescrita
  quando o utilizador edita; o hero passa a ler `+11.50`.
- **FIX 4 — P&L e fees por fill nas trades scalar** (`fills.ts` `inferred()`):
  a saída inferida passa a carregar `fees = (commission || 0) + (fees || 0)` e
  `pnl = dist_sinal × pointValue × qty − fees` (guard `exit > 0`) — a tabela
  deixa de mostrar `—` no P&L de uma trade fechada e o Total de fees deixa de
  ser `$0.00`. Coluna Points por fill: a distância própria à `avgEntry`,
  sinalizada pela direção (BE → 0; linha de entrada → `—`); qty nunca
  multiplica. Fills explícitos do CSV (pnl gross por contrato) não mudam.
- **FIX 5 — Total Price = avgExit** (`renderExecutions`): a linha Total passa
  de `fmtPrice(set.avgEntry)` para `set.avgExit > 0 ? fmtPrice(set.avgExit) :
  "—"`.
- **FIX 6 — Total Points = o do hero**: já era `t.pnlPoints` (§2.94); com o
  FIX 3 passa a dar `+11.50` na nota de teste (antes `57.5`).
- **FIX 7 — labels de fill**: `fillLabel` perde a branch `exits ≤ 1 →
  "exit"` — a saída não-BE única passa a **TP1**; BE continua `BE`; entradas
  ficam `entry` / `entry N`. O ledger (`tradeTable.drawFillRow`) usa a mesma
  função, por isso as duas superfícies concordam.
- **Nota de teste** (MNQ long 5 @ 29,342 → 29,353.5, fees $9.50): hero
  `+11.50`, fill Points `11.50`, fill P&L `+$105.50`, Total Price `29,353.5`,
  Total Points `+11.50`, tag do fill `TP1`.

### Prova

- `npm run build` 0.
- smoke **142 PASS / 0 FAIL** · `review-check.js` OK.
- **`tradedetail-check.js` OK** — secção `[fields]` reescrita: sem
  `<details>`, sem "More details", sem "Planned R:R"; as 10 linhas do cartão
  na ordem exacta; Target `21,040 / $320.00`; o caso do stop `$200` →
  `20,975 / $200` continua a passar.
- **`fills-check.js` OK** — `entry | TP1 | TP2`, BE sem número, Total
  `+18.00`, trade page `TP2` (a label nova só muda a saída única, que o
  harness não assertava).
- `node tools/ux-audit.mjs` → **`no normative violations found`**.
- `ledger-check` / `tradelog-check` / `numbers-check` continuam com o drift
  pré-existente (falhavam já antes).
- Deploy vault-dev md5 verificado (`main.js fc3679f351ee7c734b2bae0562742157`,
  `styles.css 701fde2ca7a3ce4ee4c42f626f82fe73`,
  `manifest.json 4395b22f3733eeb1c69bcc3f0a0aeaec`); `data.json` não copiado
  (`89baa19a5881fbf236718b83af496b3d` — mudou só por interação).

