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
| Management modal | `views/accountsManage.ts` | `.tj-mg-card`, `-head`, `-new`, `-cardwrap`/`-cardpick`/`-cardprev`, `-typelist`/`-typerow`, `-row`/`-rowlabel`/`-rowval` |
| Wizard | `views/accountWizard.ts` | `.tj-wz-type*`, `-review`, `-sumcard`, `-sumrows`, `-copynote` |
| Strategies | `views/setupsView.ts` | `.tj-strat-card`, `-item`, `-name`, `-pnl`, `-actions` |
| Settings | `src/settings.ts` | `.tj-account-card`, `.tj-group-card`, `.tj-acct-chip.{type}`, `.tj-theme-gallery`, `.tj-theme-card`(+`.active`) |
| Trade detail | `views/tradeDetailView.ts` | `.tj-td-execs`/`-execcard`, `.tj-td-flip-card`/`-flip-face`/`-ffront`/`-fback`, `.tj-td-dropzone-card`/`-shot-mosaic` |

Labels dos slots (account cards) vêm de `lib/cardSlots.ts` (`BAR_CATALOG`/`MINI_CATALOG`).

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
O anchor ganha `.tj-tip-anchor`; o card vive no `<body>` como `.tj-tip`
(`.tj-tip-title`, `.tj-tip-value` com `pos`/`neg`, `.tj-tip-sub`, variante `.is-wide`).
Aparece em foco de teclado e fecha com `Escape` (WCAG 1.4.13 / 2.2); um guard fecha tips
se o ponteiro não está sobre `.tj-tip-anchor`. `showTip/moveTip/killTip` para hover cards
interativos. `attachTooltip(parent)` em `ui.ts` é legacy — preferir `attachTip`.

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
