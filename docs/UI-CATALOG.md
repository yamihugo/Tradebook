# UI-CATALOG.md — tokens, cards e convenções (referência)

> **Referência, não lei.** As *regras* de design (contraste AA, hierarquia, alvos,
> ordem) estão em `UX-GUIDELINES.md`. Aqui está o **catálogo** do que existe no código:
> tokens, cards, states e convenções CSS/JS. Lido quando se constrói ou altera UI.

---

## 1. Tipografia — `--tj-fs-*` (em `styles.css` `:root`)

| Token | Valor | Uso |
|---|---|---|
| `--tj-fs-label` | `9.5px` | micro-labels uppercase |
| `--tj-fs-small` | `11px` | hints, sub-linhas, meta |
| `--tj-fs-body` | `12.5px` | texto/linhas por omissão |
| `--tj-fs-strong` | `13.5px` | nomes, valores-chave |
| `--tj-fs-big` | `15px` | números dentro de cards |
| `--tj-fs-head` | `19px` | valor headline |
| `--tj-fs-display` | `24px` | títulos de página/modal |
| `--tj-fs-hero` | `28px` | a única figura num anel/gauge |

Pesos: `--tj-w-regular` `400` · `--tj-w-medium` `600` · `--tj-w-bold` `700`.

## 2. Cor e contraste

| Token | Valor | Nota |
|---|---|---|
| `--tj-fg-1` | `#dcddde` | texto principal (12.1:1) |
| `--tj-fg-2` | `#a8aeb4` | secundário (7.0:1) |
| `--tj-fg-3` | `#8a9099` | mais discreto (5.1:1) |
| `--tj-tone-good` | `var(--color-green-bright, #34d17a)` | bom (gauges, barras de estado) |
| `--tj-tone-mid` | `#d9a441` | meio |
| `--tj-tone-bad` | `var(--color-red-bright, #ff5d48)` | mau |

Verde/vermelho (scope `.tj-app`): `--color-green #227a4a`, `--color-green-bright #34d17a`,
`--color-red #ad3527`, `--color-red-bright #ff5d48`, mais `--color-green-rgb`/`--color-red-rgb`.
Os tokens semânticos `--tj-tone-*` existem para que gauges e barras de estado leiam do tema
em vez de hex hardcoded no JS. **Nunca usar cor sozinha** para transmitir estado — acompanhar com
texto/símbolo.

## 3. Espaçamento — `--tj-sp-*`

`--tj-sp-1 4px` · `--tj-sp-2 8px` · `--tj-sp-3 12px` · `--tj-sp-4 16px` ·
`--tj-sp-5 24px` · `--tj-sp-6 32px`. Base de 4px.

## 4. Superfície e tema

- Scope `.tj-app`: `--tj-accent` (= `var(--interactive-accent)`), `--tj-accent-soft`, `--tj-dot`.
- **Escritos em runtime** por `renderAppShell()` a partir do tema ativo: `--tj-accent`,
  `--tj-dot`, `--tj-surface`, `--tj-bg`, `--tj-bg2`, `--tj-border`.
- Escritos inline por widgets: `--tj-gauge-color`, `--tj-score-color`.
- `--tj-nav-bg` (= `var(--background-secondary)`).
- **Dívida conhecida:** `--tj-muted` é usado com fallback mas nunca definido.

## 5. Temas (`src/themes.ts`)

`default` · `dotted` · `tokyo` · `tech` · `midnight` · `notion` · `ocean` · `forest` ·
`mono` · `paper` · `cyber` · `kanagawa` · `rosepine` · `gruvbox` · `nord`.
Padrões: `none | dots | grid | scanlines | stars | aurora | gradient`. Fontes: `sans | mono | serif`.

---

## 6. Cards (catálogo)

> "Card" = painel com moldura. Convenção: `createDiv({ cls })` na criação; classes de
> estado via `addClass` **uma por chamada**.

### 6.0 Receita canónica de superfície (normativa)

A partir de 19 Set 2026 há **uma** forma de abrir uma página — a linguagem da página
**Accounts**, que é a implementação de referência. Nenhuma superfície inventa a sua: a
moldura vem das hairlines, o número vem primeiro, cada número explica-se e os cartões são
translúcidos. As restantes páginas adotam-na à vez (ver BACKLOG).

| Peça | Classes | Regra |
|---|---|---|
| Cabeçalho de página | `h1.tj-view-h1` + `p.tj-import-info`; ações `.tj-iconbtn` / `.tj-filterbtn` | Título à esquerda, ações à direita; uma ação primária, no máximo. |
| Linha de números | `.tj-acct-strip` → `.tj-acct-strip-cell` → `.tj-acct-strip-k` (+`.tj-info-dot`) / `.tj-acct-strip-v` / `.tj-acct-strip-sub` | **Um** cartão segmentado: grelha com `gap:1px` sobre a cor da hairline, cada célula em `background-primary`. `-v` a `--tj-fs-head`/700/tabular. **Cada figura leva um `(i)`.** |
| Lista / painel | `.tj-panel` (cartão: raio 14, `rgba(255,255,255,.022)`, hairline) → cabeçalho `.tj-acct-h1` (`-dot`/`-t`/`-c`/`-line`) + `.tj-panel-note`; a tabela/lista por baixo | Cabeçalho dentro do cartão: ponto, micro-label, contagem a 700, hairline e a nota à direita. Sem cartão cinzento e nunca um cartão dentro de outro. |
| Fila de atenção | `.tj-attention` → `.tj-attn-chip` (+`.is-on`), `.tj-attn-none` | Chip em pill da casa (hairline + `rgba(255,255,255,.05)`), tinta do estado `--tj-tone-mid`, sempre com a palavra — nunca só cor. |
| Gaveta | `.tj-tl-drawer` (cartão irmão: raio 14, `rgba(255,255,255,.022)`, hairline, 320px) | Uma coluna ao lado da lista, não uma gaveta overlaying. |
| Cabeçalho de grupo | `.tj-acct-h1` (+`.is-sub`) | O mesmo padrão dentro de secções: ponto, label uppercase, pill de contagem, hairline, valor à direita. |

Proibido nesta receita: `#d9a441` literal (usar `--tj-tone-mid`), `background-secondary`
como fundo de cartão de página, `box-shadow` decorativo, e colorir o estado sem a palavra.
Dívida conhecida: **o Trade Log adotou A**; **Home e a página da conta** ainda não (mantêm
`.tj-card.tj-gridcard` com sombra e `.tj-acc-*`) e alinham numa passagem seguinte
(`BACKLOG-AND-HISTORY.md` §7).

### 6.1 Primitivas

| Card | Construído por | Classes |
|---|---|---|
| KPI genérico | `kpiCard()` `src/ui.ts` | `.tj-kpi` (+ tone `pos`/`neg`/`neutral`), `.tj-kpi-label`, `.tj-kpi-value`, `.tj-kpi-sub` |
| Wrapper de widget | `DashboardView.renderLayout()` | `.tj-card.tj-gridcard`, `data-wid`, `.tj-blend`, `.tj-intro`, `.tj-static`, `.tj-card-header`, `.tj-card-controls`, `.tj-card-del`, `.tj-gridcard-body` |
| Account tile | `AccountsListView.renderTile()` | `.tj-acct-tile` (+`.is-demo`, `.is-error`) |

### 6.2 Briefing/Analytics (`views/dashboard.ts`) — títulos em `CARD_TITLES`

| Nome | `data-wid` | Builder |
|---|---|---|
| Cumulative P&L | `equity` | `renderEquityBody()` |
| Long/Short P&L | `longpnl`/`shortpnl` | `renderEquityBody(..., "long"/"short")` |
| Performance Calendar | `calendar` | `PerformanceCalendarWidget` |
| Last 6 Months | `heatmap` | `renderHeatmap()` |
| Best Hours | `besthours` | `renderBestHours()` |
| Symbol Breakdown | `symbols` | `renderSymbolTable()` |
| Trading Score & Radar | `score` | `renderScoreRadar()` |
| Needs Review | `review` | `renderReviewWidget()` |
| Trends | `trends` | `renderTrendsWidget()` |
| Payouts | `payouts` | `renderPayoutsWidget()` |
| Breakdown | `breakdown` | `renderBreakdownWidget()` — tabs `.tj-bd-tabs`/`.tj-bd-tab` (texto limpo + underline accent no `.on`, como a conta), **um treemap por dimensão** (Symbol · Setup · Type · Day · Hour · Session); tiles clicáveis (`.tj-treemap-tile-click`, `.is-active`) abrem o Trade Log com a lente do bucket + o scope da grelha |
| Uma por métrica | `m.*` | `renderMetricBody()` — títulos em `METRIC_TITLES` |

Métricas (`m.*`): netpnl, winrate, trades, maxdd, profitfactor, sharpe, expectancy,
bestday, worstday, largestwin, largestloss, winstreak, lossstreak, wintrades, losstrades,
avgwin, avgloss, avgrr, holdtime, winhold, losshold, besthour, worsthour.

### 6.3 Outras superfícies (ficheiro → classes-chave)

| Superfície | Ficheiro | Classes-chave |
|---|---|---|
| Accounts list | `views/accountsListView.ts` | `.tj-acct-tile` (flex column; `-prog.is-first` com `margin-top:auto` encosta barras+mini ao fundo), `-edge`, `-logo`, `-hd*`, `-bal*`, `-prog*`, `-mini*`, `-strip`, `-comp*`, `-sect`; `.tj-tag*`, `-tag-ico` (coroa Lucide no líder), `.tj-alert*`, `.tj-archived-*` |
| Account dashboard | `views/accountDashboard.ts` | `.tj-acc-hero`, `-eqcard`, `-riskcard`(flip), `-riskbar*`/`-marker-dd`, `-ddbox`/`-ddtype`, `-mcols`/`-mcol`, `-disc-*`, `-dial`/`-donut`, `-perffacts`, `-btabs`/`-treemap`/`-tile`, `-widgets`/`-widget`, `-cashline`/`.tj-payout-*`, `-passed-banner`/`-band`/`-ring*`, `-copybar`/`-copychip`/`-copychip-ico`; modal de settings da conta (`.tj-acc-settings`/`.tj-as-pane`/`.tj-as-row*`/`.tj-as-hint`) cujos separadores **General** e **Rules** reutilizam os campos do wizard (`.tj-wz-field`/`-label`/`-affix`(+`.is-hidden`)/`-input`/`-untoggle`/`-types`/`-type`/`-disclaimer`) sob `.tj-acc-settings`/`.tj-account-wizard.tj-as-pane`; a lista de trades é o **mesmo painel do Trade Log** (`.tj-panel` + cabeçalho `.tj-acct-h1` com contagem e o chip do filtro), nunca uma tabela nua |
| Management modal | `views/accountsManage.ts` | `.tj-mg-card`, `-head`, `-new`, `-step`/`-stepnum`/`-steptitle`/`-stepblock`(+`.is-locked`), `-leadgrid`/`-leadcard`(+`.on`)/`-leadcard-nm`/`-leadcard-sub`, `-lockedlead`(+`-nm`/`-sub`), `-copier`(+`.on`)/`-pick`/`-copier-body`/`-copier-nm`/`-copier-sub`, `-tree` (árvore líder→copiers com conectores CSS), `-typelist`/`-typerow` (pill: borda+radius 14), `-vis` (pill de olho `eye`/`eye-off`, 28px), `-row`/`-rowlabel`/`-rowval`, `-secthead`/`-infoico` (o `(i)` que substitui os banners), `-badge`(+`.is-copier`), `.tj-manage-empty`/`-emptytitle` (título calado + frase; sem diagrama), `-del` (lixo 24×24, `.is-armed`), `-confirmslot`/`-confirm`/`-confirm-txt` (disband com dois toques inline), `-act.is-danger`, `-sect`/`-sectitle` (secções do grupo: Change leader junto do líder · Add a copier); dropdown em portal `.tj-mg-dd-list.is-portal` (`fixed`, `z-index` 1100; o botão **repinta** label/chip/`on` no clique). **duas superfícies sem separadores** — `openCopyGroups` · `openAccountsDisplay` abrem a mesma modal em dois modos, pelos três quadrados do header das Contas, agora ordenados **Copy groups (`users`) · Add account (`plus`) · Settings (`sliders-horizontal`, no canto direito)** — Cards saiu e Types vive dentro do Settings |
| Wizard | `views/accountWizard.ts` | `.tj-wz-type*` (ativo: borda `--interactive-accent` + glow), `-review`, `-sumcard`, `-sumrows`/`-sumrow`/`-sumk`/`-sumv` (tabela chave-valor), `-copynote`, `-secthint`, `-rulegrid` (2 colunas), `-affixhead`/`-affix`/`-affix-pre`/`-affix-suf` (afixos `$`/`%`/`days`), `-untoggle`/`-unbtn` (toggle `$ | %`), `-disclaimer-ico`, `-logogrid`/`-logogroup`/`-logoglbl`/`-logotiles`/`-logotile`(+`.on`)/`-logotile-img`/`-logotile-init`/`-logotile-lbl`/`-logo-own`/`-logocustom`, `-step.off`, `-preset` |
| Strategies | `views/setupsView.ts` | `.tj-strat-card`, `-item`, `-name`, `-pnl`, `-actions`, `-add`, `-input`, `-untracked`, `-empty`(+`-empty-sub`), `-note`/`-note-ico`/`-note-txt`/`-note-strong` (nota calada do martelo) |
| Trade log | `views/tradeLogView.ts` | Cabeçalho `.tj-acct-header`/`-header-actions` + `h1.tj-view-h1` + `p.tj-import-info`; **receita canónica §6.0 (linguagem Accounts)**: faixa `.tj-acct-strip`/`-strip-cell`/`-strip-k`(+`.tj-info-dot`)/`-strip-v`/`-strip-sub` (um cartão segmentado em vez de mini-cards), `.tj-attention`/`.tj-attn-chip`(+`.is-on`)/`.tj-attn-none`, `.tj-panel` (cartão raio 14) com cabeçalho `.tj-acct-h1`(`-dot`/`-t`/`-c`/`-line`) + `.tj-panel-note`; `.tj-tl-sub`, `.tj-tl-search`/`-search-ico` (só hairline por baixo), `.tj-tl-periodbar` (**segmented control**), `.tj-tl-active`/`-activechip`/`-activechip-x`/`-activeclear` (filtros activos em texto sublinhado), `.tj-tl-shell`/`-col`/`-bulkhost` (sticky), `.tj-tl-more` (Load more ghost `.tj-actionbtn`), `.tj-tl-bulk`/`-bulkinline`/`-bulkinput`/`-bulkpick`/`-bulkbtn`/`-bulk-count` (barra flutuante: cartão translúcido com borda de acento, botões **só com palavras**), `.tj-tl-drawer`/`-drawerhead`/`-drawer-title`/`-drawer-x`/`-drawerbody`/`-drawerfoot`/`-drawer-clear`/`-drawer-show` (gaveta = cartão irmão; filtros em **linhas de pills**: `.tj-tl-dsec`/`-dsec-t` → `.tj-tl-opts` → `.tj-tl-opt`(+`.on`)/`.tj-tl-optnone`, par include/exclude em `.tj-tl-incl`), `.tj-tl-pop`/`-cols`/`-colrow`/`-colmove`/`-colmove-b` (setas, alternativa ao drag)/`-colside*`/`-colpresets`/`-presetbtn` (popover de colunas); picker de contas `.tj-tl-accpick`/`-accsearch`/`-acctop`/`-acclist`/`-accrow`/`-accname`/`-accinfo`/`-accn`/`-acctools`/`-accbtn`/`-accbox`/`-picknone`; `.tj-confirm-title`/`-confirm-body`/`.tj-confirm-actions` e `.tj-btn-del` (modal da casa no delete). Os dropdowns (bulk + gaveta) são o **dropdown da casa** `.tj-mg-dd-*`. |
| Ledger partilhado (tabela) | `lib/tradeTable.ts` (usado pelo Trade Log e pela página da conta) | `.tj-tbl*` em linguagem A: células e linhas de execução em `--tj-fg-3`, hover `rgba(255,255,255,.035)`, cabeçalho do dia transparente com hairline e pill `.05`, header quadrado (sem `border-radius`) e os estados (estrelas, `.tj-tbl-review`, `.tj-tbl-pnl-partial`) em `--tj-tone-mid`. Nas **duas** superfícies vive dentro de `.tj-panel` com cabeçalho `.tj-acct-h1` (no Trade Log `Trades` + contagem; na conta o mesmo painel, com o chip do filtro à direita). |
| Settings | `src/settings.ts` | `.tj-account-card`, `.tj-group-card`, `.tj-acct-chip.{type}`, `.tj-theme-gallery`, `.tj-theme-card`(+`.active`) |
| Trade detail | `views/tradeDetailView.ts` | `.tj-td-hero`/`-hero-title`/`-hero-sym`/`-hero-when`/`-hero-badge`(+`.tj-td-hero-dir.is-long`/`.is-short`, `.tj-td-hero-status.is-status.is-needs-review`/`.is-reviewed`)/`-hero-metrics`/`-hero-metric`/`-hero-k`/`-hero-v`(+`.pos`/`.neg`); grid `.tj-td-cols` + `.tj-td-left`/`-right`; cartões `.tj-td-panel`/`-panel-head`/`-panel-title`/`-panel-body`; linhas `.tj-td-flip-row`/`-flip-key`/`-flip-val`(+`.pos`/`.neg`)/`-flip-input`/`-tz`, `.tj-td-flip-row-strat`/`-strat-wrap`, `-flip-row-rating` + `.tj-td-stars-inline`/`.tj-td-star`/`-star-glyph`; chips `.tj-td-tags`(+`.tj-td-tags--mistakes`)/`-tagchips`/`-tagchip`(+`.is-on`)/`-tagadd`/`-tagaddbtn`/`-taginput`; prints `.tj-td-shot-carousel`/`-shot-main`/`-shot-img`/`-shot-badge`/`-shot-annotate`/`-shot-labels`/`-shot-labelinput`/`-shot-thumbs`/`-shot-thumb`(+`.is-active`)/`-shot-thumb-label`/`-shot-thumb-missing`/`-shot-remove`/`-shot-add`/`-shot-add-plus`/`-shot-add-label`, `.tj-td-dropzone` (vazio), lightbox `.tj-td-lightbox`/`-lightbox-img`; execuções `.tj-td-execs`/`-execs-head`/`-execs-table`/`-execrow`(+`.is-entry`/`.is-exit`/`.is-total`)/`-execs-tag`/`-execs-note`; badge de contas `.tj-td-accbadge`/`-accpop`/`-acctable-row`/`-acctable-name`/`-acctable-num`/`-acctag` |
| Import CSV | `views/importUi.ts` | `.tj-import-pick` (o bloco **Where these trades go**, primeiro da página; `.is-set` quando já há resposta), `-pickhead`/`-pickico` (crosshair)/`-picktitle`/`-pickstate`(`.is-empty` âmbar / `.is-set` verde)/`-pickhint`(`.is-warn`), `-maprow`/`-mapdot`(`.is-on`)/`-mapname`(+`.is-plain` quando o ficheiro traz um só nome, sem `-maplabel`)/`-maplabel` (`Account 1`, só com vários nomes)/`-mapcount` (`3 trades · 19 Aug → 14 Sep 2026`; o número de conta do broker **nunca** é escrito), `-mapdd` (dropdown da casa a largura toda); `.tj-import-group`/`-grouphead`/`-groupico`/`-groupsub` (**This Trading Group**, só depois de haver conta), `.tj-import-accs`/`-acc`/`-accdot`/`-accname`/`-accwho` (o *Also record these trades in*), `.tj-role`(+`.is-leader` âmbar/`.is-copier` acento), `.tj-ratio`, `.tj-import-window`(+`.is-warn`); `.tj-import-costs` (3 factos: platform · glued · in account), `.tj-import-balance`(+`.is-ok`/`.is-warn`)/`-balanceico` (saldo journal vs platform), `.tj-import-helper` (porque o CTA está desativado; também o aviso de trades sem conta), `.tj-file-badge`, `.tj-dropzone`, `.tj-import-setuprow`/`-setuplbl`/`-setupctl`/`-setupnote` (campo **Strategy** opcional, aplicado a todas), `.tj-import-nostrategy` (recibo `N without strategy` + *Assign strategies*) |
| Dropdown da casa | `lib/dropdown.ts` | `.tj-mg-dd` (wrapper) / `-btn` (ghost) / `-val`(+`.is-placeholder`) / `-chev` / `-list`(+`.is-portal`: lista em `<body>`, `fixed`, `z-index` 1100, flip, reposiciona em scroll/resize) / `-item`(+`.on`/`.is-off`) / `-txt` (coluna do rótulo) / `-head` (cabeçalho de secção, não clicável, ex. Leaders · Copiers · Standalone) / `-tag`(+`.is-leader` âmbar / `.is-copier` acento, ex. `Copier ×0.5`) / `-lbl` / `-note` / `-empty` |
| Delete account | `views/accountDashboard.ts` | `.tj-delete-confirm`, `-icon`, `-desc`, `-list`/`-fact` (o que morre), `-hint`, `.tj-del` (vermelho) |

Labels dos slots (account cards) vêm de `lib/cardSlots.ts` (`BAR_CATALOG`/`MINI_CATALOG`).

**Wizard de conta** (`accountWizard.ts`): 4 passos — Type · Brand · Account · Review
(`flow()` = `[0,1,2,3]` para todos; personal/demo param depois da identidade). O passo 1 usa
ícones Lucide (`setIcon`) e o cartão ativo fica com borda `--interactive-accent` + glow.
O passo 2 é **só marca**: a grelha `.tj-wz-logogrid` em 3 secções (Prop firms · Brokers ·
Practice em símbolo CSS) + tile "Custom" com iniciais (`branding.initials`); as pills têm
altura fixa (40px) e o rótulo corta com ellipsis. O passo 3 abre com o **tamanho da conta
vazio e obrigatório**: um dropdown (`$25K · $50K · $100K · $150K · $300K · Custom…`, sem a
palavra "Standard", botão "Choose a size" enquanto vazio) que, ao ser escolhido, preenche
target/max loss/daily loss a 6%/4%/2%; **Custom…** revela um campo `$` cujo valor actualiza o
tamanho **e** o nome. Não há campo manual de saldo inicial — o tamanho *é* o saldo. Segue-se
**Nome + Started on numa linha de 2 colunas** (`.tj-wz-row-2`, empilha <560px): o **nome está
ligado** à marca, tipo e tamanho (`Tradeify Eval` enquanto não há tamanho, `Tradeify Eval $50K`
depois — `typeLabel` respeita as labels configuráveis; escrever no nome liberta-o, `nameTouched`)
e o **Started on** nasce **vazio** e é obrigatório —
o `Next` só desbloqueia com tamanho > 0 **e** data (`.tj-account-wizard .tj-wz-foot
.tj-btn:disabled`), e o helper `.tj-wz-secthint` diz só o que falta: "Choose a size and a start
date to continue." · "Choose a size to continue." · "Choose a start date to continue.". As regras são **escritas pelo
trader** ($ ou % como afixos estáticos `.tj-wz-affix-pre`/`-affix-suf`, com toggle `$ | %` inline
`.tj-wz-unbtn` dentro de um track `.tj-wz-untoggle`; sem `<select>`); o dropdown `.tj-dd` é
endurecido dentro do modal (`.tj-account-wizard .tj-dd-*` com `!important` — o Obsidian pinta os
botões por cima de uma classe solta e parecia nativo), e o aviso de que as regras das firms mudam
fica sempre visível. O passo 4 é uma tabela chave-valor
(`.tj-wz-sumrow` com hairline, valores à direita a 700). O resolvedor `lib/accountRules.ts`
serve todos os ecrãs; uma conta sem preset conhecido nunca falha — as regras em falta
leem-se como `0`.

**Settings** (`src/settings.ts`): sem "Quick add" — o botão "Open wizard" é a única porta para
criar contas; a lista lê as regras pelo resolvedor.

**Ordem do header da conta** (`accountDashboard.ts`): badges (linha de payout) → carteira
(payouts) → recibo (Correct fees) → roda (Account settings), o gear no canto direito.

**Calendário** (`lib/calendar.ts`, usado por todos os `mountDateField`): popup próprio, sem o
picker nativo do sistema. Cabeçalho `.tj-cal-head` (`‹ Mês Ano ›` + `.tj-cal-today` "Today"),
grelha `.tj-cal-grid` de 7 colunas × 30px com a semana a começar à segunda, `.tj-cal-day` e
estados `is-out` (outro mês), `is-today` (contorno), `is-sel` (acento `--interactive-accent`) e
`:focus-visible`; `is-*` a `!important` sobre os botões do Obsidian. Popup `position: fixed`,
`z-index: 1100`, preso ao campo por `getBoundingClientRect`, fora do modal para nunca ser cortado;
fecha com clique fora, Escape ou scroll. Teclado: setas ±1/±7 dias, PageUp/PageDown ±1 mês,
Enter escolhe; o campo continua a aceitar a data escrita à mão.

**Correct fees** (`feeAdjustModal.ts`): o input do saldo foca ao abrir e a qualquer clique na
linha inteira (handler no `.tj-mg-row` em `mousedown`, não só no `.tj-mg-rowval`), e o foco
sobrevive ao re-render assíncrono; `:focus` usa `--interactive-accent` com fundo
`color-mix(--interactive-accent 8%)`, hover mantém `--text-muted`. Sob o par de datas
("Spread over") fica a linha `.tj-fees-windowhint` a explicar a partilha. A partilha é
**proporcional ao nº de contratos** (`allocateProportional`), a chave de cada fatia é única
(`tradeFeeKeys`: `fillId` → caminho da nota → composta antiga como fallback), e o Post-Trade
Review (`tradeDetailView.ts`) mostra, na linha "Fees", `$total · $X corrected` com tooltip de
**model** (o número da plataforma e a fatia da correção nunca se fundem às escondidas). Se uma
fatia guardada já não encontra o trade, o modal avisa em `.tj-fees-orphan` (continua a contar
para o saldo). Nenhuma nota é reescrita.

### 6.3.1 Breakpoints do Trade Detail

| Largura   | Layout                                        |
|-----------|-----------------------------------------------|
| ≥1400px   | 2 colunas: rail 440px + painel elástico        |
| 900–1399  | 2 colunas: rail 360px + painel elástico        |
| <900px    | 1 coluna empilhada por prioridade:             |
|           | hero → screenshots → review → execução → fills |

### 6.3.2 Hero como cartão

O hero vive no corpo (não no header sticky). O header fica só com
navegação e ações. Assim em ecrãs pequenos o header não conta altura
fixa, e o hero pode fazer scroll com o resto.

### 6.4 Estados vazios e erros

Padrão: `.tj-emptystate` com ícone + título + sub + (nota) + ações. Exemplos canónicos:
"No trades yet — add trades to see the portfolio curve." · "No accounts yet — add one
above and it gets its own dashboard." · "No pending prints".
Erros de widget: "«Título» had a problem." / "… — tap Edit to remove it."
Erros de ficheiro/import/save: "Could not … — check the console."

---

## 7. States (catálogo)

Estados usam nomes **sem prefixo** e são sempre passados um a um:

`active · on · open · over · dragging · is-active · is-hidden · is-demo · is-error ·
is-selected · is-placeholder · is-tiny · is-narrow · is-compact · is-dragging · is-drop ·
is-drop-below · is-wider · is-better · is-worse · is-disabled · is-empty · is-visible ·
is-copier · is-leader · is-primary · is-quiet · is-complete · is-warn · is-still`

Tons: `pos` · `neg` · `warn` · `neutral` (ex.: `.tj-kpi.pos`). `toneClass(v)` em
`lib/fills.ts` devolve `tj-pos`/`tj-neg` (com prefixo — é a exceção).

**Regra dura:** `addClass` recebe **um token só**. Bandas como `dd safe` são passadas
como string de classes na criação — `addClass` com espaços é rejeitado pelo Obsidian.

---

## 8. Comportamentos

### 8.1 Tooltips — `attachTip` é a API canónica

`attachTip(el, { title?, value?, tone?("pos"|"neg"|""), sub? }, extraCls?)` em `lib/tip.ts`.
O anchor ganha `.tj-tip-anchor` (o próprio `attachTip` o garante); o card vive no `<body>`
como `.tj-tip`
(`.tj-tip-title`, `.tj-tip-value` com `pos`/`neg`, `.tj-tip-sub`, variante `.is-wide`).
Aparece em foco de teclado e fecha com `Escape` (WCAG 1.4.13 / 2.2); um guard fecha tips
se o ponteiro não está sobre `.tj-tip-anchor`. `showTip/moveTip/killTip` para hover cards
interativos. `attachTooltip(parent)` em `ui.ts` é legacy — preferir `attachTip`.
**Nunca pôr `aria-label` num elemento que já usa `attachTip`**: o Obsidian desenha a própria
tooltip para qualquer `aria-label` e essa (genérica, igual em todo o lado — ex. "More
information") passa a ser a única que se vê. Para um ícone `(i)`, o glifo é `aria-hidden` e o
nome acessível é um `span.tj-sr-only` com o que aquela coisa explica (ex. `About Types`).

**Um só glifo de informação.** O `(i)` é o pictograma do próprio Obsidian —
`const g = el.createSpan(); setIcon(g, "info")` — a 14px e `--tj-fg-3` (`.tj-info-dot svg`,
`.tj-manage-infoico svg`). O ícone já desenha o seu círculo, por isso **não** se acrescenta
borda nem raio nossos (daria um aro dentro de outro). Vale para a faixa, o gráfico, o
dashboard da conta e as secções do Management.

### 8.2 Interação & acessibilidade

- Alvos de toque **≥ 24×24**.
- Reordenar oferece sempre **setas** além de drag (WCAG 2.2 SC 2.5.7).
- Animações respeitam `prefers-reduced-motion`; setting **Appearance → Animations**.
  Count-up 1.2s easeOutCubic; morph do equity 700ms.
- **Settings write-through:** Management, account settings e wizard escrevem logo, sem Save.

### 8.3 Gráficos

`renderLineChart(container, opts)` (`lib/lineChart.ts`) é o único line/area chart: séries
secundárias/tracejadas, marcadores (payout/deposit), `baseline`/`targetLine`/`ddLine`/`fadeFloor`,
hover card `.tj-eq-card`. `dayCash` é `{index, kind}` — `.tj-eq-daydot.is-cash.is-out` dourado
(payout), `.is-in` verde (depósito), `.is-cost` neutro `--tj-fg-3` (correção de fees); o hover
segue a mesma regra (`b.tj-cash` / `b.tj-pos` / `b.tj-cost`). Primitivas SVG em `ui.ts`: `svgLine`,
`svgPath`, `pathFromPoints`, `renderAreaChart` (clip verde acima/vermelho abaixo),
`cumulativeEquitySeries`. Calendário: `PerformanceCalendarWidget`. Radar e treemap são SVG inline.
Regras de chart em `UX-GUIDELINES.md`.

### 8.4 Grid do dashboard

Grid próprio (`lib/grid.ts`): drag, resize, compact, placeholder e ghost; `data-wid`
identifica o widget; layout persistido.

---

## 9. Convenções CSS / JS

- **Prefixo `tj-`** em todas as classes (~1353 selectors `.tj-*`).
- **Blocos por feature:** `tj-app` shell · `tj-dashboard`/`tj-gridcard` · `tj-acc-` account
  dashboard · `tj-acct-` accounts list · `tj-as-` account settings · `tj-mg-` management ·
  `tj-wz-` wizard · `tj-add-`/`tj-addpanel` add trade · `tj-td-` trade detail · `tj-tl-`
  trade log · `tj-tbl-` tabela ledger · `tj-strat-` strategies · `tj-pcal-` calendário ·
  `tj-nav-` sidebar · `tj-pq-` print queue · `tj-anno-` annotator · `tj-payout-`/`tj-pay-`
  payouts · `tj-rename-` rename · `tj-backup-` backup · `tj-set-`/`tj-settings` settings ·
  `tj-start-` onboarding · `tj-printpick-` print picker · `tj-export-` export ·
  `tj-filter*`/`tj-pop*`/`tj-period*` popovers · `tj-tip-` tooltips · `tj-eq-` chart.
- `styles.css` está na raiz e é **prettier multi-line** — os `oldString` do edit têm de
  bater exatamente.
- **Sem código morto nem CSS morto.**
- Comentários em inglês no código; respostas em PT-PT.
- **Não duplicar**: usar as primitivas partilhadas (`kpiCard`, `renderTradeTable`,
  `mountDropdown`, `mountDateField`, `cardSlots`, `computeAccountMetrics`,
  `analyticsTrades`, `attachTip`) em vez de reinventar.
- **`input[type=number]` passa sempre por `freeNumeric`** (`lib/numeric.ts`): `step="any"`,
  sem `min`/`max` no markup, `invalid` cancelado e `novalidate` no form mais próximo. Os
  limites são impostos pelos handlers que lêem o valor — a bolha de validação nativa do
  Chromium é do browser, não se estiliza e parece um bug dentro de um modal escuro.
- **Ritmo das secções (Management)**: `.tj-manage-sect` separa com `--tj-sp-5`, o título
  `.tj-manage-sectitle` usa `--tj-fs-label` com tracking `.12em` e o `.tj-manage-secthead`
  dá `--tj-sp-2` até ao primeiro conteúdo; notas e cartões fecham com `--tj-sp-4`. O mesmo
  intervalo em todas as secções (Layout · What appears · Types).
