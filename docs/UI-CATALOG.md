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

Verde/vermelho (scope `.tj-app`): `--color-green #227a4a`, `--color-green-bright #34d17a`,
`--color-red #ad3527`, `--color-red-bright #ff5d48`, mais `--color-green-rgb`/`--color-red-rgb`.
**Nunca usar cor sozinha** para transmitir estado — acompanhar com texto/símbolo.

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

### 6.1 Primitivas

| Card | Construído por | Classes |
|---|---|---|
| KPI genérico | `kpiCard()` `src/ui.ts` | `.tj-kpi` (+ tone `pos`/`neg`/`neutral`), `.tj-kpi-label`, `.tj-kpi-value`, `.tj-kpi-sub` |
| Wrapper de widget | `DashboardView.renderLayout()` | `.tj-card.tj-gridcard`, `data-wid`, `.tj-blend`, `.tj-intro`, `.tj-static`, `.tj-card-header`, `.tj-card-controls`, `.tj-card-del`, `.tj-gridcard-body` |
| Account tile | `AccountsListView.renderTile()` | `.tj-acct-tile` (+`.is-demo`, `.is-error`) |

### 6.2 Dashboard (`views/dashboard.ts`) — títulos em `CARD_TITLES`

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
| Uma por métrica | `m.*` | `renderMetricBody()` — títulos em `METRIC_TITLES` |

Métricas (`m.*`): netpnl, winrate, trades, maxdd, profitfactor, sharpe, expectancy,
bestday, worstday, largestwin, largestloss, winstreak, lossstreak, wintrades, losstrades,
avgwin, avgloss, avgrr, holdtime, winhold, losshold, besthour, worsthour.

### 6.3 Outras superfícies (ficheiro → classes-chave)

| Superfície | Ficheiro | Classes-chave |
|---|---|---|
| Accounts list | `views/accountsListView.ts` | `.tj-acct-tile`, `-edge`, `-logo`, `-hd*`, `-bal*`, `-prog*`, `-mini*`, `-strip`, `-comp*`, `-sect`; `.tj-tag*`, `.tj-alert*`, `.tj-archived-*` |
| Account dashboard | `views/accountDashboard.ts` | `.tj-acc-hero`, `-eqcard`, `-riskcard`(flip), `-riskbar*`, `-ddbox`/`-ddtrack`, `-mcols`/`-mcol`, `-disc-*`, `-dial`/`-donut`, `-perffacts`, `-btabs`/`-treemap`/`-tile`, `-widgets`/`-widget`, `-cashline`/`.tj-payout-*`, `-passed-banner`/`-band`/`-ring*`, `-copybar`/`-copychip`/`-copyrows` |
| Management modal | `views/accountsManage.ts` | `.tj-mg-card`, `-head`, `-new`, `-step`/`-stepnum`/`-steptitle`/`-stepblock`(+`.is-locked`), `-leadgrid`/`-leadcard`(+`.on`)/`-leadcard-nm`/`-leadcard-sub`, `-lockedlead`(+`-nm`/`-sub`), `-copier`(+`.on`)/`-pick`/`-copier-body`/`-copier-nm`/`-copier-sub`, `-tree` (árvore líder→copiers com conectores CSS), `-typelist`/`-typerow` (pill: borda+radius 14), `-vis` (pill de olho `eye`/`eye-off`, 28px), `-row`/`-rowlabel`/`-rowval`, `-secthead`/`-infoico` (o `(i)` que substitui os banners), `-badge`(+`.is-copier`), `.tj-manage-empty`/`-emptytitle` (título calado + frase; sem diagrama), `-del` (lixo 24×24, `.is-armed`), `-confirmslot`/`-confirm`/`-confirm-txt` (disband com dois toques inline), `-act.is-danger`; dropdown em portal `.tj-mg-dd-list.is-portal` (`fixed`, `z-index` 1100). **duas superfícies sem separadores** — `openCopyGroups` · `openAccountsDisplay` abrem a mesma modal em dois modos, pelos três quadrados do header das Contas (`users` · `sliders-horizontal` · `plus`) — Cards saiu e Types vive dentro do Display |
| Wizard | `views/accountWizard.ts` | `.tj-wz-type*` (ativo: borda `--interactive-accent` + glow), `-review`, `-sumcard`, `-sumrows`/`-sumrow`/`-sumk`/`-sumv` (tabela chave-valor), `-copynote`, `-secthint`, `-rulegrid` (2 colunas), `-affixhead`/`-affix`/`-affix-pre`/`-affix-suf` (afixos `$`/`%`/`days`), `-untoggle`/`-unbtn` (toggle `$ | %`), `-disclaimer-ico`, `-logogrid`/`-logogroup`/`-logoglbl`/`-logotiles`/`-logotile`(+`.on`)/`-logotile-img`/`-logotile-init`/`-logotile-lbl`/`-logo-own`/`-logocustom`, `-step.off`, `-preset` |
| Strategies | `views/setupsView.ts` | `.tj-strat-card`, `-item`, `-name`, `-pnl`, `-actions` |
| Settings | `src/settings.ts` | `.tj-account-card`, `.tj-group-card`, `.tj-acct-chip.{type}`, `.tj-theme-gallery`, `.tj-theme-card`(+`.active`) |
| Trade detail | `views/tradeDetailView.ts` | `.tj-td-execs`/`-execcard`, `.tj-td-flip-card`/`-flip-face`/`-ffront`/`-fback`, `.tj-td-dropzone-card`/`-shot-mosaic` |
| Import CSV | `views/importUi.ts` | `.tj-import-pick` (o bloco **Where these trades go**, primeiro da página; `.is-set` quando já há resposta), `-pickhead`/`-pickico` (crosshair)/`-picktitle`/`-pickstate`(`.is-empty` âmbar / `.is-set` verde)/`-pickhint`(`.is-warn`), `-maprow`/`-mapdot`(`.is-on`)/`-mapname`(+`.is-plain` quando o ficheiro traz um só nome, sem `-maplabel`)/`-maplabel` (`Account 1`, só com vários nomes)/`-mapcount` (`3 trades · 19 Aug → 14 Sep 2026`; o número de conta do broker **nunca** é escrito), `-mapdd` (dropdown da casa a largura toda); `.tj-import-group`/`-grouphead`/`-groupico`/`-groupsub` (**This Trading Group**, só depois de haver conta), `.tj-import-accs`/`-acc`/`-accdot`/`-accname`/`-accwho` (o *Also record these trades in*), `.tj-role`(+`.is-leader` âmbar/`.is-copier` acento), `.tj-ratio`, `.tj-import-window`(+`.is-warn`); `.tj-import-costs` (3 factos: platform · glued · in account), `.tj-import-balance`(+`.is-ok`/`.is-warn`)/`-balanceico` (saldo journal vs platform), `.tj-import-helper` (porque o CTA está desativado; também o aviso de trades sem conta), `.tj-file-badge`, `.tj-dropzone` |
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
hover card `.tj-eq-card`. Primitivas SVG em `ui.ts`: `svgLine`, `svgPath`, `pathFromPoints`,
`renderAreaChart` (clip verde acima/vermelho abaixo), `cumulativeEquitySeries`. Calendário:
`PerformanceCalendarWidget`. Radar e treemap são SVG inline. Regras de chart em `UX-GUIDELINES.md`.

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
